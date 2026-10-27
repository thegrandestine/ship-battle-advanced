// Robustness check: bot A vs bot B across scenarios (tools/zero/scenarios.js EVAL_SCENARIOS),
// to catch a net that aces the standard game but folds when the rules or the start change.
// Scenarios marked * are held out of training ('far'); the rest are fresh draws of trained-on noise.
//   node tools/zero/robust.js <A> <B> [games per scenario=40] [--a '{cfg}'] [--b '{cfg}']
//        [--scen standard,midfight,...] [--open 2] [--max 200] [--seed 1] [--threads N] [--json]
// Bots as in tools/tourney.js (zero, gm, gm3, normal, ...). Grandmaster plays every scenario by
// its rules (its lookahead runs on the same modified sim); gm3's book is off outside 'classic',
// as in the live game. A plays red in even games, blue in odd ones. --open N: both sides play
// random moves for the first 0..N turns, so deterministic bots still play distinct games.

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import { newSimState, stepTurn, SimError } from '../../js/sim.js';
import { legalMoves } from '../../js/zero.js';
import { DIFFICULTIES } from '../../js/config.js';
import { makeBot } from '../match.js';
import { grandmasterBot } from '../bots.js';
import { mulberry32 } from '../rng.js';
import { EVAL_SCENARIOS, NEAR, applyStart, resetRules, MAX_SHIPS } from './scenarios.js';

function botFor(name, cfg, scen, cache) {
    const key = name === 'gm3' && scen !== 'classic' ? 'gm3-nobook' : name;
    if (!cache[key]) {
        cache[key] = key === 'gm3-nobook'
            ? grandmasterBot({ ...DIFFICULTIES.grandmasterV3.gmCfg, book: false })
            : makeBot(name, cfg, 0);
    }
    return cache[key];
}

function play({ scen, seed, aSide }, W, cache) {
    const rng = mulberry32(seed);
    const S = newSimState();
    applyStart(S, EVAL_SCENARIOS[scen](rng));
    const bSide = aSide === 'red' ? 'blue' : 'red';
    const bots = { [aSide]: botFor(W.aName, W.aCfg, scen, cache.a), [bSide]: botFor(W.bName, W.bCfg, scen, cache.b) };
    const memo = { blue: {}, red: {} };
    const open = Math.floor(rng() * (W.open + 1));
    let crashed = false;
    while (!S.over && S.turn <= W.max && S.blue.ships.length + S.red.ships.length <= MAX_SHIPS) {
        const pick = {};
        for (const side of ['blue', 'red']) {
            if (S.turn <= open) { const m = legalMoves(S, side); pick[side] = m[Math.floor(rng() * m.length)]; }
            else pick[side] = bots[side](S, side, rng, memo[side]) || 0;
        }
        try { stepTurn(S, pick.blue, pick.red); } catch (e) {
            if (!(e instanceof SimError)) throw e;
            crashed = true;
            break;
        }
    }
    resetRules();
    return { scen, aWon: S.over === aSide, bWon: S.over === bSide, turns: S.turn, crashed };
}

if (!isMainThread) {
    const cache = { a: {}, b: {} };
    for (const job of workerData.jobs) parentPort.postMessage(play(job, workerData, cache));
    parentPort.postMessage('done');
} else {
    const args = process.argv.slice(2);
    const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
    const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
    const aCfg = JSON.parse(flag('--a', 'null')), bCfg = JSON.parse(flag('--b', 'null'));
    const scens = flag('--scen', Object.keys(EVAL_SCENARIOS).join(',')).split(',');
    const open = Number(flag('--open', 2)), max = Number(flag('--max', 200)), seed0 = Number(flag('--seed', 1));
    const threads0 = Number(flag('--threads', Math.max(1, os.cpus().length - 1)));
    const json = bool('--json');
    const [aName, bName, per = 40] = args;
    for (const s of scens) if (!EVAL_SCENARIOS[s]) throw new Error(`unknown scenario ${s}`);

    const jobs = [];
    for (const scen of scens) for (let i = 0; i < Number(per); i++) {
        jobs.push({ scen, seed: seed0 * 1000003 + jobs.length, aSide: i % 2 === 0 ? 'red' : 'blue' });
    }
    // slow scenarios spread across threads: deal jobs round-robin
    const threads = Math.min(threads0, jobs.length);
    const chunks = Array.from({ length: threads }, () => []);
    jobs.forEach((j, i) => chunks[i % threads].push(j));
    const t0 = Date.now();
    const res = [];
    await Promise.all(chunks.map(c => new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { jobs: c, aName, bName, aCfg, bCfg, open, max } });
        w.on('message', m => { if (m === 'done') resolve(); else { res.push(m); if (!json) process.stderr.write(`\r${res.length}/${jobs.length}`); } });
        w.on('error', reject);
    })));
    if (!json) process.stderr.write('\r');
    const table = {};
    for (const scen of scens) {
        const r = res.filter(x => x.scen === scen);
        const score = r.map(x => (x.aWon ? 1 : x.bWon ? 0 : 0.5));
        const m = score.reduce((a, b) => a + b, 0) / r.length;
        const se = Math.sqrt(score.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1) / r.length);
        const t = r.map(x => x.turns).sort((a, b) => a - b);
        table[scen] = { score: +(100 * m).toFixed(1), se: +(100 * se).toFixed(1), n: r.length, turns: t[t.length >> 1], crashes: r.filter(x => x.crashed).length };
    }
    const avg = xs => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : null);
    const vals = Object.values(table).map(x => x.score);
    const group = near => Object.entries(table).filter(([k]) => NEAR.includes(k) === near).map(([, v]) => v.score);
    const summary = {
        mean: avg(vals), worst: Math.min(...vals),
        near: avg(group(true)), nearWorst: group(true).length ? Math.min(...group(true)) : null,
        far: avg(group(false)), farWorst: group(false).length ? Math.min(...group(false)) : null,
        secs: (Date.now() - t0) / 1000,
    };
    if (json) { console.log(JSON.stringify({ table, ...summary })); process.exit(0); }
    console.log(`${aName}${aCfg ? JSON.stringify(aCfg) : ''} vs ${bName}${bCfg ? JSON.stringify(bCfg) : ''}, ${per} games per scenario, ${summary.secs.toFixed(0)}s`);
    for (const [k, v] of Object.entries(table)) console.log(`  ${NEAR.includes(k) ? ' ' : '*'}${k.padEnd(12)} A ${String(v.score).padStart(5)}% ±${v.se}   median ${v.turns} turns${v.crashes ? `  (${v.crashes} crashes)` : ''}`);
    console.log(`  near (trained-on noise) ${summary.near}%, worst ${summary.nearWorst}%   far (held out) ${summary.far}%, worst ${summary.farWorst}%`);
    process.exit(0);
}

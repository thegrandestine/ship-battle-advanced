// Self-play games for Zero (js/zero.js), written out as training data for tools/zero/train.py.
//   node tools/zero/selfplay.js --net net.json --games 2000 --out data/it0001 [--pool a.json,b.json]
//        [--ppool 0.2] [--pgm 0] [--draw 0.5] [--std 0.25] [--classic 0.25] [--focus family:share] [--open 3] [--max 200] [--seed 1] [--threads N] [--temp 1]
// Both sides are the current net unless a game draws a past snapshot from --pool as one side's
// opponent (chance --ppool), or grandmaster v1.2 (chance --pgm: slow, ~7s a game, so keep it to
// a few percent; its thinking is capped at --gm-ms per move, 150 by default, v1.2 otherwise); then only the current net's moves are kept. Each game's first
// 0..--open turns are random moves (not kept), so no two games start alike.
// --std: share of plain games (Standard, a quarter Classic); the rest draw a training scenario (tools/zero/scenarios.js:
// nudged stats and prices, mid-fight mirrored fleets with low bases, rich starts, econ tweaks).
// The shuffles only live inside this process's copy of the rules; nothing is saved.
// --draw: weight of the tie-break score for games that hit a cap (see adjudicate).
// Writes <out>.bin + <out>.json (array layout) and prints a JSON summary as the last stdout line.

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import fs from 'fs';
import os from 'os';
import { newSimState, stepTurn, SimError } from '../../js/sim.js';
import { trainingScenario, applyStart, resetRules, MAX_SHIPS } from './scenarios.js';
import { grandmasterBot } from '../bots.js';
import { economy } from '../../js/economy.js';
import {
    encode, forward, moveProbs, sampleIndex, loadNet, typeTable, legalMoves,
    N_TYPES, TYPE_DIM, SHIP_DYN, ACT_DYN, GLOBAL_DIM,
} from '../../js/zero.js';
import { mulberry32 } from '../rng.js';

const GAMMA = 0.997, LAMBDA = 0.95;

/**
 * A game that hits the turn or ship cap has no winner; score it as a probable win for whoever
 * is ahead, -1..1 from blue's side: base hp, economy (ship size one turn's income buys) and
 * board strength (sum of sqrt(attack × hp)), each as a share-difference. Scaled by --draw so
 * it never counts as much as a real win: a lead can still be turned around.
 */
function adjudicate(S) {
    const diff = (a, b) => (a - b) / (Math.abs(a) + Math.abs(b) + 1e-9);
    const hp = o => Math.max(0, S[o].hp);
    const econ = o => (S[o].income > 0 ? economy(S[o].income, S[o].ore) : 0);
    const board = o => S[o].ships.reduce((a, s) => a + (s.health > 0 ? Math.sqrt(Math.max(0.5, s.attack) * s.health) : 0), 0);
    return 0.4 * diff(hp('blue'), hp('red')) + 0.3 * diff(econ('blue'), econ('red')) + 0.3 * diff(board('blue'), board('red'));
}

/** One game. Returns { samples, info }; each sample keeps its encoding plus PPO bookkeeping. */
function playGame(seed, nets, opt) {
    const rng = mulberry32(seed);
    const { start, family } = trainingScenario(rng, opt.std, opt.classic, opt.focus);
    const T = typeTable();
    const S = newSimState();
    applyStart(S, start);

    const ctrl = { blue: nets.cur, red: nets.cur };
    const keep = { blue: true, red: true };
    let mode = 'self';
    if (nets.pool.length && rng() < opt.ppool) {
        const o = rng() < 0.5 ? 'blue' : 'red';
        ctrl[o] = nets.pool[Math.floor(rng() * nets.pool.length)];
        keep[o] = false;
        mode = 'pool';
    } else if (rng() < opt.pgm) {
        const o = rng() < 0.5 ? 'blue' : 'red';
        ctrl[o] = nets.gm;
        keep[o] = false;
        mode = 'gm';
    }
    const memo = { blue: {}, red: {} };
    const open = Math.floor(rng() * (opt.open + 1));
    const traj = { blue: [], red: [] };
    let crashed = false;
    while (!S.over && S.turn <= opt.max && S.blue.ships.length + S.red.ships.length <= MAX_SHIPS) {
        const pick = {};
        for (const side of ['blue', 'red']) {
            if (S.turn <= open) {
                const m = legalMoves(S, side);
                pick[side] = m[Math.floor(rng() * m.length)];
                continue;
            }
            if (typeof ctrl[side] === 'function') { pick[side] = ctrl[side](S, side, rng, memo[side]) || 0; continue; }
            const e = encode(S, side);
            const { logits, value } = forward(ctrl[side], T, e);
            const p = moveProbs(logits, opt.temp);
            const i = sampleIndex(p, rng);
            pick[side] = e.moves[i];
            if (keep[side]) traj[side].push({ e, i, logp: Math.log(Math.max(1e-12, p[i])), value, turn: S.turn });
        }
        try { stepTurn(S, pick.blue, pick.red); } catch (err) {
            if (!(err instanceof SimError)) throw err;
            crashed = true;
            break;
        }
    }
    const winner = S.over ?? 'none';
    const lead = winner === 'none' && !crashed ? opt.draw * adjudicate(S) : 0;
    const samples = [];
    for (const side of ['blue', 'red']) {
        const tr = traj[side];
        const z = winner === side ? 1 : winner === 'none' ? (side === 'blue' ? lead : -lead) : -1;
        let adv = 0;
        for (let t = tr.length - 1; t >= 0; t--) {
            const last = t === tr.length - 1;
            const next = last ? 0 : tr[t + 1].value;
            const delta = (last ? z : 0) + GAMMA * next - tr[t].value;
            adv = delta + GAMMA * LAMBDA * (last ? 0 : adv);
            tr[t].adv = adv;
            tr[t].ret = adv + tr[t].value;
            tr[t].side = side === 'blue' ? 0 : 1;
        }
        samples.push(...tr);
    }
    const learner = mode !== 'self' ? (keep.blue ? 'blue' : 'red') : null;
    resetRules();
    return {
        T, samples,
        info: { winner, turns: S.turn, mode, family, crashed, learnerWon: learner ? winner === learner : null, learnerLost: learner ? winner !== learner && winner !== 'none' : null },
    };
}

// Growable flat arrays, so a worker's games pack straight into transferable buffers.
class Grow {
    constructor(Type, n = 1 << 16) { this.Type = Type; this.a = new Type(n); this.n = 0; }
    push(...xs) { this.reserve(xs.length); for (const x of xs) this.a[this.n++] = x; }
    pushArr(arr) { this.reserve(arr.length); this.a.set(arr, this.n); this.n += arr.length; }
    reserve(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new this.Type(m); b.set(this.a.subarray(0, this.n)); this.a = b; } }
    get() { return this.a.slice(0, this.n); }
}

const FIELDS = [
    ['tables', Float32Array], ['s_game', Int32Array], ['s_side', Int32Array], ['s_turn', Int32Array],
    ['s_global', Float32Array], ['s_ship_cnt', Int32Array], ['s_act_cnt', Int32Array], ['s_chosen', Int32Array],
    ['s_logp', Float32Array], ['s_value', Float32Array], ['s_adv', Float32Array], ['s_ret', Float32Array],
    ['sh_cell', Int32Array], ['sh_type', Int32Array], ['sh_dyn', Float32Array], ['a_type', Int32Array], ['a_dyn', Float32Array],
];

function runWorker({ jobs, netPath, poolPaths, opt }) {
    const read = p => loadNet(JSON.parse(fs.readFileSync(p, 'utf8')));
    const nets = { cur: read(netPath), pool: poolPaths.map(read), gm: grandmasterBot({ budgetMs: opt.gmMs }) };
    const G = Object.fromEntries(FIELDS.map(([k, T]) => [k, new Grow(T)]));
    const infos = [];
    jobs.forEach((seed, g) => {
        const { T, samples, info } = playGame(seed, nets, opt);
        infos.push(info);
        G.tables.pushArr(T);
        for (const s of samples) {
            const e = s.e;
            G.s_game.push(g); G.s_side.push(s.side); G.s_turn.push(s.turn);
            G.s_global.pushArr(e.global);
            G.s_ship_cnt.push(e.nShips); G.s_act_cnt.push(e.moves.length); G.s_chosen.push(s.i);
            G.s_logp.push(s.logp); G.s_value.push(s.value); G.s_adv.push(s.adv); G.s_ret.push(s.ret);
            G.sh_cell.pushArr(e.cell.subarray(0, e.nShips)); G.sh_type.pushArr(e.stype.subarray(0, e.nShips));
            G.sh_dyn.pushArr(e.sdyn.subarray(0, e.nShips * SHIP_DYN));
            G.a_type.pushArr(e.atype); G.a_dyn.pushArr(e.adyn);
        }
    });
    const out = Object.fromEntries(FIELDS.map(([k]) => [k, G[k].get()]));
    parentPort.postMessage({ out, infos, games: jobs.length }, Object.values(out).map(a => a.buffer));
}

if (!isMainThread) {
    runWorker(workerData);
} else {
    const args = process.argv.slice(2);
    const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
    const netPath = flag('--net');
    const poolPaths = (flag('--pool', '') || '').split(',').filter(Boolean);
    const games = Number(flag('--games', 1000));
    const outBase = flag('--out', 'zero-data');
    const seed0 = Number(flag('--seed', 1));
    const threads = Math.min(games, Number(flag('--threads', Math.max(1, os.cpus().length - 1))));
    const opt = {
        ppool: Number(flag('--ppool', 0.2)), pgm: Number(flag('--pgm', 0)), gmMs: Number(flag('--gm-ms', 150)), draw: Number(flag('--draw', 0.5)), std: Number(flag('--std', 0.25)), classic: Number(flag('--classic', 0.25)),
        // --focus family:share sends that share of games to one training family first (experiments)
        focus: (f => (f ? { family: f.split(':')[0], share: Number(f.split(':')[1]) } : null))(flag('--focus', '')), open: Number(flag('--open', 3)),
        max: Number(flag('--max', 200)), temp: Number(flag('--temp', 1)),
    };
    const seeds = Array.from({ length: games }, (_, i) => seed0 * 1000003 + i);
    const chunks = Array.from({ length: threads }, () => []);
    seeds.forEach((s, i) => chunks[i % threads].push(s));
    const t0 = Date.now();
    const parts = await Promise.all(chunks.map(jobs => new Promise((resolve, reject) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { jobs, netPath, poolPaths, opt } });
        w.once('message', resolve);
        w.on('error', reject);
    })));

    // concatenate, shifting game indices
    const merged = {};
    for (const [k, Type] of FIELDS) {
        const total = parts.reduce((a, p) => a + p.out[k].length, 0);
        merged[k] = new Type(total);
    }
    const pos = Object.fromEntries(FIELDS.map(([k]) => [k, 0]));
    let gOff = 0;
    for (const p of parts) {
        for (const [k] of FIELDS) {
            const src = p.out[k];
            if (k === 's_game') for (let i = 0; i < src.length; i++) merged[k][pos[k] + i] = src[i] + gOff;
            else merged[k].set(src, pos[k]);
            pos[k] += src.length;
        }
        gOff += p.games;
    }
    const header = { games, dims: { N_TYPES, TYPE_DIM, SHIP_DYN, ACT_DYN, GLOBAL_DIM }, arrays: [] };
    let off = 0;
    const fd = fs.openSync(`${outBase}.bin`, 'w');
    for (const [k, Type] of FIELDS) {
        const a = merged[k];
        header.arrays.push({ name: k, dtype: Type === Float32Array ? 'f4' : 'i4', count: a.length, offset: off });
        fs.writeSync(fd, Buffer.from(a.buffer, a.byteOffset, a.byteLength));
        off += a.byteLength;
    }
    fs.closeSync(fd);
    fs.writeFileSync(`${outBase}.json`, JSON.stringify(header));

    const infos = parts.flatMap(p => p.infos);
    const n = infos.length;
    const pool = infos.filter(i => i.mode === 'pool');
    const summary = {
        games: n, samples: merged.s_game.length, secs: (Date.now() - t0) / 1000,
        meanTurns: infos.reduce((a, i) => a + i.turns, 0) / n,
        blueWins: infos.filter(i => i.winner === 'blue').length / n,
        draws: infos.filter(i => i.winner === 'none').length / n,
        crashes: infos.filter(i => i.crashed).length,
        poolGames: pool.length,
        poolScore: pool.length ? pool.reduce((a, i) => a + (i.learnerWon ? 1 : i.learnerLost ? 0 : 0.5), 0) / pool.length : null,
        gmGames: infos.filter(i => i.mode === 'gm').length,
        gmScore: (g => (g.length ? g.reduce((a, i) => a + (i.learnerWon ? 1 : i.learnerLost ? 0 : 0.5), 0) / g.length : null))(infos.filter(i => i.mode === 'gm')),
        families: infos.reduce((a, i) => ((a[i.family] = (a[i.family] ?? 0) + 1), a), {}),
    };
    console.log(JSON.stringify(summary));
    process.exit(0);
}

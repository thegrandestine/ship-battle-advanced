// Starting scenarios for Zero: the rule shuffles self-play trains under, and a fixed set of
// held-out ones (the New Game presets, js/modifiers.js) to test whether it understands the game
// or only remembers openings. Every scenario is symmetric in rules; only the training "lopsided"
// nudge gives one side a little extra.
//
// A scenario sets the rules (TEMPLATES stats and prices, inside this process only) and returns
// a start: { money, income, ore, hp: [blue, red], fleet: [[ship, sector from blue's side]...] }.
// resetRules() puts the standard rules back.
//
// Held out of training on purpose: the New Game presets other than Glass and Juggernaut (those two
// are trained on in small doses, the 'variant' family), price changes to ×5, ×11 and ×13 ships (missiles, archers, carriers). (Big fleets
// are trained on now, in the rich 'mirror' family, so Warzone is less of a stretch.) The 'primeShift' and 'warzone' / 'missiles' tests ask
// whether what it learned about prices and fleets carries over to rules it has never seen.

import { TEMPLATES, SHIP_NUMS, calculatePrimeFactors } from '../../js/templates.js';
import { BASE_START_HP, START_INCOME, START_ORE } from '../../js/config.js';
import { priceMult } from '../../js/economy.js';
import { clearPriceCache } from '../../js/sim.js';
import { clearPriceMemos } from '../../js/grandmaster.js';
import { clearZeroMemos } from '../../js/zero.js';
import { applyBalanceMods, normalizeMods, chaosMods, standardMods, PRESETS } from '../../js/modifiers.js';

const ORIG = Object.fromEntries(SHIP_NUMS.map(n => [n, [TEMPLATES[n].attack, TEMPLATES[n].health]]));
const PRICE_PRIMES = [2, 3, 7, 17, 19, 23]; // trained on (5, 11, 13 held out)
const HELD_OUT_PRIMES = [5, 11, 13];
const FLEET_SHIPS = SHIP_NUMS.filter(n => n <= 73);
// Ships that make more ships (carriers, Ruler, Abacus, Rainbow, Wong): a mirrored
// fleet gets at most one, or mirrored carriers spam each other into the hundreds.
const SPAWNS = n => [13, 37, 41, 47, 71].some(p => n % p === 0);

const clearMemos = () => { clearPriceCache(); clearPriceMemos(); clearZeroMemos(); };

export function resetRules() {
    for (const n of SHIP_NUMS) { TEMPLATES[n].attack = ORIG[n][0]; TEMPLATES[n].health = ORIG[n][1]; }
    priceMult.fill(1);
    clearMemos();
}

const standardStart = () => ({ money: [0, 0], income: [START_INCOME, START_INCOME], ore: [START_ORE, START_ORE], hp: [BASE_START_HP, BASE_START_HP], fleet: [] });

const tools = rng => {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    return {
        lg: s => (s ? Math.exp(s * gauss()) : 1),
        pick: a => a[Math.floor(rng() * a.length)],
        uni: (lo, hi) => lo + (hi - lo) * rng(),
        int: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
    };
};

/** Nudged ship stats and prime prices (the rules a player would read off the cards). */
function jitterRules(rng, strength = 1) {
    const { lg, pick } = tools(rng);
    const atkAll = rng() < 0.25 ? lg(0.25 * strength) : 1, hpAll = rng() < 0.25 ? lg(0.25 * strength) : 1;
    const noise = pick([0.06, 0.12, 0.2]) * strength;
    for (const n of SHIP_NUMS) {
        TEMPLATES[n].attack = Math.max(1, Math.round(TEMPLATES[n].attack * atkAll * lg(noise)));
        TEMPLATES[n].health = Math.max(1, Math.round(TEMPLATES[n].health * hpAll * lg(noise)));
    }
    const all = rng() < 0.3 ? lg(0.15 * strength) : 1;
    const prime = Object.fromEntries(PRICE_PRIMES.map(p => [p, rng() < 0.4 ? lg(0.2 * strength) : 1]));
    const each = rng() < 0.5 ? 0.05 * strength : 0;
    for (const n of SHIP_NUMS) {
        let k = all * lg(each);
        for (const p of new Set(calculatePrimeFactors(n))) k *= prime[p] ?? 1;
        priceMult[n] *= k;
    }
}

/** Mild economy tweaks: miners / traders / income ships a bit cheaper or dearer. */
function econRules(rng) {
    const { pick, uni } = tools(rng);
    const k = rng() < 0.7 ? uni(0.6, 0.95) : uni(1.1, 1.5);
    const primes = pick([[3], [7], [23], [3, 7]]);
    for (const n of SHIP_NUMS) if (primes.some(p => n % p === 0)) priceMult[n] *= k;
}

/** A random fleet worth about `value`, mirrored for both sides; sectors are from blue's side. */
function randomFleet(rng, value, sectors) {
    const { pick } = tools(rng);
    const cap = Math.max(1, Math.min(73, Math.round(value * (0.1 + 0.55 * rng() ** 1.5))));
    const fleet = [];
    let left = value, spawners = 0;
    while (left >= 1 && fleet.length < 24) {
        const opts = FLEET_SHIPS.filter(n => n <= Math.min(cap, left) && !(spawners && SPAWNS(n)));
        if (!opts.length) break;
        const n = pick(opts);
        fleet.push([n, pick(sectors)]);
        if (SPAWNS(n)) spawners++;
        left -= n;
    }
    return fleet;
}

/** Mid-fight: both sides already have a fleet out, bases are low, money in the bank. */
function midfight(rng, st) {
    const { pick, int } = tools(rng);
    st.fleet = randomFleet(rng, int(10, 50), pick([[1, 2, 3], [2, 3, 4], [1, 2, 3, 4], [3, 4]]));
    st.hp = Array(2).fill(pick([40, 60, 80, 100, 120]));
    st.money = Array(2).fill(pick([5, 10, 15, 20, 30, 40]));
    if (rng() < 0.4) st.income = Array(2).fill(pick([4, 5, 6, 8]));
    if (rng() < 0.3) st.ore = Array(2).fill(pick([10, 30, 60]));
}

function richStart(rng, st) {
    const { pick } = tools(rng);
    st.money = Array(2).fill(pick([10, 15, 25, 40]));
    if (rng() < 0.5) st.income = Array(2).fill(pick([3, 5, 6, 8]));
    if (rng() < 0.4) st.ore = Array(2).fill(pick([10, 30, 60]));
    if (rng() < 0.4) st.hp = Array(2).fill(pick([100, 200, 260]));
}

/** Wider noise on one to three whole-game axes, still close to a normal game (the extremes,
    like 5× hp or 1 base hp, are kept for testing: they are different games, and training on
    them teaches habits a normal game punishes). */
function wide(rng, st) {
    const { pick, uni } = tools(rng);
    const logU = (lo, hi) => Math.exp(uni(Math.log(lo), Math.log(hi)));
    const scale = (key, lo, hi) => { const k = logU(lo, hi); for (const n of SHIP_NUMS) TEMPLATES[n][key] = Math.max(1, Math.round(TEMPLATES[n][key] * k)); };
    const axes = [
        () => scale('health', 0.5, 2),
        () => scale('attack', 0.5, 1.5),
        () => { st.hp = Array(2).fill(Math.round(logU(80, 480))); },
        () => { st.money = Array(2).fill(Math.round(logU(1, 40))); },
        () => { st.income = Array(2).fill(pick([2, 3, 5, 6, 8])); },
        () => { st.ore = Array(2).fill(Math.round(logU(5, 60))); },
        () => { const k = logU(0.67, 1.5); for (const n of SHIP_NUMS) priceMult[n] *= k; },
        () => { st.fleet = randomFleet(rng, Math.round(logU(5, 50)), [1, 2, 2, 3, 3]); },
    ].sort(() => rng() - 0.5);
    const count = pick([1, 1, 2, 2, 3]);
    for (let i = 0; i < count; i++) axes[i]();
}

/** Longer games: sturdier ships or deeper bases, so investing (traders, miners) can pay. */
function longGame(rng, st) {
    const { uni } = tools(rng);
    const r = rng();
    if (r < 0.7) { const k = uni(1.2, 1.6); for (const n of SHIP_NUMS) TEMPLATES[n].health = Math.max(1, Math.round(TEMPLATES[n].health * k)); }
    if (r > 0.4) st.hp = Array(2).fill(Math.round(uni(200, 480)));
}

/**
 * A rich mirror on otherwise normal rules: a mirrored fleet of higher-tier ships already out,
 * plenty of money, and enough income and ore that the deploy bar shows the bigger ships
 * (the bar follows income and ore, not money). Many options, no settled opening: the side
 * that breaks the mirror with the better plan wins.
 */
function mirror(rng, st) {
    const { pick, uni } = tools(rng);
    const logU = (lo, hi) => Math.exp(uni(Math.log(lo), Math.log(hi)));
    st.fleet = randomFleet(rng, Math.round(logU(40, 300)), pick([[1, 2], [1, 2, 3], [2, 3, 4], [1, 2, 3, 4, 5]]));
    st.money = Array(2).fill(Math.round(logU(40, 300)));
    st.income = Array(2).fill(pick([6, 8, 10, 12, 15, 20]));
    st.ore = Array(2).fill(Math.round(logU(20, 200)));
    if (rng() < 0.3) st.hp = Array(2).fill(pick([120, 200, 260, 320]));
}

/**
 * Real variants in small doses: juggernaut-like tough ships (long games; capped ones still score
 * through the self-play tie-break) and glass-like fragile ones. They play differently enough from
 * the standard game that a big share would pull its habits, so they stay a few percent.
 */
function variant(rng, st) {
    const { uni } = tools(rng);
    const k = rng() < 0.7 ? uni(3, 5) : uni(0.25, 0.4);
    for (const n of SHIP_NUMS) TEMPLATES[n].health = Math.max(1, Math.round(TEMPLATES[n].health * k));
}

/**
 * Money in the bank, income hard to come by: little income and pricier traders (×7). Before the
 * deploy bar stopped hiding ships by income, a start like this locked out most of the menu.
 * Milder than the Old Money preset (200 money, 1 income, traders ×3), which stays an exam.
 */
function bank(rng, st) {
    const { pick, uni } = tools(rng);
    const logU = (lo, hi) => Math.exp(uni(Math.log(lo), Math.log(hi)));
    st.money = Array(2).fill(Math.round(logU(30, 150)));
    st.income = Array(2).fill(pick([1, 2, 3]));
    const k = uni(1.3, 2.5);
    for (const n of SHIP_NUMS) if (n % 7 === 0) priceMult[n] *= k;
}

/**
 * The game's own Chaos preset: 2-4 random knobs at any slider value, extremes included
 * (1 base hp, ×10 ship hp, ×0.1 prices...). A thin blanket, so no ruleset a player can dial up
 * is wholly unseen, while no single extreme gets enough games to teach habits.
 */
function chaos(rng, st) {
    Object.assign(st, preset(chaosMods(rng), rng));
}

function lopsided(rng, st) {
    const { pick } = tools(rng);
    const s = rng() < 0.5 ? 0 : 1;
    if (rng() < 0.5) st.money[s] += pick([1, 2, 3, 5]);
    else st.hp[s] = Math.max(10, st.hp[s] + pick([-20, -10, 10, 20]));
}

// Training families and their shares (the rest of a draw is the standard game).
// Plain games: the game's Standard preset (a mirrored 0-20 fleet, 0-20 money), with this share
// of them the Classic empty board, which a pair of fixed openings turns into a coin toss.
const CLASSIC_SHARE = 0.25;
export const TRAIN_FAMILIES = {
    jitter: 0.12,   // nudged ship stats and prime prices
    midfight: 0.15, // mirrored fleets on the field, low bases, cash in hand
    rich: 0.08,     // big starting money (and sometimes income/ore/hp)
    econ: 0.08,     // cheaper/dearer miners, traders, income ships
    wide: 0.15,     // one to three whole-game axes nudged (ship hp ×0.5-2, atk ×0.5-1.5, base hp 80-480, money, income, ore, prices, fleet)
    long: 0.1,      // sturdier ships / deeper bases (to 480): longer games where an economy lead wins
    mirror: 0.2,    // rich mirror of higher-tier fleets on normal rules
    combo: 0.12,    // jitter plus one of the others
    variant: 0.06,  // a little juggernaut (ship hp ×3-5) and glass (×0.25-0.4)
    bank: 0.06,     // cash in hand, income 1-3, pricier traders
    chaos: 0.06,    // the Chaos preset's roll: 2-4 knobs anywhere on their sliders, extremes included
};

/** A training scenario; `std` = chance of a plain (Standard or Classic) game. Returns { start, family }. */
export function trainingScenario(rng, std = 0.25) {
    resetRules();
    const st = standardStart();
    if (rng() < std) {
        if (rng() < CLASSIC_SHARE) return { start: st, family: 'classic' };
        const start = preset(standardMods(rng), rng);
        clearMemos();
        return { start, family: 'standard' };
    }
    const fams = Object.entries(TRAIN_FAMILIES);
    let r = rng() * fams.reduce((a, [, w]) => a + w, 0), family = fams[0][0];
    for (const [f, w] of fams) { if (r < w) { family = f; break; } r -= w; }
    const other = () => tools(rng).pick(['midfight', 'rich', 'econ', 'wide', 'long', 'mirror']);
    const parts = family === 'combo' ? ['jitter', other()] : [family];
    for (const p of parts) {
        if (p === 'jitter') jitterRules(rng);
        else if (p === 'econ') econRules(rng);
        else if (p === 'midfight') midfight(rng, st);
        else if (p === 'rich') richStart(rng, st);
        else if (p === 'wide') wide(rng, st);
        else if (p === 'long') longGame(rng, st);
        else if (p === 'mirror') mirror(rng, st);
        else if (p === 'variant') variant(rng, st);
        else if (p === 'bank') bank(rng, st);
        else if (p === 'chaos') chaos(rng, st);
    }
    if (rng() < 0.15) lopsided(rng, st);
    clearMemos();
    return { start: st, family };
}

/** A New Game preset's rules, as the live game applies them (js/modifiers.js). */
function preset(mods, rng) {
    const m = normalizeMods(mods);
    applyBalanceMods(m);
    clearZeroMemos();
    const st = standardStart();
    st.money = [m.startMoney, m.startMoney];
    st.income = [m.startIncome, m.startIncome];
    st.ore = [m.startOre, m.startOre];
    st.hp = [m.baseHp, m.baseHp];
    if (m.openingValue) st.fleet = randomFleet(rng, m.openingValue, [1, 2, 2, 3, 3]);
    return st;
}

/** 'near' tests are fresh draws from what training sees; 'far' ones it never trains on. */
export const NEAR = ['standard', 'classic', 'midfight', 'econ', 'jitter', 'wide', 'mirror', 'fortress', 'glass', 'juggernaut', 'bank', 'chaos'];

// Held-out tests. Presets are the game's own New Game options, mostly far more extreme than
// anything in training; 'midfight' and 'econ' are fresh draws from training families.
export const EVAL_SCENARIOS = {
    // the game's Standard preset: the baseline, which decides which net is stronger
    standard: rng => { resetRules(); return preset(standardMods(rng), rng); },
    classic: () => { resetRules(); return standardStart(); },
    midfight: rng => { resetRules(); const st = standardStart(); midfight(rng, st); clearMemos(); return st; },
    econ: rng => { resetRules(); econRules(rng); clearMemos(); return standardStart(); },
    jitter: rng => { resetRules(); jitterRules(rng); clearMemos(); return standardStart(); },
    wide: rng => { resetRules(); const st = standardStart(); wide(rng, st); clearMemos(); return st; },
    mirror: rng => { resetRules(); const st = standardStart(); mirror(rng, st); clearMemos(); return st; },
    chaos: rng => { resetRules(); const st = standardStart(); chaos(rng, st); clearMemos(); return st; },
    bank: rng => { resetRules(); const st = standardStart(); bank(rng, st); clearMemos(); return st; },
    fortress: () => { resetRules(); const st = standardStart(); st.hp = [400, 400]; return st; },
    // held out: one or two of ×5 / ×11 / ×13 ships much cheaper or dearer
    primeShift: rng => {
        resetRules();
        const { pick, uni } = tools(rng);
        const ps = rng() < 0.5 ? [pick(HELD_OUT_PRIMES)] : HELD_OUT_PRIMES.filter(() => rng() < 0.6);
        for (const p of ps) { const k = rng() < 0.5 ? uni(0.3, 0.7) : uni(1.5, 3); for (const n of SHIP_NUMS) if (n % p === 0) priceMult[n] *= k; }
        clearMemos();
        return standardStart();
    },
    ...Object.fromEntries(Object.entries(PRESETS).filter(([k, p]) => !p.roll && k !== 'classic')
        .map(([k, p]) => [k, rng => { resetRules(); return preset(p.mods, rng); }])),
};

/** Safety valve: a game with more ships than this on the board is called a draw. */
export const MAX_SHIPS = 600;

/** Puts a scenario's start onto a fresh sim state (newSimState() has already begun turn 1). */
export function applyStart(S, st) {
    ['blue', 'red'].forEach((side, i) => {
        S[side].income = st.income[i];
        S[side].money = st.money[i] + st.income[i];
        S[side].ore = st.ore[i];
        S[side].hp = st.hp[i];
    });
    for (const [n, sec] of st.fleet) {
        for (const owner of ['blue', 'red']) {
            const t = TEMPLATES[n];
            const sector = owner === 'blue' ? sec : 8 - sec;
            const row = S[owner].ships.filter(s => s.sector === sector).length;
            S[owner].ships.push({ number: n, attack: t.attack, health: t.health, sector, row, template: t, dying: false });
        }
    }
}

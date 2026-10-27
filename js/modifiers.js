// Game modifiers: opt-in rule changes chosen on the New Game screen (starting economy, base and
// ship stats, ship prices per prime, a random mirrored fleet already on the field). A classic
// game uses DEFAULT_MODS, which leaves every value exactly as in config.js / templates.js. The
// Standard preset rolls a small mirrored fleet and some starting money each game, so no two
// boards open the same way.
//
// Ship stats and prices are changed where the rules read them (TEMPLATES and cost()), so the
// AIs' lookahead (js/sim.js) plays by the same modified rules as the live game.

import { BASE_START_HP, START_INCOME, START_ORE } from './config.js';
import { TEMPLATES, SHIP_NUMS, calculatePrimeFactors } from './templates.js';
import { priceMult } from './economy.js';
import { clearPriceCache } from './sim.js';
import { clearPriceMemos } from './grandmaster.js';

export const PRICE_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];

// Each modifier's allowed values (the New Game sliders step through these).
export const MOD_STEPS = {
    startMoney: [0, 1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000],
    startIncome: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 50],
    startOre: [0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000],
    baseHp: [1, 10, 20, 40, 60, 80, 100, 120, 160, 200, 240, 320, 400, 600, 800, 1000, 2000],
    shipHp: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10],
    shipAtk: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10],
    openingValue: [0, 5, 10, 20, 40, 75, 120, 200, 350, 600, 1000, 1600],
    price: [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10],
};

export const DEFAULT_MODS = {
    startMoney: 0,
    startIncome: START_INCOME,
    startOre: START_ORE,
    baseHp: BASE_START_HP,
    shipHp: 1,
    shipAtk: 1,
    priceAll: 1,                                          // every ship's price ×
    primePrice: Object.fromEntries(PRICE_PRIMES.map(p => [p, 1])), // ships with this prime ×
    openingValue: 0,                                      // total value of the random opening fleet
};

/** The Standard preset's roll: a mirrored fleet worth 0-20 and 0-20 money, fresh each game (0 and 0 is the Classic board). */
export function standardMods(rng = Math.random) {
    const m = normalizeMods();
    m.openingValue = Math.floor(rng() * 21);
    m.startMoney = Math.floor(rng() * 21);
    return m;
}

// A preset with `roll` (mods: null) rolls its modifiers fresh every game.
export const PRESETS = {
    standard: { label: 'Standard', desc: 'A random mirrored fleet worth 0–20 and 0–20 money, rolled each game', mods: null, roll: standardMods },
    classic: { label: 'Classic', desc: 'The original rules: empty field, no money', mods: {} },
    blitz: { label: 'Blitz', desc: 'Base HP 40, 20 money up front', mods: { baseHp: 40, startMoney: 20 } },
    suddenDeath: { label: 'Sudden Death', desc: 'Base HP 1: the first hit wins', mods: { baseHp: 1 } },
    glass: { label: 'Glass Cannons', desc: 'Ships have a quarter of their HP', mods: { shipHp: 0.25 } },
    juggernaut: { label: 'Juggernauts', desc: 'Ships have 5× HP', mods: { shipHp: 5 } },
    boom: { label: 'Boom Economy', desc: '15 income and 100 ore from the start', mods: { startIncome: 15, startOre: 100 } },
    oldMoney: { label: 'Old Money', desc: '200 money, 1 income, income ships (×7) cost 3×', mods: { startMoney: 200, startIncome: 1, primePrice: { 7: 3 } } },
    oreRush: { label: 'Ore Rush', desc: 'Miners (×3) half price', mods: { primePrice: { 3: 0.5 } } },
    missiles: { label: 'Missile Season', desc: 'Missile ships (×5) a quarter price, half HP everywhere', mods: { primePrice: { 5: 0.25 }, shipHp: 0.5 } },
    warzone: { label: 'Warzone', desc: 'A big random fleet each, already on the field', mods: { openingValue: 350 } },
    chaos: { label: 'Chaos', desc: 'Random modifiers every game', mods: null, roll: chaosMods },
};

const ORIGINAL = Object.fromEntries(SHIP_NUMS.map(n => [n, { attack: TEMPLATES[n].attack, health: TEMPLATES[n].health }]));

const pick = a => a[Math.floor(Math.random() * a.length)];

/** A random mix of modifiers (any of the allowed values, extremes included). */
export function chaosMods(rng = Math.random) {
    const pick = a => a[Math.floor(rng() * a.length)]; // rng: seeded in training (tools/zero/scenarios.js)
    const m = normalizeMods();
    const S = MOD_STEPS;
    const knobs = [
        () => { m.startMoney = pick(S.startMoney.slice(1)); },
        () => { m.startIncome = pick(S.startIncome); },
        () => { m.startOre = pick(S.startOre.slice(1)); },
        () => { m.baseHp = pick(S.baseHp); },
        () => { m.shipHp = pick(S.shipHp); },
        () => { m.shipAtk = pick(S.shipAtk); },
        () => { m.priceAll = pick([0.5, 0.75, 1.5, 2]); },
        () => { m.primePrice[pick(PRICE_PRIMES)] = pick(S.price); },
        () => { m.primePrice[pick(PRICE_PRIMES)] = pick(S.price); },
        () => { m.openingValue = pick(S.openingValue.slice(1)); },
    ];
    knobs.sort(() => rng() - 0.5);
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) knobs[i]();
    return m;
}

/** Fills in defaults (and reads settings saved by older versions of this screen). */
export function normalizeMods(mods) {
    const m = { ...DEFAULT_MODS, ...(mods || {}) };
    m.primePrice = { ...DEFAULT_MODS.primePrice, ...(mods?.primePrice || {}) };
    if (mods?.discount?.length) for (const p of mods.discount) m.primePrice[p] = 1 - (mods.discountPct ?? 30) / 100;
    if (mods?.opening && mods.opening !== 'none' && !mods.openingValue) m.openingValue = 40;
    delete m.discount; delete m.discountPct; delete m.opening;
    // A fixed key order, so equal settings compare equal as JSON
    return Object.fromEntries(Object.keys(DEFAULT_MODS).map(k => [k, m[k]]));
}

export function isDefault(mods) {
    return describeMods(mods).length === 0;
}

const pct = x => `${Math.round(x * 100)}%`;

/** Short labels for each active modifier, e.g. ["Ship HP ×0.5", "×7 ships 300% price"]. */
export function describeMods(mods) {
    const m = normalizeMods(mods);
    const d = DEFAULT_MODS;
    const out = [];
    if (m.startMoney !== d.startMoney) out.push(`Start money ${m.startMoney}`);
    if (m.startIncome !== d.startIncome) out.push(`Income ${m.startIncome}`);
    if (m.startOre !== d.startOre) out.push(`Start ore ${m.startOre}`);
    if (m.baseHp !== d.baseHp) out.push(`Base HP ${m.baseHp}`);
    if (m.shipHp !== d.shipHp) out.push(`Ship HP ×${m.shipHp}`);
    if (m.shipAtk !== d.shipAtk) out.push(`Ship attack ×${m.shipAtk}`);
    if (m.priceAll !== 1) out.push(`All prices ${pct(m.priceAll)}`);
    for (const p of PRICE_PRIMES) if (m.primePrice[p] !== 1) out.push(`×${p} ships ${pct(m.primePrice[p])} price`);
    if (m.openingValue) out.push(`Random opening fleet ≈${m.openingValue}`);
    return out;
}

/** Sets ship stats and prices for these modifiers (DEFAULT_MODS restores the originals). */
export function applyBalanceMods(mods) {
    const m = normalizeMods(mods);
    for (const n of SHIP_NUMS) {
        const o = ORIGINAL[n];
        TEMPLATES[n].health = m.shipHp === 1 ? o.health : Math.max(1, Math.round(o.health * m.shipHp));
        TEMPLATES[n].attack = m.shipAtk === 1 ? o.attack : Math.max(1, Math.round(o.attack * m.shipAtk));
    }
    priceMult.fill(1);
    for (const n of SHIP_NUMS) {
        // A ship with several primes pays each one's multiplier (×14 = ×2 price × ×7 price)
        let k = m.priceAll;
        for (const p of new Set(calculatePrimeFactors(n))) k *= m.primePrice[p] ?? 1;
        priceMult[n] = k;
    }
    clearPriceCache();
    clearPriceMemos();
}

// Opening fleets are valued at ship number (a ship's price with unlimited ore).
const FLEET_SHIPS = SHIP_NUMS.filter(n => n <= 73);
const MAX_FLEET = 24;

/**
 * A random fleet worth about `value`: [ship number, sector] from blue's side. The biggest ship
 * allowed is random too, so some fleets are a swarm of small ships, some a few big ones.
 */
function randomFleet(value) {
    const cap = Math.max(1, Math.min(73, Math.round(value * (0.08 + 0.6 * Math.random() ** 1.5))));
    const floor = Math.min(cap, Math.max(1, Math.floor(value / MAX_FLEET)));
    const fleet = [];
    let left = value;
    while (left >= 1 && fleet.length < MAX_FLEET) {
        const options = FLEET_SHIPS.filter(n => n >= floor && n <= Math.min(cap, left));
        if (!options.length) break;
        const n = pick(options);
        fleet.push([n, pick([1, 2, 2, 3, 3])]);
        left -= n;
    }
    return fleet;
}

/** Places a random opening fleet, mirrored, for both sides. `newId` hands out ship ids. */
export function seedOpening(state, mods, newId) {
    const m = normalizeMods(mods);
    if (!m.openingValue) return;
    for (const [num, sector] of randomFleet(m.openingValue)) {
        for (const owner of ['blue', 'red']) {
            const tpl = TEMPLATES[num];
            state[owner].ships.push({
                id: newId(), owner, number: num, attack: tpl.attack, health: tpl.health,
                maxHealth: Math.max(tpl.health, 10), sector: owner === 'blue' ? sector : 8 - sector,
                row: 0, template: tpl, justDeployed: false,
            });
        }
    }
    for (const owner of ['blue', 'red']) {
        const bySector = {};
        for (const s of state[owner].ships) s.row = (bySector[s.sector] = (bySector[s.sector] ?? -1) + 1);
    }
}

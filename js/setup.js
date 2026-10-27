// The New Game screen: pick an opponent (skirmish AI, campaign mission, online/custom) and, for
// skirmishes, modifiers (js/modifiers.js). Start Game hands the choice to startGame(); Restart
// replays it. The last choice is remembered in this browser.

import { DIFFICULTIES } from './config.js';
import { startGame } from './state.js';
import { DEFAULT_MODS, MOD_STEPS, PRICE_PRIMES, PRESETS, normalizeMods, describeMods, isDefault } from './modifiers.js';

const STORE_KEY = 'shipbattle.setup';

const SLIDERS = [
    { key: 'startMoney', label: 'Starting money' },
    { key: 'startIncome', label: 'Starting income' },
    { key: 'startOre', label: 'Starting ore' },
    { key: 'baseHp', label: 'Base HP' },
    { key: 'shipHp', label: 'Ship HP', fmt: v => `×${v}` },
    { key: 'shipAtk', label: 'Ship attack', fmt: v => `×${v}` },
    { key: 'openingValue', label: 'Opening fleet', fmt: v => v ? `≈${v}` : 'Off',
        tip: 'A random fleet of about this total value (ship numbers), mirrored for both sides and already on the field. Some are swarms of small ships, some a few big ones.' },
];

const pct = v => `${Math.round(v * 100)}%`;

const CLASSIC_HINT = {
    normal: 'The standard AI', hard: 'Gains ore and armor over time', challenging: 'More ore and armor',
    tricky: 'Sharper picks, more ore', visionary: 'The strongest handicapped AI',
};

let draft = loadDraft();

function loadDraft() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (saved && DIFFICULTIES[saved.difficulty]) {
            // Older saves had a `chaos` flag, and plain rules meant Standard (now Classic plus a roll)
            const roll = 'roll' in saved ? saved.roll
                : saved.chaos ? 'chaos' : isDefault(saved.mods) ? 'standard' : null;
            return { difficulty: saved.difficulty, mods: normalizeMods(saved.mods), roll: PRESETS[roll]?.roll ? roll : null };
        }
    } catch { /* storage unavailable: use defaults */ }
    return { difficulty: 'normal', mods: normalizeMods(), roll: 'standard' };
}

function saveDraft() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
}

const groupOf = key => key.startsWith('campaign') ? 'campaign'
    : ['pvp', 'custom'].includes(DIFFICULTIES[key].ai) ? 'other'
    : DIFFICULTIES[key].ai === 'grandmaster' ? 'grandmaster'
    : DIFFICULTIES[key].ai === 'zero' ? 'learned' : 'classic';
/** Modifiers apply to games against an AI (campaign missions and online play keep their rules). */
export const takesMods = key => !key.startsWith('campaign') && DIFFICULTIES[key]?.ai !== 'pvp';

function hintFor(key) {
    const D = DIFFICULTIES[key];
    switch (groupOf(key)) {
        case 'campaign': return `${D.tutorial ? 'Tutorial mission' : 'Prime master mission'} · its own rules, no modifiers`;
        case 'other': return D.ai === 'pvp' ? 'Play a person online · no modifiers' : 'You enter a build order for red';
        case 'grandmaster': return 'Searches ahead, no handicaps';
        case 'learned': return 'Taught itself by self-play: no search, no book, no handicaps';
        default: return CLASSIC_HINT[key] ?? '';
    }
}

function buildOpponents() {
    const sel = document.getElementById('setup-opponent');
    const groups = { classic: 'Classic AI', grandmaster: 'Grandmaster', learned: 'Learned', campaign: 'Campaign', other: 'Online & Custom' };
    for (const [g, label] of Object.entries(groups)) {
        const og = document.createElement('optgroup');
        og.label = label;
        for (const [key, D] of Object.entries(DIFFICULTIES)) {
            if (groupOf(key) !== g) continue;
            const o = document.createElement('option');
            o.value = key;
            o.textContent = D.label.replace('Campaign ', 'Mission ');
            og.appendChild(o);
        }
        sel.appendChild(og);
    }
    sel.addEventListener('change', () => { draft.difficulty = sel.value; refresh(); });
}

function buildPresets() {
    const sel = document.getElementById('setup-preset');
    sel.innerHTML = '<option value="">Presets…</option>';
    for (const [key, p] of Object.entries(PRESETS)) {
        const o = document.createElement('option');
        o.value = key;
        o.textContent = `${p.roll ? '🎲 ' : ''}${p.label} — ${p.desc}`;
        sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
        const key = sel.value;
        if (!key) return;
        draft.roll = PRESETS[key].roll ? key : null;
        if (!draft.roll) draft.mods = normalizeMods(PRESETS[key].mods);
        refresh();
    });
}

/** Index of the allowed value closest to v. */
const nearest = (steps, v) => steps.reduce((best, s, i) => Math.abs(s - v) < Math.abs(steps[best] - v) ? i : best, 0);

function buildMods() {
    const box = document.getElementById('setup-mods');
    for (const s of SLIDERS) {
        const steps = MOD_STEPS[s.key];
        const row = document.createElement('label');
        row.className = 'setup-mod';
        if (s.tip) row.title = s.tip;
        row.innerHTML = `<span class="setup-mod-label"></span><input type="range" min="0" max="${steps.length - 1}" step="1"><output></output>`;
        row.querySelector('.setup-mod-label').textContent = s.label;
        const input = row.querySelector('input');
        input.dataset.key = s.key;
        input.addEventListener('input', () => { draft.mods[s.key] = steps[Number(input.value)]; refresh(); });
        box.appendChild(row);
    }

    const prices = document.createElement('div');
    prices.className = 'setup-prices';
    prices.innerHTML = `<span class="setup-mod-label" title="Price multipliers. A ship with several primes pays each one's multiplier: ×14 pays the ×2 and the ×7 price.">Ship prices</span><div class="setup-price-grid"></div>`;
    const grid = prices.querySelector('.setup-price-grid');
    for (const p of ['all', ...PRICE_PRIMES]) {
        const cell = document.createElement('label');
        cell.className = 'setup-price';
        cell.innerHTML = `<span>${p === 'all' ? 'All' : `×${p}`}</span><select></select>`;
        const sel = cell.querySelector('select');
        sel.dataset.prime = p;
        sel.title = p === 'all' ? 'Every ship' : `Ships whose number is a multiple of ${p}`;
        for (const v of MOD_STEPS.price) sel.add(new Option(pct(v), v));
        sel.addEventListener('change', () => {
            const v = Number(sel.value);
            if (p === 'all') draft.mods.priceAll = v; else draft.mods.primePrice[p] = v;
            refresh();
        });
        grid.appendChild(cell);
    }
    box.appendChild(prices);
}

function refresh() {
    const opp = document.getElementById('setup-opponent');
    opp.value = draft.difficulty;
    document.getElementById('setup-opponent-hint').textContent = hintFor(draft.difficulty);

    const modsOn = takesMods(draft.difficulty);
    const m = draft.mods;
    const presetKey = draft.roll
        ?? Object.keys(PRESETS).find(k => !PRESETS[k].roll && JSON.stringify(normalizeMods(PRESETS[k].mods)) === JSON.stringify(m)) ?? '';
    const presetSel = document.getElementById('setup-preset');
    presetSel.value = presetKey;
    presetSel.disabled = !modsOn;

    const frozen = !!draft.roll || !modsOn;
    document.getElementById('setup-mods').classList.toggle('disabled', frozen);
    for (const s of SLIDERS) {
        const input = document.querySelector(`#setup-mods input[data-key="${s.key}"]`);
        input.value = nearest(MOD_STEPS[s.key], m[s.key]);
        input.disabled = frozen;
        input.nextElementSibling.textContent = (s.fmt ?? String)(m[s.key]);
        input.closest('.setup-mod').classList.toggle('changed', m[s.key] !== DEFAULT_MODS[s.key]);
    }
    document.querySelectorAll('.setup-price select').forEach(sel => {
        const p = sel.dataset.prime;
        const v = p === 'all' ? m.priceAll : m.primePrice[p];
        sel.value = String(MOD_STEPS.price[nearest(MOD_STEPS.price, v)]);
        sel.disabled = frozen;
        sel.closest('.setup-price').classList.toggle('changed', v !== 1);
    });

    const summary = document.getElementById('setup-summary');
    const active = describeMods(m);
    summary.textContent = !modsOn ? 'This mode plays by its own rules; modifiers are off.'
        : draft.roll === 'chaos' ? '🎲 2–4 random modifiers, rolled fresh every game.'
        : draft.roll ? `🎲 ${PRESETS[draft.roll].desc}.`
        : active.length ? `Active: ${active.join(' · ')}` : 'Classic rules.';
    summary.classList.toggle('modded', modsOn && (!!draft.roll || active.length > 0));
    saveDraft();
}

const modal = () => document.getElementById('setup-modal');

export function openSetup() {
    refresh();
    modal().classList.add('active');
    modal().setAttribute('aria-hidden', 'false');
}

export function closeSetup() {
    modal().classList.remove('active');
    modal().setAttribute('aria-hidden', 'true');
}

export const isSetupOpen = () => modal().classList.contains('active');

/** Builds the screen (closed; the menu opens it). It keeps the last setup this browser used. */
export function initSetup() {
    buildOpponents();
    buildPresets();
    buildMods();
    document.getElementById('setup-reset').addEventListener('click', () => { draft.roll = 'standard'; draft.mods = normalizeMods(); refresh(); });
    document.getElementById('setup-cancel').addEventListener('click', closeSetup);
    document.getElementById('setup-start').addEventListener('click', () => {
        closeSetup();
        const mods = takesMods(draft.difficulty);
        startGame({ difficulty: draft.difficulty, mods: mods ? draft.mods : DEFAULT_MODS, roll: mods ? draft.roll : null });
    });
    refresh();
}

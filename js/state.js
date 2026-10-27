import { DIFFICULTIES } from './config.js';
import { sfx } from './audio.js';
import { render, renderDeployBar, renderShortcutBar, resetDeployBar } from './render.js';
import {showTutorial} from '../script.js';
import { DEFAULT_MODS, PRESETS, normalizeMods, isDefault, describeMods, applyBalanceMods, seedOpening } from './modifiers.js';

export let state = null;
export let nextShipId = 1;
export let processing = false;
export let gameOver = false;
export let speedMult = 1;
export let socket = null;
export let username = "player";
export let opponent = "ai";
export let difficulty = 'normal';
// What the New Game screen chose: an opponent (a DIFFICULTIES key) and modifiers. `roll` names a
// preset that rolls fresh modifiers on every (re)start (Standard, Chaos). Restart replays the setup.
export let setup = { difficulty: 'normal', mods: { ...DEFAULT_MODS }, roll: 'standard' };
export let activeMods = { ...DEFAULT_MODS };

export function setProcessing(val) { processing = val; }
export function setGameOver(val) { gameOver = val; }
export function setSpeedMult(val) { speedMult = val; }
export function setUsername(val) { username = val; }
export function incrementShipId() { return nextShipId++; }

export const sleep = ms => new Promise(r => setTimeout(r, ms / speedMult));
export const timeout = (fn, ms) => setTimeout(fn, ms / speedMult);

export async function getNextMessage() {
    return new Promise(resolve => {
        socket.addEventListener('message', event => resolve(event.data), { once: true });
    });
}

export function log(text, cls = '') {
    if (!state) return;
    state.log.push({ text, cls });
    if (state.log.length > 200) state.log.shift();
    renderLog();
}

function renderLog() {
    const el = document.getElementById('log');
    if (!el || state.log.length === 0) return;

    const latest = state.log[state.log.length - 1];
    const div = document.createElement('div');
    div.className = `log-entry ${latest.cls || ''}`;
    div.textContent = latest.text;
    el.appendChild(div);

    if (el.children.length > 200) {
        el.removeChild(el.firstElementChild);
    }
}

export function startNewTurn() {
    state.turn++;
    state.blue.money += state.blue.income;
    state.red.money += state.red.income;
    log(`── Turn ${state.turn} ── Income: BLUE +${state.blue.income} · RED +${state.red.income}`, 'heading');
    const message = state.red.tutorial[state.turn];
    if (message !== undefined) {
        showTutorial(message);
    }
}

/** Starts a game with this setup ({ difficulty, mods, roll }) and keeps it for restarts. */
export function startGame(newSetup) {
    setup = { difficulty: newSetup.difficulty, mods: normalizeMods(newSetup.mods), roll: PRESETS[newSetup.roll]?.roll ? newSetup.roll : null };
    newGame();
}

export function newGame(handicap) {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());

    difficulty = setup.difficulty;
    let mods = setup.roll ? PRESETS[setup.roll].roll() : setup.mods;

    if (handicap !== undefined) {
        // Imported games replay standard rules.
        const idx = parseInt(handicap, 10);
        difficulty = ["normal", "hard", "challenging", "tricky", "visionary"][idx];
        mods = DEFAULT_MODS;
    }

    const D = DIFFICULTIES[difficulty];
    // Campaign missions and online play keep their own rules.
    if (difficulty.startsWith('campaign') || D.ai === 'pvp') mods = DEFAULT_MODS;
    activeMods = normalizeMods(mods);
    applyBalanceMods(activeMods);
    const M = activeMods;

    if (D.ai === "pvp") {
        socket = new WebSocket("wss://render-echo-wvk1.onrender.com");
        opponent = "waiting";
        socket.addEventListener('open', async () => {
            socket.send(username);
            opponent = await getNextMessage();
            render();
        }, { once: true });
    } else {
        opponent = `ai - ${D.label}${isDefault(M) ? '' : ' · modded'}`;
    }

    state = {
        turn: 0,
        blue: {
            hp: D.playerHp ?? M.baseHp,
            damage_mult: 1,
            regen: 0,
            income: D.playerIncome ?? M.startIncome,
            money: M.startMoney,
            ore: M.startOre,
            ore_boost: 1,
            ore_income: 0,
            armor: 1,
            armor_gain: 0,
            ships: [],
            history: [],
            lastBought: 0,
            max_ship: D.maxShip ?? 999,
            locked_factor: D.lockedFactor ?? 999,
        },
        red: {
            hp: D.botHp ?? M.baseHp,
            armor: 1,
            armor_gain: D.armorGain ?? 0,
            regen: D.regen,
            income: D.botIncome ?? M.startIncome,
            money: D.botMoney ?? M.startMoney,
            ore: D.botOre ?? M.startOre,
            ore_boost: D.oreMult ?? 1,
            ore_delay: D.oreDelay ?? 0,
            ore_income: D.oreIncome ?? 0,
            ships: [],
            ai: D.ai ?? false,
            opening: D.opening ?? [],
            history: [],
            priority: D.priority ?? [],
            tutorial: D.tutorial ?? [],
        },
        log: [],
        modded: !isDefault(M),
    };

    const handicapInput = document.getElementById('handicapSelect');
    if (handicapInput) handicapInput.value = state.red.ore_delay * 16;

    if (D.ai === "daily") { state.red.hp += 130; state.blue.hp += 130; }
    if (D.ai === "custom") {
        const p = prompt("Please enter your opponent's build order:", "0,0,7");
        if (p) state.red.opening = JSON.parse(`[${p}]`);
    }

    nextShipId = 1;
    seedOpening(state, M, incrementShipId);
    processing = false;
    gameOver = false;
    log(`Battle commenced. Handicap: ${D.label}.`, 'heading');
    if (state.modded) log(`Modifiers: ${describeMods(M).join(' · ')}.`, 'heading');
    startNewTurn();
    render();
    resetDeployBar();
    renderDeployBar();
    renderShortcutBar();
}

export function endGame() {
    gameOver = true;
    processing = false;
    const winner = state.red.hp > state.blue.hp ? 'RED' : 'BLUE';
    log(`${winner} wins on turn ${state.turn}.`, 'heading');
    if (winner === 'BLUE') sfx.win();
    else sfx.lose();
    render();
}
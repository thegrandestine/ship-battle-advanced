// The command labels on the stat cards double as AI pickers: red's swaps the opponent mid-game,
// blue's hands blue to an AI that plays itself (one turn every ~2 s, faster with animation speed),
// for AI-vs-AI matches outside the tools/ arenas.

import { DIFFICULTIES } from './config.js';
import { state, processing, gameOver, difficulty, blueAI, setBlueAI, setRedAI, sleep, log } from './state.js';
import { runTurn, pickFor } from './combat.js';

const TURN_MS = 2000;

// Any AI can take over red; the classic ones (Normal…Visionary) only know how to play red.
const RED_AIS = Object.keys(DIFFICULTIES).filter(k => !k.startsWith('campaign') && !['pvp', 'custom'].includes(DIFFICULTIES[k].ai));
const BLUE_AIS = RED_AIS.filter(k => ['grandmaster', 'zero'].includes(DIFFICULTIES[k].ai));

const redSel = () => document.getElementById('red-ai');
const blueSel = () => document.getElementById('blue-ai');

function fill(sel, entries) {
    for (const [value, label] of entries) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        sel.appendChild(o);
    }
}

function build() {
    const red = redSel(), blue = blueSel();
    fill(red, RED_AIS.map(k => [k, DIFFICULTIES[k].label]));
    fill(blue, [['player', 'Player'], ...BLUE_AIS.map(k => [k, DIFFICULTIES[k].label])]);
    red.addEventListener('change', () => { setRedAI(red.value); red.blur(); });
    blue.addEventListener('change', () => {
        const key = blue.value === 'player' ? null : blue.value;
        setBlueAI(key);
        log(`BLUE command passes to ${key ? DIFFICULTIES[key].label : 'the player'}.`, 'blue');
        blue.blur();
        if (key) autoplay();
    });
}

/** Shows the current commanders (called from render). Missions and online games keep theirs. */
export function syncCommanders() {
    const red = redSel(), blue = blueSel();
    if (!red || !blue || !state) return;
    if (!red.options.length) build();
    const redFree = RED_AIS.includes(difficulty);
    red.hidden = !redFree;
    if (redFree && red.value !== difficulty) red.value = difficulty;
    blue.hidden = state.red.ai === 'pvp';
    const b = blueAI ?? 'player';
    if (blue.value !== b) blue.value = b;
}

const paused = () => ['pause-modal', 'setup-modal', 'formModal']
    .some(id => document.getElementById(id)?.classList.contains('active'));

let looping = false;

/** Plays blue's turns while an AI has blue. Waits out the pause menu, game over and restarts. */
async function autoplay() {
    if (looping) return;
    looping = true;
    while (blueAI) {
        const game = state, turn = state.turn;
        await sleep(TURN_MS);
        // A turn the player played meanwhile (or a new game) restarts the wait
        if (!blueAI || processing || gameOver || paused() || state !== game || state.turn !== turn) continue;
        if (state.red.ai === 'pvp') break;
        await runTurn(pickFor('blue', blueAI) ?? 0);
    }
    looping = false;
}

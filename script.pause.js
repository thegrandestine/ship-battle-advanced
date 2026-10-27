import { newGame, setup } from './js/state.js';
import { DIFFICULTIES } from './js/config.js';
import { describeMods, PRESETS } from './js/modifiers.js';
import { openSetup, closeSetup, isSetupOpen } from './js/setup.js';

const pauseModal = document.getElementById('pause-modal');
const importModal = document.getElementById('formModal');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnRestartTop = document.getElementById('btn-restart-top');
const menuBtn = document.getElementById('menu-btn');
const btnNewGame = document.getElementById('btn-new-game');
const btnImport = document.getElementById('btn-open-import');
const pauseOpponent = document.getElementById('pause-opponent');
const pauseMods = document.getElementById('pause-mods');

function setOpen(modal, open) {
    modal.classList.toggle('active', open);
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function togglePauseMenu(force) {
    const shouldOpen = force !== undefined ? force : !pauseModal.classList.contains('active');
    if (shouldOpen && pauseOpponent) {
        const mods = setup.roll ? [`${PRESETS[setup.roll].label} (rolled each game)`] : describeMods(setup.mods);
        pauseOpponent.textContent = DIFFICULTIES[setup.difficulty]?.label ?? setup.difficulty;
        pauseMods.textContent = mods.length ? mods.join(' · ') : 'Classic rules';
        pauseMods.classList.toggle('modded', mods.length > 0);
    }
    setOpen(pauseModal, shouldOpen);
}

export function closeImport() { setOpen(importModal, false); }

// Global ESC hotkey: closes the top-most dialog, otherwise toggles the pause menu
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (importModal.classList.contains('active')) closeImport();
    else if (isSetupOpen()) closeSetup();
    else togglePauseMenu();
});

menuBtn?.addEventListener('click', () => togglePauseMenu(true));
btnResume?.addEventListener('click', () => togglePauseMenu(false));

btnRestart?.addEventListener('click', () => {
    togglePauseMenu(false);
    newGame();
});

btnRestartTop?.addEventListener('click', () => {
    togglePauseMenu(false);
    newGame();
});

btnNewGame?.addEventListener('click', () => {
    togglePauseMenu(false);
    openSetup();
});

btnImport?.addEventListener('click', () => {
    togglePauseMenu(false);
    setOpen(importModal, true);
});

document.getElementById('importCancel')?.addEventListener('click', closeImport);

// Click outside a dialog to close it
for (const modal of [pauseModal, importModal, document.getElementById('setup-modal')]) {
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) setOpen(modal, false);
    });
}


import { renderShortcutBar } from './js/render.js';

const SHORTCUT_KEY = 'shipbattle.showShortcut';
const shortcutBar = document.getElementById('shortcut-bar');
const shortcutToggle = document.getElementById('shortcut-toggle');

// Load preference (off unless turned on)
let showShortcut = localStorage.getItem(SHORTCUT_KEY) === '1';

if (shortcutToggle && shortcutBar) {
    shortcutToggle.checked = showShortcut;
    shortcutBar.style.display = showShortcut ? 'grid' : 'none';

    shortcutToggle.addEventListener('change', (e) => {
        showShortcut = e.target.checked;
        localStorage.setItem(SHORTCUT_KEY, showShortcut ? '1' : '0');
        shortcutBar.style.display = showShortcut ? 'grid' : 'none';
        if (showShortcut) renderShortcutBar();
    });
}

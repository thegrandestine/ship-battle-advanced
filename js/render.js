import { state, processing, gameOver, opponent, activeMods } from './state.js';
import { describeMods } from './modifiers.js';
import { SECTORS, BLUE_BASE_IDX, RED_BASE_IDX, BLUE_DEPLOY_IDX, RED_DEPLOY_IDX, ATTACK_RANGE, SWORD_SVG, BOW_SVG, ROCKET_SVG, HEART_SVG, TARGET_MARK_SVG, SECTOR_LABEL_H, BASE_H, SHIP_CARD_H, SHIP_CARD_H_COMPACT, START_ORE } from './config.js';
import { TEMPLATES, SHIP_NUMS, listAbilities } from './templates.js';
import { cost, calcOreIncome, excessExponent, oreDivisor, maxLoanFor, balance } from './economy.js';
import { shipNumBg, shipStripGradient } from './visuals.js';
import { hideTip } from './tooltips.js';
import { runTurn } from './combat.js';

const shipElements = new Map();
// Height a sector column has for stacking ships (from the battlefield's height, at least 240):
// up to SHIP_STEP apart, squeezed closer only when they would not fit.
let stackSpace = 240;
const SHIP_STEP = 240 / 7;

export function render() {
    const nameInput = document.getElementById('blue-bo');
    const emailInput = document.getElementById('red-bo');
    if (nameInput) nameInput.value = `${state.blue.history}`;
    if (emailInput) emailInput.value = `${state.red.history}`;

    hideTip();
    renderStats();
    renderBattlefield();
    // renderDeployBar();

    const ti = document.getElementById('turn-info');
    if (ti) {
        ti.innerHTML = processing
            ? `Turn ${state.turn} · <span class="resolving">RESOLVING…</span>`
            : gameOver
                ? `Turn ${state.turn} · ENDED`
                : `Turn ${state.turn} · DEPLOY`;
    }

    const ml = document.getElementById('mods-line');
    if (ml) ml.textContent = describeMods(activeMods).join(' · ') || 'Classic';
}

export function renderStats() {
    document.getElementById('blue-money').textContent = `${state.blue.money.toFixed(2)} (+${state.blue.income})`;
    document.getElementById('blue-ore').textContent = `${state.blue.ore} (+${calcOreIncome('blue', state)})`;
    document.getElementById('red-money').textContent = `${state.red.money.toFixed(2)} (+${state.red.income})`;
    document.getElementById('red-ore').textContent = `${state.red.ore} (+${calcOreIncome('red', state)})`;
    document.getElementById('red-command').textContent = opponent;
}

export function getShipPosition(ship, allShips) {
    const sectorIdx = ship.sector;
    const leftPct = (sectorIdx - 1) / 7 * 100;
    let top = SECTOR_LABEL_H;
    if (sectorIdx === BLUE_BASE_IDX || sectorIdx === RED_BASE_IDX) top += BASE_H;
    const inSector = allShips.filter(s => s.sector === sectorIdx).sort((a, b) => {
        if (a.owner !== b.owner) return a.owner === 'blue' ? -1 : 1;
        return a.row - b.row;
    });
    const l = inSector.length;
    const modifiedShips = l > 7 ? 7 * Math.pow(l / 7, 0.5) : 7;
    top += inSector.indexOf(ship) * Math.min(SHIP_STEP, stackSpace / modifiedShips);
    return { leftPct, top, compact: false };
}

export function renderBattlefield() {
    const el = document.getElementById('battlefield');
    if (!el) return;

    if (!document.getElementById('ships-layer')) {
        el.innerHTML = '';
        for (let i = 1; i < 8; i++) {
            const sec = document.createElement('div');
            sec.className = `sector${i < 4 ? ' blue-side' : (i > 4 ? ' red-side' : '')}${i === BLUE_DEPLOY_IDX ? ' deploy-blue' : ''}${i === RED_DEPLOY_IDX ? ' deploy-red' : ''}`;
            sec.dataset.sectorIdx = i;

            if (i === BLUE_BASE_IDX) sec.appendChild(renderBase('blue'));
            if (i === RED_BASE_IDX) sec.appendChild(renderBase('red'));
            el.appendChild(sec);
        }
        const shipsLayer = document.createElement('div');
        shipsLayer.id = 'ships-layer';
        el.appendChild(shipsLayer);
        const fxLayer = document.createElement('div');
        fxLayer.id = 'fx-layer';
        el.appendChild(fxLayer);
    }

    updateBase('blue', el.querySelector('.base.blue'));
    updateBase('red', el.querySelector('.base.red'));

    // Measure the height the page gives the battlefield (without last render's min-height)
    el.style.minHeight = '';
    stackSpace = Math.max(240, el.clientHeight - SECTOR_LABEL_H - BASE_H - SHIP_CARD_H - 20);

    const shipsLayer = document.getElementById('ships-layer');
    const allShips = [...state.blue.ships, ...state.red.ships];
    const activeIds = new Set(allShips.map(s => s.id));

    for (const [id, div] of shipElements) {
        if (!activeIds.has(id)) {
            div.remove();
            shipElements.delete(id);
        }
    }

    for (const ship of allShips) {
        const pos = getShipPosition(ship, allShips);
        let div = shipElements.get(ship.id);
        // Ship ids restart at 1 every game, so after a restart an id can belong to a different
        // ship: its old card would keep the old number and name under the new stats.
        if (div && div.ship !== ship) { div.remove(); div = null; }
        if (!div) {
            div = createShipElement(ship, pos.compact);
            div.ship = ship;
            shipsLayer.appendChild(div);
            shipElements.set(ship.id, div);
        }
        div.style.left = `calc(${pos.leftPct}% + 4px)`;
        div.style.top = `${pos.top}px`;
        div.style.zIndex = -ship.row;
        updateShipElement(div, ship);
    }

    let maxBottom = 300;
    for (const ship of allShips) {
        const pos = getShipPosition(ship, allShips);
        const bottom = pos.top + SHIP_CARD_H + 12;
        if (bottom > maxBottom) maxBottom = bottom;
    }
    el.style.minHeight = `${maxBottom}px`;
}

export function createShipElement(ship, compact) {
    const div = document.createElement('div');
    div.dataset.shipId = ship.id;
    div.className = `ship ${ship.owner}${compact ? ' compact' : ''}`;
    div.innerHTML = `
        <div class="ship-inner">
          <div style="display: flex; gap: 5px;">
              <div><span class="ship-num"></span></div>
              <div style="position: relative; flex: 1">
                  <div class="ship-stats">
                    <span class="atk"></span>
                    <span class="hp"></span>
                    <span class="ship-name">${ship.template.name}</span>
                  </div>
              </div>
          </div>
        </div>`;

    const numSpan = div.querySelector('.ship-num');
    numSpan.textContent = ship.number;
    numSpan.dataset.tipText = listAbilities(ship.number);
    numSpan.style.background = shipNumBg(ship.number);

    return div;
}

export function updateShipElement(div, ship) {
    if (div.classList.contains('dying')) return;

    // Preserve active animation classes so render() doesn't cancel them
    const isAttacking = div.classList.contains('attacking');
    const isDamaged = div.classList.contains('damaged');

    div.className = `ship ${ship.owner}${isAttacking ? ' attacking' : ''}${isDamaged ? ' damaged' : ''}${ship.exhausted ? ' exhausted' : ''}${ship.justDeployed ? ' appearing' : ''}${ship.health <= 0 ? ' dead' : ''}`;

    const atkEl = div.querySelector('.atk');
    if (atkEl) atkEl.innerHTML = `${ship.number % 5 ? (ship.number % 11 ? SWORD_SVG : BOW_SVG) : ROCKET_SVG}${ship.attack}`;

    const hpEl = div.querySelector('.hp');
    if (hpEl) hpEl.innerHTML = `${HEART_SVG}${Math.max(0, ship.health)}`;
}

export function updateBase(owner, baseEl) {
    if (!baseEl) return;

    // 1. In-place HP update (only touches DOM if value actually changed)
    const hpEl = baseEl.querySelector('.base-hp');
    if (hpEl) {
        let hpStr = String(parseFloat(state[owner].hp.toFixed(1)));
        if (state[owner].armor > 1) hpStr += ` x${+state[owner].armor.toFixed(2)}`;
        if (hpEl.textContent !== hpStr) {
            hpEl.textContent = hpStr;
        }
    }

    // 2. In-place Base History update
    const row = baseEl.querySelector('.row1');
    if (!row) return;

    const history = state[owner].history;

    // A. Handle battle restart / undo: prune excess nodes if history shrank
    while (row.children.length > history.length) {
        row.lastElementChild.remove();
    }

    // B. Re-sync existing nodes only if their value changed (e.g., loaded game / swapped state)
    for (let i = 0; i < row.children.length; i++) {
        const child = row.children[i];
        const n = history[i];
        if (child.dataset.shipNum !== String(n)) {
            child.dataset.shipNum = n;
            child.textContent = n;
            child.style.background = shipNumBg(n);
            child.dataset.tipText = listAbilities(n);
        }
    }

    // C. Append ONLY new entries added since last render
    for (let i = row.children.length; i < history.length; i++) {
        const n = history[i];
        const span = document.createElement('span');
        span.className = 'num';
        span.dataset.shipNum = n;
        span.textContent = n;
        span.style.background = shipNumBg(n);
        span.dataset.tipText = listAbilities(n);
        span.dataset.html = 'true';
        row.appendChild(span);
    }
}

export function renderBase(owner) {
    const div = document.createElement('div');
    div.className = `base ${owner}`;
    div.dataset.tip = 'base';
    div.innerHTML = `<div class="base-hp"></div><div class="row1"></div>`;
    updateBase(owner, div);
    return div;
}

let deployBarInitialized = false;
/** Rebuild the deploy bar on its next render (ship stats can change between games). */
export function resetDeployBar() { deployBarInitialized = false; }

function getBuyCardTooltip(n, t, c) {
    const margin = Math.max(1, calcOreIncome('blue', state));
    const d = c - cost(n, state.blue.ore+margin);
    const oppC = cost(n, state.red.ore);
    const abilities = listAbilities(n);
    const shortfall = c - state.blue.money;
    const interest_block = `<div>You are must take a loan to buy this ship - interest would be ${(shortfall/4).toFixed(2)}</div>`
    return `
      <div style="margin-bottom: 6px;">
        <strong style="font-size: 1.05em; color: #f0f6fc;">#${n} ${t.name}</strong>
      </div>
      <div style="margin-bottom: 8px; line-height: 1.45; color: #c9d1d9;">
        ${abilities}
      </div>
      <div style="border-top: 1px solid #30363d; padding-top: 6px; font-size: 0.85em; color: #8b949e; line-height: 1.4;">
        <div>Construction cost: <strong style="color: #58a6ff;">${c.toFixed(2)}</strong> — ${margin} more ore would discount this by ${d > 1 ? d.toFixed(2) : d.toPrecision(2)}</div>
        ${shortfall > 0 ? interest_block : ""}
        <div>Opponent's cost: <strong style="color: #f85149;">$${oppC.toFixed(2)}</strong></div>
      </div>
    `;
}

function largestPrimeFactor(n) {
    if (n <= 1) return 1; // 1 has no prime factors
    
    let largest = 1;
    
    // 1. Strip out all factors of 2
    while (n % 2 === 0) {
        largest = 2;
        n /= 2;
    }
    
    // 2. Strip out odd factors up to sqrt(n)
    for (let d = 3; d * d <= n; d += 2) {
        while (n % d === 0) {
            largest = d;
            n /= d;
        }
    }
    
    // 3. If n is still greater than 1, the remaining value itself is prime
    if (n > 1) {
        largest = n;
    }
    
    return largest;
}

export function renderDeployBar() {
    const el = document.getElementById('deploy-bar');
    if (!el) return;

    const cb = document.getElementById('tag-toggle');
    const scrubMode = cb ? !cb.checked : false;

    // --- INITIAL BUILD (Run only once!) ---
    if (!deployBarInitialized || el.children.length === 0) {
        el.innerHTML = '';

        // Skip Button
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.id = 'btn-ship-skip';
        skip.className = 'ship-btn skip-btn';
        skip.dataset.tip = 'free';
        skip.innerHTML = `<div class="stats"><span class="num">0</span></div><div class="row1"><span class="name">Skip</span></div><span class="overlay-text-right">FREE</span>`;
        skip.onclick = () => { if (!processing && !gameOver) runTurn(0); };
        el.appendChild(skip);

        // 54 Ship Buttons
        for (const n of SHIP_NUMS) {
            const t = TEMPLATES[n];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = `btn-ship-${n}`;
            btn.dataset.shipNum = n;
            // NOTE: data-tip-text removed from <span class="num"> so only the button has the tooltip
            btn.innerHTML = `
              <div class="stats">
                <span class="num" style="background:${shipNumBg(n)};">${n}</span>
                <span class="atk">${n % 5 ? (n % 11 ? SWORD_SVG : BOW_SVG) : ROCKET_SVG}${t.attack}</span>
                <span class="hp">${HEART_SVG}${t.health}</span>
              </div>
              <div class="row1"><span class="name">${t.name}</span></div>
              <span class="overlay-text-right price-tag"></span>
            `;
            btn.onclick = () => {
                if (btn.classList.contains('locked')) return;
                const c = cost(n, state.blue.ore);
                const affordable = state.blue.money + maxLoanFor(state.blue.income) >= c;
                if (affordable && !processing && !gameOver) runTurn(n);
            };
            el.appendChild(btn);
        }
        deployBarInitialized = true;
    }

    // --- IN-PLACE UPDATE (0 DOM nodes created or destroyed) ---
    const skipBtn = document.getElementById('btn-ship-skip');
    if (skipBtn) {
        skipBtn.classList.toggle('disabled', processing || gameOver);
    }

    // Ships just above the bar's price band are previewed (faded, not buyable) so the bar keeps
    // a steady size: at least two full rows, filled to the end of the last row.
    const shown = SHIP_NUMS.filter(n => barStatus(n) === 'shown').length;
    const cols = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length);
    let previews = Math.max(2, Math.ceil((shown + 1) / cols)) * cols - (shown + 1);

    for (const n of SHIP_NUMS) {
        const btn = document.getElementById(`btn-ship-${n}`);
        if (!btn) continue;

        const status = barStatus(n);
        const locked = status === 'above' && previews-- > 0;
        btn.style.display = status === 'shown' || locked ? '' : 'none';
        if (status !== 'shown' && !locked) continue;

        const t = TEMPLATES[n];
        const c = cost(n, state.blue.ore);
        if (locked) {
            btn.className = 'ship-btn locked';
            btn.dataset.tipText = `<b>Not on your bar yet.</b> It appears as your income and ore grow.<br><br>${getBuyCardTooltip(n, t, c)}`;
            const priceTag = btn.querySelector('.price-tag');
            if (priceTag) {
                priceTag.textContent = c.toFixed(2);
                priceTag.className = 'overlay-text-right price-tag';
            }
            continue;
        }
        const affordable = state.blue.money + maxLoanFor(state.blue.income) >= c;
        const costExceedsMoney = c > state.blue.money;
        const btnDisabled = !affordable || processing || gameOver;

        btn.className = `ship-btn${affordable ? (costExceedsMoney ? ' debt' : '') : ' unaffordable'
            }${btnDisabled ? ' disabled' : ''}`;

        // Unified all-in-one tooltip on the card:
        btn.dataset.tipText = getBuyCardTooltip(n, t, c);

        const priceTag = btn.querySelector('.price-tag');
        if (priceTag) {
            priceTag.textContent = c.toFixed(2);
            priceTag.className = `overlay-text-right price-tag ${costExceedsMoney ? 'text-red' : ''}`;
        }
    }
}

/**
 * Whether ship n is on blue's deploy bar: 'shown', 'above' its price band (too pricey for now;
 * previewed), or 'hidden' (outgrown, or locked by a campaign). js/grandmaster.js visibleShips()
 * models the same rule.
 */
function barStatus(n) {
    const { ore, income } = state.blue;
    if (n > state.blue.max_ship) return 'hidden';
    if (largestPrimeFactor(n) >= state.blue.locked_factor) return 'hidden';
    /* if (cost(40, ore) <= 2.6*income && n <= 10) return 'hidden';
    if (cost(50, ore) <= 2.5*income && n <= 20) return 'hidden';
    if (cost(60, ore) <= 2.4*income && n <= 30) return 'hidden';
    if (cost(20, ore) > 3*income && n >= 20) return 'above';
    if (cost(30, ore) > 2.8*income && n >= 30) return 'above';
    if (cost(40, ore) > 2.6*income && n >= 40) return 'above';
    if (cost(50, ore) > 2.5*income && n >= 50) return 'above';
    if (cost(60, ore) > 2.4*income && n >= 60) return 'above';
    if (cost(70, ore) > 4*income && n >= 70) return 'above'; */
    return 'shown';
}


// --- CALCULATE THE 5 RING SHIPS ---
function getShortcutRingNums() {
    const ore = state.blue.ore;
    const maxSpend = state.blue.money + maxLoanFor(state.blue.income);

    // All ships currently affordable (including using debt)
    const affordable = SHIP_NUMS.filter(n => cost(n, ore) <= maxSpend);

    const ring = [];
    // 5 columns: c = 0, 1, 2, 3, 4 where (n - 1) % 5 === c
    for (let c = 0; c < 5; c++) {
        const shipsInCol = affordable.filter(n => (n - 1) % 5 === c);
        if (shipsInCol.length > 0) {
            // Pick highest affordable ship in this modulo column
            ring.push(Math.max(...shipsInCol));
        } else {
            // Default fallback if no money (1, 2, 3, 4, 5)
            ring.push(c + 1);
        }
    }
    return ring;
}

// --- RENDER THE 7-SHIP SHORTCUT BAR ---
export function renderShortcutBar() {
    const el = document.getElementById('shortcut-bar');
    if (!el || el.style.display === 'none') return;

    el.innerHTML = '';

    // Defaults to 0 on game start
    const lastBought = state.blue.lastBought ?? 0;
    const ringShips = getShortcutRingNums();

    // 7 Slots: [0 (Skip), ...5 Ring Ships, Last-Bought]
    const shortcutSlots = [
        { type: 'skip', num: 0 },
        ...ringShips.map(num => ({ type: 'ring', num })),
        { type: 'last', num: lastBought }
    ];

    for (const slot of shortcutSlots) {
        const n = slot.num;

        // --- IF SLOT IS 0 (Slot 1 or Slot 7 defaulting to 0) ---
        if (n === 0) {
            const skip = document.createElement('button');
            skip.type = 'button';
            skip.className = `ship-btn skip-btn${processing || gameOver ? ' disabled' : ''}${slot.type === 'last' ? ' slot-last' : ''}`;
            skip.dataset.tip = 'free';
            // Single-line string eliminates whitespace rendering glitches:
            skip.innerHTML = `<div class="stats"><span class="num">0</span></div><div class="row1"><span class="name">Skip</span></div><span class="overlay-text-right">FREE</span>`;
            skip.onclick = () => { if (!processing && !gameOver) runTurn(0); };
            el.appendChild(skip);
            continue;
        }

        // --- NORMAL SHIPS (1..54) ---
        const t = TEMPLATES[n];
        if (!t) continue;

        const c = cost(n, state.blue.ore);
        const affordable = state.blue.money + maxLoanFor(state.blue.income) >= c;
        const costExceedsMoney = c > state.blue.money;
        const btnDisabled = !affordable || processing || gameOver;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ship-btn${affordable ? (costExceedsMoney ? ' debt' : '') : ' unaffordable'}${btnDisabled ? ' disabled' : ''}${slot.type === 'last' ? ' slot-last' : ''}`;
        btn.dataset.tipText = getBuyCardTooltip(n, t, c);

        btn.innerHTML = `<div class="stats"><span class="num" style="background:${shipNumBg(n)};">${n}</span><span class="atk">${n % 5 ? (n % 11 ? SWORD_SVG : BOW_SVG) : ROCKET_SVG}${t.attack}</span><span class="hp">${HEART_SVG}${t.health}</span></div><div class="row1"><span class="name">${t.name}</span></div><span class="overlay-text-right price-tag ${costExceedsMoney ? 'text-red' : ''}">${c.toFixed(2)}</span>`;

        btn.onclick = () => {
            if (affordable && !processing && !gameOver) runTurn(n);
        };

        el.appendChild(btn);
    }
}

import { state, processing, gameOver, setProcessing, sleep, timeout, log, startNewTurn, endGame, incrementShipId, socket, getNextMessage, difficulty } from './state.js';
import { SECTORS, RED_BASE_IDX, BLUE_BASE_IDX, BLUE_DEPLOY_IDX, RED_DEPLOY_IDX, ATTACK_RANGE, DIFFICULTIES } from './config.js';
import { TEMPLATES, calculatePrimeFactors } from './templates.js';
import { cost, calcOreIncome, maxLoanFor } from './economy.js';
import { sfx } from './audio.js';
import { animateAttacker, shootLaser, showDamageNumber, flashBase, clearRectCache } from './visuals.js';
import { render, renderDeployBar, renderShortcutBar, updateBase } from './render.js';
import { pickAIR } from './ai.js';
import { chooseGrandmaster } from './grandmaster.js';
import { loadNet, chooseZero, LIVE_VARIETY } from './zero.js';
import { ZERO_WEIGHTS } from './zero-weights.js';

let zeroNet;
import { HEART_SVG } from './config.js'; 

function updateHealthDisplay(target, isBase, enemyOwner) {
    if (isBase) {
        const baseEl = document.querySelector(`.base.${enemyOwner}`);
        updateBase(enemyOwner, baseEl);
    } else if (target) {
        const el = document.querySelector(`[data-ship-id="${target.id}"]`);
        if (el) {
            // Flash the element directly in the DOM
            el.classList.add('damaged');
            timeout(() => el.classList.remove('damaged'), 220);

            // Update HP with the proper SVG icon intact
            const hpEl = el.querySelector('.hp');
            if (hpEl) {
                const curHp = Math.max(0, target.health);
                hpEl.innerHTML = `${HEART_SVG}${curHp}`;
                if (curHp <= 0) {
                    hpEl.className = 'hp dead';
                    el.classList.add('dying', 'dead');
                } else if (curHp <= target.maxHealth * 0.35) {
                    hpEl.className = 'hp low';
                }
            }
        }
    }
}

export function priorityOrder(owner) {
    return state[owner].ships.slice().filter(s => s.health > 0 || s.dying).sort((a, b) => {
        const da = owner === 'blue' ? -a.sector : a.sector;
        const db = owner === 'blue' ? -b.sector : b.sector;
        if (da !== db) return da - db;
        return a.row - b.row;
    });
}

export function recomputeRows() {
    for (const owner of ['blue', 'red']) {
        const bySector = {};
        for (const s of state[owner].ships) (bySector[s.sector] ??= []).push(s);
        for (const sec in bySector) {
            bySector[sec].sort((a, b) => a.row - b.row);
            bySector[sec].forEach((s, i) => { s.row = i; });
        }
    }
}

export async function deployShip(owner, num, sector, hp, atk) {
    const tpl = TEMPLATES[num];
    if (num === 61 && state[owner].ships.length) {
        sector = (owner === 'blue' ? Math.max : Math.min)(...state[owner].ships.map(s => s.sector));
    }
    if (num === 67 && state[owner].ships.length) {
        sector = (owner === 'blue' ? Math.max : Math.min)(...state[owner].ships.map(s => s.sector));
    }
    const ship = {
        id: incrementShipId(),
        owner,
        number: num,
        attack: atk !== undefined ? atk : tpl.attack,
        health: hp !== undefined ? hp : tpl.health,
        maxHealth: Math.max(tpl.health, 10),
        sector,
        row: 999,
        template: tpl,
        justDeployed: true,
    };
    state[owner].ships.push(ship);
    for (let i = 0; i < 2 ** state[owner].ships.filter(s => s.number == 71).length; i++) {
        await triggerOnDeploy(owner, num, sector, ship);
    }
    recomputeRows();
    log(`${owner.toUpperCase()} deploys #${num} ${tpl.name} into ${SECTORS[sector]}.`, owner);
    return ship;
}

async function triggerOnDeploy(owner, num, sector, ship){
if (num === 59) ship.attack += state[owner].income;
    if (num > 0 && (num % 7 === 0)) {
        state[owner].income += num / 7;
        state[owner].hp -= 4;
        log(`${owner.toUpperCase()} trades 4 base hp for +${num / 7} income (now ${state[owner].income}).`, owner);
    }
    if (num > 0 && (num % 49 === 0)) {
        state[owner].income += num / 7;
        state[owner].hp -= 4;
        log(`${owner.toUpperCase()} trades 4 base hp for +${num / 7} income (now ${state[owner].income}).`, owner);
    }
    if (num === 73) state[owner].hp += ship.attack;
    if (TEMPLATES[num].win) {
        const enemy = owner === 'red' ? 'blue' : 'red';
        state[enemy].hp -= ship.attack;
    }
    if (num === 41) {
        for (let i = 1; i <= 23; i++) {
            if (calculatePrimeFactors(i).length === 1) await deployShip(owner, i, sector);
        }
    }
    if (num % 37 === 0) {
        for (let i = 1; i <= 12; i++) await deployShip(owner, i, sector);
    }
    if (num === 53) {
        for (const s of state[owner].ships){
            s.attack += 1;
        }
    }
}

export function canAfford(owner, num) {
    const c = cost(num, state[owner].ore);
    return state[owner].money + maxLoanFor(state[owner].income) >= c;
}

export async function buyShip(owner, num) {
    const sec = owner === 'blue' ? BLUE_DEPLOY_IDX : RED_DEPLOY_IDX;
    const c = cost(num, state[owner].ore);
    if (!canAfford(owner, num)) {
        state[owner].history.push(0);
        return false;
    }
    if (owner === 'blue' && num > 0) {
        state.blue.lastBought = num;
    }
    state[owner].history.push(num);
    state[owner].money -= c;
    if (state[owner].money < 0) state[owner].money *= 1.25;
    await deployShip(owner, num, sec);
    sfx.deploy();
    return true;
}
export function fireMissile(ship, enemyOwner, sector) {
    const attackerEl = document.querySelector(`[data-ship-id="${ship.id}"]`);
    if (attackerEl) {
        attackerEl.classList.add('attacking');
        timeout(() => attackerEl.classList.remove('attacking'), 350);
    }

    const dmg = ship.template.number / 5;
    const bSec = ship.owner === 'blue' ? RED_BASE_IDX : BLUE_BASE_IDX;
    const baseEl = document.querySelector(`.base.${enemyOwner}`);

    const hits = state[enemyOwner].ships.filter(e => e.sector === sector && e.health > 0 && !e.dying);

    hits.forEach((h, idx) => {
        const hEl = document.querySelector(`[data-ship-id="${h.id}"]`);
        const delay = idx * 60;

        const coords = shootLaser(attackerEl, hEl, ship.owner, { aoe: true, delay });
        if (coords) showDamageNumber(coords.targetX, coords.targetY, dmg, ship.owner, { aoe: true, delay: delay + 180 });

        h.health -= Math.max(dmg - (h.number % 19 === 0 ? h.number / 19 : 0), 0);

        if (h.health <= 0 && !h.dying) {
            h.dying = true;
            state.newlyKilled.push(h);
        }

        // Direct DOM update triggers individual damage flashes for every hit target
        updateHealthDisplay(h, false, enemyOwner);
    });

    sfx.missile();

    if (sector === bSec) {
        const coords = shootLaser(attackerEl, baseEl, ship.owner, { large: true });
        flashBase(enemyOwner);
        sfx.baseHit();
        state[enemyOwner].hp -= dmg / state[enemyOwner].armor;
        if (coords) showDamageNumber(coords.targetX, coords.targetY, dmg, ship.owner, { large: true, delay: 180 });
        updateHealthDisplay(null, true, enemyOwner);
    }

    log(`#${ship.number} [${ship.owner.toUpperCase()}] missile-strikes ${SECTORS[sector]} — ${hits.length} hit for ${dmg} each.`, ship.owner);
}

export async function executeStrike(ship, enemyOwner, atkTarget, atkBaseTarget, remainingDmg) {
    const dmg = remainingDmg || ship.attack;

    // Direct attacker pulse on the DOM
    const attackerEl = document.querySelector(`[data-ship-id="${ship.id}"]`);
    if (attackerEl) {
        attackerEl.classList.add('attacking');
        timeout(() => attackerEl.classList.remove('attacking'), 350);
    }

    if (atkBaseTarget) {
        const baseEl = document.querySelector(`.base.${enemyOwner}`);
        const coords = shootLaser(attackerEl, baseEl, ship.owner, { large: true });
        flashBase(enemyOwner);
        sfx.baseHit();

        state[enemyOwner].hp -= dmg / state[enemyOwner].armor;
        if (coords) showDamageNumber(coords.targetX, coords.targetY, dmg, ship.owner, { large: true, delay: 180 });
        updateHealthDisplay(null, true, enemyOwner);

        log(`#${ship.number} [${ship.owner.toUpperCase()}] strikes ${enemyOwner.toUpperCase()} base for ${dmg}.`, ship.owner);
        return { leftover: 0 };
    }

    if (!atkTarget || atkTarget.health <= 0 || atkTarget.dying) return { leftover: dmg };

    const targetEl = document.querySelector(`[data-ship-id="${atkTarget.id}"]`);
    const coords = shootLaser(attackerEl, targetEl, ship.owner);
    if (coords) showDamageNumber(coords.targetX, coords.targetY, dmg, ship.owner, { delay: 180 });

    atkTarget.health -= Math.max(dmg - (atkTarget.number % 19 === 0 ? atkTarget.number / 19 : 0), 0);
    sfx.attack();
    timeout(() => sfx.hit(), 90);

    let leftover = 0;
    if (atkTarget.health <= 0 && !atkTarget.dying) {
        leftover = Math.max(0, -atkTarget.health);
        atkTarget.dying = true;
        state.newlyKilled.push(atkTarget);
    }

    // Direct DOM update handles the damage flash and HP update immediately!
    updateHealthDisplay(atkTarget, false, enemyOwner);
    log(`#${ship.number} [${ship.owner.toUpperCase()}] hits #${atkTarget.number} for ${dmg}.`, ship.owner);

    return { leftover };
}

export function getRange(number) {
    if (number % 31 === 0) return 4;
    if (number % 11 === 0) return 3;
    return 2;
}

export async function runAttacks() {
    clearRectCache();
    state.newlyKilled = [];
    function findTarget(ship, enemyOwner) {
        const range = getRange(ship.template.number);
        const enemyShips = state[enemyOwner].ships.filter(s => s.health > 0 && !s.dying);
        const baseSec = ship.owner === 'blue' ? RED_BASE_IDX : BLUE_BASE_IDX;

        const targetCount = {};
        for (const s of enemyShips) targetCount[s.sector] = (targetCount[s.sector] || 0) + 1;
        targetCount[baseSec] = (targetCount[baseSec] || 0) + 1;

        const prioritized = enemyShips.slice().sort((a, b) => {
            const countDiff = (ship.number % 5 === 0) ? targetCount[b.sector] - targetCount[a.sector] : 0;
            if (countDiff !== 0) return countDiff;
            const secDiff = (enemyOwner === 'blue') ? b.sector - a.sector : a.sector - b.sector;
            if (secDiff !== 0) return secDiff;
            return a.row - b.row;
        });

        for (const e of prioritized) {
            if (Math.abs(e.sector - ship.sector) <= range) {
                return { target: e.sector === baseSec ? null : e, baseTarget: e.sector === baseSec };
            }
        }
        if (Math.abs(baseSec - ship.sector) <= range) {
            return { target: null, baseTarget: true };
        }
        return { target: null, baseTarget: false };
    }

    function buildAttacksForOwner(owner) {
        const attacks = [];
        for (const ship of priorityOrder(owner)) {
            const enemy = owner === 'blue' ? 'red' : 'blue';
            const strikes = ship.template.doubleStrike ? 2 : 1;
            for (let s = 0; s < strikes; s++) {
                const { target, baseTarget } = findTarget(ship, enemy);
                if (target || baseTarget) attacks.push({ ship, enemyOwner: enemy });
            }
        }
        return attacks;
    }

    async function processAttacks(attacks) {
        if (attacks.length === 0) return;

        for (const atk of attacks) {
            const { ship, enemyOwner } = atk;
            const { target, baseTarget } = findTarget(ship, enemyOwner);
            if (!target && !baseTarget) continue;

            ship.attackedThisTurn = true;
            let tsec = target?.sector ?? (ship.owner === 'blue' ? RED_BASE_IDX : BLUE_BASE_IDX);
            const result = await executeStrike(ship, enemyOwner, target, baseTarget, 0);

            if (ship.template.number % 5 === 0) fireMissile(ship, enemyOwner, tsec);
            if (ship.template.number % 25 === 0) fireMissile(ship, enemyOwner, tsec);

            if (ship.template.trample && result.leftover > 0) {
                let overflow = result.leftover;
                let trampleHits = 0;
                while (overflow > 0 && trampleHits <= 10) {
                    const { target: nextTarget, baseTarget: nextBase } = findTarget(ship, enemyOwner);
                    if (!nextTarget && !nextBase) break;
                    const res = await executeStrike(ship, enemyOwner, nextTarget, nextBase, overflow);
                    overflow = res.leftover;
                    trampleHits++;
                }
            }
            await sleep(120);
        }
    }

    state.newlyKilled = [];
    // both sides attack simultaneously
    await Promise.all([
        processAttacks(buildAttacksForOwner('blue')),
        processAttacks(buildAttacksForOwner('red'))
    ]);
    render();

    for (const s of state.newlyKilled) s.dying = false;
    for (const o of ['blue', 'red']) for (const s of state[o].ships) { s.exhausted = false; s.flashDamage = false; }
}

export async function finishCleanup() {
    for (const owner of ['blue', 'red']) {
        for (const s of state[owner].ships) if (s.health <= 0) s.dying = true;
    }
    render();
    await sleep(350);
    for (const owner of ['blue', 'red']) {
        state[owner].ships = state[owner].ships.filter(s => s.health > 0);
    }
    render();
    endGame();
}

/**
 * `side`'s pick by the AI behind DIFFICULTIES[key], for the AIs that can play either side
 * (Grandmaster, Alpha); undefined for any other. Blue's autoplay (js/commanders.js) uses it too.
 */
export function pickFor(side, key) {
    const D = DIFFICULTIES[key];
    if (D?.ai === 'grandmaster') {
        // The book holds lessons from standard games; with modifiers its moves would be misleading.
        let cfg = D.gmCfg;
        if (state.modded && cfg?.book) cfg = { ...cfg, book: false };
        return chooseGrandmaster(state, side, { cfg, memo: (state[side].gmMemo ??= {}) });
    }
    if (D?.ai === 'zero' && ZERO_WEIGHTS) {
        // It reads the board, not the other side's pick.
        // Near-best sampling: a replayed game can't map out one fixed line (see LIVE_VARIETY).
        return chooseZero(state, side, (zeroNet ??= loadNet(ZERO_WEIGHTS)), { variety: LIVE_VARIETY });
    }
}

export async function runTurn(playerPick = 0) {
    if (processing || gameOver) return;
    setProcessing(true);
    render();

    let aiPick = state.red.opening[state.turn - 1];
    if (state.red.ai === "pvp") {
        socket.send(playerPick);
        aiPick = parseInt(await getNextMessage(), 10);
    } else if (state.red.ai === "daily") {
        aiPick = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 37][state.turn - 1] ?? 0;
    } else if (state.red.ai === "grandmaster" || state.red.ai === "zero") {
        // Decided before blue's purchase below, so it never sees this turn's pick.
        aiPick = pickFor('red', difficulty);
    }
    for (const num of state.red.priority){
        if (aiPick === undefined && canAfford('red', num)) {aiPick = num;}
    }
    if (aiPick === undefined) aiPick = pickAIR();

    // Step 1: Deploy (Instant)
    if (playerPick) await buyShip('blue', playerPick);
    else { log('BLUE skips deploy.', 'blue'); sfx.skip(); state.blue.history.push(0); }

    if (aiPick) await buyShip('red', aiPick);
    else { log('RED skips deploy.', 'red'); state.red.history.push(0); }

    render();
    renderDeployBar();
    await sleep(0.01);

    if ((state.blue.hp <= 0 || state.red.hp <= 0) && state.red.hp !== state.blue.hp) {
        return finishCleanup();
    }

    // Step 2: Attacks fire immediately
    log('Attack phase.');
    await runAttacks();

    if ((state.blue.hp <= 0 || state.red.hp <= 0) && state.red.hp !== state.blue.hp) {
        return finishCleanup();
    }

    // Step 3: Cleanup dead & Advance in one smooth motion
    for (const owner of ['blue', 'red']) {
        state[owner].ships = state[owner].ships.filter(s => s.health > 0);
        state[owner].ships.sort((a, b) => a.row - b.row);

        for (const ship of state[owner].ships) {
            if (!ship.attackedThisTurn) {
                const dir = owner === 'blue' ? +1 : -1;
                const next = ship.sector + dir;
                if (next >= 1 && next <= 7) {
                    ship.sector = next;
                    ship.row = 999;
                }
            }
            delete ship.attackedThisTurn;
            ship.justDeployed = false;
        }
    }

    recomputeRows();
    render();

    // Tight 180ms slide: let CSS transition surviving ships to their new sector
    await sleep(180);

    // Step 4: Mining & Abilities
    for (const owner of ['blue', 'red']) {
        if (state[owner].regen !== undefined && state[owner].hp >= 100) state[owner].hp += state[owner].regen;
        const enemy = owner === 'red' ? 'blue' : 'red';
        const deployments = [];

        for (const s of state[owner].ships) {
            if (s.template.number % 43 === 0) s.attack *= 3;
            if (s.template.number % 23 === 0) {
                state[owner].hp -= 1;
                state[owner].income += s.template.number / 23;
            }
            if (s.template.number % 17 === 0) state[enemy].hp -= s.template.number / 17;
            if (s.template.number % 13 === 0) deployments.push([owner, 2 * s.template.number / 13, s.sector]);
            if (s.template.number % 47 === 0) {
                deployments.push([owner, s.attack, s.sector]);
                s.attack += 2;
            }
            if (s.template.number % 29 === 0) state[owner].armor += s.template.number / 29;
            if (s.template.number % 58 === 0) state[owner].armor *= 2;
        }

        const oreGained = calcOreIncome(owner, state);
        if (oreGained > 0) {
            state[owner].ore += oreGained;
            log(`${owner.toUpperCase()} mines +${oreGained.toFixed(2)} ore.`, owner);
        }
        if (state.turn >= 11) state[owner].armor += state[owner].armor_gain;
        for (const args of deployments) await deployShip(...args);
    }
    recomputeRows();

    if ((state.blue.hp <= 0 || state.red.hp <= 0) && state.red.hp !== state.blue.hp) {
        return finishCleanup();
    }

    // Step 5: Ready for next turn immediately
    startNewTurn();
    setProcessing(false);
    render();
    renderDeployBar();
    renderShortcutBar();
}

export async function load(moves) {
    for (const ship of moves) await runTurn(ship);
}

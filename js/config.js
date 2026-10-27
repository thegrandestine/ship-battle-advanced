export const SECTORS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
export const BLUE_BASE_IDX = 1;
export const RED_BASE_IDX = 7;
export const BLUE_DEPLOY_IDX = 1; // Sector B (index 1)
export const RED_DEPLOY_IDX = 7;  // Sector H (index 7)

export const BASE_START_HP = 200;
export const START_INCOME = 4;
export const START_ORE = 0;
export const ORE_POW = 0.8;
export const ORE_R = 40;
export const ORE_BASE = 40;
export const ATTACK_RANGE = 2;
export const MAX_LOAN = 4;

export const SECTOR_LABEL_H = 8;
export const BASE_H = 78;
export const SHIP_CARD_H = 30;
export const SHIP_CARD_H_COMPACT = 26;

export const SWORD_SVG = `<svg class="stat-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M10.4 1.1 L7 4.5 L8.2 5.7 L11.5 2.3 L11.5 0.5 Z M6.4 5.1 L1.4 10.1 L1.4 11.5 L2.8 11.5 L7.8 6.5 Z M5.5 7.2 L4.8 7.9 L4.1 7.2 L4.8 6.5 Z"/></svg>`;
export const BOW_SVG = '🏹';
export const ROCKET_SVG = '🚀';
export const HEART_SVG = `<svg class="stat-icon" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 11 C6 11 1 7.5 1 4.3 C1 2.7 2.2 1.5 3.7 1.5 C4.7 1.5 5.5 2 6 2.8 C6.5 2 7.3 1.5 8.3 1.5 C9.8 1.5 11 2.7 11 4.3 C11 7.5 6 11 6 11 Z"/></svg>`;
export const TARGET_MARK_SVG = `<svg class="target-mark" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="7" y1="0" x2="7" y2="2.8" stroke="currentColor" stroke-width="1.2"/><line x1="7" y1="11.2" x2="7" y2="14" stroke="currentColor" stroke-width="1.2"/><line x1="0" y1="7" x2="2.8" y2="7" stroke="currentColor" stroke-width="1.2"/><line x1="11.2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.2"/></svg>`;

const c1tutorial = {
    1: "Welcome to ship battle!\nYou can 'buy' a 'Skiff' (click the button)\nAlternatively, you can skip your turn and save your money for bigger ships. But saving money isn't useful in this mission because bigger ships haven't been unlocked yet.",
    2: "Ships advance one space every turn.",
    3: "Ships can fire at enemies within range 2.",
    4: "Ships that fire do not advance.",
    5: "Ships fire at the top ship in the enemy column.",
    6: "Reduce a ship to 0 hp to destroy it.",
    7: "After destroying an enemy ship, ships fire at the next enemy in line.",
    8: "For this mission, your objective is to destroy 10 enemy ships, then destroy the enemy base.",
    19: "Great job destroying the enemy fleet - time to move on their base.",
    20: "I heard the academy sends terminators to eliminate slow students, I wouldn't worry about that.",
    21: "Reduce the enemy base to 0hp to win!",
    26: "If you get terminated, you can press the button in the top left to try again.",
}

const c2tutorial = {
    1: "Good job cadet! I've unlocked the corvette for you. The corvette hits harder and is tougher than an ordinary skiff.",
    2: "Budget Master Ryan: On behalf of the federation, I've increased your budget to $2.",
    3: "You can take loans to buy a ship you cannot afford. Loans have a 25% interest, so don't rely on them too much.",
    4: "You might notice that ship 2 costs more than $2. Mysterious!",
    5: "Ship Masters is a deep turn based strategy game set in a sci-fi universe. Construct over 60 hand-balanced ships, discover the unique powers of the prime numbers, and master the mechanics that allow you to combine them.",
    6: "The power of the prime 2 is to hit harder. Hover over the 2 to find out more.",
    7: "I wonder what will happen if you combine 2 with itself.",
}

const c4tutorial = {
    1: "Each ship number is its ship's minimum cost. The power of the prime 3 is to mine ore, which brings the ship cost closer to the minimum.",
    2: "Budget Master Ryan: On behalf of the federation, I've increased your budget to $3.",
    3: "That said, we're under a frigate attack right now. Maybe now is not the best time to mine.",
}

const c6tutorial = {
    1: "Budget Master Ryan: On behalf of the federation, I've increased your budget to $4.",
    2: "The power of the prime 5 is to fire a missile that hits all enemies in the sector.",
    3: "Wow, that would have been useful when the enemy was actually deploying ships.",
}

const c10tutorial = {
    1: "Budget Master Ryan: I'm not increasing your budget anymore. It's perfect as is.",
    2: "Looks like we'll have to increase it ourselves.",
    3: "The power of the prime 7 is to increase your income.",
    4: "My sensors are picking up on a destroyer attack in the future. It will be hard to defeat it with only 4 income.",
    5: "Budget Master Ryan: What do you mean? 4 is a great number!",
    6: "Once we fend off these destroyers, we'll challenge the prime masters and steal their technology!",
}

export const GM_VERSION = '1.2';
export const GM_BETA_VERSION = '2.6β';
// v3: the β plus the time wizard's book (lessons from rewinding real games vs v1.2, js/book.js)
export const GM_V3_VERSION = '3.2';
// Zero (js/zero.js): bump with every net shipped to js/zero-weights.js.
export const ZERO_VERSION = '0.81';

export const DIFFICULTIES = {
    campaign1: { label: 'Campaign 1', maxShip: 1, playerIncome: 1, botHp: 62, botIncome: 33, botOre: 1000, priority: [89, 0], opening: [1,1,1,1,1,1,1,1,1,1], tutorial: c1tutorial},
    campaign2: { label: 'Campaign 2', maxShip: 2, playerIncome: 2, botHp: 63, botIncome: 66, botOre: 1000, priority: [89, 0], tutorial: c2tutorial},
    campaign4: { label: 'Campaign 4', maxShip: 4, playerIncome: 3, playerHp: 100, botHp: 160, botIncome: 7, priority: [4], tutorial: c4tutorial},
    campaign6: { label: 'Campaign 6', maxShip: 6, botHp: 160, botIncome: 52, botOre: 1000, priority: [89, 0], tutorial: c6tutorial},
    campaign10: { label: 'Campaign 10', maxShip: 10, botHp: 160, botIncome: 11, priority: [8, 4], opening: [0, 0, 0, 0, 0], tutorial: c10tutorial},
    campaign11: { label: 'Campaign 11', lockedFactor: 11, botHp: 640, botIncome: 5, priority: [11, 7, 0], oreIncome: 2},
    campaign13: { label: 'Campaign 13', lockedFactor: 13, botHp: 160, priority: [13, 0], botMoney: 96},
    campaign17: { label: 'Campaign 17', lockedFactor: 17, botHp: 1160, priority: [17, 7, 0], botIncome: 10, oreIncome: 2},
    // campaign19: { label: 'Campaign 19', lockedFactor: 19, botHp: 160, priority: [19, 14, 7, 0], botIncome: 15, oreIncome: 2},
    normal: { label: 'Normal', incomeMult: 4, oreMult: 1, hpMult: 1, aiNoise: 0.4, aiSkipChance: 0.08, ai: false },
    hard: { label: 'Hard', incomeMult: 4, oreMult: 1, oreDelay: 1 / 16, armorGain: 0.02, aiNoise: 0.2, aiSkipChance: 0.04, ai: false },
    challenging: { label: 'Challenging', incomeMult: 4, oreMult: 1, oreDelay: 2 / 16, armorGain: 0.03, aiNoise: 0.2, aiSkipChance: 0.04, ai: false },
    tricky: { label: 'Tricky', incomeMult: 4, oreMult: 1, oreDelay: 3 / 16, armorGain: 0.04, regen: 0, aiNoise: 0.1, aiSkipChance: 0.02, ai: false },
    visionary: { label: 'Visionary', incomeMult: 4, oreMult: 1, oreDelay: 4 / 16, armorGain: 0.05, regen: 0, aiNoise: 0.1, aiSkipChance: 0.02, ai: false },
    // No handicaps: same base, income and ore as Normal. The edge is all in js/grandmaster.js.
    // The version is in the label (and so on the red command card in screenshots); bump it
    // whenever default play changes, so a report can be matched to the AI that played it.
    // v1.0 first release · v1.1 winScore 3e4 · v1.2 turtle/value styles
    grandmaster: { label: `Grandmaster v${GM_VERSION}`, ai: 'grandmaster' },
    // Playtest variant: values income/ore further ahead while its base is safe (safeEcon), has no
    // "win fastest" tie-break (hurry 0), and knows the mining gridlock (the 'gridlock' style, for
    // itself and as a model of the player). β log: v1.2β distrusted far-off wins (weak to Frigate
    // counterwaves); v1.3β safeEcon 2; v1.4β + hurry 0; v1.5β + gridlock; v1.6β + investBias 3000
    // (a trader pays itself off within ~10 turns, so ties go to investing); v1.7β scales that by
    // base safety (no traders mid-defence) and adds ore credit 1500 while the board is open;
    // v1.8β respect 'push': while its push holds the enemy half, a pure-combat move must work
    // against every respected imagined opponent (worst case), so the window goes to miners;
    // v1.9β respect 'safe' (also in the opening / whenever its base is safe) and ore credit per
    // money (orePerCost: a cheap Driller over a pricey Reaver that feeds counterwaves);
    // v2.0β positions matter, not just imagined win counts: winScore 5000 (credits scaled to
    // match), ships near a defended enemy base count 0.3 (counterwave fuel), and ore that
    // centre miners will mine over 6 turns counts; v2.1β positional lookahead: 16 turns instead
    // of 30, so the middle game (centre control, pinning, fuel, mining) decides rather than who
    // wins in 30 turns; centre/pin terms; dead-zone miner penalty; real opening variety;
    // v2.2β close-out: when a whole plan (a style played from now on) wins most imagined games it
    // plays that plan instead of re-planning into one-off traders/skips until the win is gone;
    // no banking past the priciest visible ship (idleCash); variety only among its top 3 moves;
    // v2.3β miner fate: a fragile miner costs a share of an imagined flip for every imagined future
    // where it dies before ever mining (the column-1 critical fail; was 7% of its miners, now 0%);
    // v2.4β loses gracefully: a decided imagined game counts base hp and ships only (bank and
    // income are worthless once it's over), investment credit only for games not already lost,
    // and a loss further off scores better (lossDelay) - it fights to the last turn instead of
    // buying Caravans, which also makes all-in attacks against it a real risk;
    // v2.5β ore as indirect income: prices are n^(1 + e²/(e + d(ore))), so ore discounts big
    // ships far more than small ones; the economy is valued over a few spending rhythms
    // (oreTiers) and a miner is credited like a trader by the income-equivalent of its next 10
    // turns of ore at the tiers its income reaches (a Quarry ~1.8 traders early, a Driller ~0.4),
    // only while the board is open and its base safe; v2.6β that miner credit also scales by ore
    // per money vs a Driller (no trailing Reaver tanks where two Drillers mine the same for less).
    grandmasterBeta: {
        label: `Grandmaster β v${GM_BETA_VERSION}`, ai: 'grandmaster',
        gmCfg: {
            safeEcon: 2, hurry: 0, investBias: 500, investSafe: true, oreBias: 250, respect: 'safe', orePerCost: true,
            winScore: 5000, fwdMult: 0.3, mineTurns: 6,
            depth: 16, centerW: 100, pinW: 100, deadMiner: 0.5, openTol: 0.3, driftTol: 0.1,
            closeOut: 0.6, idleCash: true, varietyTop: 3, minerFate: 1,
            decidedCombat: true, lossDelay: 150, oreIncomeTurns: 10, oreTiers: [1, 2, 4], oreIncomePerMoney: true,
            mine: ['spend', 'smart', 'econ', 'mine', 'turtle', 'value', 'gridlock'],
            theirs: ['spend', 'smart', 'econ', 'mine', 'wild', 'wild', 'wild', 'turtle', 'value', 'gridlock'],
        },
    },
    grandmasterV3: { label: `Grandmaster v${GM_V3_VERSION} (wizard)`, ai: 'grandmaster', gmCfg: null },
    grandmasterV3e: { label: `Grandmaster v${GM_V3_VERSION} (learned eval)`, ai: 'grandmaster', gmCfg: null },
    // Taught itself by self-play (tools/zero/): a learned policy, no search, no book, no handicaps.
    // Shown as "Alpha 0.81" (spoken: alpha zero point eight one); the version keeps its leading
    // zero and creeps toward 0.99 rather than ever reaching 1.0, in shrinking steps since 0.7 (0.8, then +0.01 per release).
    zero: { label: `Alpha ${ZERO_VERSION}`, ai: 'zero' },
    pvp: { label: 'PVP', incomeMult: 4, oreMult: 1, hpMult: 0, aiNoise: 1.6, aiSkipChance: 0.32, ai: 'pvp' },
    custom: { label: 'Custom', incomeMult: 4, oreMult: 1, hpMult: 0, aiNoise: 1.6, aiSkipChance: 0.32, ai: 'custom' },
};

// v3 = the β's settings plus the book
// (bookW 10000: the book's verified lessons outweigh imagined-game flips; bookTol 0.1: any move
// the book rates within 10% win probability of the best is fair game, so it varies its play
// instead of replaying one memorised win)
// v3.2: it imagines only opponents (and plans of its own) that can actually play. A round-robin
// of the imagined styles (tools/styles.js) showed 6 of its 10 imagined opponents were pushovers
// (spend, mine, econ weaker than the Normal AI; three random 'wild'), so it kept going for kills
// that only a player throwing the game would allow.
const STRONG_STYLES = ['snowsmart', 'snowball', 'gridlock', 'turtle', 'smart', 'value'];
DIFFICULTIES.grandmasterV3.gmCfg = { ...DIFFICULTIES.grandmasterBeta.gmCfg, book: true, bookW: 10000, bookTol: 0.1,
    mine: STRONG_STYLES, theirs: STRONG_STYLES };
// Experimental playtest entry: v3.1 with its imagined futures scored by the learned evaluator
// (js/value-weights.js: fitted on 29k positions from 454 games, base hp left out) instead of the
// hand-written score, which favoured the eventual loser 68% of the time in turns 1-8. It contests
// a mining push from the start; vs v1.2 it is weaker (-32.5 vs -10), so playtests decide.
DIFFICULTIES.grandmasterV3e.gmCfg = { ...DIFFICULTIES.grandmasterV3.gmCfg, leaf: 'net' };

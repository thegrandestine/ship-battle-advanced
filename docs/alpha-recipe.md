# The Alpha recipe: a strong game AI from self-play

A blueprint for building a genuinely strong AI opponent for a turn-based game, distilled from
building **Alpha** for Ship Battle (this repo). Ship Battle is used here only as a running
example; the point is the pattern, which should carry over to other turn-based tactics or
strategy games once it is reshaped to fit their mechanics.

The short version: **stop writing the AI's opinions about the game. Give a small network the
same numbers a player reads, let it play itself millions of times under constantly shifting
rules and starting positions, and judge it only by whether it beats the previous version.**

---

## 1. Why the hand-built AIs hit a ceiling

Before Alpha, this project went through about twenty versions of a "Grandmaster" AI:
hand-written evaluation functions, rollout lookahead with scripted play styles, an opening
book, learned bias terms on top of the search, imagined opponents, and so on. Each version
fixed the last loss and created a new blind spot. The failure was structural, not a lack of
effort:

- **The evaluation function is the designer's opinion.** Every rollout ends in a hand-written
  score ("income is worth X, ore is worth Y, a ship near their base is worth Z"). The search
  can only be as right as that score, and nobody actually knows those exchange rates.
- **Lookahead with weak rollout policies misleads.** Searching 16-30 turns ahead means playing
  those turns with scripted stand-in policies for both sides. The search then optimises against
  imagined opponents who play badly, and finds "wins" a real player never allows.
- **The important consequences land beyond the horizon.** In Ship Battle an investment pays off
  20-40 turns later, and a push that looks winning on turn 15 collapses on turn 35. A search
  horizon short enough to be affordable is too short to see that; one long enough is too slow
  and too noisy.
- **Rules as if/else become a state machine.** "If the enemy has a ship in sector 5, don't buy
  miners" is right until it isn't. Each patch adds a special case; the cases interact; the AI
  becomes rigid and exploitable by anything outside the cases it was written for.
- **Every balance patch invalidates the tuning.** Hand-tuned weights and opening books encode a
  specific balance. Change a price and they are silently wrong.

The usual escape hatch, giving the AI cheats (extra income, ore, armour: the original game's
"Hard" to "Visionary" levels), makes it harder but not smarter, and players feel it.

## 2. What replaced it

Alpha has **no lookahead, no opening book, and no hand-written tactics.** At each decision it
glances at the position once (about a millisecond) and outputs a probability for every legal
move, plus an estimate of its own chance of winning. It learned everything from self-play.

Results in this project, as a calibration of what to expect:

- From random play, it beat the best hand-built AI about 85% of the time after **5 minutes**
  of training (about 80,000 games). It is not a slow, marginal method.
- After about 2 million self-play games (roughly 9 hours on one desktop: a 32-thread CPU for
  the games, one GPU for training), it beats every hand-built version 98-100% of the time in
  the standard game, and each new release beats the previous release about 80-90% of the time.
  The ceiling has not been reached.
- When the game's author shipped a real balance patch (base HP, prices, several abilities
  reworked), the existing network, **without retraining**, got slightly *stronger* against the
  old AIs. That robustness is not normal for self-play systems; section 5 explains where it
  came from.

## 3. Why it can learn strategy without searching ahead

The core idea, borrowed from AlphaZero minus the tree search:

- **A value estimate replaces the hand-written evaluation.** The network learns "how likely am
  I to win from here" from the outcomes of millions of real games. Nobody tells it what income
  is worth; it finds out, because positions with more income go on to win more often, and by
  exactly how much it depends on everything else on the board.
- **The policy is the search, compressed.** Each training update nudges the probability of the
  moves that led to better-than-expected outcomes. Over millions of games, "what happens 30
  turns after I do this" is pulled back into a single glance. The long horizon is handled by
  the learning signal (outcome-based value targets with discounting), not at decision time.
- **Self-play supplies an opponent that is always exactly as good as you.** Every weakness the
  network has is exactly what its twin learns to exploit, so weaknesses get found and closed
  without anyone having to notice them.
- **It plays like a classifier, not a planner.** "This position is a 'buy Frigate'", the same
  way an image classifier says "this is a flower". Fast, consistent, and with no exploitable
  script, because there is no script.

The algorithm used is ordinary PPO (policy gradient with a learned value baseline and GAE). It
handles simultaneous moves (both sides choose before seeing the other's pick) naturally, and
it does not need anything exotic.

## 4. The design decisions that matter most

### 4.1 Feed it raw values a player reads, never move sequences or ids

The single most important choice. The network never sees "ship #8" or "the last three moves
were X, Y, Z". It sees what a player sees on the screen and on the cards:

- **Each side's economy:** base HP, money, income, stockpiles (ore here), armour, what one
  turn's income can buy.
- **Every unit on the board, as numbers:** its current attack and HP, where it is, and what
  its abilities do, expressed as magnitudes ("mines 3 ore/turn", "+2 income on deploy",
  "missile hits the whole sector for 4", "range 3"), not as names or ids.
- **Every legal move, also as numbers:** its price right now, that price against money and
  income, whether it needs a loan, plus the same ability magnitudes.

Because a move is described by its properties, "buy the Destroyer" becomes "buy the thing that
costs 2.3 turns of income and brings 8 attack and 22 HP". When a patch changes the Destroyer,
the description changes and the network reads it, like a player reading the new tooltip.
Sequences ("3,3,3 is answered by 4,4,8") are memorisation and shatter under any change.

Architecture that makes this work (small: about 170k parameters, around 1 ms per decision on
a CPU in the browser):

- A small shared **per-unit encoder**, summed per board region and owner. Any number of units
  fits, order inside a region shows up as unit features, and the network sees "how much
  firepower of mine is in the centre" rather than a fixed-size list.
- A **trunk** that mixes the pooled board with the global economy numbers.
- A **value head** (chance to win) and a **policy head that scores each legal move from the
  move's own features plus the trunk**. Scoring moves as objects, rather than having one output
  slot per move id, is what lets it handle moves whose stats changed, or moves it has rarely
  seen.

### 4.2 The chaos portal: never let two games start alike

Self-play left alone converges on one opening line and over-fits to it. Our first strong
version won 97% of standard games against the old AI and **36% once the starting conditions
moved**: it had learned "always rush", never bought a single economy unit, and folded in any
game that went long. The fix is to make every game a slightly different game:

- **Rule noise near the real game.** Each game nudges every unit's attack and HP by a few to
  tens of percent, shifts prices per ability type, and varies base HP, starting money, income
  and stockpiles within a band of the real values. The network cannot memorise "unit X is
  good"; it has to learn why things are good, from the numbers.
- **Mirrored random starting positions: the strongest tool.** Both sides start with the same
  random army already on the field, sometimes mid-clash with low bases, sometimes a rich mirror
  of higher-tier units with lots of money and a full menu of options. There is no opening book
  for a position you have never seen; the side with the better *plan* breaks the mirror. This
  is where strategic, rather than tactical, understanding comes from.
- **Mostly the real game.** About a quarter of games are the plain game: three in four the
  Standard board (a small random mirrored fleet and some money, so no two games open alike),
  one in four the Classic empty board. Standard decides which version is stronger. Noise is a
  teacher, not the target.
- **Small doses of genuinely different variants.** Extreme modes (5x unit HP, quarter HP)
  play differently enough that a large share teaches habits the real game punishes. A few
  percent of them does teach transferable lessons: a dose of very long games is what finally
  taught it to win long games instead of stalling them.
- **Hold some rule changes out entirely** and use them only as an exam (section 6). If it
  handles rules it never trained on, it has learned something general.

This is why a real balance patch barely registered: to this network, a patch is just another
game with different numbers.

### 4.3 Guardrails we learned the hard way

- **Fairness by construction.** It only chooses among moves a human could choose (the visible,
  affordable deploy bar), decides before seeing the opponent's simultaneous pick, and gets no
  resource bonuses. It wins on play.
- **Self-play cycles.** A later version can beat its recent selves while forgetting how to beat
  older ones (100 iterations after a snapshot that beat an older release 91%, the run's newest
  net beat that same release only 48%). Keep a pool of
  past snapshots and spend a large share of games against them (40% here), use a modest
  learning rate, and pick releases by head-to-head ranking, never by "latest iteration".
  The cycles are rock-paper-scissors between styles: one net drifted from "invest mid-game"
  back toward "fight mid-game, bank late", beat its recent predecessors 60-70%, and lost 60/40
  to a release two versions older whose cheap-swarm style it no longer remembered. A recent-only
  pool forgets old styles, so keep a **hall of fame**: every shipped release stays in the
  opponent pool permanently.
- **A little outside sparring.** A few percent of training games against the best previous
  non-learned AI (with its thinking time capped so it doesn't stall training) keeps an outside
  style in the mix.
- **Games that don't finish still teach.** A game that hits the turn cap scores as a partial
  win (up to half a win) for whoever is ahead on base HP, economy and board strength, instead
  of a meaningless 0. Leads can turn around, so it is deliberately weaker than a real win.
- **Safety valves.** Cap the turn count and the unit count (mirrored spawner units can
  otherwise multiply into the hundreds), and treat a sim error as a draw, not a crash.

## 5. Infrastructure: what has to exist first

This approach lives or dies on the simulator. Before any learning:

1. **A fast headless copy of the rules**: no rendering, no animation delays, synchronous,
   thousands of games per second across threads. Here: 2,000 games in about 5-20 seconds.
2. **A parity test** that plays random games through both the real game code and the headless
   copy and checks the states are identical after every turn. Every rules change, every patch,
   re-run it. A silently different simulator trains an AI for a different game.
3. **One feature encoder and one forward pass, implemented identically** where the games are
   generated and where training happens (here: JavaScript for play, PyTorch for training), with
   a test that recomputes recorded move probabilities on the training side and checks they
   match to rounding error.
4. **A legal-move function** that is exactly what a player could do at that moment.

Then the loop: generate a batch of self-play games with the current network (in parallel),
fit the network to them for a few epochs on the GPU, save a snapshot every so often, repeat.
Training here was under a second per iteration; game generation was the cost.

## 6. Measuring progress honestly

Most of our wrong turns were measurement errors, not learning errors:

- **The ladder: beat the previous release.** Once the new AI is far ahead of the old ones,
  "100% vs the old AI" stops being informative. The question is always "does it beat the
  version players have now, in the real game?"
- **Big samples for the deciding number.** 30 games swing about ±9 points; that once made a
  steady net look like it had regressed from 80% to 63%. Use 200-400 games for the standard-game
  verdict (about ±2-3).
- **Deterministic players replay one game.** Two deterministic AIs from the same start play
  the same game every time: we once "won 16 of 16" that were really 3 distinct games. Randomise
  the first few turns of every benchmark game.
- **Two groups of scenario tests.** "Near": fresh draws from the kinds of noise it trains on.
  "Far": rule changes it never trains on. A net that aces standard but collapses on "far" has
  memorised; one that holds up has understood.
- **Probe the slow references lightly.** Search-based AIs are expensive to play against. Use
  them as an occasional small probe and a "still crushing it?" flag, not as the main benchmark.
- **Release checklist:** a large standard-game head-to-head against the current release, a
  scan of every scenario for a collapse, and a quick confirmation against the old AIs.

## 7. Adapting it to another game

What carries over unchanged: the self-play loop, raw-value inputs, moves scored as objects,
the chaos portal, the snapshot pool, the measurement discipline.

What has to be reshaped to the new game:

- **The state encoding.** Keep "what a player reads": units as sets of numbers pooled by
  position. A grid game might use a small grid (convolutional) encoding instead of regions; the
  principle is the same.
- **The action encoding.** Ship Battle has one kind of move (buy one of N units or skip). A
  tactics game with "unit U moves to tile T and attacks V" should still score each legal action
  from its features: the acting unit's numbers, the target's numbers, distance, terrain. If a
  turn has many sub-actions, decide them one at a time with the board updated in between.
- **Alternating vs simultaneous turns, and hidden information.** Feed only what that player
  can see. Simultaneous play works with PPO as is.
- **The chaos portal.** Find that game's equivalent knobs: unit stats, costs, map, starting
  armies, resources. Mirror the starting positions so neither side is favoured, and keep the
  real game as the anchor.
- **The benchmark.** Use whatever AI the project already has as the first thing to topple,
  then switch to the self-ladder.

Where it fits less well: games without a fast simulator, real-time games, or games where a
single decision is huge and combinatorial and can't be split into steps. For turn-based
tactics and strategy games it may be close to a universal recipe.

## 8. In this repo

For an agent that wants to see the working version:

- `js/zero.js`: feature encoder and in-browser play (player-facing name "Alpha").
- `tools/zero/selfplay.js`: parallel self-play game generation.
- `tools/zero/scenarios.js`: the chaos portal (training families and held-out exams).
- `tools/zero/train.py`: PPO training, snapshot pool, probes.
- `tools/zero/robust.js`: any two AIs across every scenario.
- `tools/zero/parity.py` and `tools/verify.js`: the two parity tests.
- `js/sim.js`: the headless rules.

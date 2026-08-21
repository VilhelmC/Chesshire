# Chesshire — Project Specification

**Name:** Chesshire (was Schackal, then Offbook)
**Owner:** Will ([@VilhelmC](https://github.com/VilhelmC))
**Target user:** one — the author. Rating band <1400.
**Doc path:** `offbook/SPEC.md`
**Status:** v0.1, pre-implementation
**Licence:** GPL-3.0-or-later (see `LICENSE`, and §12 for why it is not a free choice)
**Date:** 2026-08-18

---

## 1. Thesis

> Existing trainers teach you the book. Real games leave the book on move 4.
> Offbook trains the *seam*: the move your opponent actually plays instead of the book move, and what you do about it.

Memorization alone is inert — you memorize 12 moves deep and your opponent leaves theory on move 3, at which point your preparation has taught you nothing about the position you are now in. Punishment training alone is rootless — you can't recognise a deviation if you never knew the book move.

The product is the **join**: a repertoire tree where every node knows (a) the book continuation, (b) the full distribution of what humans in your rating band actually play instead, and (c) a concrete, drillable refutation for each of those deviations. Memorization and punishment are two views of one data structure, scheduled by one scheduler, measured by one metric.

### Why this is especially right at <1400

The <1400 band makes the thesis *easier*, not harder:

- Opponents leave book almost immediately — typically move 3–6. The trained material is therefore shallow and high-frequency, so a small repertoire covers a large share of real games.
- Deviations at this level are usually genuine errors (Δ ≥ 100cp), not subtle inaccuracies. The centipawn-noise problem that would sink an eval-ranking trainer does not apply — the signal is loud.
- Refutations are concrete and tactical (hanging pieces, forks, early-queen-sortie punishment), which makes them *teachable as patterns* rather than as vague plans.

**Corollary — explicit non-goal for v1:** the eval-ranking / Stockfish-approximation drill discussed earlier is **out of scope**. At <1400 it trains the wrong skill. Revisit at 1800+.

---


## 1.1 Learning principles

These govern every interface decision in this app. They are written down because the default instincts of a good engineer — compress, deduplicate, infer — are frequently the *opposite* of what helps someone learn, and the pull towards them is strong enough that it has to be argued against explicitly rather than resisted case by case.

**Redundancy is a feature.** Information theory says a channel is better when it carries less. Learning is not a channel problem. The same fact arriving through two routes at once — a symbol *and* a letter, a colour *and* a width, an arrow *and* a number — is what makes it stick, and what makes it survive one route being momentarily unavailable (a colour-vision difference, a glance too quick to read text, a piece the eye has not yet learned to name). Two encodings of the same thing is not waste to be refactored away.

**Never make the learner derive what can be shown.** Any step of the form *"you can work out X from Y"* is attention spent on bookkeeping rather than on chess. Whose move it was, what a move cost, which piece the letter denotes, how much material is off the board — if the app knows it, the app shows it. "The move number tells you whose turn it is" is the shape of reasoning to be suspicious of.

**A convention is not a justification.** Printed chess books omit the pawn symbol and use outline pieces for both sides. Those conventions were shaped by typesetting cost and by readers who were already fluent. Neither constraint applies here, and this app's reader is by definition not yet fluent. Match a convention when it genuinely serves the learner, and depart from it deliberately and in writing when it does not.

**One interface, learned once.** A control that means one thing in the trainer must mean the same thing, look the same and sit in the same place everywhere else. Every gratuitous variation between screens is a second thing to learn that teaches nothing about chess. This is why the board, the evaluation bar, the material readout and the control strip are shared components rather than per-view layouts.

**Honest numbers or no numbers.** A metric derived from incomplete or unmeasurable data is worse than a blank, because it is believed. This rule already runs through the coverage audit, the rating estimate and the mistake deck; it is a learning principle too, since a learner cannot tell a flattering number from a true one. **A truncated list is a number as well**: a search that shows eight of thirty-seven matches without saying so is claiming the other twenty-nine do not exist.

**Show the consequence, not just the correction.** Being told the right move teaches the move. Being shown what the wrong move loses teaches the pattern. Where the app can play out or annotate a consequence, it should, in preference to naming an answer.

### A metric must tell you what to do next

Transfer is the question the app exists to answer, and it is slow: four games either side of a drilled position, so weeks before it says anything about any one of them. **That slowness is a reason to have faster numbers, not a reason to trust them more.**

The faster numbers earn their place by being *diagnostic*. "78% accuracy" is a scoreboard. "94% to move 10 and 61% after move 20" is an instruction. Anything that only reports how well it is going is gamification wearing the costume of feedback — the test to apply to a proposed metric is whether a reader could act differently tomorrow because of it.

This also sets what NOT to build. A per-game strength estimate points nowhere, is expensive to calibrate, and is the single most distrusted number on the platform that ships it.

### The repertoire should not have to be declared first

Observed by using the competition: the trainers that quiz you on an opening require you to define your repertoire before they can ask you anything. That is a wall in front of the first useful minute, and it asks for the thing a weaker player is least equipped to supply — they are training openings *because* they do not yet have a settled repertoire.

Chesshire takes the opposite position, and it is a load-bearing one rather than a convenience:

- **Every opponent reply is in scope**, weighted by how often players at your band actually play it. Nothing has to be declared for the app to know what you will meet.
- **Moves you answer correctly are suppressed**, so the repertoire emerges from what you keep getting wrong rather than from a form you filled in.

The related failure mode, also observed: a course that *explains* a principle everyone already knows, with an anecdotal example, and never has you play it. Explanation is cheap and does not transfer. **If a principle cannot be turned into a position you have to answer, it does not belong in this app.**

## 2. Scope

### v1 — vertical slice (one opening, complete loop)

One repertoire, one colour, full cycle: import → coverage audit → memorize → deviation drill → sparring → progress tracked → real-game transfer measured.

Slice: **White, 1.e4 e5 2.Nf3 Nc6 3.Bc4 (Italian)**, depth 8 plies of book. Chosen because at <1400 it is the highest-frequency e4 e5 structure and it is rich in early deviations with clean refutations (3...Nd4, 3...Nf6 4.Ng5, 3...Bc5 4.b4, 3...d6, 3...Qf6/3...Qe7 queen sorties). Configurable — the pipeline is opening-agnostic.

### Repertoire plan (resolved 2026-08-18)

Will plays no repertoire yet; the app is how he acquires one. That changes the ordering — the app must not require prior knowledge as input.

**Decision: commit to 1.e4 as White for v1. Italian first, Scotch second, Queen's Gambit deferred.**

Reasoning:

- **Italian and Scotch share a trunk.** Both are 1.e4 e5 2.Nf3 Nc6; they diverge only at White's 3rd move (3.Bc4 vs 3.d4). Every deviation drill for plies 1–5 — which is where most <1400 opponents actually leave book — is *shared between them*. Adding the Scotch after the Italian is therefore cheap: same trunk, one new branch. It also gives a genuine pedagogical contrast (slow piece play vs immediate central break) over identical early material.
- **Queen's Gambit is a different first move.** 1.d4 means a whole separate opponent-move universe with zero shared nodes. Building it in v1 doubles the pipeline work for no additional coverage of the games you're already playing, and learning two unrelated first moves simultaneously is how beginners end up knowing neither. Defer to Phase 2, or treat it as the *replacement* for 1.e4 later if you decide you prefer the structures.
- **The Black repertoire is the bigger real gap** — you're on move as Black in half your games and have nothing there. It is deliberately Phase 2 anyway, because the pipeline must be proven once before it is run three times.

Build order: `Italian (v1) → Scotch (Phase 2a, cheap) → Black vs 1.e4 (Phase 2b) → Black vs 1.d4 (Phase 2c) → QG only if switching first move (Phase 3)`.

### Time controls (resolved 2026-08-18)

Two separate decisions that are easy to conflate:

**1. Explorer filter — `speeds=blitz,rapid`, `ratings=1000,1200,1400`.** Bullet is excluded deliberately: at <1400 bullet move distributions are distorted by premoves and panic, so training against them teaches you to punish moves your rapid opponents won't play. Blitz and rapid at this band produce near-identical deviation distributions, and including both roughly triples sample size at depth, which is what keeps the tree usable past ply 6.

**2. What you should actually play — rapid, 10+0 and 15+10.** This is the one that matters more than it sounds. Preparation you can't recall under time pressure is not preparation, and a punishment line that needs 30 seconds of calculation is unplayable in blitz. More importantly, **transfer rate (§7) measured on blitz games is noise** — you'll fail drilled positions for time-management reasons and the app's core metric will lie to you. If you want the progress tracking to mean anything, play rapid. Blitz games are still imported, but transfer rate is computed on rapid only by default.

### Explicitly out of v1

Endgame training; tactics puzzles unconnected to the repertoire; eval-ranking drills; multi-user; mobile app; cloud sync; Maia integration (Phase 3); LLM-generated prose annotations (Phase 3); Queen's Gambit / any 1.d4 repertoire.

### First real data — 2026-08-18 (Italian, 1000–1400, blitz+rapid)

Coverage audit run against live explorer data, ~1.36bn games at the root. Verified by hand: every trunk mass reproduces from the move frequencies, and every average rating falls in 1186–1419 against 1519 unfiltered, confirming the band filter works.

| | Share of White games | Nature of the problem |
|---|---|---|
| Black doesn't play 1...e5 | **45.5%** | Different opening (c5 12.1%, d5 9.6%, e6 7.8%, c6 5.4%, d6 2.8%, g6 2.3%). **Missing repertoire — not drillable.** |
| 1...e5, then off book by move 3 | **20.5%** | d6 8.1%, Nf6 6.2%, Bc5 1.7%, Qf6 1.5%, d5 0.9%. The app's actual territory. |
| Reaches 3.Bc4 | **34.0%** | Book ends immediately; top 3 replies (Nf6, Bc5, h6) are 78% of continuations. |

Three consequences for the design:

1. **The original "they leave your line early: 66%" headline was a category error** and has been replaced by the three-way split above. Adding "opponent played the Sicilian" to "opponent hung a piece" produces a number that sounds like the thesis and means nothing. You cannot punish 1...c5.
2. **The largest single hole is scope, not depth.** Nearly half of these games never reach the Italian. No amount of punishment drilling touches them. This has to be a conscious decision — build anti-Sicilian/anti-French/anti-Caro coverage, or knowingly accept that the trainer addresses ~55% of White games.
3. **Frequency is the wrong drill priority.** See below.

### The punishment gap — a better drill priority

Two data points from the ply-5 distribution:

| Move | Frequency | Black's score | Objective assessment |
|---|---|---|---|
| 3...Bc5 | 27.9% | 48.9% | Completely sound (Giuoco Piano) |
| 3...Nd4 | 5.2% | **52.6%** | Dubious — and Black's best-scoring reply |
| 3...f5 | 1.6% | **52.6%** | Close to losing a pawn outright |
| 3...f6 | 1.7% | 39.5% | Comparably bad, and duly punished |

3...f5 and 3...f6 are similarly bad and similarly rare, yet differ by 13 points of score. The difference is entirely whether opponents at this level know the refutation.

That gap — **objectively bad, empirically unpunished** — is what this app exists to close, and it is directly measurable once the engine is wired in:

```
punishmentGap = expectedScoreIfCorrectlyPunished − observedOpponentScore
```

Drills should be ranked by `mass × punishmentGap`, not by `mass` alone. Drilling 3...Bc5 at 27.9% teaches nothing — it is a good move and you will reach a normal position either way. Drilling 3...f5 at 1.6% converts a near-loss into a near-win every time it appears. Frequency-only ranking would have put Bc5 first and f5 fifteenth.

This is implemented in M2, and it is the sharpest form of the project's differentiator: not "here is what your opponent plays" (any explorer shows that), but "here is where your opponent is getting away with it".

---

## 3. Core data model

All types in `src/domain/types.ts`.

```ts
// A position in the repertoire tree, keyed by normalised FEN (no halfmove/fullmove counters)
type PositionKey = string;

type RepertoireNode = {
	id: PositionKey;
	fen: string;
	sideToMove: 'w' | 'b';
	isOurTurn: boolean;
	// Set when isOurTurn: the move we intend to play
	bookMove?: { uci: string; san: string; comment?: string };
	// Set when !isOurTurn: everything the opponent might do
	opponentMoves: OpponentMove[];
	// Probability of ever reaching this node in a real game, given our repertoire
	reachProbability: number;
	depth: number;
	parentId: PositionKey | null;
};

type OpponentMove = {
	uci: string;
	san: string;
	// From Lichess explorer, filtered to our rating band + time controls
	frequency: number;        // share of games at this node, 0..1
	gameCount: number;
	scoreForOpponent: number; // empirical win+draw/2 rate — the practical signal
	// From engine analysis
	evalBefore: number;       // cp, from our POV
	evalAfter: number;        // cp, from our POV
	delta: number;            // evalAfter - evalBefore
	classification: MoveClass;
	childId: PositionKey;
};

type MoveClass =
	| 'book'        // it's in our repertoire; we have a prepared answer
	| 'blunder'     // delta >= +150cp for us -> Punishment Drill
	| 'inaccuracy'  // +50..+150cp        -> Pressure Drill
	| 'playable'    // < +50cp            -> Coverage Card
	| 'refutes_us'; // delta <= -50cp     -> our repertoire has a hole; flag for repair
```

### The drill

```ts
type Drill = {
	id: string;
	kind: 'memorize' | 'punish' | 'pressure' | 'coverage';
	rootFen: string;
	// The move that got us here — shown as the prompt ("opponent just played 3...Nd4")
	triggerMove?: { uci: string; san: string };
	// Ordered solution. For 'punish' this may branch.
	solution: SolutionTree;
	// Success condition
	target: { type: 'reach_eval'; cp: number } | { type: 'play_line'; plies: number };
	motifs: Motif[];          // detected tactical themes, used for grouping progress
	frequencyWeight: number;  // reachProbability * frequency — drives scheduling priority
	sourceNodeId: PositionKey;
};

type SolutionTree = {
	// our move(s) — usually one, occasionally two acceptable
	ourMoves: { uci: string; san: string; cpLoss: number }[];
	// each viable opponent reply leads to a subtree
	replies: Record<string /* uci */, SolutionTree | null>;
};

type Motif =
	| 'fork' | 'pin' | 'skewer' | 'discovered_attack' | 'double_attack'
	| 'hanging_piece' | 'back_rank' | 'trapped_piece' | 'overloaded_defender'
	| 'development_lead' | 'king_exposure' | 'space_grab' | 'pawn_win';
```

---

## 4. Drill generation pipeline

This is the heart of the product. It runs as an explicit **build step** (`Build repertoire` button), not lazily at drill time, so drills are pre-validated and the trainer works offline.

```
repertoire PGN/study
	└─> 1. parse into tree of RepertoireNodes
			└─> 2. for each opponent-to-move node: query Lichess Explorer
					 (rating band + speeds filter) -> OpponentMove[] with frequencies
					└─> 3. truncate: keep moves until cumulative frequency >= COVERAGE_TARGET (0.95)
							 or frequency < MIN_FREQ (0.005), whichever first
							└─> 4. engine-evaluate each kept move (cloud-eval, else local WASM)
									 -> delta, classification
									└─> 5. for 'blunder' moves: extract + VALIDATE punishment line
											└─> 6. detect motifs, compute weights, emit Drill[]
```

### Step 3 — truncation policy

Never generate drills for the long tail. The rule: sort opponent moves by frequency descending, accumulate until 95% of the probability mass is covered, drop anything below 0.5%. Everything dropped is reported in the coverage audit as *known uncovered* — silent truncation is the failure mode that makes a trainer feel complete while leaving you unprepared.

### Step 5 — punishment line validation (critical quality gate)

A naive implementation takes Stockfish's PV and calls it the refutation. That produces drills that are wrong the moment the opponent deviates *again* — which, at 1200, they will. The validation:

1. From the deviation position, get MultiPV=3 to depth `D_DEEP` (22).
2. Our move qualifies as the solution if `best - second_best >= UNIQUE_MARGIN` (80cp). If two moves are within the margin, both are accepted answers.
3. Descend the PV. At each **opponent** node, run MultiPV=4. Collect every reply within `RESIST_MARGIN` (100cp) of the best — these are the replies a human might plausibly find.
4. Recurse into each such reply, up to `MAX_PLIES` (8) or until `|eval| >= WIN_THRESHOLD` (300cp), whichever first.
5. If the resulting tree exceeds `MAX_NODES` (40), the position is not drillable as a fixed line — downgrade it from `punish` to `pressure` (play it out against the engine instead of memorizing a refutation).

This branching tree is what makes the drill honest: **you must punish the deviation and keep punishing it while the opponent squirms.** That's the feature the market doesn't have.

### Step 6 — motif detection

Heuristic, board-diff based, no ML. Implemented in `src/engine/motifs.ts`. For the solution move, compare attack maps before/after:

- **fork / double_attack**: moved piece attacks ≥2 enemy pieces of higher value or undefended
- **hanging_piece**: a piece is attacked and not defended, and SEE > 0
- **pin / skewer**: ray from our slider through enemy piece A to enemy piece B, value(B) ≥ value(A) for pin
- **discovered_attack**: a friendly slider's attack set gained a target not attributable to the moved piece
- **trapped_piece**: enemy piece has zero safe squares
- **development_lead / king_exposure / space_grab**: fallback classifiers when no tactic fires

Motifs exist for *progress grouping* ("you solve forks 91% of the time, pins 42%"), not for scoring correctness.

---

### Course correction 2026-08-18 — the trainer, not the pipeline

Will, after the second generator run: *"The concept is really simple. The trainer helps user memorize canonical openings, but also injects deviations so that user is tested on refutations. All we have to do is pick any state in a canonical line, propose a non-book opponent move, and let user find best options."*

He is right, and the build had drifted a long way from it. What existed was an analysis pipeline: enumerate every reply at every node of a branching tree, weight each by how often games reach it, classify all of them, generate validated branching refutations, verify each at depth. Roughly a hundred API calls and several minutes — including 429s from Lichess — before a single position could be shown to a human.

All of that answers **"which drill matters most"**, a prioritisation question. Training does not require it answered first. It requires a line and a position on it.

**The trainer (`views/Train.tsx`, `engine/drill.ts`) is now the default view**, and generates each drill lazily:

1. Pick a canonical line (`domain/lines.ts` — five hand-written lines covering the Italian complex).
2. Pick a position on it, either at our move (recall the line) or theirs.
3. At their move, ask the explorer what players in the band play there, and sample a non-book reply weighted by real frequency.
4. One evaluation gives the answer, the continuation for feedback, and the severity.

**Two calls per drill, both cached.** Seconds, not minutes.

Grading accepts anything within 60cp of best, because several moves are often equally good and marking them wrong teaches superstition.

#### Scheduling the opponent's choice

Without scheduling the opponent samples purely by real-world frequency, so the commonest mistake recurs endlessly while rare ones you have never solved barely appear — the opposite of what helps. Each opponent move is now a scheduled item keyed by `positionKey|uci`, so the same move in two positions is two different things to learn.

Expanding intervals on success, reset on a miss:

`1 min → 5 min → 25 min → 2 h → 12 h → 3 d → 10 d → 30 d`

The first few are minutes rather than days on purpose. A run lasts a couple of minutes, so a scheduler working only in days would let one mistake repeat five times in a sitting.

The scheduling weight multiplies into the frequency weight, so realism and learning compose rather than compete: a move still has to be something players actually play, it just stops dominating once you know it. Suppression bottoms out at 0.03 rather than zero — a line that becomes permanently unreachable is one you get surprised by eventually — and a lapsed move returns weighted *above* baseline.

**Frequencies are sampled by their square root.** Frequencies at a single node span two orders of magnitude, and at an 80:1 ratio no amount of suppression will ever surface the rare move. Sampling in proportion to reality is also the wrong objective: the goal is coverage of everything you might meet, weighted towards the likely, not a faithful simulation of the population.

Grading is once per encounter, on the first answer. A move solved only after two misses and a reveal has not been learned, and scheduling it as though it had is how a trainer quietly stops showing you the things you cannot do.

State persists in IndexedDB (`memory` table) and is held in a `Map` so the sampling path stays synchronous. `test/scheduler.test.ts` pins the interval expansion, the suppression curve, the non-zero floor, and the harder return after a lapse.

#### Runs, not flashcards

Will, on the position-at-a-time trainer: *"We're jumping from position to position — you're asking user to memorize each to be able to recognize it. The idea is to teach the deviations as part of book training. I'm playing from the first move of the game so there is context, and it's organized to promote memorization of variations, so each time I reset the opponent may play a different variation or a deviation."*

Right, and the objection is pedagogical rather than cosmetic. An opening move is recalled **from the sequence**, not from a position seen in isolation — that is what a repertoire *is*. Presenting move 6 of the Two Knights as a standalone puzzle tests recognition of a position the user has never encountered in context, which is a different and much weaker skill than the one being trained. It also makes every prompt a fresh orientation problem.

**A run** (`engine/session.ts`) starts at the initial position and continues to the end of a line. At each of their turns the opponent either plays on into one of the variations in scope, or plays a genuine mistake. Reset, and they may choose differently.

The variation branching falls out of the line index for free. Lines are matched by SAN prefix, so after 3.Bc4 the Giuoco, Two Knights and Hungarian are all still consistent with what has been played; the opponent picks among them weighted by real explorer frequency. Successive runs therefore **interleave** variations rather than blocking them one at a time — which is also the spacing structure the research favours, and the opposite of how most opening trainers sequence material.

Phases within a run:

- **book** — one accepted move, the line's. The line is the thing being learned, so alternatives are wrong here even when they are good moves.
- **punish** — entered when the opponent errs. The engine's move is expected, but anything within 60cp is accepted, since several moves often win and marking them wrong teaches superstition. Ends when the evaluation passes +250 or after three of our moves.

`test/session.test.ts` pins the parts that are easy to regress: a run begins at move 1 with an empty path, a wrong move does not advance the run, both variations stay alive while they share a position, different seeds reach different variations, and the Petroff is still never presented as a mistake.

#### "Non-book" was the wrong concept

The first live drill read: *"They played Nf6 instead of Nc6 — 11% of players at your level do this. Punish it."* 2...Nf6 is the Petroff.

The first attempt at a fix relabelled the prompt by severity — still calling it a deviation, but describing it as sound. Will rejected that: *"If it 'is the Petroff' then it could never have been flagged as a non-book move in the first place. We are still in a book line, just not the one you thought. You should have filtered book moves."*

He is right, and the correction is at the selection layer, not the display layer. The generator sampled anything that was not the move in **our chosen line** and called it non-book. That conflates *our repertoire* with *theory*. Relabelling at display time papered over a selection bug.

**Deviations are now filtered by evaluation before being offered.** At a candidate node the top five replies are evaluated against a baseline, and only those losing ≥60cp are eligible; blunders (≥120cp) are preferred over inaccuracies. If no reply at a node is a genuine mistake, the generator moves on, and falls back to a book drill rather than inventing something to punish.

**Why the filter cannot be the explorer's ECO name.** The response labels each move with an opening name, which looks like a ready-made "is this book" signal. It is not: Damiano's Defence (1.e4 e5 2.Nf3 f6) is named theory, ECO C40, and is one of the best punishment targets in the opening. Named is not the same as sound. Evaluation is the only usable filter.

Cost: about eight cached calls the first time a node is used, then nothing.

This matters more than wording. A trainer that implies every unfamiliar move is refutable teaches a beginner to hunt for refutations that are not there — a fair description of how players at this level actually lose games. `test/drill.test.ts` pins it: sound alternatives must never be offered as mistakes, Damiano must be, and a rare blunder must outrank a common inaccuracy.

The coverage audit and punishment generator remain, under *Analysis* and *Drill research*. They answer real questions about what to train next. They are no longer in the way of training.

## 5. Training modes

### Mode A — Memorize (`kind: 'memorize'`)

Standard spaced repetition over `bookMove` nodes. Card front = position + move number; back = the move. FSRS scheduling. Nothing novel here; it exists to feed Mode B.

**One deviation from convention:** cards are scheduled by `reachProbability`, not tree order. A move you reach in 40% of games is drilled before a move you reach in 2%, regardless of depth.

### Mode B — Punish (`kind: 'punish'`) — the flagship

Presentation:

1. Board shows the position **after** the opponent's deviation. The deviating move is highlighted with an arrow and captioned: *"Book is 3...Bc5. Your opponent played 3...Nd4 — 8% of players at your level do this."*
2. You play the refutation. No move list, no multiple choice — free input on the board.
3. **On correct:** opponent plays a validated resistance move. Continue until target eval reached. Eval bar animates.
4. **On wrong:** three-layer feedback (§6).
5. Success = complete the line without leaving the solution tree.

### Mode C — Spar (`kind` n/a; a game mode)

Play from move 1 against a bot that:

- In-book: samples opponent moves from the **real explorer frequency distribution at your band** (this is genuine human move data, not an engine approximation — free and exact).
- Off-book: Stockfish at reduced depth/Skill Level, tuned to ~1200 strength.
- Deliberately biased to reproduce deviations you have failed recently (`weight *= 1 + 2*failureRate`).

Target: reach move 15 with eval ≥ −50cp. Post-game, every point where you left your own repertoire is auto-converted into a new drill.

### Mode D — Coverage audit (dashboard view, not a drill)

The repertoire tree rendered as an icicle/tree chart, each node sized by `reachProbability`, coloured by coverage state:

- green: covered and retained (FSRS stability > 21d)
- amber: covered but weak retention
- red: **uncovered** — opponent moves with real frequency and no prepared answer
- grey: below frequency threshold, deliberately ignored

Sorted list beneath: *"Your biggest hole: after 1.e4 e5 2.Nf3, 6.2% play 2...d6 and you have no prepared answer. Est. 1 in 16 games."*

This view drives what you build next. It is the single most useful screen in the app.

#### Honest coverage denominator

Coverage % must be computed against **all games as White**, not against "games that reached the Italian". An Italian-only repertoire covers roughly the half of your White games where Black replies 1...e5; against 1...c5, 1...e6, 1...c6, 1...d5 you have nothing. A trainer that reports "94% covered" while meaning "94% of the branch I chose to build" is lying in the most damaging possible way — it tells you you're prepared right up until you aren't.

So the coverage tile shows two numbers: **`covered / all White games`** as the headline, and **`covered / games reaching this repertoire`** as the secondary. Ply-1 Black replies you have not built at all appear in the red uncovered list with their real frequency, from day one.

### Mode E — Coach (session director)

Requested: the app decides what you train, you just show up. Coach mode picks a ~20-minute session by rule, in priority order, and states its reasoning in one line so the choices are auditable rather than magical.

Priority rules, evaluated top-down until the session is full:

1. **Overdue retention rescue** — any card with FSRS retrievability < 0.80 and `reachProbability > 0.02`. Forgetting high-traffic book moves invalidates every punishment drill hanging off them. Cap 40% of session.
2. **Recent real-game failures** — deviations from imported games in the last 7 days where `wasCorrect === false`, or that were undrilled. Highest pedagogical value in the app: you just lost a game to this. Cap 30%.
3. **Weakest motif** — punish drills whose motif has the lowest 30-day first-try rate, with ≥5 attempts recorded. Cap 20%.
4. **Frontier expansion** — the single highest `reachProbability × frequency` uncovered node, introduced as new material. Exactly one new node per session, never more; introducing breadth faster than retention consolidates is the classic way to end up with a large repertoire you don't know.
5. **Filler** — highest-weight due memorize cards.

Session shape: warm-up (3 known-good drills, builds momentum and calibrates latency baseline) → main block → one spar game if `sessionCount % 5 === 0`.

Coach explains itself: *"Today: 6 rescue cards (you're shaky on 4.d3 lines), the 3...Nd4 you missed on Tuesday, 4 fork drills (58% first-try), and one new line — 2...d6."*

Manual mode selection remains available; Coach is the default landing screen.

---

## 6. Feedback design

The stated gap: *trainers don't show you why a move is wrong.* Three layers, delivered in sequence, gated on user input so you can't skim past them.

**Layer 1 — immediate, quantitative (0ms).** Move rejected, eval bar swings, delta shown in centipawns *and* in the units that matter at this level: *"−180cp — that's a piece for a pawn in 3 moves."*

**Layer 2 — the consequence line (on click).** Auto-play the engine's refutation of *your* move, 4–6 plies, one move per 900ms, with per-move captions generated from the motif detector + eval deltas:

> 5...Nxe5 — *now the knight on d4 is undefended*
> 6.Qh5+ — *fork: king and the loose knight*
> 6...g6 7.Qxd5 — *you're down a piece*

Captions are template-generated from detected motifs and material deltas. Deterministic, no LLM at runtime.

**Layer 3 — role reversal (on click).** Same position, colours flipped: *you* now play the punishment against your own mistake. This is the retrieval-practice step and it is what makes the lesson stick. Optional but tracked separately in progress stats.

**Design rule:** never show layer 2 before the user has committed a move. Feedback before commitment destroys the testing effect.

---

## 7. Progress tracking

Explicitly requested; treated as a first-class subsystem, not a stats footer.

### Event log (append-only, `attempts` table)

```ts
type Attempt = {
	id: string;
	ts: number;
	mode: 'memorize' | 'punish' | 'pressure' | 'coverage' | 'spar';
	drillId: string;
	sourceNodeId: PositionKey;
	fen: string;
	userMove: string;      // uci
	expected: string[];    // uci[]
	correct: boolean;
	cpLoss: number;
	latencyMs: number;
	motifs: Motif[];
	hintsUsed: number;
	roleReversalDone: boolean;
	sessionId: string;
};
```

Never delete or mutate. All metrics are derived. Export to JSON for backup.

### Derived metrics

| Metric | Definition | Why it matters |
|---|---|---|
| **Coverage %** | Σ (reachProbability × frequency) over answered opponent moves ÷ total mass | The one number that says "how much of a real game am I prepared for" |
| **Punish rate** | first-try success on `punish` drills, 30d rolling | Core skill being trained |
| **Punish rate by motif** | same, grouped | Tells you *which* pattern is failing |
| **Retention** | FSRS stability distribution; count overdue | Memorization health |
| **Automaticity** | median latency on drills with ≥90% accuracy, over time | Falling latency at stable accuracy = real pattern formation. Accuracy alone saturates; this doesn't. |
| **Transfer rate** | in imported real games, when opponent left book at a node we had drilled, did we play the drilled move? | Slow validity check — see the note below. Not the primary loop. |
| **Off-book survival** | eval at move 15 in real games, distribution over time | Does prep translate to positions |

#### Revision 2026-08-18 — transfer rate demoted

Original draft made transfer rate "the ground-truth metric" that everything else proxied for. Will pushed back: he plays few games, so the sample will be thin for a long time, and drill performance establishes opening competence far faster. He is right about priority, and the spec was wrong.

The distinction that matters:

- **Drill performance** measures recall *in the drill context*. Dense, immediate, available from session one. This is the **primary feedback loop** — it drives Coach scheduling, motif targeting, and the sense of progress.
- **Transfer rate** measures recall *at the board, under game conditions*. These genuinely differ (recognition vs recall, context-dependent retrieval), but the signal arrives slowly and noisily at a low game volume. With ~20 rapid games a month and maybe a third reaching a drilled node, the confidence interval stays uselessly wide for months.

So transfer rate stays in the design but is **demoted to a background validity check**, displayed with an explicit sample count and never as a headline tile. It is not a gate on anything.

Why keep it at all: it is the only instrument that can detect the project's biggest risk (§10, last row) — *training the wrong thing*. Drill accuracy can go to 100% while rating goes nowhere, and drill accuracy cannot tell you that; only contact with real games can. Keeping it cheap and honest costs little; removing it would leave the project unable to notice its own failure.

Consequence for the build order: **game import (M5) moves after the drill loop, not before it.** Nothing depends on it. Rating history from the platform APIs is a cheaper low-variance companion signal and needs no game parsing.

### Game import & transfer detection

Nightly (or on-demand) pull:

- **Lichess:** `GET /api/games/user/{u}?since=&pgnInJson=true&opening=true` — token optional for public games
- **Chess.com:** `GET /pub/player/{u}/games/{YYYY}/{MM}` — public, no auth
- **OTB:** drag-drop PGN

For each game: walk moves against the repertoire tree. Record `(firstDeviationPly, deviatingSide, wasDrilled, ourResponse, wasCorrect)`. Any opponent deviation we had *not* drilled is auto-enqueued into the build pipeline — the app gets better at your actual opponents over time. This closes the loop.

### Dashboard (`src/views/Progress.tsx`)

Four tiles: Coverage %, Transfer rate, Punish rate, Overdue count. Below: coverage tree (Mode D), transfer rate line chart with training-volume bars, punish-rate-by-motif horizontal bars, rating history from platform APIs annotated with training sessions.

---

## 8. Technical architecture

**Local-first. No backend. No accounts. Data lives in IndexedDB and exports to a JSON file.**

### Stack

| Concern | Choice | Note |
|---|---|---|
| Build | Vite 5 + TypeScript 5 (strict) | |
| UI | React 18 | |
| Board | `chessground` | Lichess's own; best interaction model |
| Chess logic | `chessops` | Lichess's; correct FEN/UCI/SAN handling, better than chess.js for this |
| Engine | `stockfish.wasm` (single-thread build) + optional `lila-stockfish-web` multithread | see COOP/COEP note below |
| Cloud eval | `GET https://lichess.org/api/cloud-eval?fen=…&multiPv=3` | free, cached, covers most opening positions; local WASM only on miss |
| Explorer | `GET https://explorer.lichess.ovh/lichess` | params verified 2026-08-18: `variant, fen, play, speeds, ratings, moves, topGames, recentGames`. **Requires a Bearer token** — see below |
| SRS | `ts-fsrs` | FSRS-5 |
| Storage | Dexie (IndexedDB) | |
| Charts | Recharts or plain SVG | |
| Tests | Vitest | |

### Rating band mapping

Explorer `ratings` accepts band lower-bounds. For a <1400 player use `ratings=1000,1200,1400` and `speeds=blitz,rapid`. Store as config so it can shift as rating changes — the deviation distribution is rating-dependent and stale bands silently degrade the whole product.

### ⚠ The explorer now requires authentication (verified 2026-08-18)

Probed from the browser against six endpoint variants. Result:

| Endpoint | Anonymous | With Bearer token |
|---|---|---|
| `explorer.lichess.ovh/lichess` (full params) | **401** (nginx) | **200** |
| `explorer.lichess.ovh/lichess` (fen only) | 401 | 200 |
| `explorer.lichess.ovh/lichess` (`play=`) | 401 | 200 |
| `explorer.lichess.ovh/masters` | 401 | 200 |
| `lichess.org/api/opening-explorer/lichess` | 404 | 404 |
| `lichess.org/api/cloud-eval` | **200** | 200 |

Conclusions:

1. **Every explorer endpoint now rejects anonymous requests at the nginx layer.** A Lichess personal API token (no scopes required) is mandatory. Stored in `localStorage` under `offbook.lichessToken`, never committed.
2. **Cloud-eval is still anonymous.** The evaluation half of the pipeline has no auth dependency.
3. **The rating/speed filter works as intended.** Unfiltered, the Italian root shows ~316M games at average rating 1519; filtered to 1000–1400 blitz+rapid it shows ~131M games at average rating 1334. The band filter is doing real work — which matters, because the entire deviation distribution is rating-dependent.

Risk this introduces: a single revocable credential now sits on the critical path for the one data source with no offline substitute. Mitigation is already in the design — every explorer response is cached in IndexedDB permanently, so a built repertoire keeps working without the API. If access is withdrawn entirely, the fallback is the monthly [database.lichess.org](https://database.lichess.org/) dumps filtered to the band once and indexed locally: same data, slower setup, cannot be taken away.

### ⚠ Evaluation sign conventions (verified 2026-08-18)

The two evaluation sources disagree about whose point of view a score is from, and nothing in either response marks which:

| Source | Convention |
|---|---|
| `lichess.org/api/cloud-eval` (`cp` **and** `mate`) | **White's** point of view |
| Local Stockfish over UCI | **Side to move's** point of view |

Established empirically, since the docs were unreachable from the build sandbox. Three positions, all with **Black to move**:

| Position | Truth | cloud-eval |
|---|---|---|
| 1.e4 e5 2.Nf3 f6 3.Nxe5 | White up a pawn | `cp +157` |
| 1.f3 e5 2.g4 | Black mates in 1 | `mate −1` |
| Fried Liver 6.Nxf7 | White clearly better | `cp +88` |

Under a side-to-move convention all three would carry the opposite sign.

**This was a live bug, not a hypothetical.** The first `cloudEval.ts` wrote cloud results (White POV) and local results (side-to-move POV) into the same field and cached them under the same key. It would have flipped every evaluation in positions where Black was to move — silently, and only for one colour, which is close to the worst possible failure signature: drills would have "punished" sound moves and passed over blunders, with no error anywhere.

Design rules that follow:

1. **Everything normalises to White's point of view at the boundary**, in a field named `cpWhite`. Never store a bare `cp`.
2. **The eval cache key carries a convention version** (`v2w|…`), so changing the convention invalidates old rows instead of silently mixing them.
3. **MultiPV ranking must sort by our point of view**, not by the raw stored number — sorting White-POV scores directly picks Black's best move when we are Black. The punishment generator ranks explicitly.
4. `test/pov.test.ts` pins all of this down, including the recorded cloud values above.

Consequence: the punishment generator is now cloud-first. Lichess holds depth 40–55 analysis for most opening positions, which is both deeper and faster than local Stockfish; local is the fallback for positions the cloud lacks, holds too shallowly, or has fewer PVs than requested.

### ⚠ COOP/COEP gotcha

Multithreaded Stockfish WASM requires `SharedArrayBuffer`, which requires:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

But `require-corp` **breaks cross-origin fetches** to `explorer.lichess.ovh` and `lichess.org` unless they send `Cross-Origin-Resource-Policy: cross-origin`. Three ways out, in order of preference:

1. Use `Cross-Origin-Embedder-Policy: credentialless` (Chromium-supported) — cross-origin no-cors fetches allowed.
2. Do all explorer/cloud-eval calls in the **build step** and cache to IndexedDB, so the drill runtime never makes cross-origin requests.
3. Ship the single-threaded Stockfish build and skip SAB entirely — slower, but the build step is offline anyway.

**Recommendation: (2) + (3) for v1.** Analysis happens once, at build time, unhurried. Drill-time needs no engine at all.

### API politeness

Explorer and cloud-eval are free community infrastructure. Throttle to **1 request/second**, honour `429` + `Retry-After` with exponential backoff, and cache every response in IndexedDB keyed by `(fen, ratings, speeds)` forever. A full Italian repertoire build is a few hundred requests — a few minutes, once.

### Directory layout

```
offbook/
	SPEC.md
	package.json
	vite.config.ts
	src/
		main.tsx
		domain/
			types.ts
			repertoire.ts        # tree construction, reachProbability
			classify.ts          # MoveClass thresholds
		data/
			db.ts                # Dexie schema
			explorer.ts          # Lichess explorer client + cache + throttle
			cloudEval.ts         # cloud-eval client + cache
			importGames.ts       # lichess / chess.com / PGN
		engine/
			stockfish.ts         # WASM worker wrapper, MultiPV
			punishment.ts        # step-5 line validation
			motifs.ts            # step-6 detection
		scheduler/
			fsrs.ts
			priority.ts          # reachProbability-weighted queue
		views/
			Build.tsx
			Memorize.tsx
			Punish.tsx
			Spar.tsx
			Coverage.tsx
			Progress.tsx
		components/
			Board.tsx            # chessground wrapper
			EvalBar.tsx
			ConsequenceLine.tsx  # layer-2 feedback player
	test/
```

### Constants (`src/domain/classify.ts`)

```ts
export const COVERAGE_TARGET = 0.95;   // stop enumerating opponent moves here
export const MIN_FREQ        = 0.005;  // ignore below 0.5%
export const BLUNDER_CP      = 150;
export const INACCURACY_CP   = 50;
export const UNIQUE_MARGIN   = 80;     // solution must beat 2nd best by this
export const RESIST_MARGIN   = 100;    // opponent replies within this are "plausible"
export const WIN_THRESHOLD   = 300;    // drill ends when we reach this
export const MAX_PLIES       = 8;
export const MAX_NODES       = 40;     // above this, downgrade punish -> pressure
export const D_SHALLOW       = 16;     // classification depth
export const D_DEEP          = 22;     // punishment-line depth
```

---

## 9. Milestones

| # | Deliverable | Acceptance criteria |
|---|---|---|
| **M0** ✅ | Scaffold | Vite app runs; chessground board renders; you can play moves; Stockfish WASM returns an eval. **Done 2026-08-18** |
| **M1** ✅ | Repertoire + coverage audit | Explorer queried and cached; trunk mass and deviation weights computed; coverage audit renders with an honest denominator; backlog split into "left your line early" vs "your book ran out". 10 tests cover the mass arithmetic, including the invariant that early deviations + trunk survival = 1. **Done 2026-08-18** |
| **M2** | Punishment generator ★ | For 3...Nd4, 3...Nf6, 3...Bc5, 3...d6 the pipeline emits validated branching drills. Manually verify ≥10 generated lines are actually sound. **This milestone is the go/no-go for the project.** |
| **M3** | Punish + Memorize modes with 3-layer feedback | Full drill loop playable; consequence lines animate with correct captions; role reversal works |
| **M4** | Progress subsystem | Attempt log persists; drill-performance metrics compute; dashboard renders. Drill performance is the primary loop (§7 revision) |
| **M5** | Spar mode | Bot plays explorer-sampled moves in book, weighted toward your failures |
| **M6** | Coach mode | Session director per §5 Mode E |
| **M7** ✅ | Game import → mistake deck | Lichess + chess.com import; every game mined once for moves that cost material; worst four per game filed as flashcards. **Done 2026-08-19.** Transfer rate still deferred — see the revision below for why the deck came first |

Phase 2 (post-v1): second repertoire (Black), Maia via lc0-wasm for realistic off-book play, LLM-generated prose annotations at build time, eval-ranking mode if rating passes 1800.

#### Revision 2026-08-18 — the gate has to be machine-decidable

The original wording ("manually verify ≥10 generated lines are actually sound") quietly assumed a strong player was doing the verifying. Will is under 1400 and building this app precisely because he does not yet have that judgement. Asking him to certify engine refutations is asking the wrong person, and a gate nobody can actually evaluate is not a gate.

Replaced with an **independent verification pass**. The first implementation re-analysed the root locally at depth 24 with MultiPV 3 and blew straight past the engine timeout on the single-threaded WASM build — a verifier that never returns is no verifier. The working design uses the best available checker instead:

**Preferred — Lichess cloud analysis.** Depth 40-55, instant, and genuinely independent of our own search. It stores only one principal variation, but that answers the decisive question: does the deepest analysis available agree that our move is *the* move? A drill is verified when the cloud's top move equals ours and still values the position at ≥100cp.

**Fallback — local MultiPV with a time budget.** Used when the cloud disagrees or has no entry (it cannot measure the margin to the second-best move). 4000ms, roughly thirteen times the 300ms budget used while walking the tree, and bounded so it always returns. Verified only if:

1. The recommended move is still among the top moves at the longer search.
2. It is within `UNIQUE_MARGIN` (80cp) of the best move found.
3. The position is still worth ≥100cp to us — i.e. a punishment, not merely the least-bad option.

Related fixes from the same run: the engine's fixed 30s timeout now scales with the requested budget, and a failure on one position no longer aborts the batch — the timeout above discarded a run that had already completed all of its useful work.

Any failure produces a specific note ("at depth 24, Nxe5 is 140cp worse than d3"). The gate becomes: *what fraction of generated drills verify, and are the failures explicable?* — a question answerable from exported data by anyone, rather than a matter of playing strength.

A `Copy drill data` button exports every line, evaluation, verification verdict and priority score as plain text for exactly this review.

#### Search budgets — why the tree is time-bounded

Refutation trees need MultiPV, which the Lichess cloud does not store, so every node is a local search. Depth targets made the cost unpredictable (nodes × "however long depth 18 takes *here*"); a `go movetime` budget makes it nodes × 300ms. With MAX_REPLIES 2 and MAX_PLIES 4 that is ~7 nodes and ~14 searches, a few seconds per drill instead of minutes.

Search quality in the tree is deliberately *not* what protects correctness — the verification pass is. A shallow tree search that picks the wrong move gets caught and marked unverified rather than silently shipped, which is the right division of labour: cheap where it is recoverable, expensive where it is not.

#### First generator run, 2026-08-18 — 0 of 12 drillable, and why

The first live run analysed the twelve highest-mass deviations and classified every one as `playable` (deltas 4–49cp). The classifier was right; the candidate selection was wrong, in two ways.

**1. Frequency and punishability are anti-correlated.** The twelve most popular replies are 1...c5, 1...d5, 1...e6, 1...c6, 3...Nf6, 3...Bc5 — main-line openings. Moves are popular *because* they are sound. The spec already said frequency was the wrong drill priority (§2), and then the generator selected candidates by frequency anyway. Punishable moves live in the rare tail, which was being discarded before analysis.

Fixed with a two-phase pipeline:

- **Sweep** — classify *every* deviation including the dropped tail. Two cached evaluations each, seconds in total. First live sweep: 58 deviations → **14 blunders, 30 inaccuracies, 14 playable**. Roughly a quarter of what opponents play in this tree is concretely punishable, which is enough material for the thesis.
- **Refute** — build the expensive branching tree only for moves classified as blunders, ranked by mass.

**2. The blunder threshold missed the canonical case.** Damiano's Defence (1.e4 e5 2.Nf3 f6) runs +0.18 → +1.62: a delta of 144cp against a 150cp threshold. The most famous beginner blunder in the e5 complex, rejected by six centipawns.

The rule was also wrong in principle — a pure delta ignores where you end up. What makes a drill worth learning is that the right move leaves you clearly better, not that the number moved. Replaced with a two-sided test:

```
blunder  ⟺  evalAfter ≥ 120cp  AND  delta ≥ 60cp
```

The position after their move must be worth winning, *and* their move must be what caused it. The second clause stops positions where we were already winning from being credited to their mistake.

#### Second generator run — the thesis was measured on the wrong five plies

12 of 12 blunders drillable, 8 verified, refutations correct (2...Bc5 → 3.Nxe5 confirmed at depth 48). The machinery works. The yield does not:

| | Share of White games |
|---|---|
| All 12 blunders | **4.10%** |
| The 8 that verified | **2.52%** |
| 2...Bc5 alone | **1.73%** — 69% of the verified total |

The remainder is 1.e4 g5, 1.e4 b5, 2...b6 — moves you meet once in several hundred games. A programme addressing 2.5% of games is not worth building, and Will said so before I did.

**The cause was the tree, not the thesis.** The trunk was five plies (1.e4 e5 2.Nf3 Nc6 3.Bc4), so deviations were only ever enumerated at plies 1, 3 and 5 — where nobody blunders. Every reply there is a real opening: c5, e6, Nf6, Bc5. Beginner mistakes happen around moves 5–8. Will's own observation — *"when I practice an opening the feasible choices are very few"* — is the diagnosis: a narrow tree is what makes this trainable, and we truncated it before it reached anything interesting.

The canonical case sits one move past the old horizon. In the Two Knights, 3...Nf6 4.Ng5 d5 5.exd5 **Nxd5??** is very common at this level and close to losing to 6.Nxf7. Estimated mass ≈ 0.545 × 0.624 × 0.317 × P(4...d5) × P(5...Nxd5) ≈ **3–4% in a single position** — more than all twelve previous drills combined.

Two structural limits removed:

1. **Depth** — now `TREE_MAX_PLIES` = 12.
2. **The trunk was linear.** After 3.Bc4 Black plays Nf6 (31.7%) *and* Bc5 (27.9%); a single line discards half the tree at every step. The tree now expands the top `TREE_EXPAND_TOP` (3) replies at every opponent node.

Past the seed line, **our own moves are chosen automatically**: the most popular reply the engine does not dislike, restricted to moves played at least 3% of the time. Restricting to popular moves is not aesthetic — an engine move nobody plays leads to positions the explorer has no data for, starving every node below it. This also means the app now *generates* a repertoire rather than requiring one, which is what Will needed, since he does not play one.

**Expansion and drill-detection are deliberately independent.** Expansion follows popularity (that is where your games go); recording lists *every* reply as a drill candidate. Coupling them would be a serious bug: 5...Nxd5 is both common and near-losing, so selecting candidates by "the moves we did not expand" would hide exactly the position worth training. A test pins this.

Also fixed, caught by that test: `earlyDeviationMass` filtered deviations by ply, which double-counted once several branches shared a ply and pushed the total past 100%. It now matches the seed path, not the depth.

**M2 is the gate.** If the punishment generator can't produce sound, branching, non-trivial drills automatically, the entire differentiator collapses and the honest move is to stop and just use Chessable + Lichess analysis. Build M2 before M3, and evaluate it harshly.


#### Revision 2026-08-19 — the deck should be fed by real games, not by the trainer

Until now the mistake deck contained only mistakes made *in here*, which biases it towards whatever the trainer happened to ask. Will's point: the mistakes most worth drilling are the ones made when the game was real.

M7 was originally scoped as *transfer rate* — the fraction of games reaching your prepared lines. That metric was demoted to a background check long ago (§7), and building an import pipeline to feed a number nobody looks at is the wrong order. The same pipeline feeds the deck, which is used every session, so the deck came first and transfer rate can be computed later from the same rows.

**Cost is the whole design.** The obvious approach — evaluate the position before your move, then after — is two searches per move, eighty for a forty-move game. One pass suffices: walk the game evaluating each position once, and the loss on your move at ply *i* is

```
eval(position before ply i) − eval(position after ply i)
```

both from your point of view. That halves the work, and — more importantly — guarantees the two numbers being subtracted were measured identically. Comparing evaluations taken at different budgets is precisely the bug that made the rating estimator report 1639 on poor play; it is not being repeated.

Lichess games already analysed on the site come with their evaluations attached and cost nothing at all. A single local search is then needed per flagged ply, to have a move to ask for.

**What is not made into a card:**

| Rule | Reason |
|---|---|
| Loss < 150cp (adjustable) | Not worth a repetition |
| `\|eval before\| > 800cp` | A blunder in an already-won or already-lost position teaches nothing that transfers; the game was decided before the move |
| Engine's best move = what was played | The apparent loss is measurement noise, not a mistake |
| Opponent's moves | Their mistakes are not our flashcards |
| More than 4 per game | One collapse should not drown out twenty other games |

**A game is analysed once.** Re-running the import does not bump a card's lapse count — that number means *how often you make this mistake*, not how often you pressed the button. Analysed game IDs live in a new `imported` table (db version 6), and the import history is separately clearable without touching the cards.

**Cards carry their origin.** `phase: 'game'` plus platform, opponent, date, game URL and the measured loss. The quiz prompt says what it cost and links to the game, so a card is never a position from nowhere.

**Failure is reported per source, never as a zero.** Chess.com's public API may or may not send a CORS header for the archive routes from a browser — the build container cannot reach it (Cloudflare 403 from datacentre IPs) and this could not be verified before shipping. A silent empty result would be indistinguishable from "you played no games", so each platform reports its own status and a network-level rejection is explained rather than shown as `Failed to fetch`.

**Testability.** `findMistakes` takes its analyser as an option, defaulting to the real engine. The engine is a Worker and cannot run under vitest, so this seam is what makes the loss arithmetic, the POV flip, the decided-position skip and the cancel path testable at all — 8 tests, plus 7 on the PGN reader.

One real bug the PGN tests caught immediately: chessops rejects suffix annotations (`e4!`, `Nf3?!`), which chess.com PGNs carry. Every chess.com game with an annotated move would have been truncated at that move. Check and mate marks are fine and are left alone.


#### Revision 2026-08-19 — chessground consumes `dests`, and the quiz never re-armed them

Reported as "I can't make a move on the mistake card". Not specific to imported cards, and not a chess bug at all.

Chessground **consumes** `movable.dests` when a move is played: after a drop the board has no legal destinations until they are set again. The `Board` component split position and interaction into two effects (to fix the double-animation bug), and only the position effect depended on `version`. So re-showing the *same* position — a rejected move, a second attempt at the same card — restored the pieces but left the dests map empty. The board looked normal and silently accepted nothing.

Train mostly escaped it because its position advances on every accepted move. The quiz is where you meet the same FEN twice by design, so it hit on the first wrong answer.

Two changes:

- `version` is now a dependency of the **interaction** effect as well as the position effect.
- `Quiz.next()` bumps `version` on every card change, not just on rejection. Two cards can share a position (one slip, two candidate answers), and then `fen` does not change between them either.

#### `schackal.dump()` — a console handle for bug reports

Prompted by the same report: "I can't move" is the symptom of at least four different causes, and none of them are distinguishable from a description. `src/data/debug.ts` collects the state that separates them and copies it to the clipboard as JSON.

| | |
|---|---|
| `schackal.dump()` | copy everything to the clipboard |
| `schackal.show()` | log it instead |
| `schackal.board()` | legal-move report for the position a view is showing |
| `schackal.help()` | the above |

Views register a snapshot function (`registerDebug`) on every render, so what is captured is current state rather than the first render's. Train and Quiz are wired; the dump also carries Dexie's version and per-table row counts, `offbook.*` localStorage keys, the URL and the user agent.

The most useful field is `position.legalMoves`. A live position always has moves — so *live FEN, zero destinations* says the fault is in the UI, and *`gameOver: true`* says it is not. That is exactly the distinction this bug needed. The deck listing also carries `stmMatchesUs` per card: a card whose position has the wrong side to move can never be answered, and that would otherwise look identical from the outside.

**The Lichess token is never included** — only whether one is stored and how long it is. That much has diagnosed a problem before (the token saved against the wrong origin when Vite fell forward to port 5174); the value has no reason to leave `localStorage`.


#### Revision 2026-08-19 — `turnColor` is not part of the FEN

The previous revision fixed a real bug (consumed `dests`) that was not the reported one. This is the reported one.

Chessground's `fen` config option sets the **pieces only**. `turnColor` is separate state, defaults to `white`, and a piece is draggable only when `turnColor === piece.color`. `Board` passed `fen` at construction and set `turnColor` in an effect afterwards.

That was survivable until React StrictMode. In development React mounts, unmounts and remounts every component: board A is built and correctly updated by the position effect, then destroyed; board B is built from the same config — no `turnColor`, so white — and the position effect's "have I already pushed this position?" cache (`lastFen`) had survived the remount, so its guard short-circuited and **board B never received `turnColor` at all**.

The result is a board that looks completely normal and accepts nothing: `movable.color: 'black'`, `dests: 12`, `draggable: true`, `turnColor: 'white'`.

Three reasons it hid for so long:

- **White-to-move positions always worked**, because white is chessground's default. The trainer starts from move 1, so it never saw this.
- **Production builds always worked.** StrictMode double-invocation is development-only — so `vite build` + preview passed while `npm run dev` failed. A headless check against the production build reported everything fine.
- Both wrong things had to line up: the missing config value *and* a cache outliving the instance it described.

Fixed by passing `turnColor` (and `lastMove`) at construction, and by tying `lastFen`/`lastVersion` to the instance lifetime — set on create, cleared on destroy. They cache what was pushed to *this* chessground instance, so they have no business outliving it.

**`scripts/board-check.mjs`** guards it: seeds a card, opens the Mistakes tab, drags the piece and asserts the move was accepted — once with black to move, once with white, against the **dev** server. Verified to fail on the old code and pass on the new. Unit tests cannot reach this; neither can a production build.

The dump now carries `views.chessground.canMove` — `movable.color === turnColor` — which states the broken invariant directly.

#### Diagnosis, in general

Three attempts, and only the third was the actual fault. What made the difference was not reasoning harder but getting the machine to answer:

1. Reading the code suggested a plausible cause. It was a real bug, but not this one.
2. A headless reproduction against a production build said everything worked — which was true, and misleading.
3. `schackal.dump()` from the real browser showed `turnColor: "white"` against a `... b ...` FEN in one line.

The rule this leaves behind: when a symptom is a UI component behaving unlike its own configuration, read the component's internal state rather than the props handed to it, and reproduce in the same mode the user is running.


#### Revision 2026-08-19 — piece glyphs in all notation

`Nf6` costs three steps: read N, recall that N means knight (because K was taken), then find the knight. The board in front of you already shows a knight. Every translation between a symbol and its meaning is one the learner pays for, and this one is free to remove.

`src/domain/notation.ts` is now the single source, and `src/components/Move.tsx` renders it.

**Glyph before the full SAN — `♞ Nf6`, not `♞f6`.** Deliberately redundant: the text stays standard SAN, so it can still be copied into an engine, searched for, pasted into a forum post or read aloud. The symbol is a shortcut, not a substitute. (Published figurine notation replaces the letter and omits the pawn entirely; that is more elegant on the page and less useful in a trainer.)

**Pawns get a glyph too**, against the printed convention, so every entry in a list starts with a symbol and the notation column aligns. A ragged left edge is exactly the sort of small friction this change exists to remove. The glyph sits in a fixed-width box for the same reason.

**Coloured by the side that moved.** Books use outline symbols throughout and let the move number carry it. That is a compression, and compression is the wrong instinct here (§1.1) — a reader who has to derive whose move it was from the move number is spending attention on bookkeeping instead of on the position. Colour the symbol and the question never arises.

Getting the colour right is per-site work, and there is no single rule:

| Context | Source of colour |
|---|---|
| Move list, coverage tree, drill paths | ply parity (`colourAtPly`) |
| Mistake cards, candidate lists | the card's / run's `ourColour` |
| Their last move, refutation replies | `other(ourColour)` — alternating through the PV |
| Sandbox lines, explorer tables | side to move in the position it was played from (`colourOfFen`) |

Getting this wrong is invisible in a screenshot and wrong in a way that teaches the wrong thing, which is why it is a table rather than a default.

Strings that cannot hold a component — tooltips, status lines, engine feedback sentences — use `withGlyph()`. The feedback built inside `engine/session.ts` ("♞ Nf6 works, but ♗ Bc4 is slightly better") is glyphed at the point of construction, where the colour is known, rather than being re-parsed in the view.


#### Revision 2026-08-19 — one board panel, and the evaluation bar was reading backwards

The mistake deck showed a bare board: no evaluation bar, no material readout, and text buttons where the trainer has an icon strip. Two interfaces for one activity, and the difference taught nothing about chess (§1.1, "one interface, learned once").

`src/components/BoardPanel.tsx` is now the only way a position is shown: evaluation bar, board, captured material, the view's own content, then the control strip — same geometry, same order, same place for the hand to reach. Train and Quiz both use it. The quiz gained, as a consequence, the trainer's *Show every option weighted* help, which marks the card assisted exactly as "Show me" does.

**The material readout is new to both views.** `MaterialBar` prints the captured pieces themselves and the net: `♟♟♞  −1 in their favour`. A learner who cannot yet convert "−1" into "a pawn" gets it for free; one who can reads the number. `src/domain/material.ts` computes it, and `engine/session.ts` now imports `materialBalance` from there instead of keeping its own copy — two implementations of "who is up material" would drift, and the number under the board would stop matching the sentence beside it.

Promotions are the trap in that calculation: captured is `initial − present`, so promoting a pawn makes you appear to have captured one of your own queens. Clamped at zero, with the surplus reported separately as `promotions`.

**The evaluation bar was wrong, and the screenshot is what caught it.** It filled white-from-the-bottom always. Beside a board oriented for Black that reads inverted: your pieces are at the bottom, your advantage grows at the top, and the learner has to hold in mind which of two adjacent spatial encodings is absolute and which is relative. It now fills towards *you* — bottom of the bar is bottom of the board — still tinted by real piece colour, so nothing about "white is light" is lost. Nobody would have reported this; it just quietly made the bar harder to read for half of all positions.

Also corrected while pinning the arithmetic in a test: the old comment claimed the curve was "flat past ~600". It is not — at ±600 an extra 80cp still moves the bar perceptibly, which is right, since that is a winning but not yet won position. The comment now describes what the function does.


#### Revision 2026-08-19 — the move list previewed from a map that was never complete

Clicking a move in the list did nothing. Two independent reasons, and either alone was enough:

1. **Odd plies never existed.** A state was recorded once per *submitted* move, and a submitted move advances the path by two — ours and their reply. So the map held plies 0, 2, 4… and every chip for one of your own moves was a lookup miss that returned silently.
2. **A resumed run held exactly one entry.** The map lived in React state and was rebuilt on resume as `new Map([[path.length, state]])`. Since the app autosaves every move and resumes on load, this is the *normal* case — after a reload, every chip but the last was dead.

The map was the wrong data structure. A position is fully determined by the moves that reached it, so `replayLine(path)` in `domain/chess.ts` now derives every position on demand. There is nothing to keep in sync and nothing to lose across a reload.

**Clicking is now a preview, not a rewind.** The run is untouched; the banner names the move being viewed and offers *Back to the game* or *Play from here* (which branches via `playFrom`, the same path the review page uses). During a preview the board is not interactive and the evaluation bar reads `—` rather than the live number, which would otherwise describe a position that is not on screen.

**Why no test caught it.** Everything here was reachable only by clicking a chip in a resumed session and looking at the board. `board-check.mjs` now does exactly that: seeds a five-ply run, reloads so the session is *resumed*, clicks every chip and asserts the board's FEN actually changed — and that the last chip, which is the live position, leaves it alone. Verified to fail on the old behaviour.

Two smaller things this turned up:

- The dump reported `state.fen`, the run's position, which during a preview is not what is on the board. It now reports the shown position, with the live one alongside as `livePosition`. A debug handle that does not describe what you are looking at is worse than none.
- Move-list chips carry `data-ply`, because the visible text now includes a piece glyph and matching on notation had already broken the harness once.


#### Revision 2026-08-19 — "you are a queen up" when the queen was about to be taken

Reported from a real run ending `10.Qxc6+`. The note read *"You are a queen up (+2.0)"*. Black recaptures with `10...bxc6` immediately; White is a pawn up.

The count was taken statically on the position as it stood, and the drill stops precisely at sharp positions where a capture is usually pending — so the one place the sentence gets used is the one place a static count is least trustworthy. It was also self-contradicting: the same sentence printed `+2.0`, and a queen is not worth two pawns. Nothing checked that the two halves agreed.

Material is now counted **after the engine's own line has played out** (`settle`, up to 8 plies). For the reported position: raw count `+10`, settled `+1`, so the note becomes *"You are a pawn up once the exchange finishes (+2.0)"* — and the extra edge beyond the pawn is exactly what the evaluation is reporting.

Two guards on top:

- If the settled count still disagrees with the evaluation — down material but winning, i.e. a sacrifice — no material claim is made at all: *"Your position is much better"*. A confident wrong sentence is worse for a learner than a vaguer right one (§1.1).
- When the settled count differs from the count on the board, the sentence says *"once the exchange finishes"* rather than quietly describing a position the user is not looking at.

#### Same revision — three smaller things

**"They try something else" now remembers everything it has shown.** `RestorePoint.avoidUci` held a single move, so pressing the button twice could hand back the reply from two presses ago; with five alternatives you could bounce between two of them indefinitely. It is now `avoid: string[]`, accumulated across presses and reset once every reply has been seen, so repeated presses walk the position's alternatives and then cycle.

**An animation instead of the word "thinking…".** `components/Thinking.tsx`: three pulsing dots beside the controls, and `ThinkingBar` for panel-level work. Text of changing width moves whatever sits next to it — the same complaint that made the control strip fixed-size icons — and a still label cannot distinguish "working" from "stuck", which during a deep search is the only question. `src/index.css` exists solely because keyframes cannot be an inline style; it is dropped entirely under `prefers-reduced-motion`.

Note the import panel keeps a real progress bar while analysing, where there is a genuine denominator, and uses the indeterminate sweep only while fetching, where there is not. A progress bar with an invented total is a lie about how far along you are.

**The debug handle moved to the screen corner, on every tab.** It was a button on the Mistakes tab, which is not necessarily where a bug happens. `components/DebugCorner.tsx` is gated on `import.meta.env.DEV`, a compile-time constant, so it is removed from a production build rather than merely hidden.


#### Revision 2026-08-19 — the lines are gone; the book is the tree

Five hand-written lines were a scaffold, and the app had outgrown it. A list of lines is a lie about the shape of an opening: "Giuoco Piano" and "Two Knights" are not two things you learn separately, they are one thing that forks at move 3, and everything before the fork is shared. Written as five strings, the shared prefix is duplicated five times, a position can only be understood as belonging to a named line, and any move outside those five strings is "wrong" even when it is perfectly good theory.

The opening IS a tree and the explorer already holds it. So there is no list. At every position the app asks what is actually played there and what the engine thinks of it (`domain/book.ts`), and that answer defines both what you may play and what the opponent may reply. **The line you are in is discovered — read off the explorer's own ECO naming — rather than prescribed.**

**Both axes are the user's to set**, because they are choices about what is being trained rather than facts about chess:

| Strictness | Accepts | Trains |
|---|---|---|
| `repertoire` | the most popular sound move, only | memorisation |
| `book` | any sound move played over `minFreq` (adjustable, default 3%) | exploration |
| `free` | anything that does not cost material | error-spotting only |

Popularity and soundness are kept as **separate axes** rather than collapsed into one score, because the interesting moves are exactly the ones where they disagree: common and bad is a drill, sound and rare is a surprise. This is also what stops Damiano's Defence passing as book — it is named theory, commonly played, and close to losing.

Two invariants worth stating: **no strictness ever accepts a blunder**, and **no position is ever left with nothing acceptable** — a position where every legal move is marked wrong is a bug in the settings presented as a lesson, so the soundest single move is always a fallback.

**A pinned root does two jobs on purpose.** "Practise the Two Knights" means both *play the moves that reach it* and *do not wander into the Giuoco*. The moves that reach a pinned root are played for you — being asked to replay four moves you already know, every run, is the "jumping between positions" complaint in reverse. Pinning is available from the board and from any node of the progress tree.

#### Same revision — progress as a tree

The flat per-line rollup was worse than it looked. An answer on move 2 belonged to *every* line sharing that prefix, so "Giuoco Piano: 78%" was mostly measuring moves that have nothing to do with the Giuoco. And it structurally could not answer the question the page exists for — *where* does my knowledge stop — because the shared trunk was averaged in with the branch.

`AnswerRow.lineIds` became `AnswerRow.path`: the moves played before the answer, which places it exactly once. `domain/tree.ts` builds the tree from paths, so nothing is asserted in advance about which lines exist. Each node carries what happened AT it and, folded up from below, everything beneath it — so a collapsed row is honest on its own and expanding it is what separates "I know the Italian" from "I know the first four moves of the Italian".

`weakSpots` answers "what should I train next" directly: the deepest failing nodes, with ancestors suppressed. If you fail on move 6, being told you also fail "somewhere in the Italian" adds nothing. Each one offers to pin itself as the next practice root, which closes the loop between the two halves of this change.

Three things done deliberately rather than conveniently:

- **No schema version bump.** `path` is not an index and Dexie stores undeclared fields as they are; bumping would have rebuilt the answers index for nothing.
- **Old rows are dropped from the tree, not placed at the root.** Answers written before paths existed cannot be located, and putting them at the root would make the root's numbers describe positions they never came from. The count of dropped rows is reported instead.
- **`aggregate()` was deleted, not left in place.** Two ways to compute the same numbers drift, and the flat one was the wrong one.

#### Same revision — a real bug found on the way

`freeplayLosses` did not filter `cpLoss < 0`. Negative means *the move was never scored*; the trainer already declines to log those, but the progress page computed its own free-play filter inline and did not. An unmeasured move counted as a near-zero loss can only ever flatter the rating — the exact failure that once reported 1639 on poor play. The rule now lives where the data is read, not only where it is written, and both callers share one definition.

`domain/lines.ts` survives as a legacy shim: naming runs and cards recorded before positions were tracked, and seeding the drill-research tab. Nothing in the training loop reads it.

**Testability.** `SessionConfig.classify` overrides where the book comes from, which is the only way to exercise a run offline now that there is nothing hardcoded — the same seam that made `findMistakes` testable. The session tests drive a synthetic Italian that branches at move 3 the way the real one does.


#### Revision 2026-08-19 — finding the position you mean

The tree made every position trainable. It did not make any of them findable: pinning worked only from a position already on the board, so "I want to drill the Scotch" meant playing into the Scotch first, which is circular.

`src/data/openings.json` — 1821 named openings with the moves that reach them, 156 KB raw and **27 KB gzipped**, bundled so search is instant and works offline. Built from `chess-eco-codes` (MIT, from pgn-extract's `eco.pgn`) by `scripts/build-openings.mjs`, which strips the source's FEN keys (a position is recoverable from its moves, and the keys were two thirds of the file), keeps the shortest move order per name, and **validates every entry by replaying it** — a name pointing at moves that will not play would pin the trainer to a position that does not exist. A test re-checks that on the committed file, so the artefact cannot rot away from the generator.

Matching is token-AND with prefixes, because that is how people type:

| Typed | Top hit |
|---|---|
| `two knights` | Two knights defence (C55) |
| `scotch schmidt` | Scotch: Schmidt variation (C45) |
| `schmidt scotch` | Scotch: Schmidt variation (C45) |
| `two kn` | Two knights defence (C55) |
| `najd` | Sicilian: Najdorf (B90) |
| `scotch najdorf` | *nothing* |

Order does not matter and punctuation is ignored — you should not have to know the separator is a colon. Every token must appear, so an impossible combination returns nothing rather than a confident wrong guess. Ranking prefers whole-word matches at word starts, then **shorter names**: someone typing "scotch" means the Scotch, not the Scotch Gambit Göring Attack. Verified in the browser — `scotch` returns Scotch opening, Scotch game, Scotch gambit, Scotch: Lolli variation, in that order.

Each result shows the ECO code, the line itself in figurine notation, and **who moves first from there**. Pinning is not a colour choice and a root where the opponent moves first is perfectly valid, but it should not be a surprise.

The index also backs a naming fallback in the run: the explorer names a position while it is common enough to have a name and then stops, and a run should not silently lose its label at that point. `nameForPath` inherits the most specific named ancestor.

Neither `playwright` nor `chess-eco-codes` is a devDependency. Both are needed once — the first for `scripts/board-check.mjs`, the second to regenerate the index — and `npm i` should not pull hundreds of megabytes for tools most runs of this repo never touch. Each script says what to install at the top.


#### Revision 2026-08-19 — the Scotch Mieses was in the index the whole time

Reported as missing under "scotch", "scotch mieses" and "C45". Three different problems wearing one costume.

**1. The result list was silently truncated.** "Scotch" matches 37 openings; eight were shown. `Scotch: Mieses variation` was somewhere past the cut. From the outside that is indistinguishable from "not in the index" — which is exactly the conclusion it produced. The limit is now 25 and, more importantly, **the count is reported**: *"37 matches — showing the closest 25."* A truncated list that does not admit it is truncated is a lie by omission, and this one cost a bug report.

**2. ECO codes were not searched at all.** `C45` matched nothing, because the code was never compared against anything. It now is — `C45` lists all 19 of that code, `C4` takes the whole band, and `c45 mieses` narrows to one. The code is matched **against the code only, never against the name or the moves**, or `C4` would drag in every opening that happens to play c4.

**3. `scotch mieses` already worked.** Verified in the browser before and after. That one was a stale build.

Also added while in here: **searching by moves**. Two or more SAN tokens are treated as a line rather than a name, so pasting `e4 e5 Nf3 Nc6 d4` — with or without move numbers — answers "what is this called?", shallowest match first so the opening comes before its variations. A single token stays a name search, since "e4" is ambiguous and "scotch" is not.

| Typed | Result |
|---|---|
| `scotch` | 25 of 37, Mieses included, count shown |
| `scotch mieses` | Scotch: Mieses variation (C45) |
| `C45` | all 19 C45 openings |
| `c45 mieses` | Scotch: Mieses variation |
| `e4 e5 Nf3 Nc6 d4` | Scotch opening, then its variations |

The general lesson, which belongs with §1.1: **a cap on displayed results is a claim about completeness unless it says otherwise.** The same rule already governs the coverage audit and the rating estimate — do not show a number derived from partial data without saying it is partial. A list is a number too.


#### Revision 2026-08-19 — the tree cost fourteen searches a move

Play became slow the moment the hardcoded lines went, and the reason was structural rather than incidental. Deciding what is acceptable at a position means knowing what each candidate costs, and the first version asked that question **six times at each end of every ply, sequentially, at depth 20**. Fourteen searches per move, each either a throttled round trip or — nine moves into a specific variation, where the Lichess cloud has often never been — a multi-second local search.

Four changes, in order of what they bought:

1. **The opponent's node is not evaluated unless a mistake is actually being offered.** The roll now happens *before* the book is fetched, because it decides whether the book needs evaluating at all: choosing a book reply is a question about frequencies. At the default 35% deviation rate that removes the cost entirely from about two thirds of plies.
2. **Candidates are evaluated concurrently.** They are independent questions, and asking them one after another was most of the wait.
3. **Classification searches are bounded by movetime (200ms).** A cloud miss now costs a fifth of a second instead of however long depth 20 happens to take. Four candidates, not six.
4. **The eval bar shares the classifier's cache entry.** The two were asking the same question about the same position with different parameters, so every ply paid for one answer twice.

Roughly fourteen sequential searches per ply becomes about five concurrent ones on a mistake ply and two otherwise.

**It is now measured rather than felt.** `data/cloudEval.ts` counts calls, cache hits, cloud hits and local runs; the trainer resets the counter at the start of each move and files the result in `schackal.dump()` under `views.train.lastMoveCost`. "Thinking takes a long time" is not something anyone can act on; "eleven calls, nine of them local searches, 6.2s" is.

#### Same revision — pinning got the two things it was conflating

**A pinned root did two jobs, and they are separable after all.** It is the subtree a run is confined to, and — optionally — the moves played for you to reach it. Wanting the second is not implied by wanting the first: practising the Scotch Mieses includes practising the eleven moves that reach it, and having them handed to you every run is the opposite of practising them. `playFromStart` is now its own toggle, and the filter still applies while you walk in, so a sound move that leaves the pinned line is refused with that as the reason.

**Roots are a list.** "Practise the Two Knights or the Scotch" is one intention, not two sessions, and interleaving unrelated openings is what makes you notice which one you are in — the same argument that made variations interleave within a single opening. Each run picks one of the pinned roots. While several are still live the accepted set is the union of the moves heading towards any of them: with two roots diverging at this ply there is a genuine choice, and forcing one arbitrarily would quietly drop the other from the session.

The old single `root` key migrates on load and is written back in the new shape once, so what is stored matches the type rather than quietly relying on the normaliser forever.

#### Same revision — a correct move underlined as a blunder

Reported with a dump: the last move underlined red, captioned "the mistake you were asked to punish", while the feedback said "Correct." and the phase was `book`.

`mistakePlies` was a set of **ply numbers**, and a ply number is not stable across a replay. Branch back to move 6, meet a different reply, and the marker from the old move 6 still sat on the new one. Markers are now keyed `ply|san`, so a stale entry cannot match a different move — and anything else keyed by ply alone (`lossByPly`) is cleared when a run branches. Sessions saved with the old bare numbers are discarded on load: a ply number cannot be checked against what was actually played, and marking the wrong move is worse than marking none.


#### Revision 2026-08-19 — durability, and the only number that is not circular

Direction set: **a personal tool now, built so that accounts stay addable.** No backend, no auth, no store presence yet; nothing decided that would be painful to add them to later. Opening it to other users would buy test data, which is a real reason to keep the option open — but it is not a reason to pay for a backend before the pedagogy has been stress-tested on one user.

That ranking put durability first, and looking at it turned up something worse than a missing feature.

**`exportAll()` was a backup that backed nothing up.** It exported `nodes`, `drills`, `attempts` and `games` — four tables that are empty and have been for the life of the app. It contained none of the answers, runs, scheduler state, mistake cards or analysed games. Wired to a button it would have handed back a file that looked like a backup, and the failure would only have surfaced on the day it was needed. Deleted, not fixed: a plausible-looking wrong thing next to the right thing is worse than nothing.

Alongside it: **IndexedDB is evictable by default** and the app never asked otherwise. Everything it knows about you sits in storage the browser is entitled to reclaim under pressure. `requestPersistence()` now asks on load and the Data panel reports the answer honestly — including "the browser said no", which is a thing browsers do until a site has been used a few times.

**The merge is the part that cannot be fixed later.** One rule governs `domain/merge.ts`:

> When two copies disagree about how well you know something, believe the less flattering one.

The asymmetry is deliberate and is not a tie-break by recency. Restoring a backup that says you retired a card you have not learned costs you the card — you stop being asked and never find out. Restoring one that says you still owe it costs one repetition. Those are not equal. So `streak` takes the minimum, `dueAt` the earliest, `lapses` the maximum, and `retired` survives only if **both** copies agree. Facts about the past — `lastSeen`, `reps`, `firstSeen` — take the true value, because they are not claims about mastery. Answers and runs are events and are never reconciled at all: two devices that both recorded an answer both witnessed it.

Verified in the real database, not just in unit tests: a backup asserting `retired: true, streak: 3` restored over a card that had since lapsed leaves it `retired: false, streak: 0, lapses: 4`. Restoring a file onto itself adds nothing. A file from a future version is refused with a reason rather than partially understood. The Lichess token is not in the file — it is a credential, not data.

#### Same revision — measuring whether the app works

Every number the app showed measured how you do *inside* the app, which is circular: drilling a position until you can answer it proves you can answer it when asked.

`domain/transfer.ts` asks the other question. For any position: mistakes per game in your imported games **before** you first drilled it, against **after**. Mistakes below the position count too — drilling the Two Knights should show up as fewer mistakes anywhere in the Two Knights, not only on the move drilled.

**The denominator is the entire point.** "Two mistakes in the Italian last month and none this month" is meaningless if you played nine Italians then and one now, so games that reached the position are counted whether or not they went wrong. That required storing each analysed game's moves (`ImportedGameRow.moves`); the twenty games imported before that are excluded from the measurement entirely and reported as excluded, rather than silently shrinking every denominator.

It refuses to report a change until there are at least four games on each side. Splitting a small sample in two produces two smaller samples, and at this volume the honest answer is usually "not yet" — which is stated, along with how many games are still needed. §7's original "transfer rate" was demoted for exactly this reason; it returns now because there is finally data behind it.

This is also the metric that should decide what gets built next, rather than us guessing.


#### Revision 2026-08-19 — adaptive layout

The app assumed a 1180px window. The board was hardcoded at 420 in four places, the two sidebars carried `minWidth: 300` and `minWidth: 260`, and seven tabs sat in a row that could not wrap. Below about 900px the whole page scrolled sideways.

**The board sizes itself from its container, not from the window.** `BoardPanel` measures itself with a `ResizeObserver` and clamps to [240, 520]. The two differ constantly — a sidebar appears, panels stack, a keyboard opens — and measuring the thing the board actually lives in means the arithmetic is done once instead of guessed at every call site. `available === 0` means *not measured yet*, not *no room*: rendering a zero-width board for one frame makes chessground animate up from nothing.

**Height binds too, and only in landscape.** A phone turned sideways is 851×393; a board sized purely from width would put its own controls off the bottom. The size is the smaller of what the width and the height allow.

Three rules replaced one breakpoint, because they answer different questions:

| | Means | Used for |
|---|---|---|
| `phone` | narrow **and** portrait | padding, bar width, dropped tagline |
| `stacked` | narrow **and** taller than wide | panels below rather than beside |
| `touch` | the pointer cannot hover | captions on icon controls |

`stacked` is not simply "narrow". A landscape phone is 851px wide, and stacking there spends the scarce dimension to relieve the plentiful one.

Two things this turned up that were wrong at every size, not just small ones:

- **A 768px tablet got a *smaller* board than a 393px phone** — 304px against 312. The two columns were splitting the width, and at tablet widths each half was worse than a phone's whole. Below `NARROW_MAX` the sidebar now takes a row of its own: the tablet went to 520.
- **The stat tiles used `minWidth: 165` in a wrapping flex row**, so on a phone each claimed a full line and four of them pushed everything else 800px down the page. A `repeat(auto-fit, minmax(150px, 1fr))` grid gives two columns at 360px and four on a laptop with no breakpoint to keep in sync.

**Touch is not a small mouse.** The toolbar's icons carried their entire meaning in a `title`, which needs hover — on a phone it is simply invisible, leaving eight unlabelled glyphs to be learned by pressing them. `labelled` adds a fixed one-word caption under each icon (fixed, so the strip still does not shift) and raises the targets to 50px. Board coordinates are dropped below a 360px board, where a 40px square already has a piece in it and the label is clutter rather than reference. Text inputs are 16px, below which mobile browsers zoom the page on focus and leave you scrolled sideways.

Verified at six sizes — 360×740, 393×851, 851×393, 768×1024, 1024×768, 1280×800 — for horizontal overflow, board size and whether the whole board is on screen without scrolling. All clean; the regression harness still passes at desktop width.


#### Revision 2026-08-19 — three from a phone

**"Play from here" dropped you out of training.** `playFrom` hardcoded `phase: 'freeplay'`, which is correct for the review page's *play this out against the engine* and wrong for the trainer's *play from here*. Same function, two genuinely different requests: free play has no book and no expected move, so `expected` came back empty and *Show me* was greyed out with nothing to show. `playFrom` now takes the phase, and the opponent's reply comes from the book rather than the engine when training resumes. The review page keeps the old behaviour, which is now a default rather than an assumption.

**Double-clicking a move resumes from it.** Single click previews, double click plays on. The preview was already there; asking for a second control to reach a position you have already clicked on was the friction.

**The dev server was not reachable from a phone.** `npm run dev -- --host` looks right and is not: npm eats the forwarded flag ("Unknown cli config") and vite starts on localhost anyway, which from the phone is indistinguishable from the site being down. `server.host: true` belongs in `vite.config.ts` — a property of how this project is developed, not something to remember on the command line. `npm run dev` now prints a `Network:` address.

`strictPort: true` went back in at the same time; it had been recorded in this spec but was not in the file. Without it vite falls forward to 5174 on a busy port, and since localStorage is per-origin that is a different app — the Lichess token and the practice settings both silently vanish. That has already cost an hour once.


#### Revision 2026-08-19 — castling had two spellings

Reported from the phone: in the Scotch, Schmidt, the board would not let a castle be played.

The board was not refusing it. **Castling has two UCI spellings**, and chessops uses the one nothing else here uses:

| Source | Says |
|---|---|
| Chessground (the board) | `e1g1` |
| Lichess explorer | `e1g1` |
| Stockfish | `e1g1` |
| chessops (`applySan`) | `e1h1` — king takes rook, the form that survives Chess960 |

So `applySan(fen, 'O-O').uci` was `e1h1` while the board reported `e1g1`, and every place that builds an expected move from SAN and then compares strings rejected the castle. The board snaps back on a rejected move, which reads exactly like it refusing to let you move.

Fixed in two layers, because one is not enough:

1. **`applySan` now emits the standard spelling.** One canonical form, chosen to be the one three of the four sources already use.
2. **Move comparison goes through `sameMove`**, which normalises both sides before comparing. Cards and saved sessions written before the fix still hold `e1h1`, and rewriting them all would be a migration for something that can simply be tolerated.

Both spellings remain *playable* — `applyUci` accepted either all along — so nothing already stored is broken by this.

It was worth noticing that this had nothing to do with the phone. It surfaced there because that is where the castling position came up, and it would have behaved identically on the laptop. The dump now also reports **chessground's own `dests` map** rather than only our recomputation of it: `describePosition` derives the legal moves from the FEN and will happily call a move legal that the board was never told about, which is precisely the divergence worth being able to see.

#### Same revision — three small things from the same session

**The control strip fills the row on a phone.** Fixed-width buttons wrapped after six and left a third of the last row empty. They now flex between 52 and 90px, so they stay evenly sized and evenly spread at any width — and they still do not resize as the run changes, which is what the fixed widths were protecting in the first place.

**Practice settings have a Reset.** Six controls and a list of pinned openings is enough state to want a way back to a known position.

**The mistake deck filters by category.** `phase` already distinguished them; naming them is what made it filterable. Openings, Refutations, Real games and Free play are genuinely different exercises, and each chip carries its own due/total count so an empty category is visibly empty rather than a filter that appears to do nothing. **Nothing selected means everything, not nothing** — a cleared filter must never look like a deck that has lost its cards.

Not fixed: `localhost:5173` still fails on the reporter's machine while the LAN address works. Vite binds `0.0.0.0`, so this is a Windows name-resolution quirk (`localhost` resolving to `::1` while the listener is IPv4). `127.0.0.1` is the workaround; the LAN address is what the phone needs anyway.


### M8 — Installable (PWA)

The mobile layout made the app usable on a phone; this makes it *live* on the phone, rather than being a tab pointed at a laptop that has to be awake.

**What is there.** A web app manifest, a hand-written service worker, an install prompt and an update prompt.

| File | What it does |
|---|---|
| `public/manifest.webmanifest` | Name, standalone display, theme colour, icons |
| `public/sw.js` | Runtime caching; no build-time precache |
| `src/registerSW.ts` | Registration, update detection, install prompt, and *why nothing is offered* when nothing is |
| `src/components/InstallBar.tsx` | The two prompts, and nothing at all the rest of the time |
| `scripts/build-icons.mjs` | Icons from one inline SVG, rendered by headless Chromium |
| `scripts/pwa-check.mjs` | Verifies the manifest, the worker, **and an offline boot** |

**Runtime caching, not a precache manifest.** The standard setup lists every built file and downloads all of it on first load. Vite content-hashes filenames, so that list can only come from a build plugin — and it would include the 7MB Stockfish WASM, which most first visits never touch. The worker caches what is actually requested instead. The cost is that the first offline load only has what you have already used; the benefit is that installing the app does not spend 7MB of a phone connection to do it.

Documents are network-first so a deploy is picked up rather than shadowed by a shell that never expires. Hashed assets are cache-first, because the hash *is* the version. Cross-origin requests are not touched at all: caching an evaluation behind the app's back would show a stale number with no way to tell it was stale.

**The new worker waits.** `skipWaiting()` on install would swap the code under a drill in progress and reload the page to do it. Instead the app says "a new version is ready" and the reload happens when you ask for it. The reload is guarded by a flag, because the *first* install fires `controllerchange` too, via `clients.claim()` — reloading there would bounce the page a second after you opened it, for no reason you could see.

**Two icon files, not one declared twice.** Android's adaptive icons crop to a circle, squircle or rounded square depending on the launcher. `icon-maskable-512` puts the mark inside the middle 80% so cropping cannot clip it; `icon-512` is the uncropped mark for everywhere else.

**Base-relative throughout.** `start_url` and `scope` are `./`, the worker derives its base from `self.registration.scope`, and registration uses `import.meta.env.BASE_URL`. A deploy under a subpath — which is what GitHub Pages serves — works without a parallel set of paths to keep in step.

#### The honest limits, stated in the app

**Offline is partial and the app says so.** Train needs the Lichess explorer to know the book and cloud eval to judge a move. With the network off you get the Mistakes deck, Progress, Review, and any position already in `explorerCache`. That is real, and it is not the whole app. Discovering the difference mid-drill would be the worse version of this.

**Installing needs https or localhost.** A service worker will not register over `http://192.168.1.38:5173`, so on the LAN address there is no install prompt and no offline mode — the phone is still tethered to the laptop being awake. `registerSW` reports *which* condition failed in `pwaState().reason` rather than leaving the button silently absent, because **an absent control is a claim as well**: it says "this app cannot be installed", when the truth is "not from here".

The check script runs against `vite preview` on localhost for the same reason. Testing over the LAN address would prove nothing either way.

#### On verification

`pwa-check.mjs` asserts the offline boot, not just the manifest and the registration. Both of those are easy to get right and neither one means the app opens with the network off. It caught the reload loop on first install immediately — the check died on "execution context destroyed", which is what a page reloading under you looks like from the outside.

#### The deploy is a new origin, and that costs you your data

Published to GitHub Pages — https, which is the only reason any of the above works on a phone. `BASE_PATH` is set from the repo name; `pwa-check.mjs` takes the same variable, so the subpath deploy is verified rather than assumed.

**Deployed from a branch, not from a runner.** The Actions workflow was written first and worked, in the sense that it was correct; it never ran, because the account's Actions allowance was spent and the build job was refused before it started. Both runs showed green in the Actions *list* while the run page said `build — Failed, deploy — Skipped`, which is worth recording as a small lesson in reading a status from the summary view.

`scripts/deploy-pages.mjs` does the same work on the machine that already has the code, for nothing. The build was always local anyway; a runner was only ever doing `git push` on our behalf.

Three properties worth having in a deploy script:

1. **It writes the branch through a git worktree.** Checking out `gh-pages` would swap the working tree to a branch containing nothing but build output, and an interruption there leaves you standing in it wondering where the source went. A worktree is a separate directory sharing the same object database, so the tree you work in never moves.
2. **It refuses to push an identical build.** Vite hashes asset filenames, so identical output produces an identical tree and an empty commit. Pushing one would put a deploy in the history that changed nothing — the log should say what happened, not merely that something did.
3. **It says when it is publishing uncommitted work.** `Deploy a1b2c3d+dirty` in the commit message, and a warning before the build. A site that corresponds to no commit is a fact you want stated, not discovered later when the repo and the deployment disagree.

The branch is orphaned on first deploy, so build output never enters the source history and a clone does not drag every past build along with it. The workflow file is kept but **dormant** — `push` trigger commented out, `workflow_dispatch` retained — because the difference between dormant and live is one uncomment, and because running the tests on every push is worth having back when the allowance resets.

The part worth stating plainly: **`vilhelmc.github.io` is a different origin from `localhost:5173`.** localStorage and IndexedDB are per-origin, so the deployed app starts with no Lichess token, no mistake deck, no practice settings and no imported games. Nothing is lost — it is still on the laptop — but it does not follow you across.

The migration path is the backup we already have: export from the local app, restore into the deployed one. `restoreBackup` merges rather than replaces and takes the less flattering copy of any disagreement, so doing it twice, or in either direction, cannot inflate what it says you know. This is the first time that property has had a real use.



### M9 — What the deploy broke, and what the checks did not catch

Six reports from the first phone install. Five were surface; one was structural, and it was the same bug three times.

#### The engine was loaded from a path that does not exist

`CONFIG.engine.workerPath` was `'/engine/stockfish-18-lite-single.js'`. Correct at the origin root; one directory too high under `/Schackal/`. Vite rewrites the asset URLs it can *see* — those in `index.html` and in imports — but a path held in a config object as a plain string is invisible to it and ships unchanged.

The worker 404'd, so it never spoke, so the app timed out waiting for `uciok`. **The symptom was a timeout, and a timeout reads as "the engine is broken" rather than "the file is not there."** That one substitution is what made this cost an evening instead of a minute, and it explains all three reports: the Checks tab, Train's options panel, and — silently — every imported game.

Three changes, in increasing order of how much they matter:

1. `src/base.ts` owns the rule. `assetUrl(path)` resolves against `import.meta.env.BASE_URL`; nothing else builds a URL to our own files. It tolerates a leading slash rather than producing a broken URL from one.
2. The worker reports `onerror` and races it against the `uciok` wait, so a missing file says *"Engine failed to load from &lt;url&gt;"*. **The URL is the whole answer, so the message contains the URL.**
3. A failed `init()` no longer poisons the session. `ready` cached the rejected promise, so every later attempt re-threw the first error and only a page reload could clear it.

#### "0 cards from 20 games" was a lie the program told about the user

The import found nothing because nothing could be evaluated, and reported it in the language of a clean result. `defaultAnalyse` caught every engine error and returned `null`; `findMistakes` skipped every null; the tally came out zero. Each step was locally reasonable and the composition was a falsehood — a sentence about how Will played, produced by a program that had measured nothing.

This is the sharpest instance yet of §1.1's *honest numbers or no numbers*, and it earns a rule of its own: **a measurement failure must never be reported in the vocabulary of a measurement.** Zero found and zero measurable are different facts and need different sentences.

- `findMistakes` now returns `{ mistakes, measured, unmeasured }`. An empty list with `measured: 0` is a dead engine; an empty list with `measured: 34` is a clean game. The type makes the two distinguishable at the point they are produced, not reconstructed later.
- `importGames` calls `engine.init()` **once, up front**, and returns `engineError` if it fails. A dead engine fails every position identically, so it is worth one check before the loop rather than forty failures inside it.
- The UI has a distinct panel for it, which says outright that nothing here describes your play.

#### The checks passed, and the app did not work

`pwa-check.mjs` verified that the manifest parsed, the worker registered and the app booted offline. All true, all shipped, all useless: **it asserted that the app LOADS and never that the app WORKS.** Two things now close the gap.

`test/basePath.test.ts` bans root-absolute paths to our own assets anywhere in `src/`. The rule is mechanical, so it is enforced mechanically. Verified by reintroducing the original line and watching it fail.

`pwa-check.mjs` boots Stockfish and waits for `uciok`. Critically it reads the URL from **the app's own debug dump** rather than recomputing it — a check that derives the path the same way the app does would have agreed with the bug and passed. Verified both ways: 404 with the old resolution, `uciok` with the new.

Two smaller lessons from writing that check. It spawned `npx vite preview`; killing the npx wrapper left the real server holding the port, so the next run measured the *previous* build — test infrastructure that does not fail but lies. It now spawns Vite's entry directly and refuses to start if the port is occupied.

#### Layout: nine buttons do not fit, and saying so is the fix

The control strip still wrapped. It will: nine controls at a touch-sized target need about 516px and a phone gives 369. The options were 36px buttons that fingers miss, or a menu that hides controls behind something you must know about first — the same move §M7 rejected for the tabs.

So it still wraps, and the fix is that it wraps *evenly*. `columnsFor()` balances the count across the rows it is going to take anyway: 5 and 4 in aligned columns rather than 6 and 3 with a third of the last row empty. **"Spills over" was an objection to raggedness, not to the second row.**

#### The move list is a scoresheet now

Wrapped chips pack the most moves into the least space, which is the wrong trade. Every row began at a different move number, so finding White's 7th meant reading the strip instead of looking down a column. It is now a grid with fixed tracks — number, White, Black — so **position on the page carries information**.

The move number comes from `ply`, not from array position. A list resumed at an even ply starts on Black's move, and the old code numbered it as though Black had opened the game. An empty White cell now holds the column open, which is what the ellipsis in printed notation has always been for.

#### Both labelling gaps were the same pedagogy failure

Progress tree rows showed a move number only for White. Black's number was left to be derived from indentation — precisely the *"the move number tells you whose turn it is"* reasoning §1.1 exists to reject. Both colours are numbered now, `7.` and `7…`.

Neither the tree nor the mistake deck said which *line* a position belonged to. Cards mined from real games were the worst case: labelled `lichess vs someone, 2026-08-19`, which says where the card came FROM and nothing about what it is ABOUT — so a game-mined card could never connect to the book line it belongs to, which is the one thing that would let the deck reinforce the tree instead of sitting beside it.

Both now derive the name from the path via `nameForPath`. In the tree the name is printed only where it *changes* from the parent, because a name repeated down every row of a trunk buries the one row where the line actually became something else — and that row is why a tree is drawn instead of a list.

**A gap worth knowing about:** the bundled ECO list has no entry for the Italian junction itself (`e4 e5 Nf3 Nc6 Bc4`) — only for variations below it, and for `Two knights defence` one ply later. So that position labels as `King's knight opening`: the most specific named ancestor, which is honest but not what a player expects to read. Adding junction names means inventing them, so it is left as a known gap rather than silently patched.


### M10 — Sign in with Lichess, and why that is not accounts

The question that prompted it was whether two people sharing the app would interfere with each other. **They do not, and never could:** every byte of state is `localStorage` and IndexedDB, scoped per origin, per browser, per device. There is no server and nothing shared. Two people on two devices are independent by construction, and the only collision available is two people using the same browser profile — which is the same collision any website without login has.

So isolation was never the problem. The problem was that a second user could not get past the first screen.

#### The wall was the token, not the account

Every explorer endpoint returns 401 anonymously (§8, verified by probe). Getting a token meant leaving the app, finding `lichess.org/account/oauth/token`, understanding what a scope is in order to decide to tick none of them, creating a token, copying it, and coming back. That is a wall for anyone who is not the person who built the app, and it is a much higher one than not having an account.

**Lichess supports unregistered public OAuth clients** — no client secret, any unique string as the client id, `S256` as the only accepted challenge method. So the whole flow runs in the browser with no server anywhere, which means this is not a step towards a backend; it is the thing that makes a backend unnecessary for longer.

`src/data/lichessAuth.ts`. The client id is the app's own URL, which doubles as documentation on the consent screen: whoever is approving can see where the request came from. The verifier lives in `sessionStorage`, not `localStorage` — it is single-use and must not outlive the tab, because a verifier left lying about is a credential left lying about. The `state` check runs before the exchange is attempted, and the query string is cleared on return, since a one-time code left in the address bar gets bookmarked and shared by accident.

**Zero scopes.** The explorer needs a token to *exist*, not a token that can do anything, and `/api/account` reads without one. Asking for nothing is both the smallest possible request and the most honest consent screen: the person signing in is told, by the emptiness of the list, that the app cannot play, message or change a thing.

Two decisions that look like omissions and are not:

- **Sign-out does not revoke.** Lichess offers `DELETE /api/token`, but a button labelled "sign out" that destroys a credential the user may also have pasted in by hand would be doing more than it says. It forgets the token locally; revoking happens on Lichess, where the whole list of tokens is visible.
- **The pasted-token field stays.** Signing in obtains the same credential without leaving the app; it does not become the only way in, and the app keeps working for someone who would rather not authorise anything.

#### The sentence under the button is the important part

"Sign in" invites the assumption that there is now an account holding your data. There is not. Signing in on a phone and on a laptop gives two independent decks; Lichess is the identity provider, not our storage, and carrying a deck across devices is still the backup file. Someone who believes otherwise will eventually lose a deck to a reinstall and be right to be annoyed. So the panel says outright that signing in does **not** sync anything — **the disclaimer is a feature of the deliverable, not decoration on it.**

#### On testing an OAuth flow with no network

The exchange itself needs Lichess and cannot run in the build container, so what is tested is everything around it: the S256 derivation against **RFC 7636's own appendix B test vector** — if that passes, nothing else about PKCE is subtle — plus verifier length and alphabet, and the refusals. A code whose `state` does not match, or which arrives with no stored request at all, must not even attempt the exchange, and the tests assert `fetch` was never called rather than merely that the result was a failure.

`test/lichessAuth.test.ts` stubs the four browser things the module touches — two storages, `location`, `history.replaceState` — instead of pulling in jsdom. It keeps the suite dependency-free and the stub doubles as the list of what this module is allowed to depend on; if that list grows, the stub is where it becomes visible.

The end-to-end check clicks the real button, intercepts the redirect, and asserts the parameters: `response_type=code`, `S256`, a challenge and state of proper length, `redirect_uri` equal to the app's own URL **including the subpath**, and no scope parameter at all. Verified at both `/` and `/Schackal/`, because the redirect URI must match exactly at the exchange or Lichess refuses it — and that is precisely the kind of thing that works on a laptop and fails on the deploy.

One piece of test-infrastructure learning: registering a Playwright route on the main page broke the *offline* check with `ERR_INTERNET_DISCONNECTED`, because interception and the service worker do not coexist — the worker stopped serving the reload. The sign-in check runs last, in its own browser context, so the offline result keeps meaning what it says.


### M11 — Closing the data loop

The transfer measurement was finished in §M6 and has been sitting idle ever since, because it had nothing to read. This is the piece that feeds it.

#### Why this and not the scheduling work

Both were on the list, and the ordering is not a matter of taste. **A scheduling improvement written next month is exactly as good as one written today. A month of games that were never imported is a month of evidence no amount of later work recovers.** Game history is the only time-gated work in the project, so it goes first — everything else can wait without cost.

Until now, importing happened when someone remembered to press a button.

#### The engine belongs to whoever is looking at the screen

Analysing a game runs Stockfish over every one of your positions in it. There is one engine and it is serialised, so a background import queued ahead of a drill move would put a whole search between the move and its answer — reintroducing exactly the latency §M5 was spent removing.

The rule is blunt and states in one line: while the Train tab is mounted, the import stands down. `markTraining(true)` sets it; `findMistakes` and `importGames` both check `shouldCancel` between positions, so it yields within about one search rather than at the end of whatever game it had reached.

**That rule was wrong on its own, and the review caught it before the deploy did.** Train is the tab the app *opens on*, so the startup check would have found `training` every time and the import would never have run at all — for anyone who trains and closes the app, which is the entire intended usage. Worse, it fails identically to working correctly: "no new games" and "never ran" are the same silence. Releasing the flag now schedules a pass five seconds later, so leaving Train for any other tab is what triggers it.

Otherwise: once a day, at most eight games a pass, never without a token, a username and a network. The interval counts the last **attempt**, not the last success, so a failing import cannot retry on every page load and turn a rate limit into a worse one.

#### Quiet is one keystroke from broken

An import that has silently failed for three weeks looks exactly like an import that has found nothing new. `SyncStatus` therefore shows the last successful sync as a **date**, never as "up to date", and shows a failure in full rather than folding it into silence. This is the same rule as §M9's — a failure must not be reported in the vocabulary of a success — applied to a process nobody is watching.

#### A count is not coverage

`dataCoverage` reports the span alongside the number. Four games from one evening and four spread over two months are the same count and completely different evidence: split into before/after windows, the first pair is two halves of the same afternoon. A bare count cannot tell them apart, so it does not get to stand alone.

`gamesStillNeeded` turns an empty report into a shortfall — "three more games through a drilled position" rather than "no results yet". **An empty result reads as a verdict on the training when it is a fact about the sample**, and the distinction is exactly the one this measurement exists to protect. It returns `null`, not zero, when nothing has been drilled at all, because that is a third state needing a third sentence.

#### The twenty games with no moves

They were imported before moves were kept, so nothing can tell whether they reached any position, and they are excluded from both windows. That is correct and it is also twenty games of evidence sitting unused.

Repair re-fetches far enough back to reach the oldest of them, with `force`, because those rows are marked analysed and an ordinary run skips precisely the games that need fixing. The reach is bounded, and some may be older than the API will return — which is counted and reported afterwards ("recovered 14 of 20, the remaining 6 are beyond the API window") rather than left as a quietly smaller number.


### M11.1 — The icon

Replaced the placeholder knight with **Chesshire** (`assets/chesshire.svg`), drawn for the project: a Cheshire grin whose teeth are chessboard squares. It earns the slot the knight did not — the grin is simultaneously a cat's smile and a rank of alternating light and dark squares, which is the app's subject rather than merely a chess-adjacent object, and it survives being shrunk in a way a horse's head does not.

**It was saved into `dist/`, which would have destroyed it.** `vite build` empties the output directory on every run and the deploy script clears the published branch before copying into it — so the drawing was one `npm run build` away from being gone, with no copy in git because `dist/` is gitignored. It now lives in `assets/`.

Three things in the generator worth keeping:

**The bounding box is measured, not assumed.** Padding a source by a guessed fraction pads whatever margin the artist happened to leave, so the maskable icon's safe zone would mean something different for every drawing. The renderer is asked for `getBBox()` and the padding is applied to that, which makes 15% mean 15% regardless of how the file was drawn.

**The artwork is recoloured without being edited.** The paths carry `fill="#000000"` as a presentation attribute, and a CSS rule outranks a presentation attribute — so one `#art path { fill: … }` inverts the whole drawing to light-on-ink while the source file stays byte-for-byte as delivered. Re-exporting from the drawing tool never has to account for how this app happens to use it.

**Maskable padding came down from 21% to 15%.** The safe zone is the middle 80%, so 10% each side is the requirement; 21% cleared it by so much that the mark became a speck in the middle of a tile, which is the other way to fail an adaptive icon.

#### An honest limit

It reads as a face down to about 48px. At 32px — a browser tab — the checkered teeth fall below one pixel each and the grin becomes texture. That is a property of the drawing, not of the pipeline, and the fix would be a separate simplified mark for small sizes rather than anything the generator can do. The primary target is a phone home screen at 192 and 512, where it is at its best, so this is recorded rather than solved.


### M12 — The tab bar was a record of how the app was built

Seven destinations, three of which announced themselves as scaffolding: *"M0 — dependency checks"*, *"M2 audit"*, *"Coverage audit"*. They were built to prove the pipeline worked, and they did — the endpoint probe is what found the explorer's 401, and the analysis check is what surfaced the missing engine file. **They are worth keeping and they are not features.**

That is a reasonable thing for a tab bar to be while you are the only person who will ever see it, and an unreasonable one the moment you send someone a link.

#### Four tabs: Train, Mistakes, Progress, Settings

The three instruments moved into Settings, folded shut, under a heading that says what they are. **Demoted rather than deleted, and deliberately not dev-only** — every one of the last three bugs was found on the phone, and hiding them from production builds would have meant not having them exactly where they were needed.

**Review stopped being a peer of Progress and became a drill-down of it.** It replays a training session, which is something you go and look at *because* Progress told you something; a link from there matches how it is actually used, and takes a seventh of the top-level space back. (Worth noting for anyone reading the code: Review shows *runs*, not imported games — the name suggests otherwise.)

Four fit across a 393px phone without scrolling, which is the point of the exercise. A destination you have to swipe sideways to discover is one you forget exists.

Two things fell out of the move that were nothing to do with structure:

- Train's empty state said *"Save a Lichess token on the Checks tab first"* — a tab that no longer exists, in red, with no way to act on it. It is now an empty state with a button that goes where the problem is solved. **A message naming a place is worse than a control that takes you there**, and it rots the moment anything is renamed.
- That message and the banner above the tabs said the same thing twice. The banner went; the one in the place the problem occurs stayed.

#### A vocabulary, because "mostly agreed" is not a design system

Six colours were re-declared at the top of nine files and 450 inline style objects each decided their own padding, radius and type size. Nothing was wrong. The problem is that a panel on Progress and a panel on Mistakes were the same *by coincidence*, so they drifted apart every time either was touched.

`src/ui/theme.ts` names values by role — `space.card`, not `12` — so changing what a card's padding means changes it everywhere at once. `src/ui/primitives.tsx` is six shapes: `Section`, `Panel`, `Note`, `Field`, `Button`, `Disclosure`, plus `Stat`/`Row`/`Empty`. Deliberately small: a seventh would mostly be one of the six with a different opinion, and **a component with eight boolean flags is a stylesheet wearing a costume**.

Two details worth keeping:

- `Field` renders a real `<label>` wrapping its input, so tapping the words moves focus. On a phone that roughly doubles every target in a form for no layout cost.
- `Disclosure` is a native `<details>`, not state plus a chevron: keyboard accessible, findable by the browser's own in-page search *while closed*, and incapable of getting stuck in a state React forgot about.

**Unifying the colours changed some of them, on purpose.** The old `GOOD` was `#0ca30c` and the old `CRITICAL` was `#d03b3b` — both thin against white. They now resolve to `color.good` and `color.bad`, which are darker and pass contrast. Every file keeps its local `const GOOD = color.good` alias, so the diff is one line per constant and the values have exactly one home.

#### What is NOT done

Layout inside Train, Progress and Quiz still uses inline styles; only the colours were unified there, plus the empty states and `SyncStatus` rebuilt on the primitives. Restyling those screens onto `Section`/`Panel` is the remaining half and is deliberately separate — Train alone is 1400 lines and rewriting its layout in the same pass as the navigation would have made any regression impossible to attribute.

#### Looking, as a build step

`scripts/shots.mjs` (`npm run shots`) screenshots all four tabs at phone and desktop widths into `.shots/`. Not an assertion — a way to look. **Every layout bug in this project so far was found by a person opening the app**, never by the test suite, which only ever knew that the DOM parsed. This makes opening it cheap enough to do after every change.

Its honest limit: the container has no training data, so the shots are all empty states. Populated layouts still have to be checked on a real device with a real deck.


### M13 — Chesshire, dark, and an import that survives you

#### An import that keeps going

Import state — `running`, `progress`, `result` — lived in React state inside the `ImportGames` component. Switching tab unmounted it, and three things followed, of which only the first was obvious:

1. The work carried on and kept writing to the database, but every progress update went to a component that no longer existed.
2. Coming back showed an idle screen, because a freshly mounted component starts idle. **The import looked cancelled. It was not.**
3. Pressing Import again then started a *second concurrent run* on top of the first.

Analysing games takes minutes. Any design that requires someone to sit and watch a tab for minutes is going to be wrong the first time they do anything else, which is immediately.

`src/data/importRunner.ts` owns the run at module scope; views subscribe. **Unmounting a view is now unrelated to whether the work continues**, which is the correct relationship between the two. The progress bar therefore also appears for a run you did not start on this screen — a background pass, or a manual one from before you switched tabs.

**Explicit beats implicit.** A background import still stands down when training starts, because the engine is single and serialised and a drill move must not queue behind a game analysis. A run you pressed a button for does not: you asked for it by name, and having it silently abandon itself because you looked at another screen is the same failure in a different costume. `kind: 'manual' | 'background'` is the whole of that distinction.

The bar is determinate only once the total is known. During the fetch there is no denominator, so it runs indeterminate rather than inventing a percentage — §1.1 again, at the smallest possible scale.

#### Dark mode cost nothing, because of a decision made in M12

The colour tokens became `var(--ink)` and friends, with the values in `index.css` under three cascading states: `:root` for light, `prefers-color-scheme: dark`, then `[data-theme]` last so an explicit choice wins in both directions.

**No component changed.** An inline style saying `color: var(--ink)` is resolved by the browser against whichever palette is in force, so the 450 inline style objects that looked like technical debt in M12 turned out to be theme-agnostic by accident. This is the payoff for having centralised the tokens a step earlier rather than reaching for dark mode first.

Three things worth recording:

- **Dark is not light inverted.** Pure white on pure black vibrates, so the text stops short of white and the page short of black. Accents lift, because a colour that reads solid on white looks muddy on dark. The `*Soft` fills become dark tints — a pale wash would glow like a bulb in the middle of the screen.
- **`color-scheme: dark` earns its line.** It is what makes the browser's own widgets — number inputs, scrollbars, focus rings — follow. Without it the form controls stay light and look like a rendering fault.
- **The one real constraint:** a `var()` string cannot be concatenated into a new colour. `` `${color.bad}10` `` used to make a 6% tint and now produces nothing at all. Four places did this; they use the `*Soft` tokens now, which is what those exist for. Every hardcoded `#fff` background had to go the same way — `Button`'s default surface was invisible on a dark page.

The control is three-way, not a switch. "Follow the system" is a real answer that a two-state toggle cannot express, and the usual workaround — a toggle that quietly stops following once touched — hides the most useful setting behind an interaction nobody knows to avoid. A phone that goes dark at sunset is not always right about the room you are in.

The theme is applied in `main.tsx` **before render**, not in an effect: applying it after the first paint is exactly the flash of the wrong theme that every implementation is judged by.

#### The name

**Chesshire.** It matches the mark, which the previous name never did — the icon has been a Cheshire cat since M11.1 while the app was called after a jackal. It is also a pun that works in the language the app is written in.

The repo is renamed too, and one thing about that is worth stating because I got it wrong first time and said so: **`/Schackal/` and `/Chesshire/` are the same origin.** Storage is keyed by scheme, host and port; the path is not part of an origin. So the deck, the token, the settings and the imported games all carry across untouched. What actually breaks is narrower: an installed copy points at the old `start_url` and needs reinstalling, and old links depend on GitHub's redirect for a renamed repository.

`BASE_PATH` is derived from `git remote get-url origin`, so the deploy follows the rename with no edit — which is the payoff for deriving it in M8 rather than hardcoding it.

#### The mark, in the app

The header shows `icon.svg` — the same file the home-screen icons are generated from, so the thing you tap and the thing you land on agree.

#### Screenshots are half as useful in one palette

`npm run shots` now takes every tab at both widths **and both colour schemes**. A palette nobody looks at is a palette nobody has checked, and the first pass through it found two real faults: inactive tab labels hardcoded to `#444`, which on a dark page reads as disabled rather than available, and white-on-white buttons.


### M14 — Accuracy, by Lichess's method

Research first — the landscape is written up in `METRICS.md`, which is worth reading before adding any metric. The two findings that shaped this milestone:

**Nobody measures transfer.** Checked across Chessable, Chessbook, Aimchess, Chess Position Trainer, Listudy, Chess Tempo and DecodeChess. Every metric any of them shows is effort inside the app, a static property of the repertoire artifact, or a snapshot diagnostic of current play. The nearest miss — Chessbook checking your online games against your repertoire — measures *adherence*, not a delta. The gap looks structural: Chessable markets XP explicitly as a substitute for rating because rating moves slowly, which is the same problem sidestepped rather than solved.

**Lichess's accuracy is fully open; Chess.com's is not.** So we implement Lichess's, exactly, and say so. That buys a property an in-house formula could not have: **a number here can be checked against the same game on Lichess.** A metric verifiable against an independent implementation is a different kind of claim from one that can only be trusted.

#### The constants come from the source, not the page

`src/domain/accuracy.ts`. The published documentation and the running code disagree, and the code is what produces the numbers people see:

- the constants are rounded on the page (`103.1668` for `103.1668100711649`);
- **a `+1` "uncertainty bonus" exists in the code and is absent from the page** — it means a swing must exceed about two thirds of a percentage point before accuracy drops below 100 at all;
- evaluations are clamped to **±1000cp before** the logistic, so no position exceeds 97.54% win chance, and every mate is the same ±1000 — mate-in-1 and mate-in-20 are indistinguishable;
- the chain starts at **+15cp**, not 0, because that is what Lichess scores the initial position.

Game accuracy is the arithmetic mean of a volatility-weighted mean and a harmonic mean. The weighting says moves played while the game was actually swinging matter more; the harmonic mean is what stops one catastrophe being averaged away by forty quiet moves. Both are tested: a game with one blunder must score more than ten points below the same game without it.

Worth knowing when reading the number: the win-percentage curve was fitted over 2300+ rated rapid games, and the accuracy curve to hand-chosen anchor points. It is a consistent yardstick, not an objective one, and not calibrated to a 1400 band.

#### The evaluations are now kept

This was the time-gated part. `ImportedGame.evals` already arrived from Lichess with per-ply site evaluations, and `findMistakes` already computed its own for nearly every ply — **and both were discarded at storage.** Every game imported without them is a game that has to be analysed a second time to measure.

They are stored now, site values preferred and ours filling the gaps. One pleasant surprise while implementing: the local walk covers nearly the whole game rather than only our moves, because evaluating the positions either side of each of our plies visits `i` and `i+1`, and those interleave.

#### What an unmeasurable game is allowed to contribute

Nothing, and the rule is sharper than it looks. `isMeasurable` demands that **every** ply was evaluated. A game with a gap is not a smaller sample — skip the plies nobody looked at and the average silently describes the analysis rather than the play. Games imported before this change have no evaluations at all and land in the same bucket, which is right: they are not worse data, they are absent data. The count is reported.

ACPL is kept alongside accuracy rather than instead of it, because the two fail differently — ACPL is an arithmetic mean and forgives one catastrophe among forty quiet moves, where accuracy's harmonic component does not. **Two numbers that disagree are saying something a single number would have hidden.**

#### Bands, not phases

Accuracy is broken down by move number — 1–10, 11–20, 21–30, 31+ — rather than by opening/middlegame/endgame. Every definition of where a phase begins is arguable; a move range is arbitrary too, but visibly so, and the question that matters here is specific: how far into a game does your play hold up. A band with fewer than ten of your moves in it reports no average.

`weakestBand` names exactly one stretch. A list of six weaknesses is a list nobody acts on.

#### Still to do

`MISTAKE_CP = 150` remains centipawn-based — the model Lichess abandoned, for the reason `judge()` now demonstrates in a test: +900 to +600 is 300 centipawns and almost no change in win chance, while 150 either side of level is a real mistake. The conversion now exists, so switching the deck's threshold is small and would make it a better deck: fewer cards from positions already decided, more from moves that changed the game.


### M15 — What gets played, and what counts as a mistake

#### The threshold moved off centipawns

`MISTAKE_CP = 150` is gone as the decision rule. Cards are now mined on a **drop in win percentage**, at Lichess's own 20-point "mistake" line.

This is not a tuning tweak — the two rules disagree in opposite directions at the two ends of the scale, which is the defect:

- **+700 → +400 is 300 centipawns and almost no change in outcome.** The old rule made a card out of it: a flashcard teaching you to play more precisely in a position you had already won.
- **+150 → −150 is 300 centipawns and decides the game.** Same number, entirely different move.

A win-percentage threshold is stricter near equality and looser when winning, which is exactly the discrimination the old one could not make. `DECIDED_CP` survives as a floor for the extremes where the logistic is flat enough that even a huge centipawn move registers as nothing.

The settings UI still asks in centipawns, so `winDropFor()` converts once at the edge and an existing stored preference keeps roughly its old meaning near equality.

**Expect the deck to change composition.** Fewer cards from won and lost positions, more from moves that actually turned a game — which is a better deck by the app's own thesis, and a change worth watching rather than assuming.

#### What players at your band actually play

A new control, next to the options ramp and answering a different question. The options list is the engine's: which moves are good. This is the human one: **which moves get played, and how they score when they are.**

For this app the second is the more useful, because the premise is preparing for what an opponent will do rather than for what a 3500-rated engine would. A move played in one game in forty is not worth preparing for however good it is; a mediocre move played in one game in four is the one you meet on Saturday.

Four decisions in it:

- **Sorted by frequency, never by score.** The ordering is the message. Putting the best-scoring rarity on top would quietly turn it back into an engine list.
- **Expected score, not win rate.** "Wins 48%" is ambiguous about draws, and in openings the draws are where most of the difference between two moves lives.
- **It does not count as help.** Seeing the engine's ranked options tells you the answer, so it retires the item. Seeing how often each move is played tells you what you will *meet* — that is the subject, not the solution.
- **`movesToCover`** answers the question a distribution is really being asked: how much do I have to know to be ready for most of this? Four moves covering 90% is an evening; fourteen is a different opening.

The response is already fetched and cached by the run itself, so this usually costs a render rather than a request. And the truncation is stated — a list showing eight of thirty is otherwise claiming the other twenty-two do not exist.


### M15.1 — Four things from using it

**The move list scrolled sideways, and the cause is worth remembering.** The grid used `1fr` tracks. A CSS grid track's default minimum is `min-content`, so one long move — `Qxd5+` — forced its column wider than its share and pushed the whole grid past the panel. `minmax(0, 1fr)` lets the track shrink and the cell clip instead. **`1fr` does not mean "a fair share"; it means "a fair share, but never smaller than the contents".**

**Two commentaries were sharing one paragraph, in the wrong order.** Remarks about the current position sat above the verdict on the move you had just played, so "Correct" appeared *underneath* a sentence about something else and the two read as one run-on note.

They are separate blocks now, each with a small caption — **Your move**, then **They played** — with a coloured rule down the side. The ordering is chronological, which is the only ordering a reader never has to be taught. Nothing was said differently; the same words simply stopped being one paragraph.

**Copy PGN became a share control in the strip.** It was a lone button sitting outside the row of controls, and sharing is a control like any other. Making it an icon also made room for the things a labelled button could not offer: PGN for the run, FEN for the position, an analysis link, and the platform's own share sheet *where one exists* — `navigator.share` is absent on most desktop browsers, and a button that does nothing is worse than an absent one. A refused clipboard now says so rather than looking like it worked.

**"Default until measured" described the app rather than answering the question.** It said what the program was doing; the reader wanted the number. Now `(~1500 until you have played enough to measure)`, and `(~1500, from your play)` once it has. **When a control's label explains a mechanism instead of stating a value, the value is what was wanted.**


### M15.2 — A bug this environment cannot see

`src/ui/Mark.tsx` and `src/ui/mark.ts` are **two files on Linux and one file on Windows.** Everything typechecked, tested and built in the container; the same commit failed instantly on the machine the repo lives on — `Already included file name … differs from file name … only in casing`.

The general shape is worth stating, because it will recur: **a development environment that differs from the target in a systematic way will never report the bugs that live in the difference.** No amount of testing on Linux finds this one. It is not a gap in coverage, it is a gap in the *kind* of thing the tests can observe.

So it is checked as a property of the tree instead — `test/filenames.test.ts` — along with the other filename rules Windows enforces and POSIX does not: reserved device names (`aux.ts` is as unusable as `aux`), trailing dots and spaces, and characters legal in a POSIX path and rejected by NTFS.

**The first version of that test did not catch the bug it was written for.** It compared whole filenames lowercased, and `mark.ts` and `mark.tsx` are different strings. The clash is not between filenames — it is between *module names*, because TypeScript resolves `./ui/Mark` against both extensions. Keying on the basename with the extension stripped is what makes the comparison the same one the compiler makes.

Which is the lesson underneath the lesson: **a regression test is only worth what its failure demonstrates.** Both versions passed on a clean tree; only one of them failed when the bug was put back.


### M15.3 — When the error names the wrong thing

A dependency was added to `package.json` and `npm install` was not run. The build failed with:

```
ENOENT: no such file or directory, open
'C:\Users\vilhe\...\Schackal\@fontsource-variable\source-sans-3\wght.css'
```

which reads as a broken path, and is not. Once the package is absent, postcss-import stops treating `@fontsource-variable/...` as a package specifier and resolves it against the **project root** — so the message describes a file nobody ever asked for, at a location nobody chose.

This was the second time the same omission produced an unrelated-looking error. The first was `@types/node`, which surfaced as *"Cannot find name `process`"* in the vite config. **Neither message contains the words "npm install".**

Two changes:

**The font stylesheet is imported from `main.tsx`, not `@import`-ed from CSS.** A bare specifier in CSS goes through postcss-import, whose resolution differs from Vite's own; from TypeScript it takes the ordinary module path, which resolves identically on every platform and fails legibly when it cannot.

**The deploy checks the installation before it builds.** Every name in `package.json` must exist in `node_modules`, or it stops with the list and one instruction. The build would have failed regardless — the point is that it now fails saying what is actually wrong.

The pattern worth extracting: **when a failure mode has produced a misleading error twice, the fix is not a better guess next time — it is a check that speaks first.**


### M16 — Showing instead of telling

Three reports from a session of real use, and the first two turned out to be the same complaint.

#### "Sound, but only played 4.99% here" — the deepest bug so far

A move was shown as the engine's top choice and simultaneously rejected as not-book. Reasonable response: *what is this app actually training?*

The cause is that **two different meanings of "best" were sharing one word.** `classifyBook` assigned the verdict `best` to the most-PLAYED sound move; `engine/candidates.ts` ranks by evaluation. Both were on screen at once, disagreeing.

Worse than the naming: frequency was a *gate*. A sound move below the threshold was marked wrong. That trains you to reproduce common moves rather than good ones, which inverts what the app is for, and at the extreme it rejected the engine's own first choice.

The rule now:

> **Soundness decides right and wrong. Frequency decides what is worth saying.**

A sound move is accepted whatever its popularity, with a remark — *"sound, and off the beaten track — 5% of players go this way"* — rather than a rejection. `best` is renamed `main`, which is what it always meant. `repertoire` strictness still narrows to one line, because drilling one line is the entire point of that mode.

And the frequency slider now governs only the opponent: **"Opponent plays replies above X% of games."** That asymmetry is the correct one and worth stating as a principle — *predicting them is a question about what people play; judging yourself is a question about what is good.* One control was answering both.

#### Assertions that could not be checked

The app says *"you are a piece up once the exchange finishes"* and *"a5 is strong for them"*, then prints the supporting moves as a row of notation. That asks the reader to replay the sequence in their head before they can see what the claim was about — which is exactly the work a beginner cannot do yet, and exactly why they are using a trainer.

§1.1 already covered it: never make the learner derive what can be shown. **Five moves in text is derivation.**

`domain/line.ts` replays a quoted sequence into positions; `LinePlayer` steps through it *on the real board* rather than in a second miniature one — same squares, same orientation, nothing new to learn to read. An arrow points at the move about to be played, so what is coming is visible from the current position rather than only after it has happened. Index −1 is the position before the line starts, because a claim has to be checkable from both ends.

A line that does not fully replay is shown as far as it got **and says so**. Silently truncating would turn "the first three of these five moves are legal" into "this line is three moves long".

#### Review could not review your games

It replayed training runs only. The games most worth going back over are the real ones, and those were reachable only as isolated mistake cards — a position with no way to see how it came about.

A run and an imported game are the same object for this purpose, so `domain/reviewable.ts` says so and Review stops caring which it holds. One thing needed care: **runs store evaluations from our point of view and imported games store them from White's**, because that is what the sites send. Mixing them puts the evaluation graph upside down for every game played as Black — right half the time, which is the worst kind of wrong for a number nobody can easily check. Normalising happens once, at the boundary, and there is a test for it.

Imported games never recorded per-move losses, because nothing was watching at the time. They fall out of the stored evaluations, so `lossesFrom` derives them — and skips a ply it cannot measure rather than recording a zero, since a zero would say "played perfectly".

#### Reporting a bug from inside the app

`Report a problem`, in the corner of every tab. It composes a pre-filled GitHub issue: no server, and the repository is already a public writable endpoint.

Three decisions:

- **State is captured when the form OPENS, not when it sends.** By the time a description is typed, a background import may have finished and moved something. The state that matters is the state at the moment you noticed.
- **The token is never included** — `collect()` reports its length and nothing more.
- **A dump too large for a URL is trimmed, and the report says it was trimmed.** A truncated diagnostic that looks complete is worse than an obviously partial one. The copy option carries all of it.

### M17 — Review is a place, not a footnote

Review handled imported games and training runs, and still read as missing, because it was a button inside Progress. That was a defensible theory — you look at one game *because* a number told you to — and it was wrong. The games are the app's own record of what you have played, and "let me look at that game from this morning" is a reason to open the app rather than a footnote to a chart.

Review is a tab. Progress keeps its link, now a shortcut into a place that exists rather than the only door to a hidden one.

**The list is the screen; the board is what you get after choosing from it.** The previous control was a `<select>`, which is wrong twice over: it shows one item at a time, so choosing between twenty games means reading them one line at a time with no accuracy, no result and no way to compare — and it hides the fact that anything is there at all. The honest answer to "what have I played?" is a list you can look at.

Each row carries the accuracy, because that is what makes one game worth opening rather than another; a list of dates is a list you cannot choose from. `summarise()` is in the domain rather than the component, so what a row claims is testable. Two things it must not do: print a null accuracy as 0% (a claim about how you played, where there is none), and tidy games and runs into one undifferentiated list — the real games are the ones with something at stake, and telling them apart is the reader's business.

**Five tabs across a phone, measured rather than assumed.** The tab row is 320px wide at a 360px viewport and 353 at 393, so nothing needs swiping on any current phone; below 360 it scrolls. Worth checking rather than eyeballing, given the failure mode being fixed is precisely a destination nobody could find.

#### The round that was written to a tree nothing builds

Review shipped twice and was missing both times. Not a bug in it: the files went to `<repo>/app/src/...` while the app lives at `<repo>/src/...`. Everything about the work was correct — 528 tests, a green build, a passing PWA check — in a copy of the tree that nothing compiles.

The cause is a mismatch between where the work happens and where it lands. The scratch checkout sits at `…/offbook/app`, the repository root *is* the app, and the commit paths were built from the first rather than the second. Nothing errors, because writing a file to a new directory is a perfectly ordinary thing to do.

Two responses, and only the second is worth anything:

- **Read it back.** After writing to the device, stage the same paths again and diff them against what was meant to be there. A write that reports success and a file that contains the new bytes are different claims.
- **`test/layout.test.ts` refuses a shadow tree.** It walks the repository and fails on any directory holding a path that duplicates one under `src/` or `test/`, naming the copies — because the confusing part is not that they are wrong but that they look right. Verified by reconstructing the bug: with `app/src/App.tsx` present it fails; without it, it passes.

Same shape as the base-path regression and the Windows casing clash, and by now the pattern is not a coincidence: **every mistake in this project that took two rounds to find was one where the environment differed from the environment in my head, silently.** The fix is never to be more careful about the difference; it is a check that asserts the two are the same.

### M18 — A game has two players

Reviewing a real game as Black, the qualitative labels appeared only on White's moves. Two independent off-by-ones, and they cancelled often enough to look like a display quirk:

- **Whose loss it is.** `lossesFrom` keyed by 0-based ply index; Review read `losses[ply]` with a 1-based ply. Playing Black put our scores on their moves, and nowhere else.
- **Where an evaluation array starts.** A run writes `evals[path.length]`, so index 0 is the starting position. The sites' arrays start at the position *after* the first move. One of the two sources was a ply out, always.

Both are now normalised at one boundary — `domain/reviewable.ts` — to **our point of view, indexed by ply count**, and nothing downstream is allowed a second opinion. Losses are no longer stored alongside evaluations at all: they are derived, because two sources of truth is how a move ends up printed against a different move's score.

#### Grading one player is not reviewing a game

The deeper problem was not the indexing. Review scored our moves and said nothing about theirs, and in a trainer built on punishment that is the wrong half to drop — the moment that matters most is the one where THEY went wrong and we did or did not take it.

`domain/annotate.ts` derives every move on both sides from the one evaluation array: quality, the evaluation it leaves behind, and a line of commentary in the trainer's existing vocabulary rather than a second one. Two of those lines are the app's whole thesis, and they use the same test Train uses, so *chance to punish* means the same thing on both screens:

> **They went wrong — 320cp. This is the chance to punish it.**
> **They had just blundered and this gives 320cp of it straight back.**

The panel now shows both accuracies side by side, a judgement table with an opponent column, and an evaluation graph whose dots are coloured by whoever played the move that reached them, ringed where a chance was offered. A graph that marked only our own errors showed a line dropping for reasons it never explained.

#### The card this trainer is arguing for

Import mined our own errors only — *"the opponent's mistakes are not our flashcards"* — which quietly excluded the most valuable position in the app: they hung something and we did not take it. Worse, the ordinary rules could not have caught it even if it had been looked for. The position after their blunder is often past `DECIDED_CP`, and giving back 400cp of a +700 barely moves the win percentage. Both filters are right for ordinary moves and both are wrong for exactly this one.

So it is judged separately, by `missedTheChance(gift, giveBack, after)`: their move was a blunder by the trainer's own definition, we returned at least half of it (with a 60cp floor, because half of a small gift is the whole point of the position), **and** we are no longer clearly winning afterwards. That last clause is what keeps it honest — handing back half of a +9 is imprecision in a game that was never in doubt, and a card made from it would drill accuracy where nothing was at stake.

It costs nothing to detect: our plies alternate with theirs, so the evaluation before their blunder is the evaluation after our previous move, already in the cache. There is a test that fails if that ever stops being true, because the alternative is every imported game getting 50% slower on a phone.

Cards mined this way carry `motif: 'missed-punish'` and ask a different question — *"They had just blundered here. You played Bd3 and let it go — find the punishment."* `phase` could not carry it: that says where a card came from, and this says what the exercise is.

#### The report button that led to a Server Error

Pressing "Report a problem" while signed out of GitHub produced a sign-in page and then an error, with nothing to suggest the report was the cause.

A signed-out visitor never fetches the link. GitHub carries the destination as `login?return_to=<the whole thing, encoded again>`, and a 7000-character issue URL does not survive that round trip. The budget was sized for what a browser accepts; it needed to be sized for what survives being embedded in another URL.

It is 1500 now, and the state dump does not fit in that — so it goes to the clipboard, and the issue body says so **in the place where it would have been**, with an empty fenced block to paste into. It is not trimmed: a dump cut at an arbitrary character is not JSON, and half a diagnostic that parses as nothing is not half as useful. The `labels` parameter is gone too — GitHub rejects it from anyone without triage rights, which is one more way this link can land on an error page instead of a form.

#### A check that looks at the screen

Everything above passed 559 unit tests while the screen was wrong, because the bug lived in the seam between two modules that each behaved correctly. `scripts/review-check.mjs` seeds one imported game played as Black, steps through it, and prints the commentary for every ply. The rule this is the third instance of: **when a defect is invisible to the tests, the answer is a check at the level the defect lives at, not more tests at the level it does not.**

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Punishment lines are unsound or trivially memorizable | **High** — kills the thesis | Step-5 validation with MultiPV resistance branching; manual audit of 10+ lines at M2 |
| Explorer data too sparse at deep nodes in the <1400 band | Medium | Truncate at depth where `gameCount < 200`; widen speeds/bands adaptively; report sparsity in the audit |
| COOP/COEP fights cross-origin fetches | Medium | Build-time analysis + single-thread WASM (§8) |
| Rate limiting from Lichess | Low | 1 req/s, permanent cache, backoff |
| Over-engineering; never ships | **High** — the real risk | Vertical slice only. One opening. M2 gate. No second repertoire until transfer rate has moved. |
| Training the wrong thing (opening prep isn't where <1400 loses games) | Medium-High | Transfer rate + rating history are tracked precisely to detect this. If rating doesn't move in 3 months, the answer is "go do tactics" and that's a legitimate finding. |

The last one deserves emphasis. Under 1400, most rating points are lost to one-move blunders in the middlegame, not to opening preparation. Offbook is worth building because the *punishment* half generalises — drilling "opponent hung a piece, take it, keep the initiative" is tactical training with a repertoire-shaped delivery mechanism. If it turns out to be pure opening memorization dressed up, it will not move the rating, and the progress subsystem is designed to tell you that within a few weeks rather than a few years.

---

## 11. Resolved configuration

`src/config.ts`:

```ts
export const CONFIG = {
	user: {
		lichess: 'VilhelmC',
		chesscom: 'VilhelmC',
	},
	explorer: {
		ratings: [1000, 1200, 1400],       // band lower-bounds
		speeds: ['blitz', 'rapid'],        // bullet excluded on purpose (§2)
	},
	transfer: {
		// transfer rate computed on these only — blitz is too noisy to measure prep
		countedSpeeds: ['rapid', 'classical'],
	},
	repertoires: [
		{ id: 'italian', colour: 'w', root: '1.e4 e5 2.Nf3 Nc6 3.Bc4', active: true  },
		{ id: 'scotch',  colour: 'w', root: '1.e4 e5 2.Nf3 Nc6 3.d4',  active: false },
	],
	coach: { sessionMinutes: 20, maxNewNodesPerSession: 1 },
} as const;
```

Recommended play format while using the app: **rapid 10+0 / 15+10** (§2).

## 12. Repository

- Local: `C:\Users\vilhe\Documents\GitHub\Schackal`
- Remote: `https://github.com/VilhelmC/Schackal`
- Toolchain on device: node v22.22.3, npm 10.9.8
- Licence: **GPL-3.0-or-later** (`LICENSE`, verbatim FSF text)

### Why the licence was not a free choice

Three dependencies are shipped to the browser, and all three are GPL:

| Package | Licence | What it does here |
|---|---|---|
| `chessground` | GPL-3.0-or-later | The board |
| `chessops` | GPL-3.0-or-later | Legal moves, FEN, SAN, PGN |
| `stockfish` | GPL-3.0-or-later | The engine, as WASM in `public/engine/` |

Serving the site **is** distribution — the bundle is downloaded and executed on the visitor's machine — so the combined work has to be GPL-compatible. MIT or Apache-2.0 were never available without replacing all three, which would mean giving up the board, the rules engine and the evaluation in one go.

Chosen as `-or-later` rather than `-only` to match what the dependencies themselves grant, so nothing downstream is narrower than what came in.

**AGPL was considered and deferred.** Its one added clause covers running a modified version as a network service without distributing it — which reaches only code that lives on a server and is never sent to the browser. No such code exists yet. Lichess itself makes exactly this split: `lila` (the server) is AGPL, `chessground` and `chessops` (the client libraries) are GPL. If the deferred sync backend is ever built, it can be AGPL then; sole authorship is what keeps that option open, and it closes the moment outside contributions arrive.

**What this obliges of the deploy.** GPL §6 requires the corresponding source to accompany the object code. A public repository satisfies it, but a visitor arriving at the Pages URL never sees the README — so the app carries its own footer link to the source. The offer has to travel with the thing being distributed, not with the thing the author happens to be looking at.


Note: neither the build container nor the device sandbox can reach `lichess.org` / `explorer.lichess.ovh`. All Lichess API calls are therefore validated **in your browser** at dev time — `Build.tsx` ships with a smoke-test panel that hits the explorer once and renders the raw response, so the client can be verified on first run.

## 13. Remaining open questions

1. Do you want the app to also suggest *when* to play rated games (e.g. "you've drilled the frontier, go play 3 rapid games and import them")? Cheap to add to Coach, and it closes the loop between training and measurement.
2. Sound on/off, board theme, piece set — cosmetic, defaults chosen unless you care.

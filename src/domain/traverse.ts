// The traversal — collapsing the tree backwards.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §3.1, §6 and §9, on the symmetric complex of
// AMEND-0-SYMMETRIC.md. This is the computation the rest of the modules exist to
// make possible, and it is what `rank.ts` was a search standing in for.
//
// Will:
//
//   "The exchange and contingency graph allows only a limited number of
//    potential final exchange partitions, the score of which can be calculated
//    immediately. The adversarial part is then just collapsing the tree
//    backwards, each player denying the opponent the outcome that would be worst
//    from their perspective. Everything is deterministic."
//
// There is NO ply parameter and nowhere to put one. Nothing is played, nothing
// is searched, and no score is calculated "one move into the future". Every
// number here comes from the complex as it already stands.
//
// THE SHAPE, and why it is smaller than it looks:
//
// Each side spends ITS OWN tempi on ITS OWN obligations. So absent a coupling
// the two schedules do not interact at all and their values simply ADD — §6.1,
// measured: 79.2% of corpus positions carry no coupling and therefore no tree.
// What remains is, per side, a scheduling problem:
//
//   * each obligation needs `cost` of that side's moves,
//   * before `tempiLeft` of them have passed,
//   * and a piece cannot be in two places, so the discharges chosen must use
//     distinct pieces.
//
// That last clause is Hall's condition, arriving exactly where §3 says it lives
// — cardinality — rather than being asserted as a motif. An obligation set that
// cannot be matched to distinct pieces in time is deficient, and the ones left
// over are collected.
//
// The subset enumeration below is 2^k over ONE side's rows, and it is EXACT. The
// largest single side over the 712-position corpus carries 13 rows against a
// `MAX_ROWS` of 16 — no position refuses. Above the bound it
// refuses rather than truncating: a silent cut reads as a computed answer.
// ---------------------------------------------------------------------------

import { makeSquare } from 'chessops/util';
import type { Color, Square } from 'chessops/types';
import { other } from './exchange';
import { isLive, isMateWeight, material, MATE, type Complex, type Obligation } from './complex';
import { gamma, tempiLeft, type Discharge } from './gamma';

/** Above this the enumeration is refused rather than truncated. */
export const MAX_ROWS = 16;

/**
 * One obligation as the schedule sees it.
 *
 * Every move costs at least one of that side's moves.
 */
export type Job = {
	/** Index into `complex.obligations`. */
	row: number;
	/** How many of this side's moves are available before it is collected. */
	budget: number;
	/** What it costs if it is not discharged. */
	weight: number;
	/**
	 * The moves that would discharge it.
	 *
	 * A MOVE, not a piece — §3.1's *"look hardest for the move that answers two"*.
	 * Two obligations answered by the same `(piece, to)` are answered by ONE move
	 * and cost one tempo between them; a matching over pieces spends the piece on
	 * one of them and collects the other. Measured before it was fixed: 970 edges
	 * in the corpus discharge two rows at once, and the piece-matching threw a row
	 * away in 19.1% of positions — 88.5% once arrival rows are filed, because a
	 * travelling piece is very often answered by the same move as something else.
	 */
	moves: Move[];
};

/** One edit, and everything it answers. */
export type Move = { piece: Square; to: Square; cost: number };

export type Commitment = {
	side: Color;
	/** Index into `complex.obligations`. */
	obligation: number;
	/** Which piece is spent on it. */
	piece: Square;
	/** Where it goes. Two commitments with the same piece and `to` are ONE move. */
	to: Square;
	/** How many of that side's moves it takes. */
	cost: number;
	/**
	 * Which round of §4's alternation this move is made in, from 0.
	 *
	 * A piece may appear in two commitments at DIFFERENT rounds — that is a piece
	 * moving twice over several moves, which is legal and which the old matching
	 * wrongly forbade. Two commitments at the same round are one move answering
	 * two rows, which is §3.1.
	 */
	round: number;
};

export type Outcome = {
	/**
	 * Material from White's reference, once every schedule has run.
	 *
	 * One number with a fixed reference, which is the only form a minimax can
	 * take. "What they concede minus what I concede" was the shape of the
	 * asymmetric build and is gone with it.
	 */
	value: number;
	/** Obligations nobody could discharge in time. */
	collected: Obligation[];
	/** What each side spends its tempi on. */
	schedule: Commitment[];
	/** True when `|E|` exceeded MAX_ROWS and nothing was computed. */
	refused: boolean;
};

/**
 * Hall's condition is now STRUCTURAL, and `feasible()` is gone with it.
 *
 * The old matching enforced "a piece cannot be in two places" across a set of
 * discharges chosen simultaneously. §4's recurrence chooses ONE move per round,
 * so a piece cannot be in two places because a player cannot make two moves —
 * and across rounds it may legitimately move twice, which the matching wrongly
 * forbade. The constraint the theory names is kept and the machinery that
 * approximated it is deleted.
 */

/**
 * §4's concession, unrolled — what a side actually loses.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS REPLACES, and it was the largest number in the project.
 *
 * The previous version picked the best feasible subset to save and SUMMED the
 * weight of everything left over. That prices a fork as losing both prongs and
 * a position with three hanging enemy pieces as winning all three. It does not:
 * the collector spends a move on each, and between them the other side moves
 * again.
 *
 * `r3k2r/8/8/8/8/8/8/R3K2R w` is the smallest case. Four rooks, all four hanging,
 * White to move. The sum says White collects a8 AND h8 while Black collects only
 * h1, for +500. The true value is 0 — each side takes one rook.
 *
 * Measured over the corpus before the fix: of the same-turn pairs along forced
 * lines where the price moved away from the solver, 83.9% were the price
 * promising more than arrived, and rows the SOLVER claimed, of kind `immediate`,
 * ran at 2.25x their rate on the pairs that held — while the same rows claimed
 * by the OPPONENT ran at 0.30x. The over-prediction was one-sided and it was
 * this.
 *
 * §4, which has said so all along:
 *
 *   L(∅) = 0
 *   L(E) = min over R of max over e in E\R of ( w_e + L(E \ R \ {e}) )
 *
 *   "You pick a move, which covers some subset R; THEY TAKE THE COSTLIEST THING
 *    YOU LEFT; you move again on what survives."
 *
 * One item per opponent move. The old `schedule()` was the single-ply case of
 * this recurrence stopped after one level, which is exactly what §4 says not to
 * do — and `concede2.ts` has implemented the recurrence since M6 without the
 * traversal ever calling it.
 *
 * WHAT IS ADDED TO §4 HERE: deadlines. §4's E is the rows already due. A row with
 * `budget` tempi is not collectable until that many of this side's moves have
 * passed, so the state carries the round and a row is takeable only once its
 * budget is spent. Without that a slow promotion would be harvested immediately.
 *
 * Memoised on (mask, round). |E| is bounded by MAX_ROWS per side, so the table is
 * at most 2^16 masks by a handful of rounds, and it refuses rather than
 * truncating above that.
 * ---------------------------------------------------------------------------
 */
type Concession = {
	/** L(E) — the weight this side concedes with best play from both. */
	loss: number;
	/** The moves it makes, in order, each with the rows it answered. */
	moves: Array<Move & { covers: number }>;
	/** The rows it does not save, in the order they are taken. */
	lost: number[];
};

function concede(jobs: Job[], mineFirst: boolean, serialPress = true): Concession {
	if (!jobs.length) return { loss: 0, moves: [], lost: [] };
	const W = (j: Job) => (Number.isFinite(j.weight) ? j.weight : 1e9);
	const full = (1 << jobs.length) - 1;

	// Every distinct move available anywhere in this side's job list, with the
	// rows it answers as a mask. §3.1's "the move that answers two" is this mask
	// having more than one bit, and it needs no special case.
	const seen = new Map<number, Move & { covers: number }>();
	jobs.forEach((j, i) => {
		for (const m of j.moves) {
			const k = m.piece * 64 + m.to;
			const had = seen.get(k);
			if (had) {
				had.covers |= 1 << i;
				if (m.cost < had.cost) had.cost = m.cost;
			} else seen.set(k, { ...m, covers: 1 << i });
		}
	});
	const all = [...seen.values()];

	// Dominated moves are dropped before the search sees them.
	//
	// A move that answers a SUBSET of what another answers, no faster, can never be
	// the better choice. Pruning those is exact rather than a cut — and it matters: the state space is exponential in rows
	// and linear in moves, so every surviving move is walked in every state.
	// Measured with arrival rows filed: 76 ms a position before, 3 ms after.
	//
	const dominates = (o: Move & { covers: number }, m: Move & { covers: number }): boolean =>
		o.cost <= m.cost &&
		(m.covers & ~o.covers) === 0;
	const plays = all.filter(
		(m, i) =>
			!all.some(
				(o, j) =>
					j !== i &&
					dominates(o, m) &&
					// Between two moves that dominate each other — identical rows at the
					// same price — keep one, and say which by a rule that does not move
					// under reflection: the earlier index wins only when the other is not
					// strictly better in some respect.
					(!dominates(m, o) || j < i),
			),
	);


	// `budget` is WHEN a row becomes takeable, not an allowance that runs out.
	//
	// The first version read it as a deadline and refused to let a move answer a
	// row once `round` had passed it. That is the single-ply reading again: it
	// says a rook still hanging on move two cannot be saved on move two, so the
	// four-rook position lost both. A row is takeable from `budget` onward and
	// stays saveable until it is actually taken — the collector can only take one
	// thing per move, and everything it does not take is still there.
	//
	// Rounds stop mattering once the slowest budget has passed.
	// PRESSING ONE CLAIM DELAYS THE NEXT.
	//
	// `budget` says when a row ripens if the claimant works on it from the start.
	// It cannot work on two from the start. A pawn five moves from promoting costs
	// its owner five moves; a second pawn behind it costs five more, and the
	// defender gets all ten.
	//
	// So a row ripens at `budget + press`, where `press` is what the claimant has
	// already spent collecting. Without it, every slow claim of a side was priced
	// as though it were the only one — which is exactly what the cause table found:
	// over the corpus, promotion rows the solver claims ran at 2.63x their rate on
	// the pairs where the price held, and 43.2% of side-positions with a slow claim
	// were credited with more than that side had tempi to press.
	//
	// What a collection costs its owner, in its own moves. At least one — the
	// taking itself — and `budget` when the piece has to travel first.
	const press = (i: number) => (serialPress ? Math.max(1, jobs[i].budget) : 1);

	// ONE CLOCK, NOT TWO. The rounds elapsed and the claimant's expenditure only
	// ever appear as a difference — a row is ripe when `budget + spent <= round`,
	// which is `budget <= round - spent`. Carrying both put the product of two
	// ranges in the memo key and took a corpus run from seven minutes to over
	// thirty. `slack` is that difference: how far ahead of its own pressing the
	// clock has got.
	//
	//   a tempo passes            slack + 1
	//   they collect row i        slack + 1 - press(i)
	//
	// Bounded above by the slowest budget, because past that every row is ripe and
	// nothing more can change, and below by minus the total press.
	const ceiling = Math.max(1, ...jobs.map((j) => j.budget)) + 1;
	const floor = -jobs.reduce((n, _, i) => n + press(i), 0) - 1;
	const clamp = (v: number) => (v > ceiling ? ceiling : v < floor ? floor : v);
	const next = (r: number) => clamp(r + 1);

	// THE SEARCH CARRIES NUMBERS, NOT LISTS.
	//
	// The first version built the move list and the lost list as it went, with an
	// array spread at every node. That allocated on the order of a million short
	// arrays a position once arrival rows were filed, and cost 93 ms a position
	// against 3 — measured, and the reason `choose()` was unusable at horizon 3.
	// Each memo now stores the branch that won, and the plan is walked out of them
	// once at the end.
	type Node = { loss: number; pick: number };
	const NONE = -1;
	const mineMemo = new Map<number, Node>();
	const theirsMemo = new Map<number, Node>();
	const travelMemo = new Map<string, Node>();
	const key2 = (mask: number, slack: number) => mask * 256 + (slack - floor);

	/** Rows in `mask` that are ripe — the claimant has spent enough on them. */
	const dueIn = (mask: number, slack: number): number[] => {
		const out: number[] = [];
		for (let i = 0; i < jobs.length; i++) if (mask & (1 << i) && jobs[i].budget <= slack) out.push(i);
		return out;
	};

	/** Their move: they take the costliest thing that is ripe, then it is mine. */
	const theirs = (mask: number, slack: number): number => {
		if (!mask) return 0;
		const k = key2(mask, slack);
		const had = theirsMemo.get(k);
		if (had) return had.loss;
		const due = dueIn(mask, slack);
		// Nothing ripe yet: a tempo passes and it comes back to me.
		if (!due.length) {
			if (slack >= ceiling) {
				theirsMemo.set(k, { loss: 0, pick: NONE });
				return 0;
			}
			const v = mine(mask, next(slack));
			theirsMemo.set(k, { loss: v, pick: NONE });
			return v;
		}
		let best = -Infinity;
		let pick = NONE;
		for (const i of due) {
			const v = W(jobs[i]) + mine(mask & ~(1 << i), clamp(slack + 1 - press(i)));
			if (v > best) { best = v; pick = i; }
		}
		theirsMemo.set(k, { loss: best, pick });
		return best;
	};

	/**
	 * A move that takes more than one tempo, while they keep collecting.
	 *
	 * `left` of my moves still to spend before it lands. They act once per round
	 * throughout, and may well take the very row I am travelling to save — which
	 * is correct, and falls out of leaving the covered rows in the mask until the
	 * move actually arrives.
	 */
	const travel = (mask: number, slack: number, left: number, covers: number): number => {
		if (left <= 0) return mine(mask & ~covers, slack);
		if (!mask) return 0;
		const k = `${mask}:${slack}:${left}:${covers}`;
		const had = travelMemo.get(k);
		if (had) return had.loss;
		const due = dueIn(mask, slack);
		if (!due.length) {
			const v = travel(mask, next(slack), left - 1, covers);
			travelMemo.set(k, { loss: v, pick: NONE });
			return v;
		}
		let best = -Infinity;
		let pick = NONE;
		for (const i of due) {
			const v = W(jobs[i]) + travel(mask & ~(1 << i), clamp(slack + 1 - press(i)), left - 1, covers);
			if (v > best) { best = v; pick = i; }
		}
		travelMemo.set(k, { loss: best, pick });
		return best;
	};

	/**
	 * My move: the one that leaves them the least.
	 *
	 * ∅ is always available, because a player must move even when no move covers
	 * anything — §4's own words, and the reason zugzwang is expressible here at
	 * all rather than needing a detector.
	 */
	const mine = (mask: number, slack: number): number => {
		if (!mask) return 0;
		const k = key2(mask, slack);
		const had = mineMemo.get(k);
		if (had) return had.loss;
		mineMemo.set(k, { loss: 1e12, pick: NONE }); // guard against re-entry

		let best = theirs(mask, slack);
		let pick = NONE;
		for (let pi = 0; pi < plays.length; pi++) {
			const m = plays[pi];
			const covers = m.covers & mask;
			if (!covers) continue;
			const v = m.cost <= 1 ? theirs(mask & ~covers, next(slack)) : travel(mask, slack, m.cost, covers);
			if (v < best) { best = v; pick = pi; }
		}
		mineMemo.set(k, { loss: best, pick });
		return best;
	};

	// ---- the plan, walked out of the memos once the numbers are settled.
	const moves: Array<Move & { covers: number }> = [];
	const lost: number[] = [];

	const readTheirs = (mask: number, slack: number): void => {
		if (!mask) return;
		const n = theirsMemo.get(key2(mask, slack));
		if (!n) return;
		if (n.pick === NONE) return slack >= ceiling ? undefined : readMine(mask, next(slack));
		lost.push(jobs[n.pick].row);
		readMine(mask & ~(1 << n.pick), clamp(slack + 1 - press(n.pick)));
	};
	const readTravel = (mask: number, slack: number, left: number, covers: number): void => {
		if (left <= 0) return readMine(mask & ~covers, slack);
		if (!mask) return;
		const n = travelMemo.get(`${mask}:${slack}:${left}:${covers}`);
		if (!n) return;
		if (n.pick === NONE) return readTravel(mask, next(slack), left - 1, covers);
		lost.push(jobs[n.pick].row);
		readTravel(mask & ~(1 << n.pick), clamp(slack + 1 - press(n.pick)), left - 1, covers);
	};
	const readMine = (mask: number, slack: number): void => {
		if (!mask) return;
		const n = mineMemo.get(key2(mask, slack));
		if (!n) return;
		if (n.pick === NONE) return readTheirs(mask, slack);
		const m = plays[n.pick];
		const covers = m.covers & mask;
		moves.push({ ...m, covers });
		if (m.cost <= 1) readTheirs(mask & ~covers, next(slack));
		else readTravel(mask, slack, m.cost, covers);
	};

	const loss = mineFirst ? mine(full, 0) : theirs(full, 0);
	if (mineFirst) readMine(full, 0);
	else readTheirs(full, 0);
	return { loss, moves, lost };
}

/**
 * Collapse the tree and read off the material.
 *
 * The obligations each side cannot schedule are collected; everything else is
 * discharged. The value is the material that results, from White's reference.
 */
export type TraverseOpts = {
	/**
	 * Charge a claimant `max(1, budget)` of its own moves per collection, so
	 * pressing one claim delays the next. Default true.
	 *
	 * An ablation switch. With it false a row ripens at `budget` however many
	 * other claims the same side is pressing, which is what the traversal did
	 * before GATE-6 and is the thing to compare against.
	 */
	serialPress?: boolean;
	/**
	 * Charge a claimant's own defensive moves against the time it has to press its
	 * claims. Default true. An ablation switch.
	 */
	billDefence?: boolean;
};

/**
 * §4 RUN JOINTLY WAS BUILT, MEASURED TWICE, AND DELETED.
 *
 * ---------------------------------------------------------------------------
 * The reasoning is sound and is worth keeping: §9 says "two players alternately
 * edit a single graph", §4's recurrence is over ONE obligation set with no clause
 * saying E belongs to a player, and running `concede()` twice — once per side,
 * each over the rows claimed against that side — is an artefact of how this file
 * was built. A side's own claims live only in the OTHER side's list, so it cannot
 * hold one as an asset, and a race is exactly a position where it must.
 *
 * `concedeJointly` was one alternation over the union, a ply being COVER, COLLECT
 * one of my own ripe claims, or PASS. It did what it was meant to: on `JHGmH` it
 * collected BOTH promotions where the split collects only Black's.
 *
 * Two formulations were measured on the 200 easiest puzzles:
 *
 *   plies conflated with moves, per-side busy counters   60.2%
 *   moves counted properly, journeys folded into plies   55.1%
 *   the split                                            72.5%
 *
 * And on the 300 easiest, split against joint by class:
 *
 *   race (advancedPawn, promotion, zugzwang)   64.9% -> 59.5%   −5.4
 *   everything else                            70.4% -> 47.7%   −22.7
 *
 * WORSE ON THE CLASS IT WAS BUILT FOR. That is what settled it.
 *
 * WHY, as far as it was diagnosed: the split lets both sides collect IN PARALLEL
 * — each side's concession is computed against the other pressing optimally, and
 * the two sums are added. The joint game forces a single interleaved line, so a
 * side must choose between collecting and defending. That is more honest as a
 * game and it invalidates the tempo model: `serialPress` and `billDefence` were
 * both calibrated against the parallel reading, and neither means the same thing
 * in one line. A joint alternation needs its own tempo accounting, not the split's.
 *
 * THE RACE WAS FIXED WITHOUT IT. `JHGmH` came right from three bounds in Γ — a
 * block must arrive before the pawn, a capture must catch it while it is there,
 * and every square it will stand on is a place to take it. The target was moving
 * and the clock was per square; the alternation was never the problem.
 * ---------------------------------------------------------------------------
 */

export function traverse(c: Complex, edges: Discharge[] = gamma(c), opts: TraverseOpts = {}): Outcome {
	const live = c.obligations.map((o, i) => ({ o, i })).filter(({ o }) => isLive(o, c.board));

	// Per side, its own obligations and its own tempi. Nothing crosses.
	const bySide: Record<Color, Job[]> = { white: [], black: [] };
	for (const { o, i } of live) {
		const side = other(o.claimant);
		// NOT filtered by `tempiLeft`. That filter was the same single-ply reading
		// as the deadline check inside the recurrence: it deleted every discharge of
		// a row that is due THIS round, so a rook already hanging had no way to be
		// saved next round after the collector took something else. `tempiLeft` says
		// when the row becomes takeable — it is the `budget` below — and the race
		// between arriving and being taken is what §4's alternation computes.
		// Γ already bounds costs by the row's deadline.
		const mine = edges.filter((e) => e.obligation === i);
		const budget = tempiLeft(o, c.turn);

		// Every distinct move that answers this row, cheapest first.
		//
		// NOT only the cheapest. A dearer move is never worth buying for THIS row
		// alone — it spends more tempi for the same result — but it may be a move
		// another row has already bought, and then it costs nothing at all. That is
		// §3.1's move that answers two, and keeping only the minimum makes it
		// invisible. Deduped per (piece, to) at its cheapest, so the branching stays
		// the size of the piece list rather than of the edge list.
		const byMove = new Map<number, Move>();
		for (const e of mine) {
			const k = e.piece * 64 + e.to;
			const had = byMove.get(k);
			if (!had || e.cost < had.cost) byMove.set(k, { piece: e.piece, to: e.to, cost: e.cost });
		}
		// A MOVE THAT CANNOT ARRIVE IS NOT A MOVE.
		//
		// Γ bounds a discharge by the row's DEADLINE; the job budgets by
		// `tempiLeft`, which is `deadline - 1` when the claimant moves first. So a
		// discharge costing exactly `deadline` was admitted into a job that has one
		// fewer tempo than that, and the recurrence then believed the row was
		// answerable and committed to it.
		//
		// `JHGmH`, the pawn race — `8/8/p7/5K2/3P4/1k6/8/8 w`. Black's promotion on
		// a1 is worth 800 with `tempiLeft` 4, and its only answers cost 5:
		// `♔f5–a6`, `♔f5–a5`, `♔f5–a1`. None can arrive. The traversal scheduled
		// `♔f5→a1@5` anyway, spent White's round on it, and had nothing left to push
		// the pawn — so `d4–d5`, the move that wins the race, priced at −1.00 and
		// `♔e4` at +1.00.
		//
		// Will: "the white king is annotated as preventing black promotion by going
		// to a1 … although its distance 5 with no blocking."
		// GUARDED TO DEFERRED ROWS, and the guard is not cosmetic. `tempiLeft` is 0
		// for an immediate row when the claimant moves first, so filtering on it
		// deleted every answer to every immediate threat: the fork test — "lets a
		// collector take one thing per move" — collected both prongs at once. An
		// immediate row's race is the alternation itself and the recurrence already
		// runs it; the arithmetic being corrected here is TRAVEL, which only a
		// deferred row has. `billDefence` above draws the same line for the same
		// reason.
		const moves = [...byMove.values()]
			.filter((m) => o.deadline <= 1 || m.cost <= budget)
			.sort((a, b) => a.cost - b.cost || a.piece - b.piece || a.to - b.to);
		bySide[side].push({ row: i, budget, weight: o.weight, moves });
	}

	// The bound is PER SIDE, because the enumeration is per side: each side's
	// subset search is 2^n over its OWN rows and the two never combine. Held rows
	// pushed the total as high as 22 over the corpus, and refusing on the total
	// would have refused positions whose actual search was 2^11.
	if (bySide.white.length > MAX_ROWS || bySide.black.length > MAX_ROWS) {
		return { value: material(c.board), collected: [], schedule: [], refused: true };
	}

	const collected: Obligation[] = [];
	const plan: Commitment[] = [];
	let value = material(c.board);

	// A CLAIMANT'S MOVES ALSO HAVE TO PAY FOR ITS OWN DEFENCE.
	//
	// Each side's recurrence charges the OTHER side `max(1, budget)` of its moves
	// per collection — that is `serialPress`, and it stops one claim ripening while
	// another is being pressed. What it does not charge is the moves the claimant
	// needs for its own debts. A side under fire cannot walk a pawn up the board
	// AND answer what is claimed against it, and as written it can, for free.
	//
	// This is the gap named in CHECKPOINT-M7-GATE-5 and left open: "fixing it makes
	// the two sides' schedules interact, which they currently do not." It is what
	// makes a deep claim over-credited, and the deeper the claim the worse it gets
	// — measured, on the arrival horizon, where every step past 1 made both the
	// gate and the price worse while adding rows.
	//
	// TWO PASSES, NOT A FIXPOINT, and named as such. Pass one prices each side's
	// defence ignoring this; pass two delays every claim by however many moves its
	// claimant turned out to need for itself. Iterating to a fixpoint would be
	// exact and each round changes the other side's answer, so this takes the first
	// correction and stops.
	const spent: Record<Color, number> = { white: 0, black: 0 };
	if (opts.billDefence !== false) {
		for (const side of ['white', 'black'] as Color[]) {
			const jobs = bySide[side];
			if (!jobs.length) continue;
			const first = concede(jobs, c.turn === side, opts.serialPress !== false);
			spent[side] = first.moves.reduce((n, m) => n + Math.max(1, m.cost), 0);
		}
		for (const side of ['white', 'black'] as Color[]) {
			// A row claimed by C is pressed by C, and C is busy for `spent[C]` moves.
			//
			// ONLY DEFERRED ROWS. An immediate claim costs its claimant one move —
			// the capture — and the recurrence's own alternation already interleaves
			// that with everything else; adding to it counts the same tempo twice and
			// priced the four-rook position at +500 when each side takes one.
			//
			// A DEFERRED claim is different in kind. It costs `deadline` moves of
			// TRAVEL before anything is collectable, and those are moves its claimant
			// has to find alongside answering its own debts. That competition is not
			// modelled anywhere else, and it is why the over-crediting the cause
			// tables kept finding grew with the deadline.
			for (const j of bySide[side]) {
				if (c.obligations[j.row].deadline <= 1) continue;
				j.budget += spent[other(side)];
			}
		}
	}

	for (const side of ['white', 'black'] as Color[]) {
		// A row with no discharge at all still costs a move to COLLECT, so it goes
		// into the recurrence with the rest rather than being summed beside it.
		// Its `moves` list is empty, so no move ever covers it and it is simply the
		// first thing taken.
		const jobs = bySide[side];
		if (!jobs.length) continue;
		const out = concede(jobs, c.turn === side, opts.serialPress !== false);
		// A move may answer several rows; the plan names it once per row, so the
		// panel can say what each row was answered BY and §3.1 is visible as two
		// commitments sharing a round.
		out.moves.forEach((m, round) => {
			jobs.forEach((j, bit) => {
				if (!(m.covers & (1 << bit))) return;
				plan.push({ side, obligation: j.row, piece: m.piece, to: m.to, cost: m.cost, round });
			});
		});
		for (const row of out.lost) collected.push(c.obligations[row]);
	}

	// A MATE IS NOT MATERIAL PLUS A LARGE NUMBER.
	//
	// Will: "if there are multiple different mates available we should always sort
	// by length and choose the shortest."
	//
	// `MATE - k·STEP` orders mates by length, and summing it with material undoes
	// that inside a length: two moves that are both mate in one came out 80
	// centipawns apart and one was picked over the other on a pawn's worth of
	// residue. `v6KTR`, `Q2e5l` and `2K7rJ` are all that — a different mate chosen,
	// correctly, for the wrong reason.
	//
	// So when a mate is collected the value IS the mate, signed. Material is what
	// you have left when nobody is mated, and there is no such thing as being mated
	// and a pawn up. Shortest wins; equal lengths tie, which is what a dual is and
	// what it should look like.
	let mate = 0;
	let mateRow: Obligation | null = null;
	for (const o of collected) {
		if (isMateWeight(o.weight) || !Number.isFinite(o.weight)) {
			const w = Number.isFinite(o.weight) ? o.weight : MATE;
			const signedW = o.claimant === 'white' ? w : -w;
			// The soonest mate on the board is the one that happens.
			if (!mate || Math.abs(signedW) > Math.abs(mate)) {
				mate = signedW;
				mateRow = o;
			}
			continue;
		}
		// Material moves toward whoever collects. One reference, both signs.
		value += o.claimant === 'white' ? o.weight : -o.weight;
	}
	// AND IT COLLECTS NOTHING ELSE. Will, on `eeBaG`: "all three options also list
	// a change in pawns which never happens." Quite — the game is over, so the
	// pawns do not change hands, and a list that says they do is describing a
	// position that will never exist. The value already ignored them; the reading
	// has to as well, or the panel contradicts the number beside it.
	if (mate) {
		value = mate;
		collected.length = 0;
		if (mateRow) collected.push(mateRow);
	}

	return { value, collected, schedule: plan, refused: false };
}

/**
 * Is anything owed that cannot be paid? — §3's deficiency, read off the outcome.
 *
 * Not a separate computation. The traversal already decided what could be
 * scheduled; deficiency is the question of whether anything was left over.
 */
export const deficient = (o: Outcome): boolean => o.collected.length > 0;

/** What the traversal says, in §4's terms. */
export function say(c: Complex, o: Outcome): string {
	if (o.refused) return `too many obligations to enumerate (over ${MAX_ROWS}) — refusing rather than truncating`;
	if (!o.collected.length) {
		return o.schedule.length
			? `every debt can be paid — ${o.schedule.map((s) => (s.piece === s.to ? `${makeSquare(c.obligations[s.obligation].square)} while ${makeSquare(s.piece)} stays` : `${makeSquare(c.obligations[s.obligation].square)} by ${makeSquare(s.piece)}>${makeSquare(s.to)}`)).join(', ')}`
			: 'nothing owed';
	}
	const lost = o.collected
		.map((x) => `${makeSquare(x.square)} (${Number.isFinite(x.weight) ? x.weight : 'the king'} to ${x.claimant})`)
		.join(', ');
	return `cannot be paid: ${lost}`;
}

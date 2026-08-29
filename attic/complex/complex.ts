// The exchange complex — one object, both sides, no roles.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §1 and §9, as corrected by AMEND-0-SYMMETRIC.md.
//
// Will: "there is no attacker-defender. We are playing a symmetric game. There
// is only a player whose turn it is and the current position."
//
// Every module before this took a side as a ROLE — `ledger(pos, owed)`,
// `gamma(pos, {owed})` — so the complex was built half at a time and a symmetric
// value had to be reassembled afterwards by subtracting two asymmetric halves.
// That subtraction was the repair of damage done at the constructor, and it is
// what made a per-move evaluator feel necessary: you cannot minimax "X is owed
// by side S", only "this position is worth X".
//
// So: ONE complex. Every obligation in the position, whatever material is at
// stake and whoever collects. `claimant` is a FIELD — a fact about the row —
// never a parameter. The only asymmetry in the system is whose turn it is, and
// that belongs to the traversal node, not to anything built here.
//
// Two things are deliberately absent, both deleted rather than ported:
//
//   * `confidence`. It was `0.944^(τ-1)`, measured rather than chosen, and it is
//     a PROBABILITY. Everything here is deterministic: a deadline is met or it
//     is not, which is Hall's condition and not a hedge. It existed because
//     distances were computed on a frozen board and drift — and under a
//     traversal the board is not frozen, because the other player's edits are
//     explicit nodes.
//
//   * `tauStar`. AMEND-2-ARRIVES §2 derived a tempo correction and gave it its
//     own test as "the single most likely place to be quietly wrong". It exists
//     ONLY because the ledger was built per role. Here τ is plies from the
//     current node and there is nothing to correct.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import { makeSquare } from 'chessops/util';
import type { Board } from 'chessops/board';
import type { Chess } from 'chessops/chess';
import type { Color, Role, Square } from 'chessops/types';
import { V, other, seeValue } from './exchange';
import { priced } from './cluster';
import { stateOf, type State } from './state';
import { empty as noPaths, ask, type Paths } from './paths';
import { reach, distance, routeSteps, bear, walkOn, spanOf, type Reach, type Walks } from './reach';

/**
 * A prospective change in relative material.
 *
 * §1: "A player is obliged to prevent any change in relative material." The row
 * says WHERE the material changes hands, HOW MUCH, WHEN, and WHO collects. It
 * does not say whose obligation it is, because that is the same fact read from
 * the other end — the material at stake belongs to whoever is not the claimant.
 */
export type Obligation = {
	/** Where the material changes hands. */
	square: Square;
	/** For a deferred row, the piece that would arrive. */
	from?: Square;
	/**
	 * For an `arrival` row: where `from` stands when it bears on `square`.
	 *
	 * The row is a claim about the board AFTER that step, which is where its
	 * weight was measured, so that is the board its discharges are gated on.
	 */
	via?: Square;
	/** What is at risk, or what is travelling. For the sentence. */
	role: Role;
	/** The magnitude. Always a SEE, never a nominal piece value (§1.1). */
	weight: number;
	/** Tempi from now until it is collectable. No correction; see the header. */
	deadline: number;
	/** Who collects if it goes unanswered. A fact, not a parameter. */
	claimant: Color;
	/** How to read the row aloud. Never branched on. */
	kind: 'immediate' | 'promotion' | 'arrival';
	/**
	 * Other (traveller, arrival square) pairs that would make the same claim.
	 *
	 * DISPLAY ONLY — nothing branches on it. The row keeps the fastest route
	 * because a claim is a claim however it is reached, but a ledger someone is
	 * reading should not make a route that exists look like one that was missed.
	 */
	alts?: { from: Square; via: Square }[];
	/**
	 * A RAY THAT IS REGISTERED BUT DOES NOT YET FIRE — the contingency ledger.
	 *
	 * `isLive` is false for these unconditionally, so `gamma` and `traverse` both
	 * skip them and no price depends on one. They exist to be READ: the threat is
	 * on the board and in the ledger from the start, with the squares that gate it
	 * named, which is what Will asked for and what the panel shows as
	 * `blocked by …`.
	 *
	 * MEASURED, AND THE MEASUREMENT IS WHY THE FLAG EXISTS. Filed as ordinary
	 * rows they are latent where they are built and LIVE in any child where the
	 * gate has cleared — and then a king carries up to five arrival rows instead
	 * of one, which is the "one row per arrival square" experiment `ydGWl` already
	 * rejected for cost. Over the whole corpus that was 57.3% to 56.8% found, with
	 * blind up 2.1 to 2.4, while the 200 easiest went the other way by 0.2 and said
	 * nothing. So the row is kept and its effect on price is not.
	 *
	 * Making a contingency FIRE is a different build — tracing the chain into a
	 * single exchange, Will's "Rxh2, Kxh2, Qh5, Bh4, Qxh4+ as one exchange visible
	 * from initial registration". This is the register it would read from.
	 */
	contingent?: boolean;
	/** The route: squares that must be EMPTY for this to cost `deadline`. */
	needs: Square[];
	/** Squares that must be FILLED — the trigger only a pawn has. */
	enablers: Square[];
};

/** Collectable now, at the stated cost. A question asked of the board. */
export const isLive = (o: Obligation, board: Board): boolean =>
	!o.contingent && !o.needs.some((s) => board.occupied.has(s)) && !o.enablers.some((s) => !board.occupied.has(s));

/** The squares actually in the way right now. Derived, never stored. */
export const blockedBy = (o: Obligation, board: Board): Square[] => o.needs.filter((s) => board.occupied.has(s));

export type Complex = {
	board: Board;
	/** The only asymmetry in the system. */
	turn: Color;
	/** Every obligation, both claimants, one list. */
	obligations: Obligation[];
};

// `chains` AND `couplings` both used to be fields here, rebuilt on every call.
// Nothing read either but the board overlay, which computes its own — so every
// option `choose()` priced paid for four coupling kinds and a chain list nobody
// looked at. §6's decomposition lives in `cluster.ts` now and works off sites.

// `couplings` USED TO LIVE HERE and was computed on every build. Nothing read it
// but the board overlay, which computes its own — so every option `choose()`
// priced paid for four coupling kinds nobody looked at. Measured: 0.82 ms a
// position, 18 ms a ply once multiplied by the option count.
//
// §6's decomposition is in `cluster.ts` now, and it works off sites rather than
// `couple.ts`'s narrower chains. This field was the last trace of the version
// where the complex carried couplings it never consulted.

const LAST_RANK: Record<Color, number> = { white: 7, black: 0 };

/**
 * MATE IS ORDERED BY DISTANCE, AND THAT IS WHY IT IS NOT INFINITY.
 *
 * ---------------------------------------------------------------------------
 * A king row's weight was `seeValue` at the king's square, which is `Infinity`
 * because `V.king` is. That makes every mate the same number, so a mate in one
 * and a mate in three tie — and `mate1-audit.mjs` says that is what is left of
 * the mate-in-one failures once the arrival capture is in: the answer is at the
 * top, and so is a move that mates later.
 *
 * Infinity is right about the STAKE and wrong about the CLAIM. The material is
 * unbounded, but "I mate you in one" strictly dominates "I mate you in three",
 * and a value that cannot express that cannot pick between them.
 *
 * So a king row is worth `MATE - deadline`: finite, enormous, and ordered. It
 * still swamps every material row — `MATE` is four orders of magnitude above a
 * queen — so nothing is traded against it, which is the property Infinity was
 * there for. `V.king` stays Infinity: the exchange machinery uses it to decline
 * king captures on arithmetic alone (§1.4) and that is a different job.
 *
 * `isMateWeight` is how everything downstream asks, so no reader has to know the
 * constant — and so a weight that is merely large is never mistaken for a mate.
 * ---------------------------------------------------------------------------
 */
export const MATE = 1_000_000_000;
/**
 * The gap between "mate in n" and "mate in n+1".
 *
 * It has to be WIDER THAN ANY MATERIAL SUM, or the ordering it exists to impose
 * is undone by the thing it is supposed to dominate. The first version stepped by
 * 1 and the mates re-sorted themselves by centipawns: `v6KTR` scored two moves
 * that are both mate at 999920 and something lower, and picked between them on a
 * material difference of less than a pawn. A whole board is under 10,000
 * centipawns, so a step of a million cannot be crossed.
 */
export const MATE_STEP = 1_000_000;
export const isMateWeight = (w: number): boolean => Math.abs(w) >= MATE - 100 * MATE_STEP;

/**
 * What a promotion is worth, on the board it lands on — §1.1.
 *
 * Writing `V[queen] − V[pawn]` and stopping is what made `race.ts` wrong: the
 * new queen can be taken the moment she arrives, and deferring the collection
 * does not defer the recapture.
 */
function promotionWorth(board: Board, pawn: Square, promo: Square, mover: Color): number {
	const after = board.clone();
	after.take(pawn);
	after.take(promo);
	after.set(promo, { color: mover, role: 'queen' });
	return Math.max(0, V.queen - V.pawn - seeValue(after, promo, other(mover)));
}

export type ComplexOpts = {
	/** Shared distance index. One is made per call if none is supplied. */
	paths?: Paths;
	/** Ignore promotions further off than this. */
	horizon?: number;
	/** How far a travelling piece may be and still claim a square. 0 disables. */
	arrivalHorizon?: number;
	/**
	 * §6's per-site values, from `cluster.priced()`.
	 *
	 * When supplied, an immediate row's weight is the exchange with contested
	 * pieces COMMITTED — §6.2's sequential game — rather than the naive SEE, which
	 * assumes every defender is free to defend every square at once.
	 *
	 * Passed in rather than computed here because it needs whose turn it is (the
	 * order of commitment is the order of play) and `obligations()` is turn-free
	 * by construction. `complex()` supplies it.
	 */
	priced?: Map<Square, number>;
	/**
	 * Use §6's committed values at all. Default true. An ablation switch.
	 *
	 * Separate from `priced` because an EMPTY map is now a meaningful value — it
	 * says "no square carries an exchange" — so it can no longer double as "do not
	 * price". That conflation quietly zeroed every weight the first time the
	 * duplicate SEE pass was removed.
	 */
	cluster?: boolean;
	/**
	 * A walk cache from the position this one is one move away from, plus the
	 * squares that move touched. §7's third index row; see `reach.walksFor`.
	 *
	 * Supplied by `choose()`, which prices about twenty options a ply on boards
	 * that differ from the parent by two squares. Absent, every walk is computed.
	 */
	walks?: Walks;
	changed?: readonly Square[];
	/** Build a walk cache at all. Default true. An ablation switch. */
	walkCache?: boolean;
	/**
	 * The exchange graph for this position — §9's actual state.
	 *
	 * `complex()` builds one if none is given and passes it down. A caller with a
	 * state already in hand — `choose()`, which can get a child's by `after()`
	 * rather than by building — passes it and the graph is not rebuilt.
	 */
	state?: State;
};

/**
 * Every obligation in the position — both claimants, one pass.
 *
 * The loops run over the whole board rather than over one side's pieces. That is
 * the entire structural change: the same rows come out, and they come out
 * together instead of in two halves that have to be reconciled afterwards.
 */
export function obligations(board: Board, opts: ComplexOpts = {}): Obligation[] {
	const horizon = opts.horizon ?? 6;
	const paths = opts.paths ?? noPaths();
	const out: Obligation[] = [];

	// Cost-1: any square where the exchange favours whoever is not standing on
	// it. Asked of every occupied square, so both sides' rows arrive together.
	//
	//
	// The weight is the naive SEE and it stays the naive SEE.
	//
	// DOUBLE DUTY IS NOT PRICED HERE, and that is a deletion rather than a gap.
	// Will: "a piece involved as defender or attacker is doing double duty, so it
	// is a double obligation." AMEND-6.1 built that as a `held` row — a row per
	// (square, piece) whose safety depends on that piece staying put — and it was
	// ablated out after the gate was measured with and without it:
	//
	//     with held rows   48.9% outright, price error 39.8%
	//     without          49.2% outright, price error 38.3%
	//
	// It carried NOTHING, and slightly less than nothing. The reason is worth
	// keeping: a held row predicts what happens if the piece moves, and `choose()`
	// APPLIES each edit and rebuilds the complex — so the queen that recaptures on
	// f7 arrives at the next node with d8 already hanging as an ordinary immediate
	// row. The mechanism was computing, one node early, exactly what the next node
	// computes anyway.
	//
	// Roughly two hundred lines across three modules, three corrections and an
	// amendment, for minus 0.3 points. Deleted.
	for (const square of board.occupied) {
		const piece = board.get(square);
		if (!piece) continue;
		const claimant = other(piece.color);
		// §6's map covers every square an enemy attacks, which is every square where
		// an exchange exists at all. A square not in it has no attacker and so a SEE
		// of zero — asking again is twenty wasted exchange computations a call, and
		// `sites()` has already done every one of them.
		// A KING IS NOT IN §6'S MAP, and §1's `mate` row still needs one.
		//
		// `cluster.sites` excludes kings deliberately — a king cannot be captured,
		// so there is no exchange to commit pieces to — but §1's table files the
		// king's square at weight ∞ when it is attacked, and that row is what makes
		// checkmate readable off the complex alone. So kings are asked directly and
		// everything else comes from the map.
		//
		// Everything else IS in the map: it covers every square an enemy attacks,
		// which is every square where an exchange exists at all. A square not in it
		// has no attacker and so a SEE of zero, and asking again would repeat twenty
		// exchange computations `sites()` has already done.
		const weight =
			piece.role === 'king'
				? // A check that exists NOW is mate in zero more travelling moves, so it
					// outranks every arrival mate by the same ordering. `seeValue` here is
					// Infinity and carries no distance at all.
					seeValue(board, square, claimant) > 0
					? MATE
					: 0
				: !opts.priced
					? seeValue(board, square, claimant)
					: (opts.priced.get(square) ?? 0);
		if (weight > 0) out.push({ square, role: piece.role, weight, deadline: 1, claimant, kind: 'immediate', needs: [], enablers: [] });
	}

	// Cost-k: a pawn walking to the last rank, for either colour.
	for (const pawn of board.occupied) {
		const piece = board.get(pawn);
		if (piece?.role !== 'pawn') continue;
		const mover = piece.color;
		const owner = other(mover);
		type Cand = { square: Square; d: number; weight: number; needs: Square[]; enablers: Square[] };
		// Live and latent rank separately and live always wins. Comparing a
		// latent candidate's floor against a live one's distance demoted pawns
		// with real routes: 76 live rows on the blind bucket became 36.
		let bestLive: Cand | null = null;
		let bestLatent: Cand | null = null;
		const keep = (c: Cand, cur: Cand | null) => !cur || c.d < cur.d || (c.d === cur.d && c.weight > cur.weight);

		for (let file = 0; file < 8; file++) {
			const promo = (LAST_RANK[mover] * 8 + file) as Square;
			const live = ask(paths, board, pawn, promo, { limit: horizon });
			const weight = promotionWorth(board, pawn, promo, mover);
			if (weight <= 0) continue;

			if (Number.isFinite(live.d) && live.d >= 1 && live.d <= horizon) {
				// The route splits into BOTH triggers by occupancy: a push step must
				// stay empty, a capture step must stay occupied. The route is live
				// now, so the split is decidable — AMEND-1B.
				const route = live.forced.filter((s) => s !== promo);
				const cand: Cand = {
					square: promo,
					d: live.d,
					weight,
					needs: route.filter((s) => !board.occupied.has(s)),
					enablers: route.filter((s) => board.occupied.has(s)),
				};
				if (keep(cand, bestLive)) bestLive = cand;
				continue;
			}

			// Latent: the route does not exist yet. `needs` are the pieces standing
			// on it; `enablers` are the captures it wants and has nothing to capture.
			const needs = live.obstructions.filter((s) => s !== promo);
			const enablers: Square[] = [];
			let floor = live.floor;
			const dream = reach(board, pawn, { limit: horizon, pawnMayCaptureAnywhere: true });
			const dreamt = distance(dream, promo);
			if (Number.isFinite(dreamt) && dreamt <= horizon) {
				floor = Math.min(floor, dreamt);
				for (const [from, to] of routeSteps(dream, promo)) {
					if ((from & 7) === (to & 7)) continue; // a push, not a capture
					if (board.get(to)) continue; // occupied: nothing to enable
					enablers.push(to);
				}
			}
			if (!Number.isFinite(floor) || floor > horizon) continue;
			if (!needs.length && !enablers.length) continue;
			const cand: Cand = { square: promo, d: floor, weight, needs, enablers: [...new Set(enablers)].sort((a, b) => a - b) };
			if (keep(cand, bestLatent)) bestLatent = cand;
		}

		const best = bestLive ?? bestLatent;
		if (!best) continue;
		// The cost-1 pass already has the exchange if the promotion square holds a
		// piece of the side whose material is at stake.
		const sitting = board.get(best.square);
		if (sitting && sitting.color === owner) continue;
		out.push({
			square: best.square,
			from: pawn,
			role: 'pawn',
			weight: best.weight,
			deadline: best.d,
			claimant: mover,
			kind: 'promotion',
			needs: best.needs,
			enablers: best.enablers,
		});
	}

	// Cost-k for every other piece — §1's `invasion`. Off unless asked for: it is
	// the newest row and the one with the widest reach, so it stays a decision the
	// caller makes rather than a default that quietly changes every number.
	if ((opts.arrivalHorizon ?? 0) > 0) out.push(...arrivals(board, opts));


	// Heaviest first, and by square when equal so the order is the order every
	// time. Row order is an artefact of the scan and reads as randomness to
	// anyone comparing two positions.
	return out.sort((a, b) => (b.weight === a.weight ? a.square - b.square : b.weight - a.weight));
}

/**
 * Cost-k rows for every piece, not only pawns — §1's `invasion`.
 *
 * ---------------------------------------------------------------------------
 * `obligations()` files cost-1 rows for exchanges that are won NOW, and cost-k
 * rows for a pawn walking to the last rank. Between those two sits every other
 * way material changes hands on a clock: a piece travelling to a square where
 * the exchange is won once it arrives. That is the row §1's table has carried as
 * named-absent since M3, and without it the complex has nothing to say about the
 * move that CREATES a claim — only about answering one.
 *
 * WHY IT WAS DECLINED, AND WHY THAT DOES NOT CARRY.
 *
 * `FINDING-INVASION.md` measured this row and refused to build it: added to the
 * scorer it dropped blindness from 22.8% to 5.6% and made the answer WORSE, with
 * 6 of 37 broken ties broken correctly. The finding's own diagnosis was
 *
 *   "the row as stated prices one side's journey only"
 *
 * — the attacker's travel was counted and the defender was given one tempo of
 * credit, where §5 says the defender arrives iff `k_D ≤ k_A`.
 *
 * That measurement was taken inside `rank.ts`, the per-move scorer that has
 * since been deleted, and it is a fact about a SCORER. Here the row is a row.
 * Γ gives it discharges — capture the traveller, block its route, move the
 * target, defend the target — and `tempiLeft` counts the defender's tempi
 * against `deadline`. The defender's counter-journey is on exactly the footing
 * the finding said was missing, because that is what a traversal is.
 *
 * The measurement stands. Its conclusion does not transfer.
 *
 * THE ROW, stated precisely:
 *
 *   For each square `t` holding a non-king piece whose exchange is NOT already
 *   won (else the cost-1 pass has it), and each enemy piece `p` that can come to
 *   BEAR on `t` in `k ≤ horizon` plies: if the exchange at `t` is won once `p`
 *   stands on its arrival square, file a row on `t` with that value, deadline
 *   `k`, claimant `p`'s side, and `from = p`.
 *
 * `bear` and not `distance`: to threaten a square is not to move to it, exactly
 * as to defend one is not to move to it. Both directions of §5's `d(p, S)` are
 * the one function, which is why it now lives in `reach.ts`.
 *
 * The arrival square has to be FOUND rather than assumed — `bear` returns a
 * distance, not a square — and the exchange is evaluated with `p` standing
 * there. An earlier probe carried a comment saying it evaluated the exchange and
 * code that did not; it was measuring "an enemy can reach this and it cannot
 * run" and reporting it as an invasion.
 * ---------------------------------------------------------------------------
 */
export function arrivals(board: Board, opts: ComplexOpts = {}): Obligation[] {
	const horizon = opts.arrivalHorizon ?? 3;
	const out: Obligation[] = [];
	if (horizon < 1) return out;

	const seen = new Map<Square, Reach>();
	const walk = (p: Square) => {
		let r = seen.get(p);
		if (!r) seen.set(p, (r = walkOn(opts.walks, board, p, opts.changed ?? [], horizon)));
		return r;
	};

	// WHAT COULD THIS PIECE POSSIBLY BEAR ON, from anywhere it can get to?
	//
	// §7: "invalidation is a lookup". The loop below was asking `bear` — a whole
	// reach walk's worth of work — for every (target, piece) pair on the board,
	// and answering "no" for nearly all of them. This is the one-sided upper
	// bound: the union of what the piece attacks from each square it can reach,
	// computed on an EMPTY board so it is a fact about geometry rather than about
	// occupancy, and therefore computable once per piece.
	//
	// It can only over-estimate — a blocked ray is still in the union — so nothing
	// true is discarded, and everything it rules out was going to cost a `bear`
	// call to rule out anyway. Measured: `arrivals` from 2.97 ms a position to the
	// figure in the header.
	const span = new Map<Square, SquareSet>();
	const couldBearOn = (p: Square): SquareSet => {
		let u = span.get(p);
		if (!u) span.set(p, (u = spanOf(opts.walks, board, p, horizon)));
		return u;
	};

	for (const t of board.occupied) {
		const prize = board.get(t);
		if (!prize) continue;
		// THE KING IS A TARGET. Excluding it is why yMTAV's Rc1 was never named.
		//
		// Will: "it should be in the ledger that the king will be captured by black
		// rook if it goes to c1."
		//
		// The cost-1 pass has always filed an ∞ row for a check that exists NOW —
		// `piece.role === 'king' ? seeValue(...)`. Only the arrival pass excluded
		// kings, so a check one move away was not a claim at all, no option
		// discharged or pursued it, and the move that gives it was not in the set.
		// That asymmetry has no justification in §1: an arrival row says "this man
		// changes hands in k", and the king is the man for whom that is worth ∞.
		//
		// It costs at most ONE ROW PER SIDE, not a flood of them: `best` keeps a
		// single row per target square, so every check available to a side collapses
		// to its fastest. And a side already in check is skipped by the `now > 0`
		// test below, exactly as a hanging piece is.
		const claimant = other(prize.color);
		// Already won: the cost-1 pass owns this square, and a row that says the
		// same thing twice is material owed twice.
		//
		// Read from §6's map when it is there. This loop was recomputing the
		// exchange at every occupied square — thirty SEEs a call — and `sites()` had
		// already computed every one of them before `obligations()` was entered.
		const now = opts.priced ? (opts.priced.get(t) ?? 0) : seeValue(board, t, claimant);
		if (now > 0) continue;

		// TWO ACCUMULATORS, because they are two different claims about one square.
		//
		//   clear   the ray fires now if the traveller gets there. A live row.
		//   gated   the ray fires when something moves off it. A LATENT row — the
		//           contingency ledger Will asked for.
		//
		// They are not ranked against each other, because a gated claim can be
		// strictly faster than a clear one and ranking would delete the clear one.
		// ♗d2–h6 bears on ♚f8 in one move and needs g7 to empty; ♖f1–f6 bears on it
		// in one move and needs nothing. Both are true and the ledger should hold
		// both.
		let clear: { weight: number; from: Square; via: Square; k: number; needs: Square[] } | null = null;
		// ONE PER TRAVELLER, not one per target — and that is `1lR5W` again. Kept as
		// a single row, the fastest gated claim wins, and at the root that is
		// ♖f1 x-raying f8 through its own f6 at d = 0. True, and not the one Will
		// asked to see: ♗d2–h6 through g7 is a move slower and it is the one that
		// mates. Different travellers make different claims about the same square
		// and collapsing them keeps whichever is nearest, which is the same mistake
		// `alts` was written to fix for the clear pass.
		// EVERY GATED RAY, NOT A SELECTION OF THEM.
		//
		// This held one row per traveller, ranked, capped at four. Will: "I have
		// never signed off on any heuristics being applied at all. There is no max
		// ledger length, no max number of rays, no 'kept the shortest one only'."
		//
		// He is right, and the ranking was not a detail — `ohoTK` failed because it
		// kept ♛f5→b1 (three gates) over ♛f5→h5 (one gate), and I reported that as a
		// bug in the tie-break rather than as the tie-break being the bug. A register
		// that decides which threats are worth registering is not a register.
		const gatedRays: { weight: number; from: Square; via: Square; k: number; needs: Square[] }[] = [];
		const better = (x: { k: number; weight: number }, y: typeof clear): boolean =>
			!y || x.k < y.k || (x.k === y.k && x.weight > y.weight);
		const alts: { from: Square; via: Square; needs: Square[] }[] = [];
		for (const p of board[claimant]) {
			if (!couldBearOn(p).has(t)) continue; // geometry says never; no walk needed
			const r = walk(p);
			const mover = board.get(p);
			if (!mover) continue;
			// `bear` STAYS, and the reason is a measured 1.6 points.
			//
			// It was dropped once, on the argument that the loop below iterates
			// `r.dist` anyway and the bearing test could decide — replacing `d !== k`
			// with a bound. That is not the same computation. `bear` returns 0 when
			// the piece ALREADY bears on the target, and the caller skips the piece
			// entirely on `k < 1`, because the cost-1 pass owns a claim that exists
			// now. Without it every such piece filed an arrival row saying what an
			// immediate row already said, and §1's "a row that says the same thing
			// twice is material owed twice" is not a style note: 58.8% to 57.2% over
			// the 200 easiest, identical in every bucket, and ten seconds a run
			// slower for it.
			//
			// So the CLEAR pass is exactly what it was, and the gated pass below is
			// additional rather than a generalisation of it.
			const k = bear(board, p, t, r);
			if (k < 1 || k > horizon) continue;
			if (clear && k > clear.k) continue; // a slower claim is never the row
			for (const [to, d] of r.dist) {
				if (d !== k) continue;
				// THE CHEAP TEST FIRST, and the clone only for survivors.
				//
				// The occupancy after the step is the current one without `p` and with
				// `to` — a SquareSet edit, no board at all — and that is everything
				// `attacks` needs. The first version cloned a board for every square at
				// distance k and then threw nearly all of them away.
				const occ = board.occupied.without(p).with(to);
				if (!attacks(mover, to, occ).has(t)) continue;
				const after = board.clone();
				const moved = after.take(p);
				if (!moved) continue;
				after.take(to);
				after.set(to, moved);
				// THE ARRIVAL SQUARE IS DELIBERATELY NOT PRICED, and that is a measured
				// negative rather than an oversight.
				//
				// The obvious objection to this row is that a queen "arriving" on a
				// square it is taken on has not arrived. Both repairs were built and
				// both are WRONG:
				//
				//   refuse the row when `seeValue(after, to, ·) > 0`   48.9% -> 45.5%
				//   subtract that cost from the weight instead         48.9% -> 45.5%
				//
				// Identical to the point of suspicion, and identical because a traveller
				// that is en prise is usually worth more than what it attacks, so
				// netting and refusing delete the same rows. Option-set recall fell 6.4
				// points with either: the graph stopped naming moves that are the answer.
				//
				// The reason is that a piece landing on a defended square is how half of
				// chess works. The arrival is a SACRIFICE and the claim is still real;
				// what the sacrifice is worth is a question about the position after the
				// exchange, which is the next node's business and not this row's.
				// Pricing it here prices one side of a trade and calls it a verdict.
				// A king prize is a mate claim: ordered by how soon, not flat at ∞.
				const raw = seeValue(after, t, claimant);
				if (!(raw > 0)) continue;
				const weight = prize.role === 'king' ? MATE - (k + 1) * MATE_STEP : raw;
				// THE WHOLE RAY IS THE CONDITION, not the squares the piece stops on.
				//
				// `routeSteps` returns stop-to-stop legs, so a slider that arrives in ONE
				// move had `needs = []` — nothing at all. Γ's block section reads
				// `o.needs` for a deferred row, so a row with no needs has no line, and a
				// row with no line cannot be interposed against. `1lR5W`: ♖f1×f6 bears on
				// ♚f8, and Γ filed **zero** discharges for it — not a capture, not a
				// block, not an evasion — so every one of White's twenty-two moves
				// collected the same mate and the move that actually gives it tied with
				// twenty-one that do not. Will: "the top moves are listed as mate in 2 but
				// the first move contributes nothing to that."
				//
				// Two families of square were missing, and they are the same kind of
				// thing — AMEND-7.2's "a slider registers the whole ray", asked of a
				// journey instead of an edge:
				//
				//   TRAVEL   what the piece slides OVER between two stops. f2–f5 for
				//            ♖f1–f6. Occupy one and the journey does not happen.
				//   FIRE     what lies between the arrival square and the target. f7 for
				//            ♖f6→♚f8. Occupy one and the claim does not bear.
				//
				// Both are empty right now — the walk found the first and `attacks` the
				// second — so this cannot make a live row latent today. What it does is
				// give the row a LINE, which is what a defender interposes on, and what
				// the ledger shows as `blocked by …` once someone stands there.
				const road = new Set<Square>();
				for (const [a, b] of routeSteps(r, to)) {
					for (const mid of between(a, b)) road.add(mid);
					road.add(b);
				}
				for (const mid of between(to, t)) road.add(mid);
				road.delete(to);
				road.delete(p);
				// Every member is empty right now — the walk would not have crossed a
				// travel square otherwise, and `attacks` would not have fired through an
				// occupied one — so this row is live. The gated pass below is where
				// occupied squares get into `needs`.
				const cand = { weight, from: p, via: to, k, needs: [...road] };
				alts.push({ from: p, via: to, needs: cand.needs });
				if (better(cand, clear)) clear = cand;
			}
		}
		// ---- THE CONTINGENCY LEDGER: a ray that is registered though it is blocked.
		//
		// Will: "why haven't we registered the bishop threat contingent upon the
		// blocking pawn on g7 from the beginning? … A ray is a registered threat
		// even if blocked (just registered in the contingency ledger)."
		//
		// `1lR5W` is the case. The mate is 2.♖×f6+ g7×f6 3.♗h6#, and the row that
		// carries it — ♗ on h6, bearing on ♚f8 THROUGH g7 — could not be filed,
		// because `bear` asks about the board as it stands and the pawn is on g7.
		// What got filed instead was `f8 ← ♗d2 via g7`: the bishop travelling ONTO
		// g7, ♗h6 then ♗×g7+, a different and slower claim that Γ answers with
		// cost-2 blocks on the diagonal.
		//
		// The test is the same one, asked THROUGH the blockers rather than around
		// them — `between(to, t)` is the only thing that can stop a slider bearing
		// on `t` from `to`, so removing exactly that set asks "would this fire if
		// the line cleared" — and what it removed becomes `needs`.
		//
		// `needs` says EMPTY, not "captured", and that is the distinction Will drew:
		// "the ray goes live when the pawn is removed, which in this particular
		// solution does not happen on the pawn's capture but on the pawn moving to
		// capture the rook." g7×f6 clears g7 by the pawn LEAVING it. A model that
		// waits for the blocker to be taken never sees that; a model that asks
		// whether the square is empty does not have to.
		//
		// FROM d = 0, unlike the clear pass. A piece that already bears through a
		// blocker is the purest form of this — the x-ray standing on the board — and
		// the cost-1 pass cannot own it, because the claim does not fire.
		//
		// KING TARGETS ONLY, and that bound is why this is affordable. The scan is
		// over every (piece, reachable square) rather than the one distance `bear`
		// reports, and run for every prize on the board it cost ten seconds a run
		// for nothing. A contingent ray is worth registering where the contingency
		// is worth the game.
		//
		// IT CHANGES NO PRICE, and that is checked rather than asserted. The rows
		// carry `contingent: true`, `isLive` is false for them unconditionally, and
		// `gamma` and `traverse` both skip them before the recurrence is entered.
		// Run against the same build with the pass excised, the corpus comes out
		// BIT-IDENTICAL — 1508 found, 64 blind, 341 tied, 743 wrong over 2656 plies.
		// It is a ledger entry, and it is the substrate for tracing a contingency
		// into an exchange, which is a separate build.
		if (prize.role === 'king') {
			for (const p of board[claimant]) {
				if (!couldBearOn(p).has(t)) continue;
				const mover = board.get(p);
				if (!mover) continue;
				for (const [to, d] of walk(p).dist) {
					if (d > horizon) continue;

					const occ = board.occupied.without(p).with(to);
					const span = between(to, t);
					const gates = span.intersect(occ);
					if (gates.isEmpty()) continue; // not gated — the clear pass owns it
					if (!attacks(mover, to, occ.diff(span)).has(t)) continue;
					// The claim is about the board where the line is open, so that is the
					// board its weight is measured on. With the gate still standing the
					// SEE at `t` does not see this attacker at all and `raw > 0` would
					// refuse the row — deleting the claim for being contingent, which is
					// the whole thing being fixed.
					const after = board.clone();
					const moved = after.take(p);
					if (!moved) continue;
					after.take(to);
					after.set(to, moved);
					for (const g of gates) after.take(g);
					if (!(seeValue(after, t, claimant) > 0)) continue;
					const road = new Set<Square>(gates);
					for (const [a2, b2] of routeSteps(walk(p), to)) {
						for (const mid of between(a2, b2)) road.add(mid);
						road.add(b2);
					}
					road.delete(to);
					road.delete(p);
					gatedRays.push({ weight: MATE - (d + 1) * MATE_STEP, from: p, via: to, k: d, needs: [...road] });
				}
			}
		}

		// CAPPED, because rows are what the ledger is read from and an unbounded list
		// of contingent rays is a list nobody reads. Soonest first.
		const gated = gatedRays;

		if (!clear && !gated.length) continue;

		// A KING TARGET GETS ONE ROW PER ARRIVAL SQUARE, and this is `ydGWl`.
		//
		// `best` keeps ONE candidate per target square. For material that is fine —
		// a claim is a claim however it is reached, and the alternatives differ only
		// in route. For a KING they differ in whether it is mate.
		//
		// `ydGWl`: the row kept was `white wins K on b7 by ♗f1–a6`, which has three
		// discharges, and the real mate `♖a4–b4` went into `alts` and was never
		// offered as a move. The tie-break could not separate them because every
		// king row at the same `k` now has the same weight, so it kept whichever
		// piece came first by square index. A bishop on f1 beat a rook on a4 by
		// being nineteen squares earlier.
		//
		// So every checking arrival is its own row, and Γ says which of them cannot
		// be answered. That is the whole question for a mate and it cannot be
		// decided here — `arrivals` does not know what discharges exist.
		//
		// BOUNDED HARD, because rows are the traversal's exponent.
		//
		// Eight routes per king is sixteen extra rows in a position with two, and
		// §4's recurrence memoises on a mask over one side's rows — so eight was not
		// slow, it was a different complexity class, and the corpus run stopped
		// finishing. Three is enough to hold the mating route alongside the two most
		// plausible rivals, which is what this exists to do.
		// THE ALTERNATIVE ROUTES ARE NAMED, NOT FILED — and the difference is 900ms.
		//
		// `ydGWl` needs `♖a4–b4` to be OFFERED: the row kept `♗f1–a6`, which has
		// three discharges, and the real mate went into `alts` where no option
		// generator looked. The first repair filed one row per checking arrival so Γ
		// could judge each. It works — and it costs **1213 ms a ply against 339**,
		// because §4's recurrence memoises on a mask over one side's rows and three
		// extra rows is not a constant factor.
		//
		// But the row was never what was needed. The move only has to be NAMED; once
		// it is played the child position holds the mate as an immediate row and
		// prices it at `MATE` without any of this. So `choose.options()` reads `alts`
		// and the ledger stays the size it was.
		//
		// Cost is why this is here, and the measurement is why the first version is
		// not.
		// AT MOST ONE GATED ROW PER TARGET, and it is LATENT by construction — its
		// `needs` name squares that are occupied right now, so `isLive` is false and
		// both `gamma` and `traverse` skip it before the recurrence is entered. It
		// costs a line in the ledger and nothing in the exponent. What it buys is
		// that the threat is REGISTERED: the moment the gate empties, by capture or
		// by the blocker simply walking away, the same row is live.
		for (const best of [clear, ...gated]) {
			if (!best) continue;
			out.push({
			contingent: best !== clear,
			square: t,
			from: best.from,
			via: best.via,
			role: prize.role,
			weight: best.weight,
			// TRAVEL PLUS ONE, and this is the whole of FINDING-INVASION's complaint.
			//
			// `tempiLeft` gives the side at stake `deadline` tempi, or one fewer when
			// the claimant moves first. A traveller needs k moves to BEAR and one
			// more to TAKE, so the defender has k or k+1 — never k-1. Writing k here
			// would hand the claimant a free tempo, which is exactly the finding's
			// "the row prices one side's journey only", and it is arithmetic rather
			// than a missing condition.
			//
			// With it, Γ's `evade` at cost 1 arrives against every k ≥ 1 claim whose
			// target has somewhere safe to stand — so the finding's extra clause,
			// "and it cannot simply walk away in the same tempi", is not a clause at
			// all. It is what the deadline says once the deadline is right.
			deadline: best.k + 1,
			claimant,
			kind: 'arrival',
			// Display only. Nothing branches on it — it exists so a reader can see
			// that the row had a choice of routes and which one it kept.
			alts: alts.filter((a) => a.from !== best.from || a.via !== best.via).map((a) => ({ from: a.from, via: a.via })),
			needs: best.needs,
			enablers: [],
			});
		}
	}
	return out.sort((a, b) => a.square - b.square);
}

/** The whole state: §9's exchange complex, for one position. */
export function complex(pos: Chess, opts: ComplexOpts = {}): Complex {
	// §6 first, then §1. The ledger's weights are exchange values, and an exchange
	// value is only settled once the pieces that cannot be in two places have been
	// committed — which is a game, and `cluster.ts` plays it.
	// The board is consulted ONCE, here, to build the graph — §9's "after that the
	// board position should not need to be consulted". A caller that already holds
	// the state passes it and nothing is built at all.
	const st = opts.state ?? stateOf(pos.board);
	const withPrices =
		opts.cluster === false || opts.priced ? { ...opts, state: st } : { ...opts, state: st, priced: priced(st, pos.turn) };
	return {
		board: pos.board,
		turn: pos.turn,
		obligations: obligations(pos.board, withPrices),
	};
}

/**
 * Material from a FIXED reference — White's, positive means White is ahead.
 *
 * One number, not two. §9's minimax maximises it for White and minimises it for
 * Black, which is only expressible because the reference does not move with
 * whose turn it is.
 */
export function material(board: Board): number {
	let n = 0;
	for (const s of board.occupied) {
		const p = board.get(s);
		if (!p || p.role === 'king') continue;
		n += p.color === 'white' ? V[p.role] : -V[p.role];
	}
	return n;
}

/**
 * The complex's identity — §9's quotient.
 *
 * "Two positions with the same complex are the same state." So this is what
 * decides whether two moves are genuinely equivalent or the computation is
 * simply not seeing the difference. A surviving tie between moves with
 * DIFFERENT fingerprints is incompleteness, and a hard test rather than a
 * judgement call.
 *
 * Turn is included: the same obligations with the other player to move is a
 * different state, and that is the one asymmetry the system has.
 */
export function fingerprint(c: Complex): string {
	const rows = c.obligations
		.map(
			(o) =>
				`${makeSquare(o.square)}${o.from !== undefined ? '<' + makeSquare(o.from) : ''}` +
				`=${o.weight}/${o.deadline}${o.claimant[0]}${isLive(o, c.board) ? '' : '~'}`,
		)
		.sort();
	return `${c.turn[0]}|${material(c.board)}|${rows.join(',')}`;
}

/** Everything one side is on the hook for. A READING of the complex, not a build. */
export const owedBy = (c: Complex, side: Color): Obligation[] => c.obligations.filter((o) => o.claimant === other(side));

/** The largest live debt against `side`. */
export function worstFor(c: Complex, side: Color): number {
	const live = owedBy(c, side).filter((o) => isLive(o, c.board));
	return live.length ? Math.max(...live.map((o) => o.weight)) : 0;
}

// What each side owes, and by when.
//
// ---------------------------------------------------------------------------
// Implements DEFICIENCY.md §1, as amended by AMEND-7-ONE-EDGE.md.
//
// "A player is obliged to prevent any change in relative material." That single
// sentence is what removes the motif list: there is no fork detector here, no
// pin detector, no trapped-piece detector. There is a list of prospective
// material changes, and the motifs are what the covering condition does with it.
//
// The rewrite. The frozen baseline built an obligation only where an attack edge
// existed NOW, with `deadline` a field that was always 1. It therefore reported
// "nothing is happening" on a pawn walking d4-d5-d6-d7 to promote, which was
// 21.7% of the corpus (LEDGER-M1.md, the "blind" bucket). The fix is not a
// promotion detector. Under the amended §7 an edge carries a COST in tempi, so
// a promotion obligation is an edge to the promotion square with cost = pushes
// remaining, and §1's six rows stop being six kinds:
//
//   hanging piece   an edge to it, cost 1
//   fork prong      two such edges, from one move
//   mate            an edge to the king, cost 1, worth infinity
//   promotion       an edge to the promotion square, cost = pushes
//   invasion        an edge to the target, cost = the attacker's distance
//
// `kind` below is a LABEL for the sentence, never a branch in the logic.
//
// Not yet built, and named rather than approximated: **invasion** and
// **mate in k**. Invasion needs a reverse-reach query the ledger does not have
// yet; mate in k is the one row that is not a lookup at all. Their absence is a
// known hole in the correctness surface, which is the trade §9.5 makes.
// ---------------------------------------------------------------------------

import type { Board } from 'chessops/board';
import type { Chess } from 'chessops/chess';
import type { Square, Color, Role } from 'chessops/types';
import { seeValue, other, V } from './exchange';
import { empty as noPaths, ask, type Paths } from './paths';
import { reach, distance, routeSteps } from './reach';

/**
 * One prospective change in relative material.
 *
 * `weight` is a SEE and never a raw piece value (§1.1). A rook attacked by a
 * knight and defended twice is not a 500-point debt; it is whatever the exchange
 * actually comes to, which may be nothing at all.
 */
export type Obligation = {
	/** Where the material changes hands. */
	square: Square;
	/**
	 * The piece that will collect it, where that is a different square.
	 *
	 * A promotion obligation is about a pawn four moves away, and a sentence that
	 * cannot name which pawn is not a sentence. Absent for cost-1 rows, where the
	 * attacker is whatever the exchange at `square` says it is.
	 */
	from?: Square;
	/** What is at risk, or the piece that will arrive. For the sentence. */
	role: Role;
	/** The magnitude. Always a SEE, evaluated at the deadline. */
	weight: number;
	/** Tempi until collectable. 1 is an immediate threat. */
	deadline: number;
	/** Who collects if it goes unanswered. */
	claimant: Color;
	/** How to read this row aloud. Never branched on. */
	kind: 'immediate' | 'promotion';
	/**
	 * The ROUTE — squares that must be empty for this to cost `deadline`.
	 *
	 * `AMEND-7-ONE-EDGE.md`'s definition, and `AMEND-1B-NEEDS-IS-THE-ROUTE.md`
	 * settles the clash: this file used to store the OBSTRUCTIONS here and read
	 * "non-empty means latent" off the length. Two meanings for one field name in
	 * one codebase, which is how `watch(p, square, key)` shipped against a
	 * `watch(p, key, square)` signature.
	 *
	 * So a LIVE row now carries its route, which is what M4 needs to answer a
	 * race by blocking the file — and whether the row is live is a question asked
	 * of the board, never a stored field.
	 */
	needs: Square[];
	/**
	 * Squares that must be FILLED, by an enemy piece, for the shorter route.
	 *
	 * The trigger only pawns have. A pawn's diagonal is legal only onto an
	 * occupied square, so for a pawn — and no other piece — a square being filled
	 * can SHORTEN the route. An enemy knight arriving on b6 opens a5×b6 and the
	 * race restarts on the b-file.
	 */
	enablers: Square[];
	/**
	 * `weight` discounted for how far off it is.
	 *
	 * Checkpoint M2 measured what a deferred claim is worth: a distance computed
	 * on a frozen board survives one ply intact 94.4% of the time, and the drift
	 * compounds. So a claim four tempi out rests on three plies of geometry that
	 * may already have moved, and treating it as equal to an immediate one
	 * overstates it. 0.944^(τ−1) — measured, not chosen.
	 */
	confidence: number;
};

/** Measured in CHECKPOINT-M2.md: the share of distances unchanged after a ply. */
const PER_PLY_SURVIVAL = 0.944;

const withConfidence = (o: Omit<Obligation, 'confidence' | 'needs' | 'enablers'> & Partial<Pick<Obligation, 'needs' | 'enablers'>>): Obligation => ({
	needs: [],
	enablers: [],
	...o,
	confidence: PER_PLY_SURVIVAL ** Math.max(0, o.deadline - 1),
});

/**
 * Collectable now, at the stated cost — as opposed to waiting on a square.
 *
 * A question asked of the BOARD, per `AMEND-7-ONE-EDGE.md`. The old form read
 * `o.needs.length === 0` and answered without one, which is a stored verdict
 * pretending to be a derived one.
 *
 * BOTH triggers must be satisfied. `enablers` means "a square must be filled
 * before this route exists", which is no more live than "a square must be
 * emptied" — and reading only `needs` marked a pawn's optimistic diagonal as an
 * immediate threat, which is how an empty b8 became a promotion in one.
 */
export const isLive = (o: Obligation, board: Board): boolean =>
	!o.needs.some((s) => board.occupied.has(s)) && !o.enablers.some((s) => !board.occupied.has(s));

/** The squares actually in the way right now. Derived, never stored. */
export const blockedBy = (o: Obligation, board: Board): Square[] => o.needs.filter((s) => board.occupied.has(s));

const LAST_RANK: Record<Color, number> = { white: 7, black: 0 };

/**
 * What a promotion is actually worth, on the board it lands on.
 *
 * §1.1, and the bug it exists to prevent. Writing `V[queen] − V[pawn]` and
 * stopping is what made `race.ts` wrong on rF0aS: the new queen can be taken the
 * moment she arrives. Deferring the collection does not defer the recapture, so
 * the magnitude is the exchange at the promotion square evaluated THERE — with
 * the pawn gone from where it stood and a queen standing where it is going.
 */
function promotionWorth(board: Board, pawn: Square, promo: Square, mover: Color): number {
	const after = board.clone();
	after.take(pawn);
	after.take(promo);
	after.set(promo, { color: mover, role: 'queen' });
	const takenBack = seeValue(after, promo, other(mover));
	return Math.max(0, V.queen - V.pawn - takenBack);
}

export type LedgerOpts = {
	/** Shared distance index. One is made per call if none is supplied. */
	paths?: Paths;
	/** Ignore promotions further off than this. */
	horizon?: number;
};

/**
 * Everything `owed` is on the hook for, largest first.
 *
 * The king needs no special case. `V[king] = Infinity`, so a king under attack
 * produces an infinite obligation and everything downstream treats check as the
 * debt that must be serviced before any other — `FORMALISM.md` §1.4 and §4.4
 * falling out of the value assignment rather than being asserted.
 */
export function ledger(pos: Chess, owed: Color, opts: LedgerOpts = {}): Obligation[] {
	const board = pos.board;
	const taker = other(owed);
	const horizon = opts.horizon ?? 6;
	const paths = opts.paths ?? noPaths();
	const out: Obligation[] = [];

	// Cost-1 edges: what the opponent can collect on the next move.
	for (const square of board[owed]) {
		const piece = board.get(square);
		if (!piece) continue;
		const weight = seeValue(board, square, taker);
		if (weight > 0) {
			out.push(withConfidence({ square, role: piece.role, weight, deadline: 1, claimant: taker, kind: 'immediate' }));
		}
	}

	// Cost-k edges: a pawn walking to the last rank. The obligation exists from
	// the moment the walk is possible, which is the whole point — the baseline
	// saw nothing until the pawn was one square away and the exchange was already
	// on the board.
	for (const pawn of board[taker]) {
		if (board.get(pawn)?.role !== 'pawn') continue;
		type Cand = { square: Square; d: number; weight: number; needs: Square[]; enablers: Square[] };
		// Live and latent are ranked SEPARATELY, and live always wins.
		//
		// The first version kept one `best` and compared a latent candidate's floor
		// against a live candidate's distance. A floor ignores what is in the way, so
		// it is always the smaller number — and a pawn with a real route to a8 in
		// five was demoted to a latent row on c8 in three. Measured: 76 live rows on
		// the blind bucket became 36. A latent row is a fallback, never a rival.
		let bestLive: Cand | null = null;
		let bestLatent: Cand | null = null;
		const keep = (c: Cand, cur: Cand | null) => !cur || c.d < cur.d || (c.d === cur.d && c.weight > cur.weight);
		for (let file = 0; file < 8; file++) {
			const promo = (LAST_RANK[taker] * 8 + file) as Square;
			// A promotion path is not a file: the pawn may deviate by capturing, so
			// the distance comes from the walk rather than from arithmetic on ranks.
			const live = ask(paths, board, pawn, promo, { limit: horizon });
			const weight = promotionWorth(board, pawn, promo, taker);
			if (weight <= 0) continue;

			if (Number.isFinite(live.d) && live.d >= 1 && live.d <= horizon) {
				// Live, and it carries its ROUTE. `forced` is the squares on EVERY minimal
				// route — the exact half of the disjunction, per AMEND-7 — so filling one
				// certainly raises the cost and blocking one is a real discharge. Storing
				// `[]` here left M4 unable to answer any race by blocking the file.
				//
				// The route splits into BOTH triggers, and this is where a pawn differs
				// from every other piece. A push step must stay EMPTY; a capture step must
				// stay OCCUPIED, because a pawn's diagonal is legal only onto an enemy. So
				// a knight standing on the route is not always an obstruction — sometimes
				// it is the reason the route exists, and moving it away breaks the race.
				//
				// The route is live NOW, so the split is decidable by occupancy alone: a
				// forced square that is empty must stay empty, one that is occupied must
				// stay occupied. Filtering the whole set into `needs` marked live rows
				// latent wherever the pawn's shortest path went through a capture.
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

			// Latent. The route does not exist YET. Recording nothing here is the
			// asymmetry AMEND-1-LATENT-RACE.md corrects: every other contingency in
			// the system stores its unblocking trigger, and this one stored only the
			// blocking one. A blocked pawn is an x-ray whose ray takes several tempi.
			//
			// Two ways to be latent, and they carry different triggers:
			//
			//   needs    — the route, which currently has pieces standing on it. This
			//              is `Path.obstructions`: the empty-board walk, keeping whatever
			//              lies along it. Occupied, so `isLive` reads false; emptying one
			//              is the trigger.
			//   enablers — the route needs a CAPTURE that has nothing to capture. Only
			//              a pawn has this trigger, because only a pawn's diagonal is
			//              legal solely onto an occupied square.
			const needs = live.obstructions.filter((sq) => sq !== promo);
			const enablers: Square[] = [];
			let floor = live.floor;

			const dream = reach(board, pawn, { limit: horizon, pawnMayCaptureAnywhere: true });
			const dreamt = distance(dream, promo);
			if (Number.isFinite(dreamt) && dreamt <= horizon) {
				floor = Math.min(floor, dreamt);
				// Only the steps the optimistic route actually took, and only the ones
				// that are diagonal onto an empty square. Walking `dream.dist` instead
				// filed every square the pawn could see — a8 included as an enabler for
				// promoting to a8 — which is what made these rows meaningless.
				for (const [from, to] of routeSteps(dream, promo)) {
					if ((from & 7) === (to & 7)) continue; // a push, not a capture
					if (board.get(to)) continue; // already occupied: nothing to enable
					enablers.push(to);
				}
			}
			if (!Number.isFinite(floor) || floor > horizon) continue;
			if (!needs.length && !enablers.length) continue;
			const cand = { square: promo, d: floor, weight, needs, enablers: [...new Set(enablers)].sort((a, b) => a - b) };
			if (keep(cand, bestLatent)) bestLatent = cand;
		}
		const best = bestLive ?? bestLatent;
		if (!best) continue;
		// NOT a `pushes <= 1` gate.
		//
		// `race.ts` had one, justified by "the search can see that one anyway", and
		// I copied the justification across without checking that it still held. It
		// does not. The cost-1 pass above finds CAPTURES of pieces that exist; a
		// pawn stepping onto an empty last rank is not one, so gating on d <= 1
		// made the most urgent promotion in chess invisible.
		//
		// The real double-count is narrower: if the promotion square already holds
		// a piece of the owed side, the cost-1 pass has that exchange.
		const sitting = board.get(best.square);
		if (sitting && sitting.color === owed) continue;
		out.push(
			withConfidence({
				square: best.square,
				from: pawn,
				role: 'pawn',
				weight: best.weight,
				deadline: best.d,
				claimant: taker,
				kind: 'promotion',
				needs: best.needs,
				enablers: best.enablers,
			}),
		);
	}

	// Descending by what it is actually worth once its distance is priced in.
	return out.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
}

/**
 * The largest single debt, discounted. `Infinity` means check.
 *
 * LIVE obligations only. A latent one is a reason to watch a square and a
 * sentence to say — "if that knight moves, the a-pawn queens" — but it is not
 * owed yet, and counting it would make almost every position look lost, since
 * nearly every pawn has some latent route to some promotion square.
 */
export const worst = (E: Obligation[], board: Board): number => {
	const live = E.filter((o) => isLive(o, board));
	return live.length ? Math.max(...live.map((e) => e.weight * e.confidence)) : 0;
};

/** The largest debt at face value, ignoring how far off it is. For the sentence. */
export const worstFace = (E: Obligation[]): number => (E.length ? Math.max(...E.map((e) => e.weight)) : 0);

/**
 * The total, for reporting only — never for deciding.
 *
 * Two debts of a pawn each do not add up to a piece, because the opponent
 * collects one per tempo and you get a move in between. The covering condition
 * is what decides; this exists so a harness can say how loaded a position is.
 */
export const owedTotal = (E: Obligation[]): number =>
	E.reduce((n, e) => (Number.isFinite(e.weight) ? n + e.weight : n), 0);

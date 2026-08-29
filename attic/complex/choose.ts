// Reading the move off the graph — §9's game, one edit deep.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §9, on the symmetric complex of AMEND-0 and the traversal
// of AMEND-6.1.
//
// Will:
//
//   "Each branch on the contingency graph changes the portfolio of exchange
//    options seen by both players. Each branch is therefore priced in implied
//    material. Therefore we can calculate backwards how to minimax over the
//    contingency graph. Every decision is priced for both players through its
//    branching implications."
//
// and §9 itself: "two players alternately edit a single graph, each minimaxing
// the material it implies, choosing from an OPTION SET THE GRAPH ITSELF
// ENUMERATES."
//
// THIS IS NOT A SEARCH, and the distinction is the whole of `rank.ts`'s deletion.
//
//   * The option set is not the legal moves. It is the edits the graph names:
//     Γ's discharges of what is claimed against me, and the first step of the
//     route toward what I claim. Over the corpus that is a handful of moves out
//     of thirty-odd legal ones, and it is enumerated rather than filtered.
//
//   * A branch's price is not a heuristic evaluated at a horizon. It is
//     `traverse()` of the complex the edit produces — which reads deadlines,
//     races and promotions to whatever depth they run to, because a deadline is
//     not a ply count. There is no "the change was not visible at this horizon"
//     failure available here; that error belongs to search.
//
//   * Nothing is scored one move into the future in the sense that was rejected.
//     The edit IS the branch, and the branch's leaf value IS its price. Reading
//     it is reading the graph, not exploring it.
//
// WHAT IS ONE EDIT DEEP, and named rather than hidden: the opponent's reply is
// priced by the traversal of the child complex rather than by a second round of
// edits. That is exact whenever the child's obligations are all schedulable —
// which is what the traversal computes — and it is an approximation exactly
// where the reply is itself a claim-creating edit. §9's alternation is not yet
// unrolled past one step.
// ---------------------------------------------------------------------------

import type { Board } from 'chessops/board';
import type { Chess } from 'chessops/chess';
import type { Color, Square } from 'chessops/types';
import { other } from './exchange';
import { isLive, complex, type Complex, type ComplexOpts, type Obligation } from './complex';
import { gamma, tempiLeft, type Discharge } from './gamma';
import { traverse, type Outcome, type TraverseOpts } from './traverse';
import { reach, routeSteps, walksFor } from './reach';
import { changedSquares } from './paths';
import { stateOf, after as stateAfter, type State } from './state';

export type Option = {
	from: Square;
	to: Square;
	/** Why the graph named it. For the sentence, never branched on. */
	why: 'discharge' | 'pursue';
	/** The row it is about. */
	obligation: number;
};

export type Priced = Option & {
	/** Material from White's reference after the edit, out of the traversal. */
	value: number;
	/** The child's outcome, for reading aloud. */
	outcome: Outcome;
};

/**
 * The edits the graph names for the side to move.
 *
 * Two kinds, and they are the two ends of the same fact:
 *
 *   DISCHARGE  a Γ edge answering something claimed against me. Only cost-1
 *              edges: a dearer edge is a plan, not a move, and its first step is
 *              a cost-1 edge of its own if it is one at all.
 *   PURSUE     the first step of the route toward something I claim. This is the
 *              half that was missing while the complex filed no arrival rows, and
 *              it is why the traversal could price a position but not pick a
 *              move: every offensive answer lives here.
 *
 * Filtered through `pos.dests` at the end, because Γ is geometry and a pinned
 * piece has no move however well it would answer.
 */
// `OptionOpts.fromOutcome` LIVED HERE and measured at exactly nothing.
//
// The idea was to narrow the discharge candidates to rows the traversal says are
// at risk. It changes no number at all — 53.4% and 9.3% unoffered either way —
// because the traversal accounts for EVERY live row as either collected or
// scheduled, so "at risk" is the whole list. There is a test asserting precisely
// that invariant, which is how the idea should have been dismissed before it was
// written. Deleted per the ablation rule.

export function options(c: Complex, pos: Chess, edges: Discharge[] = gamma(c)): Option[] {
	const me = c.turn;
	const out = new Map<string, Option>();
	const keep = (o: Option) => {
		const k = `${o.from}>${o.to}`;
		if (!out.has(k)) out.set(k, o);
	};

	for (const e of edges) {
		const row = c.obligations[e.obligation];
		if (other(row.claimant) !== me) continue; // not my debt to pay
		if (e.cost > tempiLeft(row, c.turn)) continue; // arrives too late to matter
		if (e.cost === 1) {
			keep({ from: e.piece, to: e.to, why: 'discharge', obligation: e.obligation });
			continue;
		}
		// A DEARER EDGE IS A PLAN, AND ITS FIRST STEP IS STILL A MOVE.
		//
		// The first version kept only cost-1 edges, on the reasoning that anything
		// slower is a plan rather than a move. But §9.3 enumerates candidates as
		// "for each square the ledger cares about, WHICH PIECES REACH IT WITHIN τ"
		// — the whole distance table for deferred rows, not only its d = 1 layer.
		// Starting a two-move defence is a move, and dropping it was the option set
		// being narrower than the theory says.
		const r = reach(c.board, e.piece, { limit: e.cost });
		for (const [a, b] of routeSteps(r, e.to)) if (a === e.piece) keep({ from: a, to: b, why: 'discharge', obligation: e.obligation });
	}

	c.obligations.forEach((row, i) => {
		if (row.claimant !== me) return; // not mine to press
		if (!isLive(row, c.board)) return;
		if (row.from === undefined) return; // nothing travelling: it is already due
		// EVERY ROUTE TO THE CLAIM, not only the one the row kept.
		//
		// `arrivals` keeps one (traveller, arrival square) per target because a claim
		// is a claim however it is reached — true of PRICE, and false of naming a
		// move. `ydGWl`: the row kept ♗f1–a6, which Black answers three ways, and the
		// mate ♖a4–b4 sat in `alts` and was never offered. Reading them here names
		// the move without filing rows the traversal would then have to carry, which
		// was measured at 1213 ms a ply against 339.
		for (const route of [{ from: row.from, via: row.via }, ...(row.alts ?? [])]) {
			if (route.from === undefined) continue;
			const target = route.via ?? row.square;
			if (route.from === target) continue;
			const r = reach(c.board, route.from, { limit: row.deadline });
			for (const [a, b] of routeSteps(r, target)) if (a === route.from) keep({ from: a, to: b, why: 'pursue', obligation: i });
		}
	});

	return [...out.values()].filter((o) => {
		const dests = pos.dests(o.from);
		return dests.has(o.to);
	});
}

/** Apply one edit. Promotion is always a queen — §1.1 prices no other. */
function after(pos: Chess, o: Option): Chess | null {
	const next = pos.clone();
	const piece = pos.board.get(o.from);
	const promo = piece?.role === 'pawn' && (o.to >> 3 === 0 || o.to >> 3 === 7);
	try {
		next.play(promo ? { from: o.from, to: o.to, promotion: 'queen' } : { from: o.from, to: o.to });
	} catch {
		return null;
	}
	return next;
}

/**
 * Every option, priced by the complex it produces.
 *
 * The price is `traverse().value` — material from White's fixed reference — so
 * the same number serves both players and the minimax is a max or a min of it
 * rather than two incomparable quantities. That fixed reference is the whole
 * reason AMEND-0 removed the roles.
 */
export function priced(pos: Chess, opts: ComplexOpts & TraverseOpts = {}): Priced[] {
	// THE GRAPH IS BUILT ONCE. Will: "the dependency graph is only built from the
	// initial state … a single move only means updating a handful of edges."
	//
	// So the parent's state is built here and each option's is `after()` on it —
	// two occupancy bits and the mover's own edges re-anchored, not a rebuild.
	// `state.test.ts` pins `after()` equal to building from scratch on the value
	// of every exchange on the board, over two hundred moves, which is what makes
	// this a substitution rather than an approximation.
	const st = opts.state ?? stateOf(pos.board);
	const c = complex(pos, { ...opts, state: st });
	const out: Priced[] = [];
	// §7's third index row, shared across the options of this ply. Every child
	// board differs from this one by a couple of squares, and 67.3% of the walks
	// are byte for byte identical, so a walk is reused whenever no changed square
	// could have affected it. See `reach.walksFor`.
	//
	// WORTH ABOUT 4%, not the 2x the reuse rate suggests. The invalidation test and
	// the geometry it needs cost nearly as much as the walks they save at this
	// scale, and making the cache lazy did not change that. Kept because it is
	// consistently positive across interleaved runs, because it is what §7
	// describes, and because writing it caught a castling bug in an afternoon —
	// but it is not the answer to the cost.
	const horizon = opts.arrivalHorizon ?? 0;
	const walks = horizon > 0 && opts.walkCache !== false ? walksFor(pos.board, horizon) : undefined;
	for (const o of options(c, pos)) {
		const next = after(pos, o);
		if (!next) continue;
		const changed = changedSquares(pos.board, next.board);
		const outcome = traverse(
			complex(next, { ...opts, walks, changed, state: childState(st, next.board, o, changed) }),
			undefined,
			opts,
		);
		out.push({ ...o, value: outcome.value, outcome });
	}
	return out;
}

/**
 * The child's state — by edit where an edit describes the move, by build where it
 * does not.
 *
 * `state.after()` moves ONE man. Castling moves two, en passant empties a third
 * square, and both are legal moves this loop will hand it. Rather than teach
 * `after()` three special cases, the shape of the move is asked directly: a move
 * that touched more than two squares is not the simple case and gets a build.
 *
 * That is not a fallback hiding a defect — it is the same distinction
 * `state.test.ts` draws when it excludes those moves, made explicit at the one
 * place that can encounter them. They are about 2% of options.
 */
function childState(parent: State, board: Board, o: Option, changed: readonly Square[]): State {
	if (changed.length > 2) return stateOf(board);
	const promo = board.get(o.to)?.role;
	const was = parent.men.get(o.from)?.role;
	return stateAfter(parent, o.from, o.to, promo && promo !== was ? promo : undefined);
}

/**
 * The edit §9's minimax takes.
 *
 * White maximises the material, Black minimises it. A tie is returned as a tie —
 * `best.length > 1` — and never broken. Will: "no moves can be tied, other than
 * equivalent non-zero scores", so a surviving tie is a statement about the
 * COMPLEX, not a decision to be made by some other rule. Breaking one with a
 * statistic is what this whole rebuild exists to have deleted.
 */
export function choose(pos: Chess, opts: ComplexOpts & TraverseOpts = {}): { best: Priced[]; all: Priced[] } {
	const all = priced(pos, opts);
	if (!all.length) return { best: [], all };
	const mine = (a: number, b: number) => (pos.turn === 'white' ? Math.max(a, b) : Math.min(a, b));
	const top = all.reduce((n, p) => mine(n, p.value), all[0].value);
	return { best: all.filter((p) => p.value === top), all };
}

/** Which rows a side is on the hook for. A reading, for the sentence. */
export const facing = (c: Complex, side: Color): Obligation[] =>
	c.obligations.filter((o) => other(o.claimant) === side && isLive(o, c.board));

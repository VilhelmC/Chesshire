// Distances that stay true, because they know what would falsify them.
//
// ---------------------------------------------------------------------------
// Implements DEFICIENCY.md §7 as amended by AMEND-7-ONE-TABLE.md.
//
// Will: "Why would you use a frozen board distance? We should be storing paths
// with blocking triggers just like we do with the pin and blocking
// contingencies. Anything changes on the path, the race changes immediately and
// we already know how. The race paths are exactly the same as an xray."
//
// Both halves of that are load-bearing.
//
// The first: there is no approximation here. A cached distance is not "right
// most of the time" — it is right, or it has been invalidated, because every
// square whose occupancy could change it is indexed against it. Measuring the
// drift of a frozen distance (94% survives a ply) prices a shortcut this file
// exists so that nobody has to take.
//
// The second is the simplification. An x-ray is a race path with ONE critical
// square; a race path is an x-ray with several. `appearsIfEmpty` and
// `diesIfFilled` in graph.ts are this table at d = 1, and the reason `race.ts`
// and `invade.ts` each needed hand-cut fences is that they were re-deriving per
// motif what one index gives uniformly.
//
// Invalidation is deliberately CONSERVATIVE. The shortening direction — a
// square empties and a better route appears — is found from an unobstructed
// walk, which is a superset of the squares that truly matter. So this may
// recompute when nothing changed. It may never miss.
// ---------------------------------------------------------------------------

import { SquareSet } from 'chessops/squareSet';
import type { Board } from 'chessops/board';
import type { Square } from 'chessops/types';
import { reach, distance, critical, blockers, type ReachOpts } from './reach';

/** One question the index is holding an answer to. */
export type Path = {
	from: Square;
	to: Square;
	/** Plies, on the occupancy this was computed against. Infinity if no route. */
	d: number;
	/**
	 * Plies on an EMPTY board — what this would cost if nothing were in the way.
	 *
	 * The cost of the edge while it is LATENT. Without it a blocked route has no
	 * number at all, and AMEND-1-LATENT-RACE.md needs one: "that pawn is four
	 * moves from queening once the knight leaves" is the sentence, and it cannot
	 * be said from `d = Infinity`.
	 */
	floor: number;
	/**
	 * Every square whose filling could lengthen the walk — route nodes and the
	 * squares slider steps pass over. Conservative; see `reach.blockers`.
	 */
	gates: Square[];
	/**
	 * The subset that is exactly critical: on EVERY minimal route.
	 *
	 * What a human should be told to watch, and what the overlay draws. Filling
	 * one of these certainly lengthens the walk; the wider `gates` set is for
	 * invalidation, where being conservative is free and being wrong is not.
	 */
	forced: Square[];
	/**
	 * Occupied squares that might be shortening the walk by being there.
	 *
	 * Inexact by construction, and inexact in the safe direction. The square that
	 * would open a better route is not on the current route — it is on one that
	 * does not exist yet — so it is found by walking an empty board and keeping
	 * whatever is occupied along the way.
	 */
	obstructions: Square[];
};

/**
 * The cache key for a question.
 *
 * A branded type, because a key and a Square are both `number` and the compiler
 * cannot tell them apart — which is how the first version of this file shipped
 * `watch(p, square, key)` against a `watch(p, key, square)` signature and
 * invalidated nothing at all. Every test caught it; the type system did not.
 */
export type PathKey = number & { readonly __path: unique symbol };
export const key = (from: Square, to: Square) => (((from << 6) | to) as PathKey);

export type Paths = {
	/** The answers, by (from, to). */
	cache: Map<PathKey, Path>;
	/** For each square, the answers its occupancy could falsify. */
	watchers: Map<Square, PathKey[]>;
};

export const empty = (): Paths => ({ cache: new Map(), watchers: new Map() });

function watch(p: Paths, square: Square, k: PathKey) {
	const at = p.watchers.get(square);
	if (at) at.push(k);
	else p.watchers.set(square, [k]);
}

/**
 * Answer a distance question and remember what would change the answer.
 *
 * Two walks, once. The first is the real one and yields `d` and the gates; the
 * second ignores occupancy entirely and yields the squares that are in the way
 * of a route that would otherwise exist. After this, a move is a lookup.
 */
export function ask(p: Paths, board: Board, from: Square, to: Square, opts?: ReachOpts): Path {
	const k = key(from, to);
	const had = p.cache.get(k);
	if (had) return had;

	const real = reach(board, from, opts);
	const d = distance(real, to);
	// The squares every minimal route stands on, PLUS the squares its slider steps
	// pass over. Node-only gates missed the second kind and let a stale answer
	// survive a move that broke it — see reach.blockers.
	const gates = d === Infinity ? [] : blockers(real, to);
	/** The subset that is exactly critical, for the overlay and the sentence. */
	const forced = d === Infinity ? [] : critical(real, to);

	// The shortening direction: which occupied square, if it left, would open a
	// better route? That square is not on the current route — it is on one that
	// does not exist yet — so it takes a walk on an empty board to find.
	//
	// The rule is deliberately broad: any occupied square the piece could reach,
	// unobstructed, in fewer than `d` plies. Sound, and provably so even for the
	// transit squares a slider passes over rather than stops on — because a
	// slider CAN stop on them, so their unobstructed distance is bounded by the
	// route that crosses them.
	//
	// A tighter rule was tried and withdrawn: requiring `s` to sit on a shorter
	// unobstructed route, via a second walk from the target, misses exactly the
	// transit case and let a stale answer survive `c3c4`. There is no cheap exact
	// characterisation here, because the question is about a route that does not
	// exist yet. Broad and sound beats tight and wrong; the cost is retention,
	// which is measured rather than assumed.
	const bare = board.clone();
	for (const s of board.occupied) if (s !== from) bare.take(s);
	const openFrom = reach(bare, from, opts);

	const obstructions: Square[] = [];
	for (const s of board.occupied) {
		if (s === from) continue;
		const a = openFrom.dist.get(s);
		if (a !== undefined && a < d) obstructions.push(s);
	}

	const path: Path = { from, to, d, floor: openFrom.dist.get(to) ?? Infinity, gates, forced, obstructions };
	p.cache.set(k, path);
	// The origin and the target themselves: a piece that moves away, or a target
	// that is captured, invalidates the question rather than the answer.
	for (const s of [from, to, ...gates, ...obstructions]) watch(p, s, k);
	return path;
}

/**
 * Drop every answer that the changed squares could have falsified.
 *
 * Takes the squares whose contents differ, which is what a move is — the same
 * board diff `graph.applyMove` uses, so castling, en passant and promotion need
 * no special case here either.
 */
export function invalidate(p: Paths, changed: Iterable<Square>): number {
	const dead = new Set<PathKey>();
	for (const s of changed) for (const k of p.watchers.get(s) ?? []) dead.add(k);
	for (const k of dead) {
		const path = p.cache.get(k);
		p.cache.delete(k);
		if (!path) continue;
		for (const s of [path.from, path.to, ...path.gates, ...path.obstructions]) {
			const list = p.watchers.get(s);
			if (!list) continue;
			const at = list.indexOf(k);
			if (at >= 0) list.splice(at, 1);
			if (!list.length) p.watchers.delete(s);
		}
	}
	return dead.size;
}

/** Squares whose contents differ between two boards. What a move is. */
export function changedSquares(before: Board, after: Board): Square[] {
	const out: Square[] = [];
	for (let s = 0 as Square; s < 64; s++) {
		const a = before.get(s);
		const b = after.get(s);
		if (!a && !b) continue;
		if (!a || !b || a.role !== b.role || a.color !== b.color) out.push(s);
	}
	return out;
}

/**
 * The whole step: invalidate against the diff, then answer from the new board.
 *
 * Callers should not have to remember the order, and getting it backwards would
 * return an answer computed against the previous occupancy — which is precisely
 * the staleness this file exists to make impossible.
 */
export function advance(p: Paths, before: Board, after: Board): number {
	return invalidate(p, changedSquares(before, after));
}

/** For the overlay: every square currently gating any cached answer. */
export function gatesInPlay(p: Paths): SquareSet {
	let out = SquareSet.empty();
	for (const path of p.cache.values()) for (const g of path.gates) out = out.with(g);
	return out;
}

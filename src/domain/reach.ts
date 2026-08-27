// How far, and by which squares.
//
// ---------------------------------------------------------------------------
// Implements DEFICIENCY.md §7, third row, and supplies §6.1's fourth coupling.
//
// This is the layer §8 names as the dangerous one — "the ledger is bookkeeping
// and can be tested exhaustively; the deadline test is judgement" — and the
// place this codebase has already shipped two bugs. Both are guarded here:
//
//   * `race.ts` measured a defender's journey on the CURRENT board rather than
//     on the board the pawn will have left behind. Routes open behind a pawn as
//     it advances. So `reach` takes an occupancy, never a position, and the
//     caller must decide which board it means. There is no default.
//
//   * It treated a defender arriving at the pawn's own square as a block, when
//     reaching an occupied square is a capture. `stopAt` says which squares end
//     a route and why, instead of leaving it implied.
//
// Two things are kept that a shortest-path routine usually throws away, and both
// are load-bearing:
//
//   * The whole PREDECESSOR DAG, not one witness route. "Can this be blocked"
//     is a question about every minimal route at once, and one route cannot
//     answer it.
//   * DISTANCES, never verdicts. A deadline shrinks with every tempo spent, so
//     a cached "arrives in time" is invalidated by a move that changed nothing
//     about the geometry. A cached distance is invalidated only by occupancy.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import { Board } from 'chessops/board';
import type { Square, Piece, Color } from 'chessops/types';
import { other } from './exchange';

export type Reach = {
	/** Where the journey starts. */
	from: Square;
	/** Plies to each reachable square. Absent means unreachable within `limit`. */
	dist: Map<Square, number>;
	/**
	 * For each square, the squares one ply closer that lead to it.
	 *
	 * The minimal-route DAG. Kept whole because `critical` needs to know about
	 * every route at once, and a single parent pointer describes one.
	 */
	via: Map<Square, Square[]>;
};

const START_RANK: Record<Color, number> = { white: 1, black: 6 };
const PUSH: Record<Color, number> = { white: 8, black: -8 };

/**
 * Where a piece may go from a square, on a fixed occupancy.
 *
 * A pawn is not `attacks`: its pushes are not captures and its captures are not
 * pushes. Getting that wrong in either direction is a route through a square the
 * pawn cannot use, or a missing diagonal — and Will's point stands, a promotion
 * path is not a file.
 */
function stepsFrom(board: Board, piece: Piece, at: Square, occupied: SquareSet, optimistic = false): SquareSet {
	// The enemy king's square is not a destination.
	//
	// An attack may BEAR on it — that is what check is, and graph.ts must keep
	// that edge — but no move may land there. Without this, a route could pass
	// "through" the king by capturing it, and a black pawn was found walking
	// d6-d5-e4-e3-xf2-f1 to promote in five. Attacks and moves differ here and
	// only here, which is why the exclusion lives in this file and not in the
	// attack graph.
	const forbidden = board.kingOf(other(piece.color));
	let off = forbidden === undefined ? board[piece.color] : board[piece.color].with(forbidden);

	// A KING may not step next to the enemy king either — AMEND-1.4-KINGS-ADJACENT.
	//
	// This is the one king move whose legality the value assignment cannot decide.
	// Everywhere else §1.4's argument holds and is the better one: step into a
	// rook's line and the SEE recurrence declines it. But two kings contesting one
	// square puts TWO infinite captures in a single chain, and `max(0, ∞ − ∞)` is
	// `NaN` — against which every comparison is false, so a guard written as "skip
	// when the value is bad" fails OPEN and admits exactly the case it could not
	// evaluate.
	//
	// Measured: this was the whole residue of Γ's checkmate failures. Every
	// remaining miss was a king "evading" onto a square the enemy king attacks.
	//
	// Minimal on purpose. It removes the squares where two kings would contest
	// one square and nothing else.
	if (piece.role === 'king' && forbidden !== undefined) {
		off = off.union(attacks({ color: other(piece.color), role: 'king' }, forbidden, occupied));
	}

	if (piece.role !== 'pawn') {
		return attacks(piece, at, occupied).diff(off);
	}
	let out = SquareSet.empty();
	const one = (at + PUSH[piece.color]) as Square;
	if (one >= 0 && one < 64 && !occupied.has(one)) {
		out = out.with(one);
		const two = (one + PUSH[piece.color]) as Square;
		if (at >> 3 === START_RANK[piece.color] && !occupied.has(two)) out = out.with(two);
	}
	// A diagonal is available only where there is something to take. On a frozen
	// board that is decidable, and it is why a pawn's route is a DAG.
	for (const to of attacks(piece, at, occupied)) {
		if (to === forbidden) continue;
		if (board[other(piece.color)].has(to) || (optimistic && !board[piece.color].has(to))) {
			out = out.with(to);
		}
	}
	return out;
}

export type ReachOpts = {
	/** Stop expanding past this many plies. Distances beyond are simply absent. */
	limit?: number;
	/**
	 * Let a pawn take a diagonal whether or not there is anything there.
	 *
	 * A pawn's diagonal is legal only onto an occupied square, so for a pawn — and
	 * for no other piece — a square being FILLED can SHORTEN the route. Asking for
	 * the optimistic route is how the squares that would enable it are found:
	 * they are the diagonals it used that are presently empty.
	 *
	 * AMEND-1-LATENT-RACE.md. Never use this for a live distance; it answers "how
	 * fast could this go if the right things appeared", not "how fast is it".
	 */
	pawnMayCaptureAnywhere?: boolean;
	/**
	 * Squares that end a route rather than continuing it.
	 *
	 * A capture is an arrival, not a transit: a defender that reaches the pawn
	 * takes it and stops. Naming this explicitly is the repair for the second
	 * `race.ts` bug, where an occupied square was silently treated as a block.
	 */
	stopAt?: SquareSet;
};

/**
 * Distances from one square, on one occupancy.
 *
 * The piece itself is lifted off before the walk. It is not an obstacle to its
 * own journey, and leaving it there makes a rook on a1 unable to use a1.
 */
export function reach(board: Board, from: Square, opts: ReachOpts = {}): Reach {
	const piece = board.get(from);
	const dist = new Map<Square, number>();
	const via = new Map<Square, Square[]>();
	if (!piece) return { from, dist, via };

	const limit = opts.limit ?? 8;
	const occupied = board.occupied.without(from);
	dist.set(from, 0);

	let frontier: Square[] = [from];
	for (let d = 1; d <= limit && frontier.length; d++) {
		const next: Square[] = [];
		for (const at of frontier) {
			if (opts.stopAt?.has(at) && at !== from) continue;
			for (const to of stepsFrom(board, piece, at, occupied, opts.pawnMayCaptureAnywhere)) {
				const seen = dist.get(to);
				if (seen !== undefined && seen < d) continue;
				if (seen === undefined) {
					dist.set(to, d);
					next.push(to);
					via.set(to, [at]);
				} else {
					// Same distance by another route — the DAG's whole point.
					via.get(to)?.push(at);
				}
			}
		}
		frontier = next;
	}
	return { from, dist, via };
}

/** Plies to `to`, or Infinity. Never a verdict — the caller owns the deadline. */
export const distance = (r: Reach, to: Square): number => r.dist.get(to) ?? Infinity;

/**
 * Squares that lie on EVERY minimal route to `to`.
 *
 * "Blocking one of these lengthens the journey" holds only for an IMPASSABLE
 * blocker. Measured on a king in a corridor: an own-colour knight on a critical
 * square takes the walk from 3 plies to 6, while an enemy knight on the same
 * square changes nothing — the king captures it and carries on. That is Will's
 * distinction ("a race is stopped by blocking the path OR capturing the piece")
 * arriving as a consequence of the move rules rather than as a special case, and
 * a pawn shows the other half of it: anything in front of a pawn, of either
 * colour, stops it dead.
 *
 * So this function answers a question about GEOMETRY. Whether a given piece can
 * actually be put there, and whether it survives once it is, is the exchange —
 * and that belongs to the ledger.
 *
 * Blocking one of these lengthens the journey; blocking anything else does not,
 * because another minimal route avoids it. Enumerating whole routes would be
 * both expensive and the wrong object — what a caller wants is the small set of
 * squares whose occupancy actually matters.
 *
 * The derivation is cheap because a BFS DAG is layered: every minimal route
 * visits exactly one square per ply, so a ply whose minimal-route set has
 * exactly one member is a square every route must use.
 */
export function critical(r: Reach, to: Square): Square[] {
	const d = r.dist.get(to);
	if (d === undefined || d === 0) return [];

	// Walk back from the target, collecting every square on any minimal route.
	const byPly = new Map<number, Set<Square>>();
	const seen = new Set<Square>([to]);
	let layer = [to];
	byPly.set(d, new Set([to]));
	for (let ply = d - 1; ply >= 1; ply--) {
		const here = new Set<Square>();
		const nextLayer: Square[] = [];
		for (const sq of layer) {
			for (const parent of r.via.get(sq) ?? []) {
				if (r.dist.get(parent) !== ply) continue;
				here.add(parent);
				if (!seen.has(parent)) {
					seen.add(parent);
					nextLayer.push(parent);
				}
			}
		}
		byPly.set(ply, here);
		layer = nextLayer;
	}

	const out: Square[] = [];
	for (const [ply, set] of byPly) {
		// The destination is not a square that blocks the journey — it IS the
		// journey's end, and occupying it is a capture rather than an obstruction.
		if (ply === d) continue;
		if (set.size === 1) out.push([...set][0]);
	}
	return out.sort((a, b) => a - b);
}

/**
 * Every square whose filling could lengthen the walk to `to`.
 *
 * `critical` returns the NODES every minimal route stands on. That is not the
 * whole story for a slider, and the gap is subtle enough that it shipped: BFS
 * treats a1-a5 as one edge, so a2, a3 and a4 are not nodes on the route — yet
 * filling any of them breaks that step. Blocking a transit square is invisible
 * to a node-based analysis.
 *
 * This is exactly what `graph.diesIfFilled` already does for edges at d = 1,
 * generalised to d > 1 — which is Will's unification arriving with teeth: an
 * x-ray is a race path with one critical square, and a race path's blocking set
 * must be built the same way an x-ray's is.
 *
 * Conservative on purpose. Transit squares are collected for every edge on ANY
 * minimal route, not only for edges on every route, so this may name a square
 * whose filling leaves an equal-length alternative. It may never miss one.
 */
export function blockers(r: Reach, to: Square): Square[] {
	const d = r.dist.get(to);
	if (d === undefined || d === 0) return [];
	const out = new Set<Square>(critical(r, to));

	// Walk the minimal-route DAG backwards, adding what each step passes over.
	const seen = new Set<Square>([to]);
	let layer = [to];
	for (let ply = d - 1; ply >= 0; ply--) {
		const nextLayer: Square[] = [];
		for (const sq of layer) {
			for (const parent of r.via.get(sq) ?? []) {
				if (r.dist.get(parent) !== ply) continue;
				for (const mid of between(parent, sq)) out.add(mid);
				if (!seen.has(parent)) {
					seen.add(parent);
					nextLayer.push(parent);
				}
			}
		}
		layer = nextLayer;
	}
	out.delete(to);
	out.delete(r.from);
	return [...out].sort((a, b) => a - b);
}

/**
 * Every step taken on some minimal route to `to`, as `[from, to]` pairs.
 *
 * `critical` and `blockers` both answer questions about SQUARES. A pawn's
 * enabling trigger is a question about a STEP: a diagonal is a capture and a
 * push is not, and the same square can be reached either way. Collapsing the
 * route to a square set is what produced the first version's enabler lists —
 * every square in the optimistic reach set, including the promotion square
 * itself, filed as "fill this and the pawn may cross".
 */
export function routeSteps(r: Reach, to: Square): Array<[Square, Square]> {
	const d = r.dist.get(to);
	if (d === undefined || d === 0) return [];
	const out: Array<[Square, Square]> = [];
	const seen = new Set<Square>([to]);
	let layer = [to];
	for (let ply = d - 1; ply >= 0; ply--) {
		const nextLayer: Square[] = [];
		for (const sq of layer) {
			for (const parent of r.via.get(sq) ?? []) {
				if (r.dist.get(parent) !== ply) continue;
				out.push([parent, sq]);
				if (!seen.has(parent)) {
					seen.add(parent);
					nextLayer.push(parent);
				}
			}
		}
		layer = nextLayer;
	}
	return out;
}

/**
 * Can `from` reach any of `targets` within `deadline` plies, and how fast?
 *
 * The shape §2's `arrives()` will be built from. It returns the number rather
 * than a boolean for the reason in this file's header: the deadline belongs to
 * the obligation, not to the journey, and baking it in here would make the cache
 * invalidate on every tempo.
 */
export function soonest(r: Reach, targets: SquareSet): number {
	let best = Infinity;
	for (const t of targets) {
		const d = r.dist.get(t);
		if (d !== undefined && d < best) best = d;
	}
	return best;
}

/**
 * Plies until `from` ATTACKS `to`. Zero if it already does.
 *
 * FORMALISM §5's `d(p, S)` — "can attack or defend S in k plies" — the bearing
 * distance, not the landing one. To defend S is not to move to S, and to threaten
 * it is not to move to it either: both directions of §5 are this one function.
 */
export function bear(board: Board, from: Square, to: Square, r?: Reach): number {
	const piece = board.get(from);
	if (!piece) return Infinity;
	if (attacks(piece, from, board.occupied).has(to)) return 0;
	const walk = r ?? reach(board, from, { limit: 6 });
	let best = Infinity;
	for (const [sq, d] of walk.dist) {
		if (d === 0 || d >= best) continue;
		const occ = board.occupied.without(from).with(sq);
		if (attacks(piece, sq, occ).has(to)) best = d;
	}
	return best;
}

/**
 * A walk cache with gate-based invalidation — §7's third index row.
 *
 * ---------------------------------------------------------------------------
 * §7 names three rows for the one square-keyed index:
 *
 *   edges that appear if `s` empties,
 *   edges that die if `s` fills,
 *   DISTANCES THAT LENGTHEN IF `s` FILLS — the new row, and the only one.
 *
 * `paths.ts` implements that discipline for POINT queries: `ask` caches one
 * (from, to) distance with the gates that would invalidate it. This is the same
 * discipline for WHOLE WALKS, which is what `arrivals` needs — it wants the set
 * of squares a piece can reach, not the distance to one of them.
 *
 * The problem it solves: `choose()` prices about twenty options a ply, each
 * rebuilding the ledger, each running a walk per piece — on boards that differ
 * from each other by two squares. Measured: 67.3% of those walks are byte for
 * byte the walk on the parent board (87.9% for pawns, 22.5% for queens).
 *
 * THE INVALIDATION TEST, and why it is sound. A square outside a piece's
 * EMPTY-BOARD reach at `limit` cannot affect its walk: the piece can never step
 * there, and it cannot lie on a step's path either, because a slider's transit
 * squares are themselves reachable in one step. So the empty-board reach is a
 * superset of everything that could matter, and it is a fact about geometry, so
 * it is computed once per piece and never invalidated.
 *
 * `pawnMayCaptureAnywhere` is on for the same reason it exists: a pawn's diagonal
 * is legal only onto an occupied square, so for a pawn a square being FILLED can
 * SHORTEN the route. The optimistic walk is what catches those squares.
 *
 * Conservative in one direction only. It can say "changed" when nothing did —
 * that costs a walk that was going to happen anyway — and it cannot say
 * "unchanged" when something did.
 * ---------------------------------------------------------------------------
 */
export type Walks = {
	limit: number;
	/** Walks on the board the cache was built for. */
	base: Map<Square, Reach>;
	/** What would change each — the empty-board reach. */
	sens: Map<Square, SquareSet>;
	/**
	 * Everything the piece could bear on from anywhere it can get to, on an empty
	 * board. An upper bound, so it never changes with occupancy and is computed
	 * once per piece per ply rather than once per option.
	 */
	span: Map<Square, SquareSet>;
	/** The board they were computed on, to check a piece has not been replaced. */
	board: Board;
};

/**
 * The cache for one board. LAZY, and that is most of what it is worth.
 *
 * Eager, it walked every one of about thirty pieces twice — once for real and
 * once on an empty board — and `arrivals` then asked about sixteen of them.
 * Paying for fourteen pieces nobody asks about ate most of the 67.3% reuse the
 * measurement promised. Filled on demand, the up-front cost is only what is used.
 */
export function walksFor(board: Board, limit: number): Walks {
	return { limit, base: new Map(), sens: new Map(), span: new Map(), board };
}

/** The geometry of one piece, computed once and never invalidated. */
function geometry(w: Walks, p: Square): { sens: SquareSet; span: SquareSet } {
	const had = w.sens.get(p);
	if (had) return { sens: had, span: w.span.get(p) ?? SquareSet.empty() };
	const piece = w.board.get(p);
	let s = SquareSet.empty();
	let a = SquareSet.empty();
	if (piece) {
		const bare = Board.empty();
		bare.set(p, piece);
		for (const [sq] of reach(bare, p, { limit: w.limit, pawnMayCaptureAnywhere: true }).dist) {
			s = s.with(sq);
			a = a.union(attacks(piece, sq, SquareSet.empty()));
		}
	}
	w.sens.set(p, s);
	w.span.set(p, a);
	return { sens: s, span: a };
}

/** The upper bound of what `p` could ever bear on — a fact about geometry. */
export function spanOf(w: Walks | undefined, board: Board, p: Square, limit: number): SquareSet {
	const was = w?.board.get(p);
	const now = board.get(p);
	if (w && was && now && was.role === now.role && was.color === now.color) return geometry(w, p).span;
	if (!now) return SquareSet.empty();
	const bare = Board.empty();
	bare.set(p, now);
	let a = SquareSet.empty();
	for (const [sq] of reach(bare, p, { limit, pawnMayCaptureAnywhere: true }).dist)
		a = a.union(attacks(now, sq, SquareSet.empty()));
	return a;
}

export function walkOn(w: Walks | undefined, board: Board, p: Square, changed: readonly Square[], limit: number): Reach {
	if (!w || w.limit !== limit) return reach(board, p, { limit });
	const was = w.board.get(p);
	const now = board.get(p);
	if (!was || !now || was.role !== now.role || was.color !== now.color) return reach(board, p, { limit });
	if (changed.some((s) => geometry(w, p).sens.has(s))) return reach(board, p, { limit });
	let had = w.base.get(p);
	if (!had) w.base.set(p, (had = reach(w.board, p, { limit })));
	return had;
}

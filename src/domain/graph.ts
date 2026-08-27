// The attack graph, and what would change it.
//
// ---------------------------------------------------------------------------
// Implements DEFICIENCY.md §7.
//
// This is the piece the first attempt skipped as an "optimisation", and skipping
// it is what made everything downstream a search. Without an index of what is
// LATENT — the edge behind a blocker, the edge a piece would gain if a square
// emptied — the only way to find out what a move does is to play it. With one,
// the future is already in the state and a move is three lookups.
//
// Two properties are load-bearing and both are easy to lose:
//
//   * It is SYMMETRIC, and cannot be otherwise. A ray's blockers are of both
//     colours, so the contingency table for White is not constructible without
//     Black's occupancy. Both sides come out of one pass or neither does.
//
//   * The contingency index is keyed by SQUARE, not by piece. It is tempting to
//     hang "what I reveal" off the blocker, but any move to any square can
//     CREATE a block, and a piece-keyed table has nowhere to put that. Two
//     tables of 64 entries each: what appears if a square empties, what dies if
//     it fills.
//
// Nothing here plays a move or clones a position — see test/no-search.test.ts,
// which fails the build if that changes.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Board } from 'chessops/board';
import type { Square, Color, Role, Piece } from 'chessops/types';

/**
 * One piece bearing on one square, at a price, under conditions.
 *
 * AMEND-7-ONE-EDGE.md. Will: "just like an xray slide is treated like one edge,
 * we could treat a race path as one edge — it just takes several tempi to
 * realize instead of a slide move's one, since it's a compound move."
 *
 * So there is one edge type and `live`/`latent` are no longer kinds of edge.
 * They are a question asked of the board: are this edge's `needs` empty right
 * now? A battery, an x-ray, a pin and a discovered attack are all the same
 * object read against different occupants.
 */
export type Edge = {
	from: Square;
	to: Square;
	role: Role;
	colour: Color;
	/** Tempi the owner must spend to realise it. A slider step is 1. */
	cost: number;
	/**
	 * Squares that must be EMPTY for the edge to exist at this cost.
	 *
	 * For a cost-1 step this is the transit squares, and it is an exact
	 * conjunction. For cost > 1 it is the squares on every minimal route — the
	 * part of the disjunction common to all of them — so it stays exact while a
	 * multi-route journey is stored as one edge.
	 */
	needs: Square[];
};

/** Is this edge acting right now? A question about the board, not the edge. */
export const isLive = (e: Edge, board: Board): boolean =>
	!e.needs.some((s) => board.occupied.has(s));

/**
 * Who is standing in the way, if anyone.
 *
 * Replaces the old stored `blocker` field. A cost-1 edge with exactly one
 * occupied `needs` square is the x-ray/pin/battery family — which is which
 * depends on the colours, and that is `graphShapes.motifsIn`'s business.
 */
export const blockedBy = (e: Edge, board: Board): Square[] =>
	e.needs.filter((s) => board.occupied.has(s));

export type Graph = {
	/** Squares each piece bears on now, by origin square. */
	from: Map<Square, SquareSet>;
	/** Pieces bearing on each square now, by colour. */
	on: Map<Square, { white: Square[]; black: Square[] }>;
	/**
	 * Every edge whose existence this square governs — the one index.
	 *
	 * The two views below are derived from it against the current occupancy and
	 * kept because they read well at call sites, not because they are separate
	 * structures.
	 */
	watchers: Map<Square, Edge[]>;
	/** Latent edges that become live if this square empties. Derived. */
	appearsIfEmpty: Map<Square, Edge[]>;
	/** Live edges that die if this square fills. Derived. */
	diesIfFilled: Map<Square, Edge[]>;
	/** Every edge, live and latent — for the overlay and for diffing. */
	edges: Edge[];
	/**
	 * Which pieces could bear on a square if the board were empty.
	 *
	 * This is what makes INVALIDATION a lookup rather than a scan. The two
	 * contingency tables above answer "what changes if this square changes" only
	 * for rays blocked at most once; a ray already blocked twice is in neither,
	 * so an index built from them alone would silently miss the case where the
	 * second blocker leaves. Unobstructed reach has no such hole — it is a
	 * property of the piece and the geometry, not of the occupancy.
	 */
	couldBearOn: Map<Square, Square[]>;
};

const SLIDER: Partial<Record<Role, true>> = { bishop: true, rook: true, queen: true };

const empty = (): Graph => ({
	from: new Map(),
	on: new Map(),
	watchers: new Map(),
	appearsIfEmpty: new Map(),
	diesIfFilled: new Map(),
	edges: [],
	couldBearOn: new Map(),
});

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
	const at = m.get(k);
	if (at) at.push(v);
	else m.set(k, [v]);
};

/**
 * Where a piece bears, ignoring occupancy entirely.
 *
 * `attacks` with an empty board gives the piece's full reach, which is what the
 * ray walk below needs as its starting set. For a pawn this is the capture
 * squares only — a pawn's forward move is not an attack, and treating it as one
 * would put a defended square in the graph that nothing actually defends.
 */
const reachOf = (piece: Piece, from: Square): SquareSet => attacks(piece, from, SquareSet.empty());

/**
 * One piece's edges, live and latent, on a given occupancy.
 *
 * Extracted so `build` and `applyMove` cannot drift apart: the incremental path
 * recomputes exactly this for the pieces it invalidates, and nothing else, so
 * the two agree by construction rather than by two implementations happening to
 * match. `graph.test.ts` still checks it over 5000 positions, because "by
 * construction" has been wrong here before.
 */
export function edgesFor(board: Board, from: Square, piece: Piece): { edges: Edge[]; live: SquareSet } {
	const edges: Edge[] = [];
	let live = SquareSet.empty();
	const reach = reachOf(piece, from);

	if (!SLIDER[piece.role]) {
		// A leaper's edge needs nothing: there is no ray to interrupt. Which is
		// also why leapers contribute no watchers at all.
		live = reach;
		for (const to of live) {
			edges.push({ from, to, role: piece.role, colour: piece.color, cost: 1, needs: [] });
		}
		return { edges, live };
	}

	// Walk each ray outward and register the WHOLE ray, however many men stand on
	// it. `needs` is the transit set; whether those squares happen to be occupied
	// is what makes the edge live or latent, and that is read off the occupancy
	// rather than stored — AMEND-7's whole point.
	//
	// THE DEPTH LIMIT IS GONE, and it was load-bearing in the wrong direction.
	// This loop used to emit an edge only where a ray carried at most ONE blocker,
	// on the reasoning that a double-blocked ray was "too deep to matter at one
	// remove". That is true of a single move and false of an EXCHANGE, where men
	// come off a ray one after another: on
	// `6nr/5pk1/Pr2p3/2q1RR1p/8/5P2/P1pP1PB1/4K3 b` the rank-five exchange on h5
	// runs Rf5 Rh8 Re5 Qc5 — four captures, and the queen's edge was behind two
	// rooks, so the graph could not see her and priced the exchange at +100 where
	// the truth is 0.
	//
	// §9 wants the board unnecessary after the graph is built. A graph that omits
	// any edge cannot do that, and the omission is not a small one: it is exactly
	// the deep reveals that make exchanges non-obvious, which is to say the ones
	// worth computing.
	//
	// The cost is bounded — a queen has at most 27 ray squares whatever stands on
	// them — and `couldBearOn` stays, because invalidation must also cover pieces
	// that MOVE, which no edge from a current square can describe.
	for (const to of reach) {
		const path = between(from, to);
		edges.push({ from, to, role: piece.role, colour: piece.color, cost: 1, needs: [...path] });
		if (!path.intersects(board.occupied)) live = live.with(to);
	}
	return { edges, live };
}

/** Rebuild the lookup tables from a complete edge list. Cheap; array work only. */
function reindex(g: Graph, board: Board): Graph {
	g.from = new Map();
	g.on = new Map();
	g.watchers = new Map();
	g.appearsIfEmpty = new Map();
	g.diesIfFilled = new Map();

	// One map, keyed by square: every edge whose existence that square governs.
	// The old `appearsIfEmpty` / `diesIfFilled` split was never a property of the
	// index — it is a property of the CURRENT board, so it is derived below.
	const liveBy = new Map<Square, SquareSet>();
	for (const e of g.edges) {
		for (const s of e.needs) push(g.watchers, s, e);
		if (isLive(e, board)) {
			// `from` and `on` are WHO BEARS ON WHAT NOW, and only a cost-1 edge does.
			// A promised queen's edge can have every `need` empty and still describe a
			// piece that does not exist yet; counting it here would put a queen's
			// attacks on a pawn's square and every exchange downstream would read it.
			if (e.cost === 1) liveBy.set(e.from, (liveBy.get(e.from) ?? SquareSet.empty()).with(e.to));
			for (const s of e.needs) push(g.diesIfFilled, s, e);
		} else {
			const blocked = blockedBy(e, board);
			if (blocked.length === 1) push(g.appearsIfEmpty, blocked[0], e);
		}
	}
	for (const from of board.occupied) {
		const piece = board.get(from);
		if (!piece) continue;
		const live = liveBy.get(from) ?? SquareSet.empty();
		g.from.set(from, live);
		for (const to of live) {
			const slot = g.on.get(to) ?? { white: [], black: [] };
			slot[piece.color].push(from);
			g.on.set(to, slot);
		}
	}
	return g;
}

/** Reverse reach: for each square, the pieces that could bear on it if unobstructed. */
function reverseReach(board: Board): Map<Square, Square[]> {
	const out = new Map<Square, Square[]>();
	for (const from of board.occupied) {
		const piece = board.get(from);
		if (!piece) continue;
		for (const to of reachOf(piece, from)) push(out, to, from);
	}
	return out;
}

/**
 * The graph of a board, from nothing.
 *
 * O(pieces x rays). `applyMove` exists for hot loops; this is the reference, and
 * `graph.test.ts` holds the two to be identical.
 */
/**
 * THE PROMISED QUEEN WAS BUILT, FIRED, AND DELETED — and the reason is worth more
 * than the code was.
 *
 * ---------------------------------------------------------------------------
 * Will:
 *
 *   "Given that the ledger has the promotion registered, why doesn't it just
 *    register a potential queen and its rays there from the beginning as well?
 *    Gated behind the promotion contingency."
 *
 * It fits perfectly, and that is why it was worth building. AMEND-7 left one edge
 * type — `{from, to, cost, needs}` — and a promoted queen's edges are that shape
 * exactly, with no new kind of gate:
 *
 *   from    THE PAWN'S SQUARE. Every consumer already checks that a man stands on
 *           `from`, so a pawn that is captured takes its future queen with it.
 *   cost    the pushes to promote, plus one for the queen's own move.
 *   needs   the pawn's road AND the ray from the promotion square — so the gate
 *           IS the occupancy word and `isLive` learned nothing.
 *
 * It worked. Γ read it in `defend`, and over the 300 easiest puzzles it produced
 * **90 discharges on 79 plies — 11.8%.** It is not a mechanism that never fired.
 *
 * IT CHANGED NOTHING. 72.5% before, 72.5% after, to the ply. And it cost: 170
 * promise edges a ply and the domain suite from 41s to 69s.
 *
 * WHY, and this is the part to keep. A race is not won by covering the enemy's
 * promotion square — a queen on d8 does not bear on a1, and in `JHGmH` she never
 * will in time. It is won by promoting FIRST and then CAPTURING WHAT THEY MADE.
 * That is an exchange after both deadlines have passed, and Γ's question is
 * "what discharges this row within its deadline". The promise answers a question
 * the race does not ask.
 *
 * It is the same horizon that the joint alternation ran into — see the note in
 * `traverse.ts`. Two independent attempts at the race, from opposite ends, both
 * stopped at "what happens after the last deadline". That is the thing to build,
 * and neither of these was it.
 * ---------------------------------------------------------------------------
 */

export function build(board: Board): Graph {
	const g = empty();
	for (const from of board.occupied) {
		const piece = board.get(from);
		if (!piece) continue;
		g.edges.push(...edgesFor(board, from, piece).edges);
	}
	g.couldBearOn = reverseReach(board);
	return reindex(g, board);
}

/**
 * The graph after a move, without rebuilding it.
 *
 * Takes both boards rather than a move, and diffs them. That is not laziness: it
 * makes castling, en passant and promotion fall out with no special case at all,
 * because each is just "these squares changed contents".
 *
 * Invalidation is a lookup, per DEFICIENCY.md §7. For each changed square, the
 * pieces that must be recomputed are whatever now stands there plus everything
 * in `couldBearOn` for it — a piece whose geometry lets it bear on that square,
 * whether or not anything currently blocks the way. Everything else keeps its
 * edges untouched.
 */
export function applyMove(g: Graph, before: Board, after: Board): Graph {
	const changed: Square[] = [];
	for (let s = 0 as Square; s < 64; s++) {
		const a = before.get(s);
		const b = after.get(s);
		if (!a && !b) continue;
		if (!a || !b || a.role !== b.role || a.color !== b.color) changed.push(s);
	}

	const redo = new Set<Square>();
	for (const s of changed) {
		if (after.get(s)) redo.add(s);
		for (const from of g.couldBearOn.get(s) ?? []) redo.add(from);
	}
	// A piece that moved away must lose its edges even though its ORIGIN square is
	// not somewhere it could bear on.
	for (const s of changed) redo.add(s);

	const next = empty();
	// Keep only edges owned by pieces that neither moved nor had a ray disturbed,
	// and that are still on the board.
	next.edges = g.edges.filter((e) => !redo.has(e.from) && after.get(e.from) !== undefined);
	for (const from of redo) {
		const piece = after.get(from);
		if (!piece) continue;
		next.edges.push(...edgesFor(after, from, piece).edges);
	}
	next.couldBearOn = reverseReach(after);
	return reindex(next, after);
}

/** Pieces of `side` bearing on `square` right now. */
export const on = (g: Graph, square: Square, side: Color): Square[] =>
	g.on.get(square)?.[side] ?? [];

/** Does `side` bear on `square` at all? */
export const covers = (g: Graph, square: Square, side: Color): boolean =>
	on(g, square, side).length > 0;

/**
 * Squares whose occupancy changes at least one edge.
 *
 * The overlay rings these, and the incremental path consults them. A square in
 * neither table is one where a move changes nothing about who bears on what —
 * which is most of the board, and is why the index is worth keeping.
 */
export function sensitive(g: Graph): Set<Square> {
	const out = new Set<Square>();
	for (const s of g.appearsIfEmpty.keys()) out.add(s);
	for (const s of g.diesIfFilled.keys()) out.add(s);
	return out;
}

/** Latent edges only, for the overlay and for the deferred rows of §1. */
export const latent = (g: Graph, board: Board): Edge[] => g.edges.filter((e) => !isLive(e, board));

/**
 * A stable string for the whole graph, so two graphs can be compared exactly.
 *
 * `graph.test.ts` holds the incremental path and the rebuild to be identical,
 * and "identical" has to mean something order-independent — the two arrive at
 * the same edges by different routes.
 */
export function fingerprint(g: Graph): string {
	return g.edges
		.map((e) => `${e.colour[0]}${e.role[0]}${e.from}>${e.to}@${e.cost}~${[...e.needs].sort((x, y) => x - y).join('.')}`)
		.sort()
		.join('|');
}

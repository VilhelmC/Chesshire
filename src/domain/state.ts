// The state, read off the graph — with the board consulted once and then not.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §7 and §9, on AMEND-7-ONE-EDGE.md's single edge type.
//
// Will:
//
//   "The dependency graph is only built from initial state which scans all
//    potential moves at the current position and builds the contingency ledgers.
//    1) after that the board position should not need to be consulted because
//    all necessary information is in the graph. 2) full rebuild would be
//    unnecessary anyway since a single move only means updating a handful of
//    edges. 3) none of this is per ply. After building the graph it is simply
//    pruned by adversarial alternation. Exchanges were already precalculated so
//    costs of branches on the graph should be trivial lookups."
//
// §9 says the same: "the state is not the board. It is the exchange complex."
//
// WHAT THIS CORRECTS.
//
// `graph.ts` was built at M1, verified incremental-equals-rebuild over a thousand
// positions, and amended to AMEND-7's `(from, to, cost, needs)` with `isLive` as
// a question asked of the board. Then M3 through M7 were written without it: not
// one module of `complex.ts`, `gamma.ts`, `traverse.ts`, `cluster.ts` or
// `choose.ts` imports it. Every one of them consults the board directly, and
// `choose()` rebuilds the whole ledger for each of twenty-odd options a ply.
//
// So the index that exists to make a move three lookups has never been used, and
// the cost measured in FINDING-COST.md is the cost of not using it.
//
// WHAT THIS FILE IS.
//
// The bridge. A `State` is the graph plus an occupancy, and every question the
// exchange layer asks is answered from those two — no `Board`, no `capturersOn`,
// no `see` over a position.
//
//   * WHO BEARS ON A SQUARE is the live cost-1 slice of the graph: edges into it
//     whose `needs` are empty under this occupancy. AMEND-7: "live and latent are
//     questions about the board, not fields on the edge" — here, questions about
//     the occupancy word.
//
//   * WHAT AN EXCHANGE IS WORTH is the standard backward pass over two sorted
//     value lists. §6.3: "chain length is an output, not an unknown." Nothing is
//     scanned; the participants are read from the index and the arithmetic is
//     over at most a dozen numbers.
//
//   * AN X-RAY NEEDS NO SPECIAL CASE. When the front piece is taken its square
//     empties, and the edge behind it has that square in `needs`, so it becomes
//     live by the same test as everything else. That is AMEND-7's whole point and
//     it is why this can be done without a board: the reveal is already indexed.
//
//   * A MOVE IS AN OCCUPANCY EDIT. `after()` flips two bits and re-homes the
//     mover's own edges. Everything else in the graph is untouched, and which
//     edges changed status is `watchers[from]` and `watchers[to]` — §7's two rows,
//     used as §7 says to use them.
//
// This is verified against the board-based path rather than argued for:
// `state.test.ts` requires `value()` to equal `seeValue()` on every attacked
// square of every position of a corpus walk. If the graph and the board ever
// disagree, one of them is wrong and the point of the index is gone.
// ---------------------------------------------------------------------------

import { SquareSet } from 'chessops/squareSet';
import { Board } from 'chessops/board';
import type { Color, Piece, Role, Square } from 'chessops/types';
import { V, other, promotionOf } from './exchange';
import { build, edgesFor, type Edge, type Graph } from './graph';

export type State = {
	/** Built once. Static: edges do not depend on occupancy, only their liveness does. */
	graph: Graph;
	/** The only thing a move changes. */
	occupied: SquareSet;
	/** What stands where. Sparse and small; a move touches two entries. */
	men: Map<Square, Piece>;
	/** Edges into each square, by colour. The index the exchange reads. */
	into: Map<Square, { white: Edge[]; black: Edge[] }>;
};

const bucket = (m: Map<Square, { white: Edge[]; black: Edge[] }>, s: Square) => {
	let b = m.get(s);
	if (!b) m.set(s, (b = { white: [], black: [] }));
	return b;
};

/** Index a set of edges by their target. */
function indexInto(edges: Edge[]): Map<Square, { white: Edge[]; black: Edge[] }> {
	const into = new Map<Square, { white: Edge[]; black: Edge[] }>();
	for (const e of edges) bucket(into, e.to)[e.colour].push(e);
	return into;
}

/** The board, consulted once. Everything after this is the graph. */
export function stateOf(board: Board, graph: Graph = build(board)): State {
	const men = new Map<Square, Piece>();
	for (const s of board.occupied) {
		const p = board.get(s);
		if (p) men.set(s, p);
	}
	return { graph, occupied: board.occupied, men, into: indexInto(graph.edges) };
}

/** Is this edge acting under this occupancy? AMEND-7's question, asked of a word. */
export const live = (e: Edge, occupied: SquareSet): boolean => !e.needs.some((s) => occupied.has(s));

/**
 * ABSOLUTE pins only — and a pin is not an edge deletion.
 *
 * Will:
 *
 *   "A pin doesn't actually remove an edge, it just redistributes pieces between
 *    exchanges. For example a knight pinned by a ray with the king behind. The
 *    knight may still move but that exposes the king which is infinite value so
 *    that calculation is easy. Lets say the prize piece is not a king but a queen
 *    or rook, we can still move the blocking piece thus offering opponent the
 *    prize exchange and that's completely fine — it's just part of the opponent's
 *    option set and must be offset by whatever we gain by moving the pinned
 *    piece."
 *
 * So `AMEND-7-ONE-EDGE.md` §2.1's "absolute pins delete edges rather than being
 * checked per move" is a special case wearing the clothes of a general rule, and
 * it should not be read as one. The general fact is a COUPLING: moving a shield
 * hands the opponent the exchange behind it, priced like any other exchange and
 * set against whatever the shield went off to do. `cluster.ts` is where that
 * belongs, and the whole-ray graph of AMEND-7.2 is what finally makes it visible
 * — a rook bearing on a queen through a knight is now an edge with the knight's
 * square in `needs`.
 *
 * What this function does is the ONE case where the coupling degenerates: the
 * prize behind the shield is the king, the exchange is worth infinity, so no
 * price can offset it and the move is simply never taken. Chess calls that
 * illegal and the effect is the same. Nothing here claims more than that, and the
 * relative pin is deliberately NOT filtered — it is an option with a cost, not a
 * missing edge.
 *
 * The shape is one the index already holds: an enemy edge to my king with exactly
 * one occupied square in its `needs`, and one of my men standing on it. The
 * shield may still act, but only along the ray — that `needs` set plus the
 * pinner's own square, since taking the pinner ends the pin.
 */
export function pinned(s: State, side: Color): Map<Square, SquareSet> {
	const out = new Map<Square, SquareSet>();
	let king: Square | null = null;
	for (const [sq, p] of s.men) if (p.role === 'king' && p.color === side) king = sq;
	if (king === null) return out;

	const b = s.into.get(king);
	if (!b) return out;
	for (const e of b[other(side)]) {
		if (e.cost !== 1) continue;
		// THE PINNER MUST STILL BE THERE. Found by the equivalence test: a queen on
		// a4 pinning b5 against e8, which then takes on c4 — it has left a4, so the
		// pin is gone and b5 joins the exchange. Without this the shield stayed
		// pinned by a piece that had moved, and an exchange lost a participant that
		// was free by the time it was needed. `exchange.pinsFor` carries the same
		// warning in its own comment; this file had to learn it again.
		if (!s.men.has(e.from)) continue;
		const blockers = e.needs.filter((n) => s.occupied.has(n));
		if (blockers.length !== 1) continue;
		const shield = blockers[0];
		if (s.men.get(shield)?.color !== side) continue;
		// The ray it may not leave: everything between, plus taking the pinner.
		let ray = SquareSet.empty().with(e.from);
		for (const n of e.needs) ray = ray.with(n);
		out.set(shield, ray);
	}
	return out;
}

/**
 * Who of `side` bears on `square` right now.
 *
 * The live cost-1 slice. Cost above 1 is a journey — §1's promotion and invasion
 * rows — and a journey is not a participant in an exchange happening now.
 */
export function bearing(s: State, square: Square, side: Color, pins = pinned(s, side)): Square[] {
	const b = s.into.get(square);
	if (!b) return [];
	const out: Square[] = [];
	for (const e of b[side]) {
		if (e.cost !== 1 || !live(e, s.occupied) || !s.men.has(e.from)) continue;
		const ray = pins.get(e.from);
		if (ray && !ray.has(square)) continue; // pinned, and this is off the ray
		out.push(e.from);
	}
	return out;
}

/**
 * What the exchange on `square` is worth to `side` — from the index, no board.
 *
 * The standard backward pass, taking with the least valuable attacker at every
 * step. §6.3: the `max(0, ·)` IS the rational stopping rule, so the length of the
 * chain falls out of the same computation that produces the value, and declining
 * is always available — which is what makes the value non-negative.
 *
 * The occupancy is edited as pieces come off, so an edge shielded by a captured
 * man becomes live exactly when it should. That is the x-ray, and it needs no
 * mention here at all.
 */
function liveMen(s: State, gone: Set<Square>): Map<Square, Piece> {
	if (!gone.size) return s.men;
	const m = new Map(s.men);
	for (const g of gone) m.delete(g);
	return m;
}

/**
 * The exchange, with the line it plays.
 *
 * §6.3: "chain length is an output, not an unknown." The same backward pass that
 * produces the value locates where it stops, so WHICH MEN THE EXCHANGE CONSUMES
 * costs nothing extra — and `cluster.ts` needs exactly that, because §6.2's
 * sequential commitment is over pieces that cannot be in two places. A cluster
 * that knew only the value would have to guess at the participants from the
 * bearing sets, which over-commits every defender that never took part.
 *
 * `spent` is the men that MOVE, in order. The prize is not among them — the
 * caller knows what square it is standing on.
 */
export type Line = { value: number; spent: Square[]; depth: number };

export function line(s: State, square: Square, side: Color): Line {
	const prize = s.men.get(square);
	if (!prize) return { value: 0, spent: [], depth: 0 };

	let occ = s.occupied;
	const gone = new Set<Square>();
	// Pins are recomputed as men come off: taking the pinner releases the shield,
	// and a chain that does not notice keeps a defender out of the count that is
	// free by the time it is needed.
	const pinsNow = (who: Color) => pinned({ ...s, occupied: occ, men: liveMen(s, gone) }, who);
	const cheapest = (who: Color): { from: Square; role: Role } | null => {
		const b = s.into.get(square);
		if (!b) return null;
		const pins = pinsNow(who);
		let best: { from: Square; role: Role } | null = null;
		for (const e of b[who]) {
			if (e.cost !== 1 || gone.has(e.from) || !s.men.has(e.from)) continue;
			if (e.needs.some((n) => n !== square && occ.has(n))) continue;
			const ray = pins.get(e.from);
			if (ray && !ray.has(square)) continue;
			const role = s.men.get(e.from)?.role;
			if (!role) continue;
			if (!best || V[role] < V[best.role]) best = { from: e.from, role };
		}
		return best;
	};

	// The captures that could happen, in order, and what each takes off.
	//
	// A pawn capturing onto a last rank PROMOTES, and what comes off the board is
	// the prize plus the difference the new queen makes. Missed in the first
	// version and found the same way as the pin: a c2 pawn taking a rook on b1 is
	// worth 1300, not 500.
	const taken: number[] = [];
	const froms: Square[] = [];
	let standing: Role = prize.role;
	let who = side;
	for (;;) {
		const next = cheapest(who);
		if (!next) break;
		const bonus = promotionOf({ color: who, role: next.role }, square);
		taken.push(V[standing] + bonus);
		froms.push(next.from);
		standing = bonus > 0 ? 'queen' : next.role;
		gone.add(next.from);
		occ = occ.without(next.from);
		who = other(who);
	}

	// S(j) = max(0, c_j − S(j+1)), backwards. The stopping point is where it hits
	// zero, and it is located by the same pass that values the chain: the first
	// j at which the side to move prefers to decline is where the line ends, so
	// the men that actually move are the prefix before it.
	const S: number[] = new Array(taken.length + 1).fill(0);
	for (let j = taken.length - 1; j >= 0; j--) S[j] = Math.max(0, taken[j] - S[j + 1]);
	let d = 0;
	while (d < taken.length && S[d] > 0) d++;
	return { value: S[0] ?? 0, spent: froms.slice(0, d), depth: d };
}

/** The number alone — what almost every caller wants. */
export function value(s: State, square: Square, side: Color): number {
	return line(s, square, side).value;
}

/**
 * The state with some men removed, and nothing rebuilt.
 *
 * §6.2's commitment sequence runs one exchange, then asks what the next is worth
 * with those men gone. On a board that means `clone()` and `take()` per node. On
 * the graph it is two collection edits: the edges are static, and an edge whose
 * anchor has left is skipped by the same `men.has(e.from)` test that was already
 * there. This is what "costs of branches on the graph should be trivial lookups"
 * looks like when it is not a metaphor.
 */
export function without(s: State, gone: Iterable<Square>): State {
	const men = new Map(s.men);
	let occupied = s.occupied;
	for (const g of gone) {
		men.delete(g);
		occupied = occupied.without(g);
	}
	return { ...s, occupied, men };
}

/**
 * The state after a move — two bits and the mover's own edges.
 *
 * §7: "a move is `from` emptying and `to` filling — exactly the two keys the
 * table is indexed by — plus the moving piece's own edge set from its
 * destination. Those three give the whole delta. Nothing is constructed, and
 * there is no make/unmake."
 *
 * The graph's other edges are not touched. Their LIVENESS changes, and that is
 * not a change to them: it is the same question asked of a different occupancy
 * word, which is exactly what AMEND-7 made possible by deleting `live` as a
 * stored field.
 *
 * The mover is the one piece whose edges genuinely move, because an edge is
 * anchored at a square. Re-homing it is `edgesFor` on the new occupancy — one
 * piece, not thirty.
 */
export function after(s: State, from: Square, to: Square, promotes?: Role): State {
	const mover = s.men.get(from);
	if (!mover) return s;
	const piece: Piece = promotes ? { color: mover.color, role: promotes } : mover;

	const men = new Map(s.men);
	men.delete(from);
	men.set(to, piece);
	const occupied = s.occupied.without(from).with(to);

	// Every edge except the mover's survives; the mover's are re-anchored.
	const kept = s.graph.edges.filter((e) => e.from !== from && e.from !== to);
	const mine = edgesForPiece(men, to, piece);
	const edges = [...kept, ...mine];
	return { graph: { ...s.graph, edges }, occupied, men, into: indexInto(edges) };
}

/**
 * The mover's edges from its new square.
 *
 * `graph.edgesFor` wants a Board, so one is assembled from the piece map for this
 * one call. Named rather than hidden: this is the seam where the graph layer is
 * not yet self-sufficient, and closing it means `edgesFor` taking an occupancy
 * and a piece map instead of a Board. It is O(pieces) for one piece, not a
 * rebuild, and it is the only board-shaped thing left in this file.
 */
function edgesForPiece(men: Map<Square, Piece>, at: Square, piece: Piece): Edge[] {
	const b = Board.empty();
	for (const [s, p] of men) b.set(s, p);
	return edgesFor(b, at, piece).edges;
}

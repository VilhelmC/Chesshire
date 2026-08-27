// Couplings — where the exchanges stop adding up.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §6, as amended by AMEND-6-TWO-CONDITIONS.md. PLAN.md M5.
//
// §6.1's claim is that if two exchange chains share no piece, no line and no
// tempo, their values ADD and there is no tree at all. Every branch point in
// the computation is a place where that fails. So this module's job is to find
// those places and nothing else: it prices no branch and chooses no move.
//
// §6.1 named four couplings by their mechanism. Counted as mechanisms they
// over-fire — a square gating two rays occurs on 92.7% of plies, which cannot
// be a branch point. The amendment keeps the four as the vocabulary of the
// SENTENCE and replaces them with two conditions as the TEST:
//
//   resolution — A's rational exchange, played out, changes B's value
//   commitment — one piece's departure turns two chains from held to lost
//
// Measured: 41.3% of plies carry a coupling, at most 8 pairs in one position.
// Depth is the number of couplings and branching is the arity of each, both
// known before the computation begins — which is §6.2's claim surviving
// contact with a corpus.
//
// No depth parameter, and nowhere to put one. Boards are cloned to construct
// hypothetical occupancy; positions are never played. `see()` already returns
// the steps, so resolving a chain is bookkeeping over a Board.
// ---------------------------------------------------------------------------

import { makeSquare } from 'chessops/util';
import type { Board } from 'chessops/board';
import type { Color, Square } from 'chessops/types';
import { see, seeValue, other, V } from './exchange';
import { build, on, type Graph } from './graph';

/**
 * A square where both sides bear and something is standing.
 *
 * The unit §6.3 calls a leaf: a chain under a partition and a parity, whose
 * value is closed-form. Everything above is bookkeeping over these.
 */
export type Chain = {
	square: Square;
	/** Whose piece is standing there. */
	owner: Color;
	/** Who would be taking. */
	taker: Color;
	attackers: Square[];
	defenders: Square[];
	/** SEE for the taker. Zero means the exchange is declined, not absent. */
	value: number;
	/**
	 * How many captures actually happen.
	 *
	 * An output, not an unknown — §6.3. The backward pass locates the rational
	 * stopping point by the same computation that produces the value, which is
	 * why harvest parity is recoverable without a second index.
	 */
	length: number;
};

export function chains(board: Board, g: Graph = build(board)): Chain[] {
	const out: Chain[] = [];
	for (const square of board.occupied) {
		const w = on(g, square, 'white');
		const b = on(g, square, 'black');
		// Both sides must bear on it. One-sided pressure is an obligation — the
		// ledger's business — and there is no exchange to couple to anything.
		if (!w.length || !b.length) continue;
		const piece = board.get(square);
		if (!piece) continue;
		const taker = other(piece.color);
		const ex = see(board, square, taker);
		out.push({
			square,
			owner: piece.color,
			taker,
			attackers: piece.color === 'white' ? b : w,
			defenders: piece.color === 'white' ? w : b,
			value: ex.value,
			length: ex.depth,
		});
	}
	return out.sort((a, b) => a.square - b.square);
}

/**
 * The board once the exchange at `c` has played itself out.
 *
 * An occupancy edit, not a replay. `see()` already computed which captures
 * happen and in what order; this applies them. Everything that traded is gone
 * and the last mover's piece is left standing on the square.
 *
 * A declined exchange returns the board unchanged, which is the correct answer
 * and the reason the commitment condition below has to exist separately: if
 * nothing happens, nothing downstream of it changes either.
 */
export function resolve(board: Board, c: Chain): Board {
	const b = board.clone();
	const ex = see(board, c.square, c.taker);
	if (!ex.steps.length) return b;
	let last = ex.steps[ex.steps.length - 1];
	for (const st of ex.steps) b.take(st.from);
	b.take(c.square);
	b.set(c.square, { color: last.side, role: last.promotes ? 'queen' : last.role });
	return b;
}

/**
 * §6.1's four kinds, kept as the vocabulary of the sentence.
 *
 * The mechanism is what a human is told — *"your knight cannot guard f7 and d6
 * at once"* names a contested defender, and naming it is the whole pedagogy.
 * It is not what the code tests, because tested as a mechanism it fires on
 * nearly every position.
 */
export type Mechanism = 'contestedDefender' | 'contestedSquare' | 'xray' | 'parity';

export type Coupling =
	| {
			kind: 'resolution';
			mechanism: Mechanism;
			/** The chain whose resolution moves the other. */
			from: Square;
			/** The chain that moves. */
			to: Square;
			/** What `to` is worth before and after `from` resolves. */
			was: number;
			becomes: number;
	  }
	| {
			kind: 'commitment';
			mechanism: 'contestedDefender';
			/** The piece that cannot be in two places. */
			piece: Square;
			/** The chains it is holding, all of which fall if it leaves. */
			holds: Square[];
			/** What its departure costs, summed over what it was holding. */
			cost: number;
	  };

/**
 * Which mechanism produced a resolution coupling.
 *
 * Diagnosed after the fact, from what the resolution actually changed. Asking
 * the mechanism FIRST is what over-fires; asking it second turns a true
 * condition into a sentence a human can use.
 */
function mechanismOf(board: Board, after: Board, a: Chain, b: Chain): Mechanism {
	// A defender or attacker of B was consumed by A. The participant set changed
	// because a participant died, which is the contested-defender shape arriving
	// through a resolution rather than through a deflection.
	const gone = [...b.defenders, ...b.attackers].filter((p) => board.occupied.has(p) && !after.occupied.has(p));
	if (gone.length) return 'contestedDefender';
	// A's square changed occupancy and B's value moved with it: a line opened or
	// closed through it. §6.1's x-ray, which is the same object as a race path
	// and as a slider's transit square — AMEND-7-ONE-EDGE.
	if (board.occupied.has(a.square) !== after.occupied.has(a.square)) return 'xray';
	const before = board.get(a.square);
	const now = after.get(a.square);
	if (before && now && (before.color !== now.color || before.role !== now.role)) return 'xray';
	return 'contestedSquare';
}

export type CoupleOpts = {
	/** Ignore chains worth less than this. Zero keeps every one. */
	floor?: number;
};

/**
 * Every place two chains fail to be independent.
 *
 * The two conditions are asked separately because they are separate questions.
 * Resolution asks what happens if the exchange RUNS; commitment asks what
 * happens if a piece is MADE TO CHOOSE. A defender holding two squares is
 * overloaded exactly when neither exchange runs — both chains are held while it
 * stays — so a single test keyed on resolution finds nothing there.
 */
export function couplings(board: Board, opts: CoupleOpts = {}): Coupling[] {
	const floor = opts.floor ?? 0;
	const cs = chains(board);
	const out: Coupling[] = [];

	// ---- Resolution. One walk per chain, reused across every other chain.
	const after = new Map<Square, Board>();
	for (const a of cs) {
		for (const b of cs) {
			if (a.square === b.square) continue;
			let boardAfter = after.get(a.square);
			if (!boardAfter) after.set(a.square, (boardAfter = resolve(board, a)));
			// B may have been the piece that just died. That is not a coupling, it
			// is A's own chain, and counting it would make every capture couple to
			// itself.
			if (!boardAfter.occupied.has(b.square)) continue;
			const becomes = seeValue(boardAfter, b.square, b.taker);
			if (becomes === b.value) continue;
			if (Math.max(becomes, b.value) < floor) continue;
			out.push({
				kind: 'resolution',
				mechanism: mechanismOf(board, boardAfter, a, b),
				from: a.square,
				to: b.square,
				was: b.value,
				becomes,
			});
		}
	}

	// ---- Commitment. The overload, tested by the counterfactual rather than by
	// the shape: a defender is overloaded when two chains it guards are HELD
	// while it stays and LOST when it goes.
	//
	// Measuring this on chains that are already losing found 1.7% and would have
	// hidden the motif entirely — an overloaded defender guards squares that are
	// each currently safe, which is what being defended means.
	const duty = new Map<Square, Chain[]>();
	for (const c of cs) {
		for (const d of c.defenders) {
			if (!duty.has(d)) duty.set(d, []);
			duty.get(d)!.push(c);
		}
	}
	for (const [piece, held] of duty) {
		// An early-out, NOT the condition — `falls.length < 2` below is. A mutation
		// audit changed this line and no test moved, which is the right answer: it
		// saves a board clone for every single-duty defender, and most defenders
		// are single-duty. Labelled so nobody reads it as the definition and
		// tightens it into one.
		if (held.length < 2) continue;
		const gone = board.clone();
		gone.take(piece);
		const falls = held.filter((c) => c.value <= 0 && seeValue(gone, c.square, c.taker) > 0);
		if (falls.length < 2) continue;
		const cost = falls.reduce((n, c) => n + seeValue(gone, c.square, c.taker), 0);
		if (cost < floor) continue;
		out.push({
			kind: 'commitment',
			mechanism: 'contestedDefender',
			piece,
			holds: falls.map((c) => c.square).sort((x, y) => x - y),
			cost,
		});
	}

	return out;
}

/**
 * Harvest parity, computed post hoc — §6.1's own prescription.
 *
 * *"It is a parity, not a piece or a square, so an index keyed on occupancy
 * alone will miss it."* Two chains that end on the same occupancy at different
 * parities are identical to the resolution test and different to the game, so
 * this is not a third index — it is arithmetic on lengths the exchange already
 * returned.
 *
 * The rule is §6.4's, stated as a tempo law rather than a value one: an odd
 * chain hands the move back to the other side, an even one does not. Two chains
 * of the same parity compete for the same tempo; two of different parity do not.
 */
export const parity = (c: Chain): 0 | 1 => (c.length % 2) as 0 | 1;

export function competesForTempo(a: Chain, b: Chain): boolean {
	// Length zero is a declined exchange: it spends nothing, so it competes for
	// nothing. Without this every pair of quiet squares reads as coupled.
	if (!a.length || !b.length) return false;
	return parity(a) === parity(b);
}

/**
 * What a coupling costs to ignore — the number that makes it worth branching on.
 *
 * Not a verdict and not a move. §6.2's tree is over these; choosing between its
 * branches needs §4's unrolling, which is still Open, and pretending otherwise
 * here is exactly the drift PLAN.md exists to prevent.
 */
export const weight = (c: Coupling): number =>
	c.kind === 'commitment' ? c.cost : Math.abs(c.becomes - c.was);

/** A one-line reading, in §6.6's terms: a sentence about a coupling. */
export function say(c: Coupling, board: Board): string {
	if (c.kind === 'commitment') {
		const role = board.get(c.piece)?.role ?? 'piece';
		return `the ${role} on ${makeSquare(c.piece)} cannot hold ${c.holds.map(makeSquare).join(' and ')} at once — ${c.cost}`;
	}
	const dir = c.becomes > c.was ? 'opens' : 'closes';
	return `resolving ${makeSquare(c.from)} ${dir} ${makeSquare(c.to)} (${c.was} → ${c.becomes})`;
}

/** Every square a coupling is about, for the overlay and for invalidation. */
export const squaresOf = (c: Coupling): Square[] =>
	c.kind === 'commitment' ? [c.piece, ...c.holds] : [c.from, c.to];

/** The pieces that are doing two jobs, largest debt first. §6.6's pedagogy. */
export function overloaded(board: Board): { piece: Square; holds: Square[]; cost: number }[] {
	return couplings(board)
		.filter((c): c is Extract<Coupling, { kind: 'commitment' }> => c.kind === 'commitment')
		.map(({ piece, holds, cost }) => ({ piece, holds, cost }))
		.sort((a, b) => b.cost - a.cost);
}

/** Kept so the value table has one importer and no second copy. */
export { V };

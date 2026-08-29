// What happens along a line, read off the board — no engine involved.
//
// ---------------------------------------------------------------------------
// WHY THE ENGINE IS NOT HERE.
//
// The obvious way to explain a line is to evaluate every position in it and point
// at the biggest swing. It does not work, and the reason is structural rather
// than practical: **inside a principal variation the evaluation is flat by
// construction.** That is what a PV IS — the line along which the root's value is
// realised. Walking it with the engine finds noise where the PV was truncated,
// not drama.
//
// The interesting points inside a line are the FORCING ones and the ones where
// MATERIAL CHANGES, and both are facts about the board. So this module needs no
// engine, no budget, and no caching, and it cannot disagree with itself.
//
// (Divergence between two DIFFERENT lines is a real signal, and that is a
// different computation: `engine/compare.ts` at the branch point.)
//
// ---------------------------------------------------------------------------
// MATERIAL IS OURS, AND THAT IS THE POINT.
//
// `PLAN-EXPLAINER.md` §2: NNUE has no material term to subtract, so
// `engineScore − ourMaterialCount` is not "the positional part" — it is the
// engine's disagreement with our piece values plus the horizon gap. We never
// report that number.
//
// What we can report is material, exactly, because we count it ourselves. It
// never has to be reconciled with the engine's scale, and it is the half of the
// explanation that is always true. When material is flat and the score is not,
// the honest sentence is "material is level; the difference is positional" — and
// then a named primitive takes over, or nothing does.
// ---------------------------------------------------------------------------

import type { Role } from 'chessops/types';
import { positionFromFen } from './chess';
import type { Line } from './line';
import { V } from './exchange';

/** Material for one side, in centipawns, kings excluded. */
function materialFor(fen: string, side: 'w' | 'b'): number {
	const pos = positionFromFen(fen);
	const colour = side === 'w' ? 'white' : 'black';
	let n = 0;
	for (const square of pos.board.occupied) {
		const piece = pos.board.get(square);
		if (!piece || piece.role === 'king') continue;
		n += piece.color === colour ? V[piece.role] : -V[piece.role];
	}
	return n;
}

export type TraceStep = {
	/** Index into the line's own steps. */
	ply: number;
	uci: string;
	san: string;
	/** Position after this move. */
	fen: string;
	/** Whose move this was. */
	colour: 'w' | 'b';
	/**
	 * Material after this move, in centipawns, from the ROOT MOVER's side.
	 *
	 * One point of view for the whole trace, and it is the point of view of the
	 * person who asked. A column that flips sign every ply is a column nobody can
	 * read down.
	 */
	material: number;
	/** Change this move caused, same sign convention. */
	delta: number;
	/** What came off the board, if anything. */
	captured: Role | null;
	/** Promoted to, if anything — material can change without a capture. */
	promoted: Role | null;
	/** This move gives check. */
	check: boolean;
	/** After this move the opponent has exactly one legal reply. */
	only: boolean;
	/** After this move the opponent has none, and is in check. */
	mate: boolean;
	/** Check, capture, promotion, only-reply or mate: the line is being driven. */
	forcing: boolean;
};

export type Trace = {
	steps: TraceStep[];
	/** Material at the root, root mover's side. The baseline every delta is against. */
	base: number;
	/** Net change from root to the end of the line. */
	net: number;
	/**
	 * The plies worth pointing at: where material moved, or the move was forcing.
	 *
	 * This is "the critical moment" inside a line, and it is a list rather than a
	 * single index because a line can have several — a sacrifice and its payoff are
	 * two moments, and collapsing them to one loses the story.
	 */
	moments: number[];
};

/**
 * Fold a line into what a reader needs: material at every ply, and where it moved.
 *
 * `mover` is whose point of view the numbers take. Defaults to whoever is to move
 * at the start of the line, which is the person asking.
 */
export function trace(line: Line, mover?: 'w' | 'b'): Trace {
	const side = mover ?? (positionFromFen(line.start).turn === 'white' ? 'w' : 'b');
	const base = materialFor(line.start, side);

	let previous = base;
	const steps: TraceStep[] = line.steps.map((s, i) => {
		const after = positionFromFen(s.fen);
		const material = materialFor(s.fen, side);

		// What was taken, read from the position BEFORE the move rather than
		// inferred from the material delta — a promotion changes material without a
		// capture, and a capture-with-promotion changes it twice. The two facts are
		// reported separately because a reader wants the piece, not the arithmetic.
		const before = positionFromFen(s.from);
		const from = before.board.get(uciSquare(s.uci, 0));
		const target = before.board.get(uciSquare(s.uci, 2));
		const enPassant =
			!target && from?.role === 'pawn' && s.uci[0] !== s.uci[2] ? ({ role: 'pawn' } as const) : null;
		const captured = (target?.role ?? enPassant?.role ?? null) as Role | null;
		const promoted = (PROMOTION[s.uci[4]] ?? null) as Role | null;

		const check = after.isCheck();
		const replies = countReplies(after);
		const mate = check && replies === 0;
		const delta = material - previous;
		previous = material;

		return {
			ply: i,
			uci: s.uci,
			san: s.san,
			fen: s.fen,
			colour: s.colour,
			material,
			delta,
			captured,
			promoted,
			check,
			only: replies === 1,
			mate,
			// A move is forcing when the opponent's choice is narrowed or the board
			// changed hands. Everything else in a line is a quiet move, and a reader
			// stepping through wants to know which is which.
			forcing: check || mate || replies === 1 || captured !== null || promoted !== null,
		};
	});

	return {
		steps,
		base,
		net: (steps.at(-1)?.material ?? base) - base,
		// A moment is a ply where something happened. `delta !== 0` catches the
		// exchange; `forcing` catches the check that made it possible.
		moments: steps.filter((s) => s.delta !== 0 || s.forcing).map((s) => s.ply),
	};
}

const PROMOTION: Record<string, Role> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

/** The square at `offset` in a UCI string, as a chessops index. */
function uciSquare(uci: string, offset: number): number {
	return 'abcdefgh'.indexOf(uci[offset]) + 8 * (Number(uci[offset + 1]) - 1);
}

/**
 * How many legal replies the side to move has, counted to at most two.
 *
 * "Exactly one reply" is the interesting fact — a forced move — and the count
 * beyond that is never used, so there is no reason to build the whole list.
 */
function countReplies(pos: ReturnType<typeof positionFromFen>): number {
	let n = 0;
	for (const [, dests] of pos.allDests()) {
		n += dests.size();
		if (n > 1) return 2;
	}
	return n;
}

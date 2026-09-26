// Solving a puzzle: what is on the board, and what happens when you move.
//
// ---------------------------------------------------------------------------
// A state machine rather than a pile of `useState` in the view, for the reason
// `domain/cursor` and `domain/punish` are: the rules here are the whole feature
// and none of them are about React. Whether a move is right, whether a puzzle
// is failed, whose turn it is, when the opponent replies and what counts as
// finished — all of it is arithmetic over a list of moves, and all of it was
// going to be reached only by clicking a board if it lived in the view.
//
// ---------------------------------------------------------------------------
// THE RULES, AND WHERE THEY COME FROM.
//
// FIRST WRONG MOVE FAILS IT. Lichess's rule, and it is the one that makes the
// rating mean anything: a puzzle you can retry until it works measures
// persistence, not sight. Retrying afterwards is allowed and does not count —
// see `PuzzleAttempt.rated`.
//
// A MATE IS A MATE. The corpus stores one solution, but a puzzle ending in mate
// can have several, and a reader who finds a different forced mate has solved
// it. So a move that delivers checkmate is accepted on the final move whatever
// the line says. Not on earlier moves: those have to follow the line, because
// there is a reply coming and the line is what it answers.
//
// THE OPPONENT'S REPLY IS SCRIPTED. It is `moves[even]`, played for you after
// each correct move. No engine is consulted — the puzzle's line is the puzzle,
// and asking an engine what to play instead would be inventing a different
// exercise from the one that was rated.
// ---------------------------------------------------------------------------

import { applyUci, positionFromFen, sameMove } from './chess';
import type { Puzzle } from './puzzles';

export type SolveStatus = 'solving' | 'solved' | 'failed';

export type SolveState = {
	puzzle: Puzzle;
	/**
	 * How many of the puzzle's moves have been played, including the opponent's.
	 *
	 * Starts at 1: the opponent's move that makes the puzzle is played before
	 * the reader sees anything. Always even when it is the solver's turn.
	 */
	at: number;
	status: SolveStatus;
	/** The position on the board now. */
	fen: string;
	/** The move that produced it, for the board's highlight. */
	lastMove: [string, string] | undefined;
	/** A wrong move, kept so it can be shown and then taken back. */
	wrong: string | null;
};

const asMove = (uci: string): [string, string] => [uci.slice(0, 2), uci.slice(2, 4)];

/** The puzzle as first seen: the opponent's move has been played. */
export function startSolve(puzzle: Puzzle): SolveState {
	const first = puzzle.moves[0];
	return {
		puzzle,
		at: 1,
		status: 'solving',
		fen: applyUci(puzzle.fen, first).fen,
		lastMove: asMove(first),
		wrong: null,
	};
}

/** Is it checkmate in this position? */
function isMate(fen: string): boolean {
	// The FEN after a move that gives mate — `applyUci` has already validated
	// legality, so the question is only whether the side to move has anything.
	return countLegal(fen) === 0 && inCheck(fen);
}

/* Both go through `chess.ts`'s position, which is the app's only board. */
function countLegal(fen: string): number {
	try {
		const pos = positionFromFen(fen);
		if (!pos) return 1;
		let n = 0;
		for (const [, to] of pos.allDests()) n += to.size();
		return n;
	} catch {
		return 1;
	}
}

function inCheck(fen: string): boolean {
	try {
		const pos = positionFromFen(fen);
		return pos ? pos.isCheck() : false;
	} catch {
		return false;
	}
}

export type SolveResult = {
	state: SolveState;
	/** What just happened, for the view to say something about. */
	verdict: 'right' | 'wrong' | 'solved';
};

/**
 * Play the reader's move.
 *
 * Returns the state unchanged when it is not their turn or the puzzle is over —
 * a guard rather than a throw, because a board can deliver a move a frame after
 * the puzzle ended and that is not an error.
 */
export function playMove(state: SolveState, uci: string): SolveResult {
	if (state.status !== 'solving') return { state, verdict: 'wrong' };

	const want = state.puzzle.moves[state.at];
	const last = state.at === state.puzzle.moves.length - 1;

	let played: { fen: string } | null = null;
	try {
		played = applyUci(state.fen, uci);
	} catch {
		played = null;
	}
	if (!played) return { state, verdict: 'wrong' };

	// See the header: a different forced mate on the final move is a solution.
	const right = (want && sameMove(state.fen, uci, want)) || (last && isMate(played.fen));

	if (!right) {
		return {
			state: { ...state, status: 'failed', wrong: uci },
			verdict: 'wrong',
		};
	}

	// Their scripted reply, if the line has one left.
	const afterOurs = state.at + 1;
	const reply = state.puzzle.moves[afterOurs];
	if (!reply) {
		return {
			state: {
				...state,
				at: afterOurs,
				status: 'solved',
				fen: played.fen,
				lastMove: asMove(uci),
			},
			verdict: 'solved',
		};
	}

	let afterReply: { fen: string };
	try {
		afterReply = applyUci(played.fen, reply);
	} catch {
		// A line that will not replay is a broken row, not a failed solve. Call it
		// solved rather than punish the reader for the corpus.
		return {
			state: { ...state, at: afterOurs, status: 'solved', fen: played.fen, lastMove: asMove(uci) },
			verdict: 'solved',
		};
	}

	return {
		state: {
			...state,
			at: afterOurs + 1,
			fen: afterReply.fen,
			lastMove: asMove(reply),
		},
		verdict: 'right',
	};
}

/**
 * Give up on it.
 *
 * A real transition rather than a wrong move faked for the purpose. The first
 * attempt at "skip" pushed an illegal move through `playMove`, which refuses it
 * and returns the state UNCHANGED — so skipping did nothing at all while
 * looking like it had. Giving up is its own act and says so.
 *
 * It counts as a failure. A puzzle you can walk away from for free is one the
 * rating never has to meet, and a rating that only meets the puzzles you
 * fancied is not measuring anything.
 */
export function giveUp(state: SolveState): SolveState {
	if (state.status !== 'solving') return state;
	return { ...state, status: 'failed', wrong: null };
}

/** The solver's move expected right now, as UCI. Null once it is over. */
export function wantedMove(state: SolveState): string | null {
	return state.status === 'solving' ? (state.puzzle.moves[state.at] ?? null) : null;
}

/** How far through: solver moves made, and how many there are. */
export function progress(state: SolveState): { done: number; total: number } {
	return {
		done: Math.floor(state.at / 2),
		total: Math.floor(state.puzzle.moves.length / 2),
	};
}

/**
 * The rest of the solution from here, as UCI.
 *
 * What "show me" walks on the board. From the CURRENT position rather than from
 * the start, so a reader who got three moves in and stuck is shown the part
 * they are stuck on.
 */
export function remainingLine(state: SolveState): string[] {
	return state.puzzle.moves.slice(state.at);
}

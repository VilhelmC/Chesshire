// A stated line, made walkable.
//
// ---------------------------------------------------------------------------
// The app asserts things like "you are a piece up once the exchange finishes"
// and "a5 is strong for them", and then prints the supporting moves as a row of
// notation. That asks the reader to play the sequence in their head before they
// can see what the claim was about — which is precisely the work a beginner
// cannot yet do, and precisely the reason they are using a trainer.
//
// §1.1 already says it: never make the learner derive what can be shown. A
// sequence of five moves in text is derivation. The same five moves stepped
// through on the board, with the piece that moves and the square it goes to
// marked, is showing.
//
// This turns a list of moves into positions. Rendering is elsewhere; what lives
// here is the part that has to be right — replaying legally, stopping cleanly
// when a line does not apply, and never pretending a broken line is a whole one.
// ---------------------------------------------------------------------------

import { applyUci, applySan, sideToMove } from './chess';

export type LineStep = {
	/** Position BEFORE this move — what the board shows while the move is highlighted. */
	from: string;
	/** Position after it. */
	fen: string;
	san: string;
	uci: string;
	/** Whose move this is. */
	colour: 'w' | 'b';
	/** 1-based move number, as a scoresheet counts. */
	moveNo: number;
};

export type Line = {
	/** Where the sequence starts. */
	start: string;
	steps: LineStep[];
	/**
	 * True when every supplied move was legal and replayed.
	 *
	 * A partially replayed line is shown as far as it got, and this says so. A
	 * truncated sequence presented as complete would be a claim that the line
	 * ends where the replay happened to fail.
	 */
	complete: boolean;
};

/** Replay a sequence of UCI moves from a position. */
export function lineFromUci(start: string, moves: string[]): Line {
	return replay(start, moves, (fen, m) => applyUci(fen, m));
}

/** Replay a sequence of SAN moves from a position. */
export function lineFromSan(start: string, moves: string[]): Line {
	return replay(start, moves, (fen, m) => applySan(fen, m));
}

function replay(
	start: string,
	moves: string[],
	apply: (fen: string, move: string) => { fen: string; san?: string; uci?: string },
): Line {
	const steps: LineStep[] = [];
	let fen = start;
	let complete = true;

	// Move numbering continues from wherever the position already is, so a line
	// starting at Black's 11th says 11 rather than 1.
	const startPly = plyOf(start);

	for (let i = 0; i < moves.length; i++) {
		const before = fen;
		try {
			const r = apply(before, moves[i]);
			const ply = startPly + i;
			steps.push({
				from: before,
				fen: r.fen,
				san: r.san ?? moves[i],
				uci: r.uci ?? moves[i],
				colour: sideToMove(before),
				moveNo: Math.floor(ply / 2) + 1,
			});
			fen = r.fen;
		} catch {
			// Illegal from here. Show what replayed and say the rest did not.
			complete = false;
			break;
		}
	}

	return { start, steps, complete };
}

/**
 * Plies played before this position.
 *
 * From the FEN's own move number and side to move, so a line quoted from the
 * middle of a game is numbered the way the game numbers it.
 */
export function plyOf(fen: string): number {
	const parts = fen.split(' ');
	const fullmove = Number(parts[5]) || 1;
	const black = parts[1] === 'b';
	return (fullmove - 1) * 2 + (black ? 1 : 0);
}

/** The board state to show at a given point in the line. */
export function stepAt(line: Line, index: number): { fen: string; lastMove?: [string, string] } {
	// -1 is the position before anything, so the claim can be seen from its
	// starting point as well as its conclusion.
	if (index < 0 || !line.steps.length) return { fen: line.start };
	const step = line.steps[Math.min(index, line.steps.length - 1)];
	return {
		fen: step.fen,
		lastMove: [step.uci.slice(0, 2), step.uci.slice(2, 4)],
	};
}

/**
 * Every position the line passes through, indexed from its start.
 *
 * ---------------------------------------------------------------------------
 * THE OFFSET IS THE WHOLE OF IT, so it is written down once.
 *
 * A line's cursor is −1 before its first move, which means index 0 of this
 * array is the position the line starts FROM and the cursor at `at` sits at
 * index `at + 1`. Every caller that wants to animate between two cursor
 * positions has to get that right, and the ways of getting it wrong — showing
 * the destination twice, skipping the first move — are indistinguishable from
 * a timing bug when you are watching pieces move.
 *
 * Here rather than in the overlay hook because it is a fact about a `Line` and
 * nothing to do with a board, a cursor or React.
 */
export function positionsOf(line: Line): string[] {
	return [stepAt(line, -1).fen, ...line.steps.map((_, i) => stepAt(line, i).fen)];
}

/**
 * An arrow for the move that PRODUCED the position being shown.
 *
 * ---------------------------------------------------------------------------
 * It used to draw the move about to be played — `steps[index + 1]` — on the
 * reasoning that the next move is the interesting one and the move just played
 * is already marked by chessground's last-move squares.
 *
 * Will, on the explainer: *"When I click a move the next move in the sequence is
 * drawn with an arrow, not what just changed."*
 *
 * That is the whole objection and it is right. AN ARROW IS THE LOUDEST THING ON
 * A BOARD, and pointing it at a move the reader did not click, while the move
 * they did click gets only a pair of tinted squares, makes the two channels
 * disagree about what the subject is. The subject is what you clicked.
 *
 * At the start of a line nothing has been played yet, so the first move is drawn
 * FAINTLY — `q3` rather than `q0`. It is a preview of the claim rather than a
 * report of it, and the ramp says which.
 */
export function arrowFor(line: Line, index: number): { orig: string; dest: string; brush: string }[] {
	const draw = (uci: string, brush: string) => [
		{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush },
	];
	if (index < 0) {
		const first = line.steps[0];
		// Faint: this has not happened, it is where the line begins.
		return first ? draw(first.uci, 'q3') : [];
	}
	const here = line.steps[Math.min(index, line.steps.length - 1)];
	// The quality ramp's strongest brush: this is the move being asserted.
	return here ? draw(here.uci, 'q0') : [];
}

/** Plain text for the whole line, for a tooltip or a copy. */
export function describeLine(line: Line): string {
	return line.steps
		.map((s, i) => {
			const prefix =
				s.colour === 'w' ? `${s.moveNo}.` : i === 0 ? `${s.moveNo}…` : '';
			return `${prefix}${s.san}`;
		})
		.join(' ');
}

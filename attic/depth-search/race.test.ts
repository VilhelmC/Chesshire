// A pawn nobody can catch, and — more importantly — the ones that CAN be caught.
//
// ---------------------------------------------------------------------------
// This term is the only place in the evaluation where a number appears that no
// capture put there, so it is the only place that can invent a win. The tests
// that matter here are therefore the negative ones: a pawn the king catches by
// the square rule, a pawn a knight gets in front of, a pawn whose promotion
// square is covered, a pawn with something in the way. Each of those must score
// zero, and each was chosen because a plausible implementation gets it wrong.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { positionFromFen, parseSquare } from '../src/domain/chess';
import { unstoppable, raceValue, raceGain, movesToReach, PROMOTION_GAIN, PER_PUSH } from '../src/domain/race';
import { SquareSet } from 'chessops/squareSet';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as number;

describe('the promotion race', () => {
	it('fires when every defender is further away than the pawn is from the eighth', () => {
		// gbaJ7, after 1...Bxg3 2.hxg3 h3. White's king needs four moves to reach
		// the h-file and the knight three; the pawn needs two. This is the position
		// Will pointed at, and depth does not help it: the same move scores -130 at
		// depths 4, 6 and 8 without this term.
		const pos = at('6k1/p7/2N3p1/8/6p1/2P3Pp/PP1K4/8 w - - 0 1');
		expect(unstoppable(pos, sq('h3'), 'black', 'white')).toBe(true);
		// Priced from the side to move, so White sees it as a loss — less one push,
		// because the queen is a move away rather than on the board.
		expect(raceValue(pos)).toBe(-(PROMOTION_GAIN - PER_PUSH));
	});

	it('does not fire when the king catches it — the square rule', () => {
		// Same pawn, king three files closer. Kf2-g2 covers h1 in time.
		const pos = at('6k1/p7/6p1/8/8/2P4p/PP3K2/8 w - - 0 1');
		expect(unstoppable(pos, sq('h3'), 'black', 'white')).toBe(false);
		expect(raceValue(pos)).toBe(0);
	});

	it('does not fire when a knight can get in front of it', () => {
		// Knight on f2 covers h1 in one move: an interception, not a capture.
		const pos = at('6k1/p7/6p1/8/8/2P4p/PP3N2/6K1 w - - 0 1');
		expect(unstoppable(pos, sq('h3'), 'black', 'white')).toBe(false);
	});

	it('does not fire when the promotion square is merely covered', () => {
		// A rook on the first rank covers the promotion square from a distance: it
		// never has to touch the pawn to answer it.
		const pos = at('6k1/p7/6p1/8/8/2P1K2p/PP6/1R6 b - - 0 1');
		expect(unstoppable(pos, sq('h3'), 'black', 'black')).toBe(false);
	});

	it('does not fire when something stands in the way', () => {
		// Even the pawn's own piece blocking the path stops it being a race.
		const pos = at('6k1/p7/6p1/8/8/2P4p/PP5b/4K3 b - - 0 1');
		expect(unstoppable(pos, sq('h3'), 'black', 'black')).toBe(false);
	});

	it('is a wash when both sides have one', () => {
		// Two unstoppable pawns do not win two queens; the position is decided by a
		// tempo this term deliberately does not try to count.
		const pos = at('7k/8/1P6/8/8/6p1/8/K7 w - - 0 1');
		expect(raceValue(pos)).toBe(0);
	});

	it('measures distance in the move graph, not on an empty board', () => {
		// Its own pawn stands between the rook and the target square, so the walk
		// has to go round. A distance function that ignored occupancy would call
		// this one move.
		const pos = at('7k/8/8/8/8/P7/8/R6K w - - 0 1');
		const target = SquareSet.empty().with(sq('a4'));
		// a1-a4 is blocked by the pawn on a3, so the rook has to step off the file
		// and back on: three moves, not one.
		expect(movesToReach(pos.board, sq('a1'), target, 2)).toBe(Infinity);
		expect(movesToReach(pos.board, sq('a1'), target, 4)).toBe(3);
	});
});

describe('the board the race is measured on', () => {
	it('sees a rook that the pawn itself is blocking', () => {
		// rF0aS. The white pawn on a7 stands between the black rook on a2 and the
		// promotion square, so measuring the rook's path on the CURRENT board says
		// it can never get there — and the term awarded a free queen for a pawn
		// that is captured the moment it arrives. The pawn is the piece that
		// moves; it cannot still be in the way when the queen lands.
		const pos = at('2R5/P2k4/1Kp3p1/5p2/1P2b1p1/6P1/r6P/8 w - - 7 53');
		// Not zero — the promotion is still worth making. It is worth the EXCHANGE
		// it wins (rook for pawn) rather than a whole queen, because the rook
		// arrives the moment the queen does and our own rook takes it back. Before
		// the fix this was the full 800, and moves that merely kept the pawn on a7
		// inherited it.
		const gain = raceGain(pos, sq('a7'), 'white', 'white');
		expect(gain).toBeGreaterThan(0);
		expect(gain).toBeLessThan(PROMOTION_GAIN);
		expect(gain).toBe(400);
	});

	it('still fires when nothing is behind the pawn', () => {
		// The same shape with the rook moved off the file: now it really is a race.
		const pos = at('2R5/P2k4/1Kp3p1/5p2/1P2b1p1/6P1/6rP/8 w - - 7 53');
		expect(raceValue(pos)).toBeGreaterThan(0);
	});
});

import { describe, it, expect } from 'vitest';
import { toWhitePov, toOurPov, parseInfo } from '../src/engine/stockfish';
import { toColourPov } from '../src/data/cloudEval';

// ---------------------------------------------------------------------------
// The two APIs disagree about whose point of view a score is from, and getting
// it wrong flips the evaluation in exactly half of all positions — quietly, and
// only for one colour. These tests pin the convention down.
//
//   Lichess cloud-eval : WHITE's point of view   (verified empirically)
//   Stockfish over UCI : SIDE TO MOVE's point of view
// ---------------------------------------------------------------------------

describe('sign conventions', () => {
	it('converts a side-to-move score to White POV', () => {
		// Black to move, engine says -157 (bad for Black) => White is +157.
		expect(toWhitePov(-157, 'b')).toBe(157);
		// White to move, engine says +162 => already White POV.
		expect(toWhitePov(162, 'w')).toBe(162);
	});

	it('is an involution for Black', () => {
		expect(toWhitePov(toWhitePov(42, 'b'), 'b')).toBe(42);
	});

	it('converts White POV to our POV', () => {
		expect(toColourPov(157, 'w')).toBe(157);
		expect(toColourPov(157, 'b')).toBe(-157);
	});

	it('agrees with the observed cloud-eval values', () => {
		// Real responses recorded 2026-08-18, all with BLACK to move:
		//   3.Nxe5 (White up a pawn)   -> cp +157
		//   Fried Liver 6.Nxf7         -> cp  +88
		// If these were side-to-move scores they would be negative. As White POV
		// they correctly say "White is better", and our POV as White is positive.
		expect(toColourPov(157, 'w')).toBeGreaterThan(0);
		expect(toColourPov(88, 'w')).toBeGreaterThan(0);
		// The same positions, viewed as Black, must be losing.
		expect(toColourPov(157, 'b')).toBeLessThan(0);
	});

	it('keeps mate scores on the right side of zero', () => {
		// 1.f3 e5 2.g4 with Black to move: cloud reports mate = -1, i.e. White
		// gets mated. As White that must be catastrophic, as Black it must be won.
		const mateForBlack = -10000 - -1 * 10; // the mapping used in cloudEval
		expect(mateForBlack).toBeLessThan(-9000);
		expect(toColourPov(mateForBlack, 'w')).toBeLessThan(-9000);
		expect(toColourPov(mateForBlack, 'b')).toBeGreaterThan(9000);
	});

	it('maps UCI mate scores from the side to move', () => {
		// "score mate 1" means the side to move mates. If that is Black, White is
		// the one being mated.
		const line = parseInfo('info depth 10 multipv 1 score mate 1 pv d8h4')!;
		expect(line.cp).toBeGreaterThan(9000);
		expect(toWhitePov(line.cp, 'b')).toBeLessThan(-9000);
	});

	it('round-trips UCI -> White -> our POV', () => {
		// Black to move, Black is winning by 300 (UCI: +300 for the side to move).
		const white = toWhitePov(300, 'b'); // -300
		expect(white).toBe(-300);
		expect(toColourPov(white, 'b')).toBe(300);
		expect(toOurPov(white, 'w')).toBe(-300);
	});
});

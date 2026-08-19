import { describe, it, expect } from 'vitest';
import { describeAdvantage, settle } from '../src/engine/session';
import { playSanLine } from '../src/domain/chess';

/**
 * The reported position: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5
 * 6.Nxf7 Kxf7 7.Qf3+ Ke8 8.Bxd5 Qf6 9.Bxc6+ Qxc6 10.Qxc6+ — White has just
 * taken the queen with check, and Black recaptures at once with 10...bxc6.
 */
const LINE =
	'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke8 Bxd5 Qf6 Bxc6+ Qxc6 Qxc6+';
const FEN = playSanLine(LINE).fen;
const RECAPTURE = ['b7c6'];

describe('settle', () => {
	it('plays the engine line out', () => {
		expect(settle(FEN, RECAPTURE)).not.toBe(FEN);
	});

	it('returns the position unchanged when there is no line', () => {
		expect(settle(FEN, [])).toBe(FEN);
	});

	it('stops at the first move that will not play', () => {
		expect(settle(FEN, ['a1a8', 'b7c6'])).toBe(FEN);
	});
});

describe('describeAdvantage', () => {
	it('does not claim a queen that is about to be recaptured', () => {
		// The bug: the raw count after Qxc6+ says queen up. It is not.
		const text = describeAdvantage(FEN, 'w', 200, 'plies', RECAPTURE);
		expect(text).not.toMatch(/queen up/i);
	});

	it('describes what survives the exchange, and says so', () => {
		const text = describeAdvantage(FEN, 'w', 200, 'plies', RECAPTURE);
		expect(text).toMatch(/once the exchange finishes/);
		// A knight and two pawns for a bishop — a piece, not a queen.
		expect(text).toMatch(/a piece up|a pawn up|two pawns up/i);
	});

	it('states the material plainly when nothing is pending', () => {
		// A quiet position: a clean extra rook, no captures in the air.
		const quiet = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
		const text = describeAdvantage(quiet, 'w', 600, 'threshold', []);
		expect(text).toContain('You are a rook up');
		expect(text).not.toMatch(/once the exchange/);
	});

	it('makes no material claim when material and evaluation disagree', () => {
		// Down material but winning — a sacrifice. Saying "you are a piece down"
		// as the punishment lands would be true and useless; saying "a piece up"
		// would be false. Say neither.
		const sacked = '4k3/8/8/8/8/8/8/n3K3 w - - 0 1';
		const text = describeAdvantage(sacked, 'w', 400, 'threshold', []);
		expect(text).toContain('Your position is much better');
		expect(text).not.toMatch(/\bup\b|\bdown\b/);
	});

	it('always carries the evaluation and the reason it stopped', () => {
		const t1 = describeAdvantage(FEN, 'w', 250, 'threshold', RECAPTURE);
		expect(t1).toContain('(+2.5)');
		expect(t1).toContain('punishment complete');
		const t2 = describeAdvantage(FEN, 'w', 250, 'plies', RECAPTURE);
		expect(t2).toContain('ordinary chess');
	});
});

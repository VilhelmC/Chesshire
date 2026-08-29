// Mate in one, and — the harder half — everything that is not mate in one.
//
// ---------------------------------------------------------------------------
// This is the only place in the evaluation that can return Infinity from a quiet
// position, so a false positive is unbounded: one wrongly-claimed mate outranks
// every real tactic on the board. The scan itself asks chessops whether the
// position is checkmate, which cannot be fooled; the risk lives entirely in the
// GATE in front of it, which decides what gets scanned at all. So the tests that
// matter are the ones where the gate is tempted — a king with room, a check that
// is not mate, a mate that only appears by discovery.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { mateIn1, mateThreatened } from '../src/domain/mate';

const at = (fen: string) => positionFromFen(fen);

describe('mate in one', () => {
	it('finds a back-rank mate', () => {
		expect(mateIn1(at('4r1k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1'))).toBe(true);
	});

	it('finds a mate that only exists by discovery', () => {
		// Ne8–f6 is mate because of the ROOK it uncovers on the eighth rank, not
		// because of where the knight lands. A scan that only looked at what the
		// moved piece attacks would miss this whole class.
		expect(mateIn1(at('R3N1k1/5ppp/8/8/8/8/8/6K1 w - - 0 1'))).toBe(true);
	});

	it('does not call an ordinary check a mate', () => {
		// Re8+ is available and is not mate: the h-pawn has moved, so the king has
		// h7 to step to. One square is the whole difference, which is why the gate
		// in front of the scan must not be the thing deciding.
		expect(mateIn1(at('6k1/5pp1/7p/8/8/8/4R3/6K1 w - - 0 1'))).toBe(false);
	});

	it('does not fire in a quiet middlegame', () => {
		expect(mateIn1(at('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1'))).toBe(false);
	});

	it('sees a mate threatened one move away, and only when it is real', () => {
		// White to move is not mated; Black threatens ...Re1#, and White is obliged
		// to answer it.
		const threatened = at('4r1k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1');
		expect(mateThreatened(threatened)).toBe(true);
		// Same position with an escape square made: no longer a threat.
		expect(mateThreatened(at('4r1k1/5ppp/8/8/8/6P1/5P1P/6K1 w - - 0 1'))).toBe(false);
	});

	it('never probes while in check — that obligation is already explicit', () => {
		// Black is in check (and in fact mated). The probe would be asking what
		// happens if Black passes, which is not a question the position allows;
		// the check extension is what handles this node.
		expect(mateThreatened(at('4R1k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1'))).toBe(false);
	});
});

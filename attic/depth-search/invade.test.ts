// Material at a distance — and, mostly, when NOT to claim it.
//
// ---------------------------------------------------------------------------
// This term invents material out of a quiet position, which makes a false
// positive unbounded in a way a false negative is not: a missed march costs one
// puzzle, an imagined one corrupts every endgame. So the tests that matter are
// the negative ones — a pawn the enemy king already guards, a pawn our king
// cannot walk to without stepping through fire, a middlegame where nobody has
// time to walk anywhere.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { invasionValue, anyInvasion } from '../src/domain/invade';

const at = (fen: string) => positionFromFen(fen);

describe('the invasion race', () => {
	it('says nothing about a pawn its own king is guarding', () => {
		// Black king on f6 defends f5; White's king is three moves from touching it.
		expect(invasionValue(at('8/7p/5k2/5p2/5P2/4K3/6P1/8 w - - 0 1'))).toBe(0);
	});

	it('says nothing in a middlegame — nobody has time to walk', () => {
		const pos = at('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
		expect(anyInvasion(pos)).toBe(false);
		expect(invasionValue(pos)).toBe(0);
	});

	it('fires when the king wins the race to a loose pawn', () => {
		// Kg3–h4 attacks h5 next move; the black king is in the far corner and
		// nothing else defends the pawn.
		const v = invasionValue(at('k7/8/8/7p/8/6K1/8/8 w - - 0 1'));
		expect(v).toBeGreaterThan(0);
	});

	it('is symmetric — the same race, priced from the other side', () => {
		const white = invasionValue(at('k7/8/8/7p/8/6K1/8/8 w - - 0 1'));
		// The same race with the colours swapped: it must be worth the same to the
		// side running it, and negative to the side it is being run against.
		const black = invasionValue(at('8/8/6k1/8/7P/8/8/K7 b - - 0 1'));
		expect(white).toBeGreaterThan(0);
		expect(black).toBeGreaterThan(0);
	});

	it('never counts a pawn the defender can recapture on', () => {
		// The knight can reach a square attacking the b-pawn, but taking it walks
		// into the rook.
		const v = invasionValue(at('7K/1p6/8/8/2N5/8/6k1/1r6 w - - 0 1'));
		expect(v).toBe(0);
	});
});

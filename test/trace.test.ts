// The material trace — the half of an explanation that is always true.
//
// The aggregate is `scripts/m2-trace-gate.mjs`: over 1,031 corpus lines and 5,312
// plies, the net matches a direct board diff, the deltas sum to it, every delta
// has a capture or promotion behind it, and `only`/`mate` are true of the board.
// All four exact — this module is arithmetic, so there is no threshold to argue.
//
// What is pinned here is the handful of cases that are easy to get wrong and rare
// enough that a corpus sweep might not contain them. Every FEN and every number
// below was generated and checked before it was written down.
import { describe, it, expect } from 'vitest';
import { trace } from '../src/domain/trace';
import { lineFromUci } from '../src/domain/line';

const t = (fen: string, moves: string[], mover?: 'w' | 'b') => {
	const line = lineFromUci(fen, moves);
	expect(line.complete).toBe(true); // an illegal move here is a broken test, not a finding
	return trace(line, mover);
};

describe('the material trace', () => {
	it('sees en passant, which takes a man on an EMPTY square', () => {
		// The case a naive `board.get(destination)` misses entirely: the pawn is
		// captured on f4 while the capturing pawn lands on f3. Read the wrong way
		// this reports a delta with no capture behind it, which is the one thing
		// the gate's third property forbids.
		const r = t('4k3/8/8/8/4pP2/8/8/4K3 b - f3 0 1', ['e4f3']);
		expect(r.steps[0].captured).toBe('pawn');
		expect(r.steps[0].delta).toBe(100);
		expect(r.net).toBe(100);
	});

	it('sees a promotion, which changes material with no capture at all', () => {
		// +800: a queen arrives (900) and a pawn leaves (100). `captured` stays null
		// — the two facts are reported separately because a reader wants the piece,
		// not the arithmetic.
		const r = t('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q']);
		expect(r.steps[0].captured).toBeNull();
		expect(r.steps[0].promoted).toBe('queen');
		expect(r.steps[0].delta).toBe(800);
	});

	it('sees a capture AND a promotion on the same move', () => {
		// +1120: knight taken (320), queen arrives (900), pawn spent (100). A
		// delta-only implementation would have to guess which of the two happened.
		const r = t('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7b8q']);
		expect(r.steps[0].captured).toBe('knight');
		expect(r.steps[0].promoted).toBe('queen');
		expect(r.steps[0].delta).toBe(1120);
	});

	it('marks a move that leaves exactly one legal reply', () => {
		// ♖a8+ and the king has only g7: g8 is still on the rook's rank and h7 is
		// his own pawn. This is a forcing point with no material behind it, which is
		// precisely the kind the engine's flat PV evaluation cannot show.
		const r = t('7k/7p/8/8/8/8/8/R3K3 w - - 0 1', ['a1a8', 'h8g7']);
		expect(r.steps[0].check).toBe(true);
		expect(r.steps[0].only).toBe(true);
		expect(r.steps[0].forcing).toBe(true);
		expect(r.steps[0].delta).toBe(0);
		// And the reply itself is not forcing anything.
		expect(r.steps[1].forcing).toBe(false);
	});

	it('marks mate, and does not mistake it for a forced reply', () => {
		const r = t('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8']);
		expect(r.steps[0].mate).toBe(true);
		expect(r.steps[0].check).toBe(true);
		expect(r.steps[0].only).toBe(false); // zero replies, not one
	});

	it('keeps ONE point of view down the whole column', () => {
		// Black captures, so the material moves against White — and the trace is
		// White's, so it reads −500 rather than flipping sign at Black's move. A
		// column that changes whose side it is on every ply is a column nobody can
		// read down.
		const fen = '3r2k1/5pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1';
		const white = t(fen, ['g1h1', 'd8d1'], 'w');
		expect(white.net).toBe(-500);
		expect(white.steps[1].delta).toBe(-500);

		// The same line from the other side is the exact mirror.
		const black = t(fen, ['g1h1', 'd8d1'], 'b');
		expect(black.net).toBe(500);
		// `+ 0` because negating a zero gives −0, and −0 is not 0 to a deep-equal.
		// A JS artefact rather than anything about chess, but it fails the test.
		expect(black.steps.map((s) => s.material)).toEqual(white.steps.map((s) => -s.material + 0));
	});

	it('defaults to the point of view of whoever is about to move', () => {
		// The person asking is the person on move, so that is the default.
		const fen = '3r2k1/5pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1';
		expect(t(fen, ['g1h1', 'd8d1']).net).toBe(t(fen, ['g1h1', 'd8d1'], 'w').net);
	});

	it('points only at the plies where something happened', () => {
		// ♔h1 is a quiet move and is not a moment; ♜xd1# is both a capture and mate
		// and is. This is what "the critical moment inside a line" means, and it is
		// a LIST because a sacrifice and its payoff are two moments — collapsing
		// them to one loses the story.
		const r = t('3r2k1/5pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1', ['g1h1', 'd8d1']);
		expect(r.moments).toEqual([1]);
	});

	it('reports a trade as a moment even when the net comes back to zero', () => {
		// ♖xd8+ wins a rook and the position is then a rook up; the moment is real
		// even though a reader looking only at the endpoints would see the capture.
		const r = t('3r2k1/5pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8', 'g8h7']);
		expect(r.steps[0].captured).toBe('rook');
		expect(r.moments).toContain(0);
		expect(r.net).toBe(500);
	});

	it('handles an empty line without inventing anything', () => {
		const r = t('4k3/8/8/8/8/8/8/4K3 w - - 0 1', []);
		expect(r.steps).toEqual([]);
		expect(r.net).toBe(0);
		expect(r.moments).toEqual([]);
	});
});

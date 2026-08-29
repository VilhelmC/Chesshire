// Mobilization deficiency — the arithmetic, and the one direction it may claim.
//
// The gate is `scripts/m5-muster-gate.mjs`, which falsifies rather than scores:
// every position where the corpus's own verified answer wins material ON a
// square this called unwinnable. It went 80.17% → 2.92% → 1.46% → 0.87% as three
// separate bugs came out, and the file records which.
//
// `swap` needs no FEN at all, so those cases are hand-checked arithmetic. The
// board cases were generated and verified by hand against the gate's own output
// before being written down.
import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { makeSquare } from 'chessops/util';
import { swap, muster, deficiencies, worthMobilising, musterMark } from '../src/domain/primitives/muster';
import { V } from '../src/domain/exchange';

const at = (fen: string) => positionFromFen(fen);

describe('swap — the exchange from value lists alone', () => {
	it('gives the whole prize when nothing answers', () => {
		// The case that caught the first version, which returned MINUS five pawns
		// for a completely undefended rook and so called it unwinnable.
		expect(swap(V.rook, [V.queen], [])).toBe(500);
	});

	it('nets the difference when the recapture happens', () => {
		expect(swap(V.rook, [V.pawn], [V.rook])).toBe(400);
	});

	it('is zero rather than negative when the exchange is declined', () => {
		// A knight taking a defended pawn loses material, so nobody plays it. The
		// value is what the position is WORTH, and no player is obliged to capture
		// — the same stand-pat `quiesce` rests on.
		expect(swap(V.pawn, [V.knight], [V.pawn])).toBe(0);
	});

	it('brings the least valuable man first', () => {
		// Pawn takes knight, rook recaptures the recapturer. Sending the rook first
		// would be worse, and the ordering is what makes this exact.
		expect(swap(V.knight, [V.pawn, V.rook], [V.knight])).toBe(320);
	});

	it('is zero on an empty square, however many men bear on it', () => {
		expect(swap(0, [V.rook, V.queen], [])).toBe(0);
	});
});

describe('deficiency', () => {
	it('calls a defended knight unwinnable', () => {
		// ♘d4 is held by ♛f6. Nxd4 Qxd4 is an even trade however many more men
		// arrive, because they arrive on both sides.
		const fen = 'r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/R2Q1RK1 w kq - 0 12';
		const d = deficiencies(at(fen), 3);
		expect(d.map((m) => makeSquare(m.square))).toContain('d4');
		expect(d.find((m) => makeSquare(m.square) === 'd4')!.best).toBe(0);
	});

	it('does NOT call a free rook unwinnable', () => {
		// The 275-position contradiction that exposed the sign bug: ♕b4xf8 simply
		// wins a rook, and the detector was telling a learner not to play it.
		const fen = '1k3r2/1pp5/p3p3/P5pp/1Q2r3/4q2P/1P4PK/4R3 w - - 0 31';
		expect(deficiencies(at(fen), 3).map((m) => makeSquare(m.square))).not.toContain('f8');
	});

	it('lets the king capture when nothing answers', () => {
		// ♔h7xh8 takes the rook. The king is kept out of the swap because it cannot
		// be spent, and putting it back for the FIRST capture is the ordinary rule
		// — two of the last five contradictions were exactly this.
		const fen = '7R/1P3ppk/P7/8/3Pp3/4Pb2/1r5p/4RK2 b - - 1 40';
		expect(deficiencies(at(fen), 3).map((m) => makeSquare(m.square))).not.toContain('h8');
	});

	it('ignores prizes below the threshold, because the wide form is a decoration', () => {
		// Measured, not chosen: any prize fires on 39.5% of plies against
		// PLAN-EXPLAINER §4's 40% line; knight-or-better on 9.9%. "You cannot win
		// that defended pawn" is true of half the board.
		// ♘d4 bears on ♟e6, which ♟f7 holds. Nxe6 fxe6 loses a knight for a pawn, so
		// e6 really is unwinnable — and saying so is worth nothing to anybody.
		const fen = '6k1/5p2/4p3/8/3N4/8/8/6K1 w - - 0 1';
		expect(deficiencies(at(fen), 3, 0).map((m) => makeSquare(m.square))).toEqual(['e6']);
		expect(deficiencies(at(fen), 3, V.knight)).toEqual([]);
	});

	it('says one fixed sentence', () => {
		const fen = 'r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/R2Q1RK1 w kq - 0 12';
		const m = deficiencies(at(fen), 3).find((x) => makeSquare(x.square) === 'd4')!;
		expect(musterMark(m).note).toBe('d4 cannot be won — they can always answer');
	});
});

describe('the horizon', () => {
	it('reports arrivals later than now, which is the whole point', () => {
		// If every arrival were at t=0 the primitive would be SEE wearing a hat.
		const fen = 'r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/R2Q1RK1 w kq - 0 12';
		const m = muster(at(fen).board, 27 /* d4 */, 'white', 3);
		expect(m.ours.some((a) => a.at > 0)).toBe(true);
	});

	it('worthMobilising is an upper bound and is not drawn', () => {
		// It offers f6 — the enemy QUEEN — as winnable in two plies, because `bear`
		// walks one man on a frozen board and she will not wait. Asserted so the
		// optimism is a documented property rather than a surprise: this is why the
		// overlay ships the NEGATIVE claim only.
		const fen = 'r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/R2Q1RK1 w kq - 0 12';
		const w = worthMobilising(at(fen), 3);
		expect(w.map((m) => makeSquare(m.square))).toContain('f6');
		expect(w.every((m) => m.bestAt > 0)).toBe(true);
	});
});

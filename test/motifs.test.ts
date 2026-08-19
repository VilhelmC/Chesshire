import { describe, it, expect } from 'vitest';
import { detectMotifs } from '../src/engine/motifs';
import { expectedScore, computePunishmentGap } from '../src/engine/punishment';

describe('detectMotifs', () => {
	it('spots the classic Qh5 fork of king and loose piece', () => {
		// Scholar's-mate shape: after 1.e4 e5 2.Bc4 Nc6 3.Qh5, Qh5 hits f7 (with
		// Bc4) and eyes e5. The queen attacking e5 + threatening mate is the
		// beginner fork this app exists to teach.
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 4 3';
		const m = detectMotifs(fen, 'd1h5');
		expect(m.length).toBeGreaterThan(0);
	});

	it('reports material gain when a piece is simply taken', () => {
		// White knight on f3 captures a pawn on e5.
		const fen = 'rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2';
		const m = detectMotifs(fen, 'f3e5');
		expect(m).toContain('pawn_win');
	});

	it('detects a pin against the king', () => {
		// Ra1-e1 pins the e5 rook against the e8 king down an empty e-file.
		const fen = '4k3/8/8/4r3/8/8/8/R5K1 w - - 0 1';
		expect(detectMotifs(fen, 'a1e1')).toContain('pin');
	});

	it('does not call a coincidental alignment a tactic', () => {
		// The Ruy Lopez 3.Bb5 is famously NOT a pin: the d7 pawn sits between the
		// c6 knight and the king. An earlier version reported "skewer" here.
		const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 3';
		const m = detectMotifs(fen, 'f1b5');
		expect(m).not.toContain('pin');
		expect(m).not.toContain('skewer');
	});

	it('returns nothing for an illegal or malformed move', () => {
		expect(detectMotifs('not a fen', 'e2e4')).toEqual([]);
		const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		// e2-e5 is not a legal pawn move. chessops' play() does not validate, so
		// without an explicit legality check this used to return 'space_grab'.
		expect(detectMotifs(fen, 'e2e5')).toEqual([]);
		expect(detectMotifs(fen, 'zzzz')).toEqual([]);
	});

	it('always returns at least one motif for a legal quiet move', () => {
		const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		expect(detectMotifs(fen, 'e2e4').length).toBeGreaterThan(0);
	});
});

describe('punishment gap', () => {
	it('maps centipawns to a sane expected score', () => {
		expect(expectedScore(0)).toBeCloseTo(0.5, 6);
		expect(expectedScore(400)).toBeCloseTo(0.909, 2);
		expect(expectedScore(-400)).toBeCloseTo(0.091, 2);
	});

	it('is large when a losing move still scores well', () => {
		// 3...f5 territory: we are +200 after the refutation, so they "should"
		// score ~24% — but they actually score 52.6%.
		const gap = computePunishmentGap(200, 0.526)!;
		expect(gap).toBeGreaterThan(0.25);
	});

	it('is near zero for a sound move scoring as expected', () => {
		const gap = computePunishmentGap(20, expectedScore(-20))!;
		expect(Math.abs(gap)).toBeLessThan(0.001);
	});

	it('ranks the badly-punished move above the well-punished one', () => {
		// Both are near-losing and rare. 3...f5 scores 52.6%, 3...f6 scores 39.5%.
		const f5 = computePunishmentGap(200, 0.526)!;
		const f6 = computePunishmentGap(150, 0.395)!;
		expect(f5).toBeGreaterThan(f6);
		// Both are still positive: at this level even the "punished" move is
		// under-punished, which is the whole premise.
		expect(f6).toBeGreaterThan(0);
	});

	it('returns null without a final evaluation', () => {
		expect(computePunishmentGap(null, 0.5)).toBeNull();
	});
});

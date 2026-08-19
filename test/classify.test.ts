import { describe, it, expect } from 'vitest';
import { classifyMove, truncateByCoverage, scoreForSideToMove } from '../src/domain/classify';
import { playSanLine, positionKey, applyUci, INITIAL_FEN } from '../src/domain/chess';
import { parseInfo } from '../src/engine/stockfish';

describe('classifyMove', () => {
	it('marks repertoire moves as book regardless of the swing', () => {
		expect(classifyMove(0, 500, true)).toBe('book');
	});

	it('needs both a real swing and a real advantage to call a blunder', () => {
		// Damiano's Defence: 1.e4 e5 2.Nf3 f6 goes +0.18 -> +1.62. The old
		// delta-only rule (>=150cp) missed this by six centipawns.
		expect(classifyMove(18, 162)).toBe('blunder');
		// Big swing, but we are still not better — nothing concrete to punish.
		expect(classifyMove(-300, -100)).not.toBe('blunder');
		// Already winning before their move; they did not cause it.
		expect(classifyMove(400, 420)).not.toBe('blunder');
	});

	it('leaves sound main-line replies alone', () => {
		// Real values from the first live sweep, all correctly classified.
		expect(classifyMove(18, 32)).toBe('playable'); // 1...c5
		expect(classifyMove(7, 20)).toBe('playable'); // 3...Bc5
		expect(classifyMove(18, 22)).toBe('playable'); // 1...e6
		expect(classifyMove(7, 56)).toBe('inaccuracy'); // 3...h6 — loosening, not losing
	});

	it('flags moves that are good for them as holes in our line', () => {
		expect(classifyMove(50, -60)).toBe('refutes_us');
	});
});

describe('truncateByCoverage', () => {
	it('keeps the head and reports the dropped tail', () => {
		const moves = [
			{ frequency: 0.5 },
			{ frequency: 0.3 },
			{ frequency: 0.15 },
			{ frequency: 0.04 },
			{ frequency: 0.003 },
		];
		const { kept, dropped, coveredMass } = truncateByCoverage(moves);
		expect(coveredMass).toBeGreaterThanOrEqual(0.95);
		// the 0.3% move is below MIN_FREQ and must be reported, never silently lost
		expect(dropped).toContainEqual({ frequency: 0.003 });
		expect(kept.length + dropped.length).toBe(moves.length);
	});
});

describe('scoreForSideToMove', () => {
	it('counts draws as a half point for the side to move', () => {
		expect(scoreForSideToMove('w', { white: 10, draws: 10, black: 0 })).toBeCloseTo(0.75);
		expect(scoreForSideToMove('b', { white: 10, draws: 10, black: 0 })).toBeCloseTo(0.25);
	});
});

describe('chess helpers', () => {
	it('plays the Italian into the expected FEN', () => {
		const { fen, ucis } = playSanLine('1. e4 e5 2. Nf3 Nc6 3. Bc4');
		expect(fen).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
		expect(ucis).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4']);
	});

	it('normalises position keys across move counters', () => {
		const a = positionKey('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
		const b = positionKey('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 99 40');
		expect(a).toBe(b);
	});

	it('rejects illegal moves', () => {
		expect(() => applyUci(INITIAL_FEN, 'e2e5')).toThrow();
	});
});

describe('parseInfo', () => {
	it('parses a MultiPV info line', () => {
		const l = parseInfo(
			'info depth 22 seldepth 30 multipv 2 score cp -45 nodes 1000 pv e7e5 g1f3 b8c6',
		);
		expect(l).not.toBeNull();
		expect(l!.multipv).toBe(2);
		expect(l!.cp).toBe(-45);
		expect(l!.depth).toBe(22);
		expect(l!.pv[0]).toBe('e7e5');
	});

	it('maps mate scores onto the centipawn scale', () => {
		const l = parseInfo('info depth 10 multipv 1 score mate 3 pv d1h5');
		expect(l!.cp).toBeGreaterThan(9000);
		const m = parseInfo('info depth 10 multipv 1 score mate -3 pv d1h5');
		expect(m!.cp).toBeLessThan(-9000);
	});

	it('ignores non-pv info lines', () => {
		expect(parseInfo('info depth 1 currmove e2e4 currmovenumber 1')).toBeNull();
	});
});

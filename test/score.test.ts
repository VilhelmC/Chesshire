import { describe, it, expect, vi, beforeEach } from 'vitest';

// Centipawn loss is a DIFFERENCE, so both evaluations must be measured the same
// way. The bug this file guards: the first version compared a cached deep cloud
// evaluation against a fresh shallow one, then clamped negatives to zero — so
// depth-gap noise could only ever flatter, and a poor game estimated at 1639.

const analyse = vi.fn();
vi.mock('../src/engine/stockfish', () => ({
	engine: { analyse: (...a: unknown[]) => analyse(...a) },
	toWhitePov: (cp: number, stm: 'w' | 'b') => (stm === 'w' ? cp : -cp),
}));

const { scoreMove } = await import('../src/engine/score');
const { playSanLine } = await import('../src/domain/chess');

const START = playSanLine('').fen;

beforeEach(() => analyse.mockReset());

/** UCI scores are side-to-move relative. */
function line(cp: number, first = 'e2e4') {
	return { fen: '', depth: 14, lines: [{ multipv: 1, cp, mate: null, depth: 14, pv: [first] }] };
}

describe('scoreMove', () => {
	it('uses the same budget for both evaluations', async () => {
		analyse.mockResolvedValue(line(20));
		await scoreMove(START, 'e2e4', 'w');

		expect(analyse).toHaveBeenCalledTimes(2);
		const [, depthA, pvA, timeA] = analyse.mock.calls[0];
		const [, depthB, pvB, timeB] = analyse.mock.calls[1];
		expect(depthA).toBe(depthB);
		expect(pvA).toBe(pvB);
		expect(timeA).toBe(timeB);
	});

	it('reports no loss for a move that keeps the evaluation', async () => {
		// White to move at +20; after the move Black is to move and the engine
		// reports -20 from Black's side, i.e. still +20 for White.
		analyse.mockResolvedValueOnce(line(20)).mockResolvedValueOnce(line(-20));
		const s = await scoreMove(START, 'e2e4', 'w');
		expect(s!.loss).toBe(0);
	});

	it('measures the drop when a move throws away an advantage', async () => {
		// +300 before; after the move Black is to move and stands at +100 from
		// Black's side, i.e. -100 for White. White gave up 400.
		analyse.mockResolvedValueOnce(line(300)).mockResolvedValueOnce(line(100));
		const s = await scoreMove(START, 'e2e4', 'w');
		expect(s!.best).toBe(300);
		expect(s!.after).toBe(-100);
		expect(s!.loss).toBe(400);
	});

	it('caps a catastrophe so one move cannot dominate an average', async () => {
		analyse.mockResolvedValueOnce(line(300)).mockResolvedValueOnce(line(5000));
		const s = await scoreMove(START, 'e2e4', 'w');
		expect(s!.loss).toBe(600);
	});

	it('never reports a negative loss', async () => {
		analyse.mockResolvedValueOnce(line(20)).mockResolvedValueOnce(line(-500));
		const s = await scoreMove(START, 'e2e4', 'w');
		expect(s!.loss).toBeGreaterThanOrEqual(0);
	});

	it('returns null rather than zero when the engine gives nothing', async () => {
		// Zero would be recorded as "played the best move" — the exact bias that
		// pushed the rating estimate up.
		analyse.mockResolvedValueOnce(line(20)).mockResolvedValueOnce({ fen: '', depth: 14, lines: [] });
		expect(await scoreMove(START, 'e2e4', 'w')).toBeNull();
	});

	it('returns null on an illegal move without calling the engine', async () => {
		expect(await scoreMove(START, 'e2e5', 'w')).toBeNull();
		expect(analyse).not.toHaveBeenCalled();
	});

	it('scores from Black’s point of view when we are Black', async () => {
		const afterE4 = playSanLine('1. e4').fen;
		// Black to move at -30 from Black's side (White better by 30). After the
		// reply White is to move at +30, i.e. still -30 for Black. No loss.
		analyse.mockResolvedValueOnce(line(-30, 'e7e5')).mockResolvedValueOnce(line(30));
		const s = await scoreMove(afterE4, 'e7e5', 'b');
		expect(s!.best).toBe(-30);
		expect(s!.loss).toBe(0);
	});
});

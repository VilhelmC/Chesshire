import { describe, it, expect } from 'vitest';
import {
	classifyQuality,
	distribution,
	accuracyPercent,
	comment,
	QUALITY_ORDER,
	QUALITY_COLOUR,
} from '../src/domain/review';
import { ratingSeries } from '../src/domain/rating';

describe('move quality', () => {
	it('uses the vocabulary every chess site already uses', () => {
		expect(classifyQuality(0)).toBe('best');
		expect(classifyQuality(25)).toBe('excellent');
		expect(classifyQuality(50)).toBe('good');
		expect(classifyQuality(100)).toBe('inaccuracy');
		expect(classifyQuality(200)).toBe('mistake');
		expect(classifyQuality(400)).toBe('blunder');
	});

	it('is monotonic across the whole range', () => {
		let last = -1;
		for (const cp of [0, 10, 30, 60, 120, 250, 600]) {
			const idx = QUALITY_ORDER.indexOf(classifyQuality(cp));
			expect(idx).toBeGreaterThanOrEqual(last);
			last = idx;
		}
	});

	it('has a colour for every grade', () => {
		for (const q of QUALITY_ORDER) expect(QUALITY_COLOUR[q]).toMatch(/^#[0-9a-f]{6}$/i);
	});
});

describe('distribution', () => {
	it('counts every move exactly once', () => {
		const losses = [0, 5, 40, 90, 300, 700];
		const d = distribution(losses);
		expect(QUALITY_ORDER.reduce((s, q) => s + d[q], 0)).toBe(losses.length);
	});
});

describe('accuracy', () => {
	it('is 100 for a flawless run and falls as loss rises', () => {
		expect(accuracyPercent([0, 0, 0])).toBe(100);
		expect(accuracyPercent([100])).toBeLessThan(accuracyPercent([20])!);
	});

	it('does not report zero for consistently second-best play', () => {
		// "Share of best moves" would call this 0%, which is not what the game was.
		const acc = accuracyPercent([25, 25, 25, 25])!;
		expect(acc).toBeGreaterThan(60);
	});

	it('has no opinion without moves', () => {
		expect(accuracyPercent([])).toBeNull();
	});

	it('caps a single disaster', () => {
		expect(accuracyPercent([0, 0, 5000])).toBe(accuracyPercent([0, 0, 600]));
	});
});

describe('commentary', () => {
	it('says where the move was played', () => {
		expect(comment({ quality: 'best', cpLoss: 0, phase: 'punish' })).toContain('punishing');
		expect(comment({ quality: 'best', cpLoss: 0, phase: 'book' })).toContain('in the line');
	});

	it('does not grade an assisted answer', () => {
		expect(comment({ quality: 'blunder', cpLoss: 400, assisted: true })).toContain('not scored');
	});

	it('names the better move when there is one', () => {
		expect(comment({ quality: 'mistake', cpLoss: 200, best: 'Nxe5' })).toContain('Nxe5');
	});
});

describe('rating over time', () => {
	const row = (runId: string, ts: number, cpLoss: number) => ({ runId, ts, cpLoss });

	it('gives one point per run, in time order', () => {
		const rows = [
			...Array(5).fill(0).map(() => row('r2', 2000, 40)),
			...Array(5).fill(0).map(() => row('r1', 1000, 20)),
		];
		const s = ratingSeries(rows);
		expect(s.map((p) => p.runId)).toEqual(['r1', 'r2']);
	});

	it('skips runs too short to mean anything', () => {
		const rows = [row('r1', 1000, 20), row('r1', 1000, 20)];
		expect(ratingSeries(rows)).toEqual([]);
	});

	it('still counts short runs towards the cumulative figure', () => {
		// Dropping them from the plot is a display decision; throwing away the
		// data would be a measurement one.
		const rows = [
			row('short', 500, 400),
			...Array(5).fill(0).map(() => row('r1', 1000, 10)),
		];
		const [p] = ratingSeries(rows);
		expect(p.elo).toBeGreaterThan(p.cumulative);
	});

	it('moves the cumulative estimate as play improves', () => {
		const rows = [
			...Array(6).fill(0).map(() => row('r1', 1000, 150)),
			...Array(6).fill(0).map(() => row('r2', 2000, 15)),
		];
		const s = ratingSeries(rows);
		expect(s[1].cumulative).toBeGreaterThan(s[0].cumulative);
		expect(s[1].elo).toBeGreaterThan(s[1].cumulative);
	});
});

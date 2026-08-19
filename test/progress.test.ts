import { describe, it, expect } from 'vitest';
import { freeplayLosses, accuracy, median, type AnswerRow } from '../src/domain/progress';

// The per-line aggregation this file used to test is gone: it counted every
// answer once per line sharing the prefix, so a line's accuracy was mostly a
// measure of the trunk. Positions form a tree and the numbers are computed on
// one now — see test/tree.test.ts.

let n = 0;
const ans = (over: Partial<AnswerRow> = {}): AnswerRow => ({
	id: `a${++n}`,
	ts: n,
	runId: 'r1',
	path: ['e4', 'e5'],
	ply: 2,
	phase: 'book',
	correct: true,
	revealed: false,
	assisted: false,
	cpLoss: 0,
	...over,
});

describe('freeplayLosses', () => {
	it('takes only free-play moves, which are the only ones that measure strength', () => {
		const rows = [
			ans({ phase: 'freeplay', cpLoss: 40 }),
			ans({ phase: 'book', cpLoss: 500 }),
			ans({ phase: 'punish', cpLoss: 500 }),
		];
		expect(freeplayLosses(rows)).toEqual([40]);
	});

	it('excludes assisted moves — being shown the move measures nothing', () => {
		const rows = [
			ans({ phase: 'freeplay', cpLoss: 40 }),
			ans({ phase: 'freeplay', cpLoss: 0, assisted: true }),
		];
		expect(freeplayLosses(rows)).toEqual([40]);
	});

	it('drops unmeasured moves rather than recording them as perfect', () => {
		// -1 means "not scored". Counting it as 0 would flatter the rating, which
		// is exactly the bug that once reported 1639 on poor play.
		const rows = [ans({ phase: 'freeplay', cpLoss: -1 }), ans({ phase: 'freeplay', cpLoss: 60 })];
		expect(freeplayLosses(rows)).toEqual([60]);
	});
});

describe('accuracy', () => {
	it('is null with no attempts, never a flattering 100%', () => {
		expect(accuracy(0, 0)).toBeNull();
	});

	it('is the plain ratio otherwise', () => {
		expect(accuracy(3, 4)).toBe(0.75);
		expect(accuracy(0, 4)).toBe(0);
	});
});

describe('median', () => {
	it('is null for nothing', () => {
		expect(median([])).toBeNull();
	});

	it('takes the middle of an odd count and the mean of the middle two of an even one', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
	});
});

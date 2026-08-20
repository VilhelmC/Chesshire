// The control strip's column count.
//
// Nine controls at a usable touch size do not fit across a phone. What this
// guards is the consequence: when it has to take two rows, the rows are EVEN.
// Plain flex-wrap gave six then three, with a third of the last row empty,
// which is what "spills over to two rows" was objecting to.

import { describe, it, expect } from 'vitest';
import { columnsFor } from '../src/components/Toolbar';

describe('columnsFor', () => {
	it('puts everything on one row when there is room', () => {
		expect(columnsFor(9, 1000)).toBe(9);
	});

	it('balances the rows instead of stranding a remainder', () => {
		// A 393px phone minus the app's own padding.
		const cols = columnsFor(9, 369);
		expect(cols).toBe(5); // 5 + 4, not 6 + 3
		const rows = Math.ceil(9 / cols);
		const lastRow = 9 - cols * (rows - 1);
		// No row may be less than half full — that is the ragged edge.
		expect(lastRow).toBeGreaterThanOrEqual(cols - 1);
	});

	it('never returns more columns than fit at the minimum size', () => {
		for (const width of [200, 260, 320, 369, 480, 700]) {
			const cols = columnsFor(9, width);
			expect(cols * 52 + (cols - 1) * 6).toBeLessThanOrEqual(Math.max(width, 58));
		}
	});

	it('keeps rows even for every plausible control count', () => {
		for (let n = 1; n <= 12; n++) {
			const cols = columnsFor(n, 369);
			const rows = Math.ceil(n / cols);
			const lastRow = n - cols * (rows - 1);
			expect(lastRow).toBeGreaterThan(0);
			// Balanced: the shortest row is within one of the longest.
			expect(cols - lastRow).toBeLessThanOrEqual(1);
		}
	});

	it('survives being measured before layout', () => {
		expect(columnsFor(9, 0)).toBe(1);
		expect(columnsFor(0, 369)).toBe(1);
	});
});

// The move list reads as a scoresheet, which means the columns have to line up.
//
// The property that matters: White's move is always in White's column. A line
// resumed at an even ply starts with Black, and the old strip renumbered from
// that move — so Black's 5th was displayed as White's 1st, in White's column,
// under a number that belonged to neither.

import { describe, it, expect } from 'vitest';
import { toPairs, pairsPerRow, MAX_PAIRS_PER_ROW, type MoveChip } from '../src/components/MoveList';

const chip = (san: string, ply: number): MoveChip => ({
	san,
	ply,
	mistake: false,
	suboptimal: false,
	white: ply % 2 === 1,
});

describe('toPairs', () => {
	it('numbers moves the way a scoresheet does', () => {
		const pairs = toPairs([chip('e4', 1), chip('e5', 2), chip('Nf3', 3)]);
		expect(pairs.map((p) => p.no)).toEqual([1, 2]);
		expect(pairs[0].white?.san).toBe('e4');
		expect(pairs[0].black?.san).toBe('e5');
		expect(pairs[1].white?.san).toBe('Nf3');
		expect(pairs[1].black).toBeNull();
	});

	it('leaves White empty when the line starts on a Black move', () => {
		// Resumed at ply 4: the first move shown is Black's 2nd.
		const pairs = toPairs([chip('Nc6', 4), chip('Bc4', 5)]);
		expect(pairs[0].no).toBe(2);
		expect(pairs[0].white).toBeNull();
		expect(pairs[0].black?.san).toBe('Nc6');
		expect(pairs[1].no).toBe(3);
		expect(pairs[1].white?.san).toBe('Bc4');
	});

	it('never puts a Black move in the White column', () => {
		const chips = [4, 5, 6, 7, 8, 9].map((p) => chip(`m${p}`, p));
		for (const p of toPairs(chips)) {
			if (p.white) expect(p.white.white).toBe(true);
			if (p.black) expect(p.black.white).toBe(false);
		}
	});

	it('keeps every move', () => {
		const chips = Array.from({ length: 21 }, (_, i) => chip(`m${i + 1}`, i + 1));
		const pairs = toPairs(chips);
		const kept = pairs.flatMap((p) => [p.white, p.black]).filter(Boolean);
		expect(kept.length).toBe(chips.length);
	});

	it('handles an empty list', () => {
		expect(toPairs([])).toEqual([]);
	});
});

describe('pairsPerRow', () => {
	it('always shows at least one pair, even before measurement', () => {
		expect(pairsPerRow(0)).toBe(1);
		expect(pairsPerRow(50)).toBe(1);
	});

	it('gives a phone one pair per row and a wide panel several', () => {
		expect(pairsPerRow(369)).toBe(2);
		expect(pairsPerRow(130)).toBe(1);
		expect(pairsPerRow(900)).toBe(MAX_PAIRS_PER_ROW);
	});

	it('is monotonic in width — a wider panel never shows fewer', () => {
		let last = 0;
		for (let w = 0; w <= 1200; w += 40) {
			const n = pairsPerRow(w);
			expect(n).toBeGreaterThanOrEqual(last);
			last = n;
		}
	});
});

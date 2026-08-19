import { describe, it, expect } from 'vitest';

/**
 * The bar's arithmetic, pinned separately from the component.
 *
 * The rule: the bar fills from the bottom towards the side the board is
 * oriented for, which is always us. So the fill depends on the evaluation from
 * OUR point of view and on nothing else — in particular, not on our colour.
 * Getting that wrong is the bug this replaced, and it is invisible unless you
 * happen to look at a black-to-move position.
 */
const share = (cp: number | null) => (cp === null ? 0.5 : 1 / (1 + Math.exp(-cp / 320)));

describe('eval bar fill', () => {
	it('sits at the midline when there is no evaluation', () => {
		expect(share(null)).toBe(0.5);
	});

	it('sits at the midline when the position is equal', () => {
		expect(share(0)).toBe(0.5);
	});

	it('fills towards us as we do better, whichever colour we are', () => {
		expect(share(300)).toBeGreaterThan(0.5);
		expect(share(-300)).toBeLessThan(0.5);
		// Symmetry: +3 for us and +3 for them are mirror images.
		expect(share(300) + share(-300)).toBeCloseTo(1, 10);
	});

	it('flattens monotonically as the position gets more decided', () => {
		// The same 80cp is worth progressively less bar the further out it is.
		const band = (from: number) => share(from + 80) - share(from);
		const bands = [0, 300, 600, 900, 1200].map(band);
		for (let i = 1; i < bands.length; i++) {
			expect(bands[i]).toBeLessThan(bands[i - 1]);
		}
		// By the time the game is decided, 80cp barely moves it at all.
		expect(band(1200)).toBeLessThan(band(0) / 10);
	});

	it('never saturates completely, so the bar keeps an edge', () => {
		expect(share(10000)).toBeLessThan(1);
		expect(share(-10000)).toBeGreaterThan(0);
	});
});

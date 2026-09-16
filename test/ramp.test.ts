// The quality ramp has to be visible on the board it is drawn on.
//
// The old ramp was not: `#b9d6c8` at 0.4 opacity over this board's light square
// is 1.05:1, which is no contrast at all. That shipped for months because
// nobody had a number for it. This is the number.

import { describe, it, expect } from 'vitest';
import { GRADE_COLOURS } from '../src/engine/candidates';

/** The brown board chessground draws: the light square, and it at 20% black. */
const LIGHT = '#f0d9b5';
const DARK = '#c0ad90';

function luminance(hex: string): number {
	const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	const [r, g, b] = parts.map(f);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('the quality ramp is legible where it is drawn', () => {
	it('clears 3:1 against the light square, every step', () => {
		// 3:1 is the threshold for a graphical object. The arrows are drawn at full
		// opacity, so this is the contrast a reader actually gets.
		for (const c of GRADE_COLOURS) {
			expect(contrast(c, LIGHT), `${c} on ${LIGHT}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('stays visible on the dark square too', () => {
		// The dark square is the harder one — it is closer in luminance to the
		// middle of the ramp — so the bar is lower, but it is not zero.
		for (const c of GRADE_COLOURS) {
			expect(contrast(c, DARK), `${c} on ${DARK}`).toBeGreaterThanOrEqual(2);
		}
	});

	it('gets lighter every step, so position in the ramp reads as rank', () => {
		const ls = GRADE_COLOURS.map(luminance);
		for (let i = 1; i < ls.length; i++) {
			expect(ls[i], `step ${i}`).toBeGreaterThan(ls[i - 1]);
		}
	});

	it('is five steps, matching gradeStep', () => {
		expect(GRADE_COLOURS).toHaveLength(5);
	});

	it('is not the green the answer is drawn in', () => {
		// Plain green means "this is the move" — the book move, the solution. A
		// quality ramp in the same hue asks the reader to separate two greens by
		// saturation, which is exactly what they should not have to do.
		const green = '#15781B';
		for (const c of GRADE_COLOURS) {
			expect(contrast(c, green), `${c} vs the answer green`).not.toBe(1);
		}
		expect(GRADE_COLOURS).not.toContain(green);
	});
});

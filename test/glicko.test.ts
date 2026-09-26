// The rating moves fast when it knows nothing and slowly once it does.
//
// ---------------------------------------------------------------------------
// Will: "puzzle difficulty tracking using something like elo on puzzle
// difficulty."
//
// Elo with a fixed K fails at both ends of that: a beginner starting at 1500
// climbs down to 900 twenty points at a time, and a settled player's rating
// jitters by those same twenty points on one coin flip. Both are the same
// failure — the formula has no idea how much evidence it has. So what is
// pinned here is not the arithmetic of the update but the BEHAVIOUR that
// justifies carrying a deviation at all.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
	MAX_RD,
	MIN_RD,
	START,
	band,
	decayed,
	describeRating,
	ratingParts,
	expected,
	rate,
} from '../src/domain/glicko';

const DAY = 86_400_000;
const now = 1_700_000_000_000;

describe('what a result is worth', () => {
	it('moves a new rating far', () => {
		// The whole point of a wide deviation. Solving a 1500 from 1500 should be
		// worth a lot more than Elo's K/2.
		const after = rate(START, 1500, 1, now);
		expect(after.r - START.r).toBeGreaterThan(100);
	});

	it('moves a settled rating a little', () => {
		const settled = { r: 1500, rd: MIN_RD, at: now };
		const after = rate(settled, 1500, 1, now);
		expect(after.r - settled.r).toBeLessThan(20);
		expect(after.r - settled.r).toBeGreaterThan(0);
	});

	it('is worth more for an upset than for the expected result', () => {
		const settled = { r: 1500, rd: 60, at: now };
		const easyWin = rate(settled, 1000, 1, now).r - settled.r;
		const hardWin = rate(settled, 2000, 1, now).r - settled.r;
		expect(hardWin).toBeGreaterThan(easyWin);
		// And failing something easy costs more than failing something hard.
		const easyLoss = settled.r - rate(settled, 1000, 0, now).r;
		const hardLoss = settled.r - rate(settled, 2000, 0, now).r;
		expect(easyLoss).toBeGreaterThan(hardLoss);
	});

	it('goes up on a solve and down on a failure, always', () => {
		for (const puzzle of [600, 1000, 1500, 2000, 2800]) {
			const r = { r: 1500, rd: 90, at: now };
			expect(rate(r, puzzle, 1, now).r).toBeGreaterThan(r.r);
			expect(rate(r, puzzle, 0, now).r).toBeLessThan(r.r);
		}
	});
});

describe('how sure it gets', () => {
	it('narrows with every result', () => {
		let r = START;
		const widths = [r.rd];
		for (let i = 0; i < 25; i++) {
			r = rate(r, 1500, i % 2 ? 1 : 0, now);
			widths.push(r.rd);
		}
		// Monotone: evidence never makes it less sure.
		for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]);
		expect(r.rd).toBeLessThan(120);
	});

	it('never claims more certainty than a rating can have', () => {
		let r = START;
		for (let i = 0; i < 500; i++) r = rate(r, 1500, i % 2 ? 1 : 0, now);
		expect(r.rd).toBeGreaterThanOrEqual(MIN_RD);
	});

	it('widens again while you are away', () => {
		const settled = { r: 1500, rd: MIN_RD, at: now };
		expect(decayed(settled, now + 30 * DAY).rd).toBeGreaterThan(settled.rd);
		// A fortnight off must not throw away what you established.
		expect(decayed(settled, now + 14 * DAY).rd).toBeLessThan(100);
	});

	it('never widens past knowing nothing', () => {
		const settled = { r: 1500, rd: 200, at: now };
		expect(decayed(settled, now + 100 * 365 * DAY).rd).toBe(MAX_RD);
	});

	it('does not widen for time that has not passed', () => {
		const r = { r: 1500, rd: 80, at: now };
		expect(decayed(r, now).rd).toBe(80);
		expect(decayed(r, now - DAY).rd).toBe(80);
	});
});

describe('finding your level', () => {
	it('walks a badly-placed rating down to the truth in a few dozen puzzles', () => {
		// The case Elo handles worst. A 900-strength solver starts at 1500 by
		// convention; each puzzle is served from their band and they solve the
		// ones at or below their true level.
		let r = START;
		const TRUE = 900;
		for (let i = 0; i < 60; i++) {
			const { low, high } = band(r);
			const puzzle = Math.round((low + high) / 2);
			r = rate(r, puzzle, puzzle <= TRUE ? 1 : 0, now + i * 1000);
		}
		expect(Math.abs(r.r - TRUE)).toBeLessThan(200);
	});
});

describe('the band it asks for', () => {
	it('is as wide as the uncertainty', () => {
		const wide = band({ r: 1500, rd: 300, at: now });
		const narrow = band({ r: 1500, rd: MIN_RD, at: now });
		expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
	});

	it('never collapses to a single number', () => {
		// A diet of exact coin flips is right for measuring and dull for
		// practising.
		const narrow = band({ r: 1500, rd: MIN_RD, at: now });
		expect(narrow.high - narrow.low).toBeGreaterThanOrEqual(240);
	});

	it('shifts up when harder puzzles are asked for', () => {
		const normal = band({ r: 1500, rd: 80, at: now });
		const harder = band({ r: 1500, rd: 80, at: now }, 300);
		expect(harder.low).toBeGreaterThan(normal.low);
	});
});

describe('what it admits to', () => {
	it('says it is still finding your level while it is', () => {
		expect(describeRating(START)).toMatch(/finding your level/i);
	});

	it('shows the spread once it is worth showing', () => {
		expect(describeRating({ r: 1450, rd: 120, at: now })).toBe('1450 ± 120');
	});

	it('stops qualifying once it is settled', () => {
		expect(describeRating({ r: 1450, rd: MIN_RD, at: now })).toBe('1450');
	});

	it('splits into a number and a qualifier, and the sentence is built from them', () => {
		// The headline draws the two halves at two sizes — one 30px sentence did not
		// fit a 300px column and broke mid-phrase. `describeRating` must stay exactly
		// what it was, so it is composed from the same parts rather than written
		// twice: one definition, two readers.
		for (const rd of [MIN_RD, 80, 120, 149, 150, 350]) {
			const r = { r: 1450, rd, at: now };
			const parts = ratingParts(r);
			expect(parts.value).toBe(1450);
			expect(describeRating(r)).toContain(String(parts.value));
			if (parts.qualifier) expect(describeRating(r)).toContain(parts.qualifier);
			else expect(describeRating(r)).toBe('1450');
		}
	});

	it('rounds the number and the spread, because both are drawn', () => {
		// The rating is stored unrounded on purpose — see `rate`.
		const parts = ratingParts({ r: 1449.6, rd: 119.7, at: now });
		expect(parts.value).toBe(1450);
		expect(parts.qualifier).toBe('± 120');
	});
});

describe('the expectation behind it', () => {
	it('is even against your own rating', () => {
		expect(expected(1500, 1500)).toBeCloseTo(0.5, 5);
	});

	it('rises with the gap', () => {
		expect(expected(1500, 1100)).toBeGreaterThan(0.8);
		expect(expected(1500, 1900)).toBeLessThan(0.2);
	});
});

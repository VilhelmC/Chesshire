// What the theme filter leaves behind, and whether the app admits it.
//
// `pickPuzzle` widens its band until something is in it, which is right and
// silent. These tests are about the sentence that makes it audible.
import { describe, it, expect } from 'vitest';
import {
	THIN_POOL,
	allPuzzles,
	pickPuzzle,
	poolNear,
	poolNote,
	themes,
} from '../src/domain/puzzles';
import { band, START, type Rating } from '../src/domain/glicko';

/** A settled rating, which is the narrow-band case the note has to get right. */
const settled = (r: number): Rating => ({ r, rd: 45, at: 0 });

describe('counting the pool', () => {
	it('counts the band the picker actually prefers', () => {
		// Not a band of its own: `poolNear`'s half-width must be the `width / 2` of
		// `pickPuzzle`'s first attempt, or the note describes a different pool from
		// the one being served.
		const rating = settled(1400);
		const { low, high } = band(rating);
		const mid = (low + high) / 2;
		const w = (high - low) / 2;
		const byHand = allPuzzles().filter((p) => Math.abs(p.rating - mid) <= w).length;
		expect(poolNear(rating).near).toBe(byHand);
	});

	it('narrows to the theme, and says how much was there to begin with', () => {
		const theme = themes()[0].id;
		const whole = allPuzzles().filter((p) => (p.themes ?? []).includes(theme)).length;
		const pool = poolNear(settled(1400), theme);
		expect(pool.inTheme).toBe(whole);
		expect(pool.near).toBeLessThanOrEqual(pool.inTheme);
	});

	it('reports the nearest puzzle when none is near', () => {
		// 9000 is off the end of a corpus that stops at 3097.
		const pool = poolNear(settled(9000));
		expect(pool.near).toBe(0);
		expect(pool.nearest).not.toBeNull();
		expect(pool.gap).toBeGreaterThan(1000);
		// And what it names is really the closest one there is.
		const best = Math.max(...allPuzzles().map((p) => p.rating));
		expect(pool.nearest).toBe(best);
	});

	it('agrees with what the picker serves', () => {
		// The note claims the next puzzle will be far off. This is that claim being
		// checked against the picker rather than against the arithmetic twice.
		const rating = settled(9000);
		const p = pickPuzzle(rating, { rng: () => 0 });
		expect(p).not.toBeNull();
		expect(p!.rating).toBe(poolNear(rating).nearest);
	});
});

describe('what it says', () => {
	it('stays quiet with no theme and a rating the corpus covers', () => {
		// The common case. A sentence printed every time is a sentence nobody reads.
		expect(poolNote(settled(1400), null)).toBeNull();
		expect(poolNote({ ...START, at: 0 }, null)).toBeNull();
	});

	it('speaks up with no theme once the rating has left the corpus', () => {
		const note = poolNote(settled(3600), null);
		expect(note?.tone).toBe('warn');
		expect(note?.text).toMatch(/closest/);
		// Which direction, because "off your rating" without a side is half a fact.
		expect(note?.text).toMatch(/below you/);
	});

	it('reports the count, quietly, when a theme has plenty nearby', () => {
		// `mateIn2` at 1200 holds 28 within a settled band — measured.
		const note = poolNote(settled(1200), 'mateIn2');
		expect(note?.tone).toBe('quiet');
		expect(note?.text).toMatch(/mate in 2/);
		expect(note?.text).toMatch(new RegExp(`${poolNear(settled(1200), 'mateIn2').near} of `));
	});

	it('warns when the theme has nothing at that level', () => {
		// The case that prompted this: `mateIn1` holds nothing above about 2100, so
		// a strong solver drilling it is served puzzles hundreds of points easier
		// and every miss looks like theirs.
		const rating = settled(2600);
		expect(poolNear(rating, 'mateIn1').near).toBe(0);
		const note = poolNote(rating, 'mateIn1');
		expect(note?.tone).toBe('warn');
		expect(note?.text).toMatch(/None of the/);
		expect(note?.text).toMatch(/below you/);
	});

	it('warns when the theme is merely thin', () => {
		// Between 1 and THIN_POOL - 1 near: a different sentence from "none", because
		// "none" and "a couple" call for different reading of a miss.
		// 2050: three mate-in-ones within a settled band, out of 87 — measured.
		const rating = settled(2050);
		const pool = poolNear(rating, 'mateIn1');
		expect(pool.near).toBeGreaterThan(0);
		expect(pool.near).toBeLessThan(THIN_POOL);
		const note = poolNote(rating, 'mateIn1');
		expect(note?.tone).toBe('warn');
		expect(note?.text).toMatch(/^Only \d+ of the \d+ mate in 1 puzzles/);
		// And the quiet wording is NOT what a thin pool gets, which is the whole
		// distinction: "3 of 87 sit near your rating" reads as reassurance.
		expect(note?.text).not.toMatch(/sit near your rating\.$/);
	});

	it('never warns about a theme it has not measured', () => {
		// Every theme, at the levels the corpus actually serves: a quiet note must
		// only appear when the count really is at or above the threshold.
		for (const t of themes()) {
			for (const r of [800, 1200, 1500, 1800, 2200]) {
				const rating = settled(r);
				const note = poolNote(rating, t.id);
				const near = poolNear(rating, t.id).near;
				expect(note).not.toBeNull();
				expect(note!.tone).toBe(near >= THIN_POOL ? 'quiet' : 'warn');
			}
		}
	});
});

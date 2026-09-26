// What the pile of attempts says: which ones count, the series, the streak.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	countsForRating,
	puzzleSeries,
	rated,
	streaks,
	type AttemptRow,
} from '../src/domain/puzzleProgress';

const DAY = 86_400_000;

function row(over: Partial<AttemptRow> & { id: string }): AttemptRow {
	return {
		at: 0,
		puzzleRating: 1400,
		solved: 1,
		assist: 'none',
		ratingAfter: 1500,
		...over,
	};
}

describe('which attempts the rating learned from', () => {
	it('counts an unaided solve', () => {
		expect(countsForRating({ solved: 1, assist: 'none' })).toBe(true);
	});

	it('does not count a helped solve', () => {
		// Will: "doesn't count puzzle as solved if assistance were used."
		expect(countsForRating({ solved: 1, assist: 'wheels' })).toBe(false);
		expect(countsForRating({ solved: 1, assist: 'moves' })).toBe(false);
	});

	it('counts a failure whatever the help was', () => {
		// The asymmetry that keeps the number honest: if help hid failures too, the
		// overlays could go on whenever a puzzle looked hard and the rating would
		// only ever meet the ones that were going to be solved anyway.
		expect(countsForRating({ solved: 0, assist: 'moves' })).toBe(true);
		expect(countsForRating({ solved: 0, assist: 'wheels' })).toBe(true);
		expect(countsForRating({ solved: 0, assist: 'none' })).toBe(true);
	});

	it('is the rule the writer uses, not a second copy of it', () => {
		// `record` decided this inline first. A source check rather than a
		// behavioural one because the failure being guarded against is textual: the
		// expression coming back beside the import and drifting from it.
		const src = readFileSync('src/data/puzzleHistory.ts', 'utf8');
		expect(src).toContain('countsForRating(');
		expect(src).not.toContain("assist === 'none'");
	});

	it('orders what it keeps oldest first, whatever order it was given', () => {
		// `attempts()` reads newest-first out of Dexie. Every reading here is
		// chronological, so the sort belongs on this side of the call.
		const out = rated([
			row({ id: 'c', at: 3 * DAY }),
			row({ id: 'a', at: 1 * DAY }),
			row({ id: 'b', at: 2 * DAY }),
		]);
		expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('the series the graph plots', () => {
	const rows = [
		row({ id: 'a', at: 1 * DAY, puzzleRating: 1200, ratingAfter: 1512.7 }),
		row({ id: 'h', at: 2 * DAY, puzzleRating: 1900, assist: 'moves', ratingAfter: 1512.7 }),
		row({ id: 'b', at: 3 * DAY, puzzleRating: 1350, solved: 0, ratingAfter: 1480.2 }),
	];

	it('plots the rating that came out of each attempt, and the difficulty met', () => {
		const s = puzzleSeries(rows);
		expect(s.map((p) => p.runId)).toEqual(['a', 'b']);
		expect(s.map((p) => p.cumulative)).toEqual([1513, 1480]);
		expect(s.map((p) => p.elo)).toEqual([1200, 1350]);
	});

	it('leaves helped solves out', () => {
		// They moved the rating not at all, so a point for one is a flat step that
		// reads as a result.
		expect(puzzleSeries(rows).some((p) => p.runId === 'h')).toBe(false);
	});

	it('rounds, because the chart prints these numbers', () => {
		// The rating is stored unrounded on purpose — see `glicko.rate` — and the
		// end-of-line label draws `cumulative` verbatim. Unrounded, that label is
		// "1512.7182818".
		for (const p of puzzleSeries(rows)) {
			expect(Number.isInteger(p.elo)).toBe(true);
			expect(Number.isInteger(p.cumulative)).toBe(true);
		}
	});

	it('keeps the most recent window, not the first', () => {
		const many = Array.from({ length: 300 }, (_, i) =>
			row({ id: `p${i}`, at: i * 1000, ratingAfter: 1400 + i }),
		);
		const s = puzzleSeries(many, 120);
		expect(s).toHaveLength(120);
		expect(s[s.length - 1].runId).toBe('p299');
		expect(s[0].runId).toBe('p180');
	});

	it('is empty rather than broken with nothing to plot', () => {
		expect(puzzleSeries([])).toEqual([]);
		expect(puzzleSeries([row({ id: 'h', assist: 'moves' })])).toEqual([]);
	});
});

describe('streak', () => {
	it('counts solves in a row and remembers the best', () => {
		const s = streaks([
			row({ id: 'a', at: 1, solved: 1 }),
			row({ id: 'b', at: 2, solved: 1 }),
			row({ id: 'c', at: 3, solved: 1 }),
			row({ id: 'd', at: 4, solved: 0 }),
			row({ id: 'e', at: 5, solved: 1 }),
		]);
		expect(s).toEqual({ current: 1, best: 3 });
	});

	it('reads the newest end as the current streak however the rows arrive', () => {
		const s = streaks([
			row({ id: 'e', at: 5, solved: 1 }),
			row({ id: 'a', at: 1, solved: 0 }),
			row({ id: 'd', at: 4, solved: 1 }),
		]);
		expect(s.current).toBe(2);
	});

	it('skips helped solves instead of breaking on them', () => {
		// Documented as the better of two mistakes: breaking a streak for using a
		// learning tool teaches readers to stop using it.
		const s = streaks([
			row({ id: 'a', at: 1, solved: 1 }),
			row({ id: 'h', at: 2, solved: 1, assist: 'wheels' }),
			row({ id: 'b', at: 3, solved: 1 }),
		]);
		expect(s).toEqual({ current: 2, best: 2 });
	});

	it('breaks on a failure even when the failure was helped', () => {
		// Which is the same asymmetry as the rating's, and the reason a helped
		// attempt cannot be used to protect a streak from a real miss.
		const s = streaks([
			row({ id: 'a', at: 1, solved: 1 }),
			row({ id: 'b', at: 2, solved: 0, assist: 'moves' }),
		]);
		expect(s).toEqual({ current: 0, best: 1 });
	});

	it('says nothing has happened with nothing to read', () => {
		expect(streaks([])).toEqual({ current: 0, best: 0 });
	});
});

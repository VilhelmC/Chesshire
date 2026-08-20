// A run must survive the person doing something else.
//
// The bug: import state lived in a React component, so switching tab unmounted
// it, the work carried on writing to the database unobserved, and coming back
// showed an idle screen — at which point pressing Import again started a second
// concurrent run. Analysing games takes minutes; any design that needs someone
// to sit and watch is wrong the first time they look away, which is at once.

import { describe, it, expect } from 'vitest';
import { describeRun, runFraction } from '../src/data/importRunner';
import type { ImportProgress, ImportResult } from '../src/data/importGames';

const progress = (over: Partial<ImportProgress> = {}): ImportProgress => ({
	stage: 'analysing',
	note: 'lichess vs someone',
	done: 0,
	total: 0,
	sources: [],
	cards: 0,
	skipped: 0,
	...over,
});

const idle = {
	running: false,
	kind: null,
	progress: null,
	result: null,
	error: null,
	finishedAt: null,
} as const;

describe('runFraction', () => {
	it('is null before the total is known', () => {
		// During the fetch there is no denominator. A bar that invents a
		// percentage here is showing a number it does not have.
		expect(runFraction({ ...idle, running: true, kind: 'manual', progress: progress() })).toBeNull();
	});

	it('reports how far through the games it is', () => {
		const s = { ...idle, running: true, kind: 'manual' as const, progress: progress({ done: 3, total: 12 }) };
		expect(runFraction(s)).toBeCloseTo(0.25);
	});

	it('never exceeds one', () => {
		const s = { ...idle, running: true, kind: 'manual' as const, progress: progress({ done: 20, total: 12 }) };
		expect(runFraction(s)).toBe(1);
	});

	it('is null when nothing is running', () => {
		expect(runFraction(idle)).toBeNull();
	});
});

describe('describeRun', () => {
	it('counts games rather than repeating an opaque note', () => {
		const s = { ...idle, running: true, kind: 'manual' as const, progress: progress({ done: 2, total: 9, cards: 5 }) };
		expect(describeRun(s)).toContain('game 3 of 9');
		expect(describeRun(s)).toContain('5 cards');
	});

	it('says something before the first game', () => {
		expect(describeRun({ ...idle, running: true, kind: 'background' })).toBe('Starting…');
	});

	it('reports a finished run, which is what survives a tab switch', () => {
		const result = { cards: 4, analysed: 6 } as ImportResult;
		expect(describeRun({ ...idle, result })).toBe('4 cards from 6 games');
	});

	it('prefers the error over the tally', () => {
		// A failure must never be dressed as a count. See §M9.
		const result = { cards: 0, analysed: 0 } as ImportResult;
		const s = { ...idle, result, error: 'Engine failed to load' };
		expect(describeRun(s)).toBe('Engine failed to load');
	});

	it('says nothing when nothing has happened', () => {
		expect(describeRun(idle)).toBe('');
	});

	it('gets the singular right', () => {
		const result = { cards: 1, analysed: 1 } as ImportResult;
		expect(describeRun({ ...idle, result })).toBe('1 card from 1 game');
	});
});

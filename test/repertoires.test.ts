// Saving a repertoire and training it are two different acts.
//
// Will: "we should be able to save training repertoires… with toggle buttons to
// make them active / inactive", and "multiple toggled means union". The tests
// that matter are the ones about what a run DRAWS FROM, because that is where a
// switched-off repertoire could quietly keep being trained.

import { describe, it, expect } from 'vitest';
import {
	activeRoots,
	describePractice,
	normalise,
	DEFAULT_PRACTICE,
	type PracticeConfig,
} from '../src/domain/practice';
import { STRICTNESS } from '../src/domain/book';

const cfg = (roots: PracticeConfig['roots']): PracticeConfig => ({ ...DEFAULT_PRACTICE, roots });
const root = (name: string, active?: boolean) => ({ path: ['e4'], name, ...(active === undefined ? {} : { active }) });

describe('which repertoires a run draws from', () => {
	it('takes the ones switched on', () => {
		expect(activeRoots(cfg([root('Italian', true), root('Scotch', false)])).map((r) => r.name)).toEqual([
			'Italian',
		]);
	});

	it('takes ALL of them when several are on — union, not one-of', () => {
		const on = activeRoots(cfg([root('Italian', true), root('Scotch', true), root('Vienna', false)]));
		expect(on.map((r) => r.name)).toEqual(['Italian', 'Scotch']);
	});

	it('treats a root with no flag as active', () => {
		// Every config stored before the flag existed held roots the reader WAS
		// training. Reading absence as "off" would silently empty their filter.
		expect(activeRoots(cfg([root('Italian')])).map((r) => r.name)).toEqual(['Italian']);
	});

	it('is empty when every one is switched off, which is not the same as none saved', () => {
		const c = cfg([root('Italian', false), root('Scotch', false)]);
		expect(activeRoots(c)).toEqual([]);
		// The library is still there.
		expect(c.roots).toHaveLength(2);
	});
});

describe('what the header says', () => {
	it('counts what is being trained, not what is kept', () => {
		expect(describePractice(cfg([root('Italian', true), root('Scotch', false)]))).toContain('Italian');
	});

	it('says the whole tree when everything is switched off', () => {
		expect(describePractice(cfg([root('Italian', false)]))).toContain('the whole opening');
	});

	it('counts several', () => {
		expect(describePractice(cfg([root('a', true), root('b', true)]))).toContain('2 openings');
	});
});

// ---------------------------------------------------------------------------
// The strictness ladder replaced three ids with four, and a browser that has
// been used before is holding one of the old ones. Dropping it would silently
// move the reader to a different exercise from the one they chose, so the old
// ids map forward — and the migrated answer is written back, so what is stored
// stops contradicting what is running.
// ---------------------------------------------------------------------------
describe('carrying an older setting forward', () => {
	it('maps the retired ids onto the rungs that replaced them', () => {
		// 'repertoire' drilled the most POPULAR sound move; 'bestBook' drills the
		// strongest one — the same shape of exercise, aimed at a better target.
		expect(normalise({ strictness: 'repertoire' } as never).strictness).toBe('bestBook');
		// 'book' and 'free' accepted an identical set, which is why the ladder
		// exists at all, so both land where they already were.
		expect(normalise({ strictness: 'book' } as never).strictness).toBe('free');
		expect(normalise({ strictness: 'free' } as never).strictness).toBe('free');
	});

	it('falls back to the default rather than crashing on nonsense', () => {
		expect(normalise({ strictness: 'gibberish' } as never).strictness).toBe(
			DEFAULT_PRACTICE.strictness,
		);
		expect(normalise({}).strictness).toBe(DEFAULT_PRACTICE.strictness);
	});

	it('keeps every rung it is given', () => {
		for (const s of STRICTNESS) {
			expect(normalise({ strictness: s.id }).strictness).toBe(s.id);
		}
	});
});

// Saving a repertoire and training it are two different acts.
//
// Will: "we should be able to save training repertoires… with toggle buttons to
// make them active / inactive", and "multiple toggled means union". The tests
// that matter are the ones about what a run DRAWS FROM, because that is where a
// switched-off repertoire could quietly keep being trained.

import { describe, it, expect } from 'vitest';
import { activeRoots, describePractice, DEFAULT_PRACTICE, type PracticeConfig } from '../src/domain/practice';

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

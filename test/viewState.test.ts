// What survives a reload, and — more importantly — what does not.
//
// `recall` validates on the way out, and the reason is in viewState.ts: a stored
// value that has stopped being meaningful restores the app into a state its own
// UI cannot produce, and the report that comes back is "the Mistakes tab is
// empty" rather than "the thing it remembered is gone".
import { describe, it, expect, beforeEach } from 'vitest';

// A hand-rolled `localStorage`, the same stub `lichessAuth.test.ts` uses and for
// the same reason: this module touches exactly one browser thing, and writing it
// out is cheaper than a DOM — and keeps visible what it is allowed to depend on.
class MemoryStorage {
	private m = new Map<string, string>();
	getItem(k: string) {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, String(v));
	}
	removeItem(k: string) {
		this.m.delete(k);
	}
	clear() {
		this.m.clear();
	}
	get length() {
		return this.m.size;
	}
	key(i: number) {
		return [...this.m.keys()][i] ?? null;
	}
}
(globalThis as unknown as Record<string, unknown>).localStorage = new MemoryStorage();

import { recall, remember } from '../src/data/viewState';
import { CATEGORIES } from '../src/domain/mistakes';

const KEY = 'chesshire.view';
const ok = (v: unknown) => Array.isArray(v) && v.every((x) => CATEGORIES.some((c) => c.id === x));

describe('quizCategories', () => {
	beforeEach(() => localStorage.clear());

	it('comes back as it was left', () => {
		// Will: "the toggled categories do not persist when the app is reloaded or
		// when I switch tab and return."
		remember({ quizCategories: ['book', 'punish'] });
		expect(recall('quizCategories', ok)).toEqual(['book', 'punish']);
	});

	it('keeps the empty selection, which MEANS all of them', () => {
		// The distinction the predicate has to preserve: `[]` is a real choice
		// ("show everything"), not a missing value. Validating it away would make
		// "show all" the one setting that never persisted.
		remember({ quizCategories: [] });
		expect(recall('quizCategories', ok)).toEqual([]);
	});

	it('drops a category an older build wrote and this one has retired', () => {
		remember({ quizCategories: ['book', 'endgame-drill'] });
		expect(recall('quizCategories', ok)).toBeUndefined();
	});

	it('drops a value of the wrong shape entirely', () => {
		localStorage.setItem(KEY, JSON.stringify({ quizCategories: 'book' }));
		expect(recall('quizCategories', ok)).toBeUndefined();
	});

	it('does not erase the Lab’s fields — remember MERGES', () => {
		// Two views write different keys and must not clobber each other.
		remember({ labId: 'yMTAV', labPly: 3 });
		remember({ quizCategories: ['game'] });
		expect(recall('labId', () => true)).toBe('yMTAV');
		expect(recall('labPly', (v) => v >= 0)).toBe(3);
		expect(recall('quizCategories', ok)).toEqual(['game']);
	});

	it('survives a corrupt store rather than taking the app down', () => {
		// `localStorage` throws in some private modes, and a crash inside a
		// `useState` initialiser kills the first paint — a worse outcome than
		// forgetting a selection.
		localStorage.setItem(KEY, 'not json{');
		expect(() => recall('quizCategories', ok)).not.toThrow();
		expect(recall('quizCategories', ok)).toBeUndefined();
	});
});

import { describe, it, expect } from 'vitest';
import {
	afterAnswer,
	intervalFor,
	newItem,
	summarise,
	weightFor,
	itemKey,
	type MemoryStore,
} from '../src/domain/scheduler';

const T0 = 1_700_000_000_000;

describe('intervals', () => {
	it('expands with each success', () => {
		for (let i = 1; i < 8; i++) {
			expect(intervalFor(i)).toBeGreaterThan(intervalFor(i - 1));
		}
	});

	it('starts in minutes, not days', () => {
		// A run lasts a couple of minutes. A scheduler working only in days would
		// let the same mistake repeat five times in one sitting.
		expect(intervalFor(0)).toBeLessThanOrEqual(60_000);
		expect(intervalFor(1)).toBeLessThanOrEqual(10 * 60_000);
	});

	it('reaches genuine spaced-repetition distances', () => {
		expect(intervalFor(7)).toBeGreaterThan(7 * 86_400_000);
	});
});

describe('weighting', () => {
	it('gives an unseen move full weight', () => {
		expect(weightFor(undefined, T0)).toBe(1);
		expect(weightFor(newItem('k', T0), T0)).toBe(1);
	});

	it('suppresses a move immediately after it is answered correctly', () => {
		const item = afterAnswer(newItem('k', T0), true, T0);
		expect(weightFor(item, T0)).toBeLessThan(0.1);
	});

	it('suppresses further with each additional success', () => {
		let item = newItem('k', T0);
		let t = T0;
		const weights: number[] = [];
		for (let i = 0; i < 4; i++) {
			item = afterAnswer(item, true, t);
			// Look at each one a fixed short time later.
			weights.push(weightFor(item, t + 30_000));
			t += intervalFor(item.streak) + 1;
		}
		for (let i = 1; i < weights.length; i++) {
			expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
		}
	});

	it('never suppresses to zero', () => {
		let item = newItem('k', T0);
		for (let i = 0; i < 12; i++) item = afterAnswer(item, true, T0);
		// A line that becomes permanently unreachable is one you get surprised by.
		expect(weightFor(item, T0)).toBeGreaterThan(0);
	});

	it('brings a missed move straight back, harder than before', () => {
		let item = afterAnswer(newItem('k', T0), true, T0);
		item = afterAnswer(item, false, T0 + 1000);
		expect(item.streak).toBe(0);
		expect(item.lapses).toBe(1);
		// Due again within the shortest interval, and weighted above baseline.
		expect(item.dueAt - (T0 + 1000)).toBe(intervalFor(0));
		expect(weightFor(item, item.dueAt + 1)).toBeGreaterThan(1);
	});

	it('restores weight as the due time approaches', () => {
		const item = afterAnswer(newItem('k', T0), true, T0);
		const justAfter = weightFor(item, T0 + 1000);
		const nearlyDue = weightFor(item, item.dueAt - 1000);
		expect(nearlyDue).toBeGreaterThan(justAfter);
	});
});

describe('summary', () => {
	it('counts known, learning and due', () => {
		const store: MemoryStore = new Map();
		let a = newItem('a', T0);
		for (let i = 0; i < 3; i++) a = afterAnswer(a, true, T0);
		store.set('a', a);
		store.set('b', afterAnswer(newItem('b', T0), false, T0));

		const s = summarise(store, T0 + intervalFor(0) + 1);
		expect(s.total).toBe(2);
		expect(s.known).toBe(1);
		expect(s.learning).toBe(1);
		expect(s.due).toBe(1);
	});
});

describe('keys', () => {
	it('identifies a move by the position it was played in', () => {
		// The same move in two positions is two different things to learn.
		expect(itemKey('fenA', 'f7f6')).not.toBe(itemKey('fenB', 'f7f6'));
	});
});

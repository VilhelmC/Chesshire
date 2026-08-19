import { describe, it, expect } from 'vitest';
import {
	makeCard,
	relapse,
	answer,
	due,
	summarise,
	RETIRE_STREAK,
	type MistakeCard,
	CATEGORIES,
	inCategories,
	countByCategory,
} from '../src/domain/mistakes';

const T0 = 1_700_000_000_000;

function card(over: Partial<Parameters<typeof makeCard>[0]> = {}): MistakeCard {
	return makeCard({
		fen: 'fen',
		positionKey: 'pk',
		ourColour: 'w',
		expectedUci: 'f3e5',
		expectedSan: 'Nxe5',
		playedSan: 'd2d4',
		path: ['e4', 'e5'],
		ply: 4,
		phase: 'punish',
		now: T0,
		...over,
	});
}

describe('cards', () => {
	it('keys on the position and the move that was missed', () => {
		// The same slip met twice is one card with two lapses, not two cards.
		const a = card();
		const b = card();
		expect(a.id).toBe(b.id);
		expect(card({ expectedUci: 'd2d4' }).id).not.toBe(a.id);
	});

	it('starts due immediately', () => {
		expect(due([card()], T0)).toHaveLength(1);
	});
});

describe('answering', () => {
	it('puts a wrong answer straight back in the queue', () => {
		// "Repeat until correct" means exactly that — no interval on a miss.
		const c = answer(card(), false, T0 + 5000);
		expect(c.dueAt).toBe(T0 + 5000);
		expect(c.streak).toBe(0);
		expect(due([c], T0 + 5000)).toHaveLength(1);
	});

	it('schedules a correct answer further out each time', () => {
		let c = card();
		let t = T0;
		const gaps: number[] = [];
		for (let i = 0; i < 3; i++) {
			c = answer(c, true, t);
			gaps.push(c.dueAt - t);
			t = c.dueAt;
		}
		for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
	});

	it(`retires only after ${RETIRE_STREAK} correct in a row`, () => {
		let c = card();
		for (let i = 0; i < RETIRE_STREAK - 1; i++) c = answer(c, true, T0);
		expect(c.retired).toBe(false);
		c = answer(c, true, T0);
		expect(c.retired).toBe(true);
		expect(due([c], T0 + 1e9)).toHaveLength(0);
	});

	it('un-retires a card that comes back wrong', () => {
		let c = card();
		for (let i = 0; i < RETIRE_STREAK; i++) c = answer(c, true, T0);
		expect(c.retired).toBe(true);
		const again = relapse(c, T0 + 1000);
		expect(again.retired).toBe(false);
		expect(again.streak).toBe(0);
		expect(again.lapses).toBe(c.lapses + 1);
	});

	it('breaks the streak on a single miss', () => {
		let c = card();
		c = answer(c, true, T0);
		c = answer(c, true, T0);
		c = answer(c, false, T0);
		expect(c.streak).toBe(0);
		expect(c.retired).toBe(false);
	});
});

describe('queue order', () => {
	it('puts the most-missed card first', () => {
		const easy = card({ expectedUci: 'a2a3' });
		const hard = relapse(relapse(card({ expectedUci: 'b2b3' }), T0), T0);
		const q = due([easy, hard], T0);
		expect(q[0].expectedUci).toBe('b2b3');
	});

	it('hides retired cards', () => {
		let c = card();
		for (let i = 0; i < RETIRE_STREAK; i++) c = answer(c, true, T0);
		const s = summarise([c], T0 + 1e9);
		expect(s.retired).toBe(1);
		expect(s.due).toBe(0);
		expect(s.total).toBe(1);
	});
});

describe('categories', () => {
	const mk = (id: string, phase: MistakeCard['phase'], dueAt: number): MistakeCard => ({
		id,
		fen: 'f',
		ourColour: 'w',
		expectedUci: 'e2e4',
		expectedSan: 'e4',
		playedSan: 'd4',
		path: [],
		ply: 1,
		phase,
		firstSeen: 0,
		lastSeen: 0,
		streak: 0,
		lapses: 1,
		dueAt,
		retired: false,
	});

	const deck = [
		mk('a', 'book', 0),
		mk('b', 'punish', 0),
		mk('c', 'game', 0),
		mk('d', 'game', 10_000),
		mk('e', 'freeplay', 0),
	];

	it('filters to the chosen categories', () => {
		expect(inCategories(deck, ['game']).map((c) => c.id)).toEqual(['c', 'd']);
		expect(inCategories(deck, ['book', 'punish']).map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('treats no selection as everything, not as nothing', () => {
		// A filter UI with every box cleared must not produce an empty deck and
		// look like the cards are gone.
		expect(inCategories(deck, []).length).toBe(deck.length);
	});

	it('counts total and due separately per category', () => {
		const counts = countByCategory(deck, 100);
		expect(counts.game).toEqual({ total: 2, due: 1 });
		expect(counts.book).toEqual({ total: 1, due: 1 });
		expect(counts.freeplay).toEqual({ total: 1, due: 1 });
	});

	it('covers every phase a card can have', () => {
		const ids = CATEGORIES.map((c) => c.id).sort();
		expect(ids).toEqual(['book', 'freeplay', 'game', 'punish']);
	});
});

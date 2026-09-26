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
	applyAnswer,
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
		// `puzzle` joined them when the Puzzles tab landed — Will: "failed puzzles
		// into the Mistakes deck". This test is the reason that could not be done
		// halfway: a phase with no category is a card filed where no filter can
		// reach it, which looks exactly like the deck having lost it.
		const ids = CATEGORIES.map((c) => c.id).sort();
		expect(ids).toEqual(['book', 'freeplay', 'game', 'punish', 'puzzle']);
	});
});

// ---------------------------------------------------------------------------
// THE THREE FIXES OF 2026-08-28, each named after what it was reported as.
// ---------------------------------------------------------------------------

describe('applyAnswer — the streak survives the caller', () => {
	it('does not retire on three corrects with a miss between them', () => {
		// Will: "the 'three-correct-in-a-row' principle is not enforced (I suspect
		// cards are retired after three correct, not resetting count if there was an
		// error in between)."
		//
		// `answer` alone always got this right; the app got it wrong because the
		// view kept the pre-answer card and incremented from ITS streak. This test
		// therefore threads the RETURNED card through, which is the only thing
		// `applyAnswer` makes it possible to do — feed it a stale card and you are
		// back to the bug, which is why the deck comes back with it.
		let held = card();
		let deck = [held];
		const step = (correct: boolean) => {
			const r = applyAnswer(held, deck, correct, T0);
			held = r.card;
			deck = r.deck;
		};
		step(true);
		step(true);
		expect(held.streak).toBe(2);
		step(false); // the miss that used to be forgotten
		expect(held.streak).toBe(0);
		step(true);
		expect(held.retired).toBe(false);
		step(true);
		expect(held.retired).toBe(false);
		step(true); // only NOW is it three in a row
		expect(held.retired).toBe(true);
	});

	it('returns a deck that agrees with the card', () => {
		// The invariant the view could not hold by hand: one object, not two.
		const a = card({ expectedUci: 'a2a3' });
		const b = card({ expectedUci: 'b2b3' });
		const r = applyAnswer(a, [a, b], false, T0);
		expect(r.deck.find((c) => c.id === a.id)).toBe(r.card);
		// And nothing else is touched.
		expect(r.deck.find((c) => c.id === b.id)).toBe(b);
	});
});

describe('countByCategory', () => {
	it('drops retired cards from the total, not just from due', () => {
		// Will: "retired cards are still counted in the category totals. That's
		// annoying. when they are gone they no longer contribute to the number of
		// cards in the category."
		let retiredCard = card({ expectedUci: 'a2a3' });
		for (let i = 0; i < RETIRE_STREAK; i++) retiredCard = answer(retiredCard, true, T0);
		expect(retiredCard.retired).toBe(true);
		const live = card({ expectedUci: 'b2b3' });

		const counts = countByCategory([retiredCard, live], T0 + 1e9);
		const phase = live.phase;
		expect(counts[phase].total).toBe(1);
		expect(counts[phase].due).toBe(1);
	});

	it('reports a fully retired category as empty, so its chip goes quiet', () => {
		let c = card();
		for (let i = 0; i < RETIRE_STREAK; i++) c = answer(c, true, T0);
		const counts = countByCategory([c], T0 + 1e9);
		expect(counts[c.phase]).toEqual({ total: 0, due: 0 });
		// The cards are not lost — they moved to the finished pile, which is where
		// a number about what you have completed belongs.
		expect(summarise([c], T0 + 1e9).retired).toBe(1);
	});
});

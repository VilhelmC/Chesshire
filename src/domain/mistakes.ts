// Mistakes worth repeating.
//
// The opponent-move scheduler decides which POSITIONS you meet. This is the
// other half: the positions you personally got wrong, kept as flashcards and
// repeated until you can answer them.
//
// Keyed by position and expected move, so the same slip met twice is one card
// rather than two. A card is only retired by answering it correctly several
// times on separate occasions — getting it right immediately after being shown
// the answer is not evidence of anything, which is why the streak is what
// retires a card rather than a single success.

import { intervalFor } from './scheduler';

/**
 * Where a card came from.
 *
 * 'game' means it was mined from a real game on Lichess or Chess.com rather
 * than produced here. Those are the most valuable cards in the deck — they are
 * mistakes you made when it counted — so the source is kept, both to say so in
 * the prompt and to link back to the game.
 */
export type CardOrigin = {
	platform: 'lichess' | 'chesscom';
	url: string;
	opponent: string;
	playedAt: number;
	/** Centipawns lost, as measured at import. */
	loss: number;
};

export type MistakeCard = {
	/** positionKey|expectedUci */
	id: string;
	fen: string;
	ourColour: 'w' | 'b';
	expectedUci: string;
	expectedSan: string;
	/** What you played instead, the first time. */
	playedSan: string;
	/** The moves that reached this position — where it happened. */
	path: string[];
	/** What the explorer called the position, when it had a name. */
	opening?: string | null;
	/** Line IDs, on cards made before paths were recorded. Never written now. */
	lineIds?: string[];
	ply: number;
	phase: 'book' | 'punish' | 'freeplay' | 'game';
	/**
	 * What kind of position this is, when it is a particular kind.
	 *
	 * 'missed-punish' is a card mined from a game where the OPPONENT blundered
	 * and the chance went by. `phase` cannot carry it: that says where the card
	 * came from, and this says what the exercise is. Both are worth knowing —
	 * these are the cards this whole trainer is arguing for.
	 */
	motif?: 'missed-punish';
	origin?: CardOrigin;
	firstSeen: number;
	lastSeen: number;
	/** Times answered correctly in a row. */
	streak: number;
	/** Times got wrong, including the original. */
	lapses: number;
	dueAt: number;
	/** Answered correctly enough times to stop asking. */
	retired: boolean;
};

/** Consecutive correct answers before a card stops coming back. */
export const RETIRE_STREAK = 3;

export function makeCard(opts: {
	fen: string;
	positionKey: string;
	ourColour: 'w' | 'b';
	expectedUci: string;
	expectedSan: string;
	playedSan: string;
	path: string[];
	opening?: string | null;
	ply: number;
	phase: 'book' | 'punish' | 'freeplay' | 'game';
	motif?: 'missed-punish';
	origin?: CardOrigin;
	now: number;
}): MistakeCard {
	return {
		id: `${opts.positionKey}|${opts.expectedUci}`,
		fen: opts.fen,
		ourColour: opts.ourColour,
		expectedUci: opts.expectedUci,
		expectedSan: opts.expectedSan,
		playedSan: opts.playedSan,
		path: opts.path,
		...(opts.opening ? { opening: opts.opening } : {}),
		ply: opts.ply,
		phase: opts.phase,
		...(opts.motif ? { motif: opts.motif } : {}),
		...(opts.origin ? { origin: opts.origin } : {}),
		firstSeen: opts.now,
		lastSeen: opts.now,
		streak: 0,
		lapses: 1,
		dueAt: opts.now,
		retired: false,
	};
}

/** Met the same mistake again — reset progress on it and make it due. */
export function relapse(card: MistakeCard, now: number): MistakeCard {
	return {
		...card,
		streak: 0,
		lapses: card.lapses + 1,
		lastSeen: now,
		dueAt: now,
		retired: false,
	};
}

export function answer(card: MistakeCard, correct: boolean, now: number): MistakeCard {
	const streak = correct ? card.streak + 1 : 0;
	return {
		...card,
		streak,
		lapses: card.lapses + (correct ? 0 : 1),
		lastSeen: now,
		// A wrong answer comes straight back inside the same session; that is what
		// "repeat until correct" means.
		dueAt: correct ? now + intervalFor(streak) : now,
		retired: correct && streak >= RETIRE_STREAK,
	};
}

/**
 * Where a card came from, as the user thinks of it.
 *
 * `phase` already carried this; naming it is what makes it filterable. The
 * categories are genuinely different exercises — recalling a line, finding a
 * refutation, and not repeating something that cost you a real game — and
 * wanting to drill one of them is a reasonable thing to want.
 */
export const CATEGORIES: { id: MistakeCard['phase']; label: string; note: string }[] = [
	{ id: 'book', label: 'Openings', note: 'Book moves you lost the line on.' },
	{ id: 'punish', label: 'Refutations', note: 'Mistakes you failed to punish.' },
	{
		id: 'game',
		label: 'Real games',
		note: 'Mined from your Lichess and Chess.com games — your errors, and the chances you let go.',
	},
	{ id: 'freeplay', label: 'Free play', note: 'Moves that cost material after the book ran out.' },
];

/** Cards in the chosen categories. An empty selection means everything. */
export function inCategories(
	cards: MistakeCard[],
	categories: MistakeCard['phase'][],
): MistakeCard[] {
	if (!categories.length) return cards;
	return cards.filter((c) => categories.includes(c.phase));
}

/**
 * How many cards, and how many due, in each category — RETIRED ONES EXCLUDED.
 *
 * Will: "retired cards are still counted in the category totals. That's
 * annoying. when they are gone they no longer contribute to the number of cards
 * in the category."
 *
 * `total` used to mean "cards that have ever existed in this category", which is
 * a fact about your history rather than about the deck, and it sat beside `due`
 * — which has always excluded retired cards — as though the two were the same
 * kind of number. Learning ten openings and retiring them left "0/10" beside a
 * category with nothing in it, so the chip stayed enabled and the count never
 * fell. Both halves now count the same population: cards still in the deck.
 *
 * The retired ones are not lost — `summarise` still reports them, which is where
 * a number about what you have finished belongs.
 */
export function countByCategory(
	cards: MistakeCard[],
	now: number,
): Record<string, { total: number; due: number }> {
	const out: Record<string, { total: number; due: number }> = {};
	for (const c of CATEGORIES) out[c.id] = { total: 0, due: 0 };
	const dueSet = new Set(due(cards, now).map((c) => c.id));
	for (const c of cards) {
		if (c.retired) continue;
		const row = out[c.phase];
		if (!row) continue;
		row.total++;
		if (dueSet.has(c.id)) row.due++;
	}
	return out;
}

/**
 * One answer, applied to the card AND to the deck it lives in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN JUST `answer`.
 *
 * `answer` was correct and unit-tested — `correct ? streak + 1 : 0` — and the
 * three-in-a-row rule was still broken in the app, because the view kept the
 * PRE-answer card on screen after a miss. The reset went to the database; the
 * stale copy stayed in hand; the next correct answer incremented from the streak
 * the card had before it failed:
 *
 *   streak 2 → wrong → saved as 0, held copy still says 2
 *                    → correct → answer(2, true) = 3 → RETIRED
 *
 * A pure function cannot be tested into catching that, because the defect is in
 * which value the caller keeps. So the update returns BOTH halves, and the caller
 * has nothing left to get out of step: whatever it renders next comes from here.
 * ---------------------------------------------------------------------------
 */
export function applyAnswer(
	card: MistakeCard,
	deck: MistakeCard[],
	correct: boolean,
	now: number,
): { card: MistakeCard; deck: MistakeCard[] } {
	const updated = answer(card, correct, now);
	return { card: updated, deck: deck.map((c) => (c.id === updated.id ? updated : c)) };
}

export function due(cards: MistakeCard[], now: number): MistakeCard[] {
	return cards
		.filter((c) => !c.retired && c.dueAt <= now)
		.sort((a, b) => b.lapses - a.lapses || a.dueAt - b.dueAt);
}

export function summarise(cards: MistakeCard[], now: number) {
	return {
		total: cards.length,
		due: due(cards, now).length,
		learning: cards.filter((c) => !c.retired).length,
		retired: cards.filter((c) => c.retired).length,
	};
}

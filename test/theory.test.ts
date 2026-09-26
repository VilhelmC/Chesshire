// Book is what theory names, not what people happen to play.
//
// ---------------------------------------------------------------------------
// Will: "you're conflating move frequency with whether it is 'book' — that's
// why I'm objecting to 0.2% reason. Theory does not care how frequent a move is
// and book is defined by theory not move frequency."
//
// The conflation was load-bearing, not cosmetic. `classifyBook` assigned
// `verdict: 'book'` when `freq >= minFreq`; `isTheory` reads `verdict`; and
// BOTH book rungs of the strictness ladder are built on `isTheory`. So a slider
// labelled "how mainstream your opponent is" — whose own help text says it
// "does not judge your own moves" — decided what counted as a right answer. The
// interface was telling the truth and the code disagreed with it.
//
// These are the two halves of the claim, in both directions: a rare named move
// is book, and a popular unnamed one is not.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
	classifyBook,
	isTheory,
	acceptable,
	movesTowardRoots,
	type Verdict,
} from '../src/domain/book';
import { namesTheory } from '../src/domain/localBook';
import { INITIAL_FEN, applySan } from '../src/domain/chess';
import type { ExplorerResponse } from '../src/domain/types';

const uciOf = (san: string) => applySan(INITIAL_FEN, san).uci;

/** An explorer response with the game counts spelled out. */
const explorer = (moves: { san: string; games: number; name?: string }[]): ExplorerResponse =>
	({
		white: 0,
		draws: 0,
		black: 0,
		moves: moves.map((m) => ({
			uci: uciOf(m.san),
			san: m.san,
			white: m.games,
			draws: 0,
			black: 0,
			...(m.name ? { opening: { eco: 'A00', name: m.name } } : {}),
		})),
	}) as ExplorerResponse;

const verdictOf = (rows: ReturnType<typeof classifyBook>, san: string): Verdict | undefined =>
	rows.find((r) => r.san === san)?.verdict;

describe('a rare move that theory names', () => {
	it('is book, however few games went that way', () => {
		// 2 games in 10002 — 0.02%, far under any frequency bar, and a named line.
		const rows = classifyBook(
			explorer([
				{ san: 'e4', games: 10000 },
				{ san: 'b4', games: 2 },
			]),
			{ minFreq: 0.03, isTheory: (u) => u === uciOf('b4') || u === uciOf('e4') },
		);
		expect(verdictOf(rows, 'b4')).toBe('book');
		expect(isTheory(rows.find((r) => r.san === 'b4')!)).toBe(true);
	});

	it('is therefore accepted on the book rungs', () => {
		// The consequence that matters: this is what was refusing right answers.
		const rows = classifyBook(
			explorer([
				{ san: 'e4', games: 10000 },
				{ san: 'b4', games: 2 },
			]),
			{ minFreq: 0.03, isTheory: () => true },
		);
		for (const rung of ['bookSound', 'free'] as const) {
			expect(acceptable(rows, rung).map((m) => m.san)).toContain('b4');
		}
	});
});

describe('a popular move that nothing names', () => {
	it('is sound, not book', () => {
		// Being played is not being written down. Half the games go this way and
		// it is still not theory.
		const rows = classifyBook(
			explorer([
				{ san: 'e4', games: 500 },
				{ san: 'a3', games: 500 },
			]),
			{ minFreq: 0.03, isTheory: (u) => u === uciOf('e4') },
		);
		expect(verdictOf(rows, 'a3')).toBe('sound');
	});

	it('cannot be promoted to the main line by popularity alone', () => {
		// `main` is "the main line", which IS a frequency question — but it may
		// only rank moves already in the book, never admit one to it.
		const rows = classifyBook(
			explorer([
				{ san: 'a3', games: 900 },
				{ san: 'e4', games: 100 },
			]),
			{ minFreq: 0.03, isTheory: (u) => u === uciOf('e4') },
		);
		expect(verdictOf(rows, 'a3')).toBe('sound');
		expect(verdictOf(rows, 'e4')).toBe('main');
	});
});

describe('where the answer comes from', () => {
	it('counts the explorer naming a move as theory too', () => {
		// The explorer names moves deeper than the bundled table reaches, and a
		// name is a name whoever supplies it.
		//
		// `main` rather than `book` here, and that is the right answer: it is the
		// only theory move in the fixture, so it is also the most-played one. The
		// claim being made is that it is IN the book, which `isTheory` is the
		// question for — the label only ranks moves already there.
		const rows = classifyBook(
			explorer([
				{ san: 'e4', games: 100 },
				{ san: 'g3', games: 1, name: "King's Indian Attack" },
			]),
			{ minFreq: 0.5, isTheory: () => false },
		);
		expect(isTheory(rows.find((r) => r.san === 'g3')!)).toBe(true);
		expect(isTheory(rows.find((r) => r.san === 'e4')!)).toBe(false);
	});

	it('calls nothing theory when there is no book to ask', () => {
		// Past where any book reaches, nothing is theory — which is the honest
		// answer and the premise of the whole app.
		const rows = classifyBook(explorer([{ san: 'e4', games: 100 }]), { minFreq: 0.0001 });
		expect(verdictOf(rows, 'e4')).toBe('sound');
	});
});

describe('the bundled table answers the question directly', () => {
	it('names the moves of real openings', () => {
		expect(namesTheory(INITIAL_FEN, uciOf('e4'))).toBe(true);
		// Anderssen's opening — a named line played by almost nobody, which is
		// exactly the case the frequency rule got wrong.
		expect(namesTheory(INITIAL_FEN, uciOf('a3'))).toBe(true);
	});

	it('does not name a move no line goes through', () => {
		// Every legal FIRST move has a name — measured, all twenty — so the case
		// has to be found deeper. After 1.e4 e5 2.Nf3 the table names exactly
		// eight replies (Nc6 Nf6 Qe7 Qf6 d5 d6 f5 f6); walking the king out is
		// legal, perfectly playable to look at, and written down nowhere.
		let fen = INITIAL_FEN;
		for (const san of ['e4', 'e5', 'Nf3']) fen = applySan(fen, san).fen;
		expect(namesTheory(fen, applySan(fen, 'Nc6').uci)).toBe(true);
		expect(namesTheory(fen, applySan(fen, 'Ke7').uci)).toBe(false);
	});
});

describe('what narrows the drill now that popularity does not', () => {
	/*
	 * Will: "'How strict' settings currently have no way to set minimum
	 * popularity, after our last changes. Is that a feature users might need
	 * still?" — and, having seen the measurements, no: pin a repertoire instead.
	 *
	 * That answer only holds if pinning really does narrow the wide case, which
	 * is the first move or two, where "any named line" is close to "anything
	 * legal" — 20 named replies at the start, against an average of 1.4 across
	 * the whole table. So the claim is pinned here rather than left as a remark.
	 */
	it('restricts the opening move to the pinned line', () => {
		const roots = [{ path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] }];
		expect(movesTowardRoots([], roots)).toEqual(['e4']);
		expect(movesTowardRoots(['e4', 'e5'], roots)).toEqual(['Nf3']);
	});

	it('accepts either when two pinned openings diverge', () => {
		// "Multiple toggled means union", per Will — forcing one would quietly
		// drop the other from the session.
		const roots = [{ path: ['e4', 'e5'] }, { path: ['d4', 'd5'] }];
		expect(movesTowardRoots([], roots).sort()).toEqual(['d4', 'e4']);
	});

	it('stops restricting once you are inside the root', () => {
		// Walking IN is a filter the user set; once there, the rung decides. The
		// two must not be confused — see `describeBookMistake`.
		expect(movesTowardRoots(['e4', 'e5'], [{ path: ['e4', 'e5'] }])).toEqual([]);
	});
});

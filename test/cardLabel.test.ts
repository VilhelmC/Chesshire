// A card should say what it is about, not only where it came from.
//
// Cards mined from real games used to be labelled "lichess vs someone, 2026-08"
// and nothing else. That identifies the source and says nothing about the
// position, so a game-mined card could not be connected to the book line it
// belongs to — which is the one thing that would let the deck reinforce the
// tree instead of sitting beside it.

import { describe, it, expect } from 'vitest';
import { lastMoveOf, lineLabelFor, moveNumberFor, namesFor } from '../src/views/Quiz';
import type { MistakeCard } from '../src/domain/mistakes';

const card = (over: Partial<MistakeCard> = {}): MistakeCard => ({
	id: 'x',
	fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
	ourColour: 'w',
	expectedUci: 'e2e4',
	expectedSan: 'e4',
	playedSan: 'a3',
	path: [],
	ply: 0,
	phase: 'book',
	firstSeen: 0,
	lastSeen: 0,
	streak: 0,
	lapses: 1,
	dueAt: 0,
	retired: false,
	...over,
});

describe('lineLabelFor', () => {
	it('prefers the name recorded on the card', () => {
		expect(lineLabelFor(card({ opening: 'Italian Game' }))).toBe('Italian Game');
	});

	it('derives a name from the path when none was recorded', () => {
		const c = card({ path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] });
		expect(lineLabelFor(c)).toMatch(/two knights/i);
	});

	it('falls back to the most specific named ancestor, not to nothing', () => {
		// The bundled ECO list has no entry for the Italian junction itself
		// (e4 e5 Nf3 Nc6 Bc4) — only for the variations below it. The label is
		// then the nearest named ancestor, which is honest: it is the most
		// specific thing that is actually known about the position.
		const c = card({ path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] });
		expect(lineLabelFor(c)).toMatch(/knight/i);
	});

	it('labels a card mined from a real game, which used to have no line at all', () => {
		const c = card({
			phase: 'game',
			path: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
			origin: {
				platform: 'lichess',
				url: 'https://lichess.org/abc',
				opponent: 'someone',
				playedAt: 0,
				loss: 300,
			},
		});
		expect(lineLabelFor(c)).toMatch(/Scotch/i);
	});

	it('falls back to nothing rather than inventing a name', () => {
		// A position far outside any book has no honest label.
		expect(lineLabelFor(card({ path: [] }))).toBeNull();
	});

	it('still honours the legacy line ids on old cards', () => {
		expect(lineLabelFor(card({ lineIds: ['italian'] }))).toBe('italian');
	});
});

describe('moveNumberFor', () => {
	it('counts the mistake as the move after the path', () => {
		// path e4 e5 Nf3 Nc6 -> the mistake is White's 3rd move.
		expect(moveNumberFor(card({ path: ['e4', 'e5', 'Nf3', 'Nc6'] }))).toEqual({
			no: 3,
			white: true,
		});
	});

	it('knows a Black mistake from a White one', () => {
		expect(moveNumberFor(card({ path: ['e4', 'e5', 'Nf3'] }))).toEqual({ no: 2, white: false });
	});

	it('starts at move 1, not move 0', () => {
		expect(moveNumberFor(card({ path: [] })).no).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// WHAT THE POSITION WAS.
//
// Will, on the Hardest list: "the annotation is useless. Just says a move and
// variation, but that tells user nothing about what the position was." The
// missing fact is the move you were answering — `path`'s last entry — and the
// only thing easy to get wrong about it is whose move it was, because the path
// is the moves BEFORE the card's own.
// ---------------------------------------------------------------------------
describe('the move that produced the position', () => {
	it('is the last move of the path, and White made it at an even ply', () => {
		// 1.e4 e5 2.Nf3 — three plies, so the last is index 2, which is White's.
		expect(lastMoveOf(card({ path: ['e4', 'e5', 'Nf3'] }))).toEqual({
			san: 'Nf3',
			colour: 'w',
		});
	});

	it('is Black at an odd ply', () => {
		expect(lastMoveOf(card({ path: ['e4', 'e5'] }))).toEqual({ san: 'e5', colour: 'b' });
	});

	it('is absent at the start, where nothing produced the position', () => {
		expect(lastMoveOf(card({ path: [] }))).toBeNull();
	});
});

describe('what the row leads with', () => {
	it('names the line and where in it, not the answer', () => {
		const label = namesFor(card({ opening: 'Italian Game', path: ['e4', 'e5', 'Nf3'] }));
		expect(label).toContain('Italian Game');
		expect(label).toContain('move 2');
		// The answer is the one thing a list of your weak spots must not shout.
		expect(label).not.toContain('e4');
	});

	it('always says where in the game, named line or not', () => {
		// `a3 a6 b3` turns out to BE a named opening, which is the point: the
		// move number is the part that is always there, so it is the part the
		// row can be identified by.
		expect(namesFor(card({ path: ['a3', 'a6', 'b3'] }))).toMatch(/move 2…/i);
		expect(namesFor(card({ path: [] }))).toMatch(/move 1/i);
	});
});

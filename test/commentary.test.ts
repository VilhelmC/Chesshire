// The register, and the fifty pages that nearly disappeared.
//
// Every malformed title below is a real one from the book. They are the reason
// this module has a normalisation step at all, and the reason that step is
// tested rather than trusted: each of these is a page that vanishes silently if
// its spelling is not handled, and a register cannot tell you what it lost.

import { describe, it, expect } from 'vitest';
import {
	BOOK,
	isMoveTitle,
	sansOfTitle,
	keyOfTitle,
	buildRegister,
	proseOf,
	isSubstantial,
	paragraphFor,
	MIN_PROSE,
} from '../src/domain/commentary';
import { positionKey, INITIAL_FEN, applySan } from '../src/domain/chess';

const t = (path: string) => BOOK + path;

/** The position key after a line of SAN, for comparing against a title's key. */
function keyAfter(sans: string[]): string {
	let fen = INITIAL_FEN;
	for (const san of sans) fen = applySan(fen, san).fen;
	return positionKey(fen);
}

describe('which pages are about a position', () => {
	it('takes a move page', () => {
		expect(isMoveTitle(t('1. e4/1...c5/2. Nf3'))).toBe(true);
	});

	it('leaves the apparatus alone', () => {
		// These exist in the book and have no position, so they have no key.
		for (const page of [
			'ECO index',
			'ECO volume A',
			'How to navigate this wikibook',
			'Local manual of style',
			'Footer',
			"Croon's Gambit",
		]) {
			expect(isMoveTitle(t(page)), page).toBe(false);
		}
	});

	it('refuses a title from another book', () => {
		expect(isMoveTitle('Chess/Playing the game')).toBe(false);
	});
});

describe('the spellings the book actually uses', () => {
	it('reads the ordinary form', () => {
		expect(sansOfTitle(t('1. e4/1...c5/2. Nf3'))).toEqual(['e4', 'c5', 'Nf3']);
	});

	it('takes a typographic ellipsis', () => {
		// "Chess Opening Theory/1. c4/1…c5/2. b4"
		expect(sansOfTitle(t('1. c4/1…c5/2. b4'))).toEqual(['c4', 'c5', 'b4']);
	});

	it('takes a missing space after the number', () => {
		// ".../4.e3/4...b5/5.Nxb5?"
		expect(sansOfTitle(t('1. d4/1...d5/2. c4/2...c6/3. Nc3/3...dxc4/4.e3'))).toEqual([
			'd4',
			'd5',
			'c4',
			'c6',
			'Nc3',
			'dxc4',
			'e3',
		]);
	});

	it('takes zeroes for castling', () => {
		// ".../4. e4/4...0-0"
		expect(sansOfTitle(t('1. d4/1...Nf6/2. c4/2...g6/3. Nc3/3...Bg7/4. e4/4...0-0'))).toEqual([
			'd4',
			'Nf6',
			'c4',
			'g6',
			'Nc3',
			'Bg7',
			'e4',
			'O-O',
		]);
		expect(sansOfTitle(t('1. d4/1...d5/2. Nc3/2...Nc6/3. Bf4/3...Bf5/4. Qd2/4...Qd7/5. 0-0-0'))![
			8
		]).toBe('O-O-O');
	});

	it('strips an annotation glued to the move', () => {
		expect(sansOfTitle(t('1. e4/1...e5/2. Nf3?!'))).toEqual(['e4', 'e5', 'Nf3']);
		expect(sansOfTitle(t('1. e4/1...e5/2. Ke2??'))).toEqual(['e4', 'e5', 'Ke2']);
	});

	it('keeps check and mate, which are part of the move', () => {
		expect(sansOfTitle(t('1. e4/1...e5/2. Qh5/2...Ke7/3. Qxe5+'))).toEqual([
			'e4',
			'e5',
			'Qh5',
			'Ke7',
			'Qxe5+',
		]);
	});

	it('splits two moves crammed into one segment', () => {
		// ".../4. Nf3 Nc6"
		expect(sansOfTitle(t('1. d4/1...Nf6/2. c4/2...e5/3. dxe5/3...Ng4/4. Nf3 Nc6'))).toEqual([
			'd4',
			'Nf6',
			'c4',
			'e5',
			'dxe5',
			'Ng4',
			'Nf3',
			'Nc6',
		]);
	});
});

describe('titles become positions', () => {
	it('replays to the position the moves reach', () => {
		expect(keyOfTitle(t('1. e4/1...c5/2. Nf3'))).toBe(keyAfter(['e4', 'c5', 'Nf3']));
	});

	it('ignores a move number that disagrees with the moves', () => {
		// The numbering is stripped, not checked: the page is still about the
		// position its moves reach.
		expect(keyOfTitle(t('1. e4/7...c5'))).toBe(keyAfter(['e4', 'c5']));
	});

	it('refuses a move that will not play', () => {
		expect(keyOfTitle(t('1. e4/1...e5/2. Qh9'))).toBeNull();
		// A legal-looking move in an illegal place.
		expect(keyOfTitle(t('1. e4/1...e5/2. Nf6'))).toBeNull();
	});
});

describe('the register', () => {
	it('keys by position, so a transposition finds the page', () => {
		const { register } = buildRegister([t('1. d4/1...Nf6/2. c4/2...e6/3. Nc3')]);
		// The same position by a different order — the case Lichess misses.
		const other = keyAfter(['c4', 'Nf6', 'd4', 'e6', 'Nc3']);
		expect(register.get(other)).toBe('1. d4/1...Nf6/2. c4/2...e6/3. Nc3');
	});

	it('keeps the shortest path when two pages name one position', () => {
		const direct = t('1. e4/1...e5/2. Nf3');
		const roundabout = t('1. Nf3/1...e5/2. e4');
		const a = buildRegister([direct, roundabout]);
		const b = buildRegister([roundabout, direct]);
		// Same length here, so order decides — the point is only that ONE wins and
		// the count is honest about the other.
		expect(a.register.size).toBe(1);
		expect(b.register.size).toBe(1);
		expect(a.transpositions).toBe(1);

		const short = t('1. d4/1...d5');
		const long = t('1. d4/1...Nf6/2. Nf3/2...d5/3. c4/3...dxc4');
		const c = buildRegister([long, t('1. c4/1...c5')]);
		expect(c.register.size).toBe(2);
		expect(buildRegister([short]).register.get(keyAfter(['d4', 'd5']))).toBe('1. d4/1...d5');
	});

	it('reports what it could not replay instead of dropping it', () => {
		const { register, unplayable } = buildRegister([
			t('1. e4/1...c5'),
			t('1. e4/1...e5/2. Qh9'),
			t('ECO index'),
		]);
		expect(register.size).toBe(1);
		// The apparatus page is not "unplayable" — it was never a candidate.
		expect(unplayable).toEqual([t('1. e4/1...e5/2. Qh9')]);
	});
});

describe('what counts as commentary', () => {
	const body = 'x'.repeat(MIN_PROSE + 10);

	it('cuts the apparatus off the end', () => {
		const extract = `White plays 3. d4.\n\nTheory table\n1 2 3 4\n\nReferences\n[1]`;
		expect(proseOf(extract)).toBe('White plays 3. d4.');
	});

	it('refuses a stub', () => {
		expect(isSubstantial('3. d4')).toBe(false);
		expect(isSubstantial(body)).toBe(true);
	});

	it('does not count the theory table towards the length', () => {
		// A heading and a big table is exactly the page that should not open.
		expect(isSubstantial(`3. d4\n\nTheory table\n${'1 2 3 4 '.repeat(80)}`)).toBe(false);
	});
});

describe('finding the paragraph about a move', () => {
	const extract = [
		'White plays 3. d4, inviting Black to trade a pawn.',
		'3...cxd4 is the main move. Black captures towards the centre.',
		'3...Nf6 is a minor sideline.',
	].join('\n\n');

	it('finds the move that is written about', () => {
		expect(paragraphFor(extract, 'cxd4')).toContain('the main move');
		expect(paragraphFor(extract, 'Nf6')).toContain('minor sideline');
	});

	it('does not match a move inside another move', () => {
		// `d4` appears inside `cxd4`; the paragraph about d4 is the first one.
		expect(paragraphFor(extract, 'd4')).toContain('inviting Black');
	});

	it('says nothing rather than guessing', () => {
		expect(paragraphFor(extract, 'Bb5')).toBeNull();
	});
});

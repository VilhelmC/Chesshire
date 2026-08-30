// The rating's second population: the games you actually played.
//
// Will: "why is my rating estimate only based on 28 scored moves, when there
// are plenty of games imported." Because they never reached the estimator. The
// tests that matter here are the ones about what is EXCLUDED, because every
// exclusion is a way for the sample to be quietly small again.

import { describe, it, expect } from 'vitest';
import { gameLosses } from '../src/domain/progress';
import type { Reviewable } from '../src/domain/reviewable';

/** `evals` is our-POV and indexed by ply, so index 0 is the start. */
function game(evals: (number | null)[], ourColour: 'w' | 'b', moves: string[] = []): Reviewable {
	return {
		id: 'g',
		source: 'game',
		ts: 0,
		title: 'vs someone',
		detail: 'test',
		label: 'vs someone · test',
		moves: moves.length ? moves : evals.slice(1).map((_, i) => `m${i}`),
		evals,
		ourColour,
	};
}

/** No opening is ever recognised, so nothing is excluded as book. */
const noBook = () => 0;

describe('losses from played games', () => {
	it('counts our moves and not theirs', () => {
		// White to move at ply 1. Our-POV evals: we drop 50, they drop 30.
		const g = game([20, -30, 0], 'w');
		expect(gameLosses([g], noBook)).toEqual([50]);
	});

	it('reads the board from the right side when we are Black', () => {
		// Ply 1 is White's, so as Black our moves are the EVEN plies.
		const g = game([0, -100, -40], 'b');
		// Ply 2 is ours: our-POV went from −100 to −40, which is a gain, not a loss.
		expect(gameLosses([g], noBook)).toEqual([0]);
	});

	it('skips a ply that was never evaluated rather than calling it level', () => {
		// A null is the absence of a measurement. Counting it as 0 would be a
		// perfect move invented out of missing data, and would flatter the number.
		const g = game([0, null, -60], 'w');
		expect(gameLosses([g], noBook)).toEqual([]);
	});

	it('never counts a negative loss', () => {
		// Their blunder makes our eval rise across our own move; that is not a
		// negative loss, it is a zero.
		const g = game([0, 300, 250], 'w');
		expect(gameLosses([g], noBook)).toEqual([0]);
	});

	it('drops the opening, which is recall and not strength', () => {
		// Six plies of ours; the book is said to end at ply 4.
		const g = game([0, -10, -20, -30, -40, -50, -60], 'w');
		const all = gameLosses([g], noBook);
		const past = gameLosses([g], () => 4);
		expect(all.length).toBe(3); // plies 1, 3, 5
		expect(past.length).toBe(1); // ply 5 only
	});

	it('excludes nothing when the game left theory immediately', () => {
		const g = game([0, -10, -20, -30], 'w');
		expect(gameLosses([g], () => 0).length).toBe(2);
	});

	it('is given the moves, so the cutoff can be asked about the real line', () => {
		const g = game([0, -10, -20], 'w', ['e4', 'c5']);
		const seen: string[][] = [];
		gameLosses([g], (moves) => {
			seen.push(moves);
			return 0;
		});
		expect(seen).toEqual([['e4', 'c5']]);
	});

	it('ignores a game with no evaluations at all', () => {
		expect(gameLosses([game([], 'w')], noBook)).toEqual([]);
	});

	it('pools across games', () => {
		const a = game([0, -10], 'w');
		const b = game([0, -40], 'w');
		expect(gameLosses([a, b], noBook)).toEqual([10, 40]);
	});
});

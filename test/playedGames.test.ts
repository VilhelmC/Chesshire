// Which games count, and the mate score that was being counted as centipawns.
//
// Will: "are you sure my estimated rating is 1640 - seems too high to me."
// It was, by about 300 points, and neither cause was arithmetic: nine of his
// seventeen games were correspondence, and ten of his moves were being scored
// by subtracting a mate score from an evaluation.

import { describe, it, expect } from 'vitest';
import { speedOf, splitBySpeed, isMateScore } from '../src/domain/playedGames';
import { gameLosses } from '../src/domain/progress';
import type { Reviewable } from '../src/domain/reviewable';

describe('is this a game or an analysis session', () => {
	it('takes the site at its word when it says', () => {
		expect(speedOf({ speed: 'blitz' })).toBe('live');
		expect(speedOf({ speed: 'rapid' })).toBe('live');
		expect(speedOf({ speed: 'classical' })).toBe('live');
		expect(speedOf({ speed: 'correspondence' })).toBe('correspondence');
		expect(speedOf({ speed: 'daily' })).toBe('correspondence');
	});

	it('does not care how the site capitalises it', () => {
		expect(speedOf({ speed: 'Daily' })).toBe('correspondence');
		expect(speedOf({ speed: 'ultraBullet' })).toBe('live');
	});

	it('reads a chess.com daily game out of its URL, for rows imported before the field existed', () => {
		expect(speedOf({ url: 'https://www.chess.com/game/daily/1014117486' })).toBe('correspondence');
		expect(speedOf({ url: 'https://www.chess.com/game/live/98765' })).toBe('unknown');
	});

	it('says unknown rather than guessing at a lichess URL', () => {
		// A lichess address carries nothing about the time control. Guessing
		// "live" here is how a correspondence game sneaks into the estimate.
		expect(speedOf({ url: 'https://lichess.org/abcd1234' })).toBe('unknown');
		expect(speedOf({})).toBe('unknown');
	});

	it('prefers the stored field over the URL', () => {
		expect(
			speedOf({ speed: 'blitz', url: 'https://www.chess.com/game/daily/1' }),
		).toBe('live');
	});
});

describe('splitting a deck', () => {
	const deck = [
		{ speed: 'blitz' },
		{ speed: 'daily' },
		{ url: 'https://www.chess.com/game/daily/7' },
		{ url: 'https://lichess.org/xyz' },
	];

	it('keeps the live games and the unknown ones', () => {
		const { counted } = splitBySpeed(deck);
		expect(counted).toHaveLength(2);
	});

	it('counts the unknowns out loud rather than hiding them', () => {
		// A sample that is mostly unknown might quietly be correspondence, and the
		// caller cannot say so unless it is told.
		expect(splitBySpeed(deck).population).toEqual({
			counted: 2,
			correspondence: 2,
			unknown: 1,
		});
	});

	it('is empty-safe', () => {
		expect(splitBySpeed([]).population).toEqual({ counted: 0, correspondence: 0, unknown: 0 });
	});
});

describe('a mate score is not a quantity of centipawns', () => {
	it('recognises both signs', () => {
		expect(isMateScore(9990)).toBe(true);
		expect(isMateScore(-9990)).toBe(true);
		expect(isMateScore(900)).toBe(false);
		expect(isMateScore(-899)).toBe(false);
	});

	function game(evals: (number | null)[]): Reviewable {
		return {
			id: 'g',
			source: 'game',
			ts: 0,
			title: 't',
			detail: 'd',
			label: 't · d',
			moves: evals.slice(1).map((_, i) => `m${i}`),
			evals,
			ourColour: 'w',
		};
	}

	it('refuses the move that walks into mate rather than calling it a 9,000cp loss', () => {
		// We are White, so plies 1 and 3 are ours. Ply 1 drops 200 and counts;
		// ply 3 walks into mate, and the honest reading of that is no number
		// rather than a capped one.
		expect(gameLosses([game([0, -200, -250, -9990])], () => 0)).toEqual([200]);
	});

	it('refuses a mate score differenced against another mate score', () => {
		// This produced the deck's largest single loss: 19,850.
		expect(gameLosses([game([0, 9990, -9860])], () => 0)).toEqual([]);
	});

	it('still counts ordinary moves in a game that ends in mate', () => {
		const losses = gameLosses([game([0, -30, -60, -100, -9990])], () => 0);
		// Plies 1 and 3 are ours and measurable; ply 5 touches the mate score.
		expect(losses).toEqual([30, 40]);
	});
});

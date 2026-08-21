// Runs and real games, made reviewable by the same code.
//
// The subtle one is the point of view. Runs store evaluations from OUR side;
// imported games store them from WHITE's, because that is what the sites send.
// Mixing the two silently produces an evaluation graph that is upside down for
// every game played as Black — right half the time, which is the worst kind of
// wrong for a number nobody can easily check.

import { describe, it, expect } from 'vitest';
import { fromRun, fromGame, lossesFrom, reviewables } from '../src/domain/reviewable';

const run = (over = {}) => ({
	id: 'r1',
	ts: 100,
	opening: 'Italian Game',
	moves: ['e4', 'e5'],
	evals: [20, 10],
	losses: { 0: 5 },
	ourColour: 'w' as const,
	plies: 2,
	finished: 'line-complete',
	...over,
});

const game = (over = {}) => ({
	id: 'g1',
	playedAt: 200,
	opponent: 'someone',
	platform: 'lichess',
	url: 'https://lichess.org/abc',
	result: 'win' as const,
	moves: ['e4', 'e5', 'Nf3', 'Nc6'],
	evals: [20, 10, 25, 5],
	ourColour: 'w' as const,
	...over,
});

describe('fromRun', () => {
	it('takes a run that kept its moves', () => {
		expect(fromRun(run())?.source).toBe('run');
	});

	it('refuses one that did not', () => {
		// Nothing to replay is not an empty review, it is not a review.
		expect(fromRun(run({ moves: undefined }))).toBeNull();
	});

	it('leaves the evaluations alone — runs already store our point of view', () => {
		expect(fromRun(run({ ourColour: 'b' }))?.evals).toEqual([20, 10]);
	});
});

describe('fromGame', () => {
	it('takes an imported game', () => {
		const r = fromGame(game())!;
		expect(r.source).toBe('game');
		expect(r.label).toContain('someone');
		expect(r.url).toBe('https://lichess.org/abc');
	});

	it('flips the evaluations when we were Black', () => {
		// The one that would otherwise be wrong half the time.
		expect(fromGame(game({ ourColour: 'b' }))!.evals).toEqual([-20, -10, -25, -5]);
	});

	it('leaves them alone when we were White', () => {
		expect(fromGame(game())!.evals).toEqual([20, 10, 25, 5]);
	});

	it('carries a gap through as a gap', () => {
		expect(fromGame(game({ evals: [20, null] }))!.evals).toEqual([20, null]);
	});

	it('refuses a game with no moves', () => {
		expect(fromGame(game({ moves: undefined }))).toBeNull();
	});
});

describe('lossesFrom', () => {
	it('charges only our own moves', () => {
		// White plays plies 0 and 2 (0-indexed). Ply 1 is theirs.
		const losses = lossesFrom([15, -400, 15, -400], 'w');
		expect(Object.keys(losses)).toEqual(['0', '2']);
	});

	it('measures a drop from our own point of view', () => {
		// Evaluations are already our-POV here, so a fall is a loss either way.
		expect(lossesFrom([15, 10, -85], 'w')[2]).toBe(95);
	});

	it('does not credit a move that improved the position', () => {
		expect(lossesFrom([200], 'w')[0]).toBe(0);
	});

	it('skips a ply it cannot measure rather than guessing zero', () => {
		// A zero would say "played perfectly"; absence says "not measured".
		expect(lossesFrom([null, 10, 20], 'w')[0]).toBeUndefined();
	});
});

describe('reviewables', () => {
	it('mixes both sources, newest first', () => {
		const all = reviewables([run()], [game()]);
		expect(all.map((r) => r.source)).toEqual(['game', 'run']);
	});

	it('drops whatever cannot be replayed, from either source', () => {
		const all = reviewables([run({ moves: undefined })], [game({ moves: undefined })]);
		expect(all).toEqual([]);
	});
});

// Runs and real games, made reviewable by the same code.
//
// Two conventions differ between the sources, and both had already put a wrong
// number on screen:
//
//  * POINT OF VIEW. Runs store evaluations from OUR side; imported games store
//    them from WHITE's, because that is what the sites send. Mixing them
//    produces a graph that is upside down for every game played as Black —
//    right half the time, which is the worst kind of wrong for a number nobody
//    can easily check.
//  * INDEXING. Runs index by ply count (index 0 is the starting position);
//    imported games index from the position after the first move. Off by one,
//    silently, in one of the two.
//
// Both are normalised at this boundary, so these tests are where the claim is
// made that everything downstream can trust one convention.

import { describe, it, expect } from 'vitest';
import { fromRun, fromGame, reviewables, summarise } from '../src/domain/reviewable';

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

	it('leaves the indexing alone — runs already count plies', () => {
		// A run writes evals[path.length] after each move, so index 0 is the
		// starting position and no shift is needed.
		expect(fromRun(run({ evals: [null, 20, 10] }))?.evals).toEqual([null, 20, 10]);
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
		expect(fromGame(game({ ourColour: 'b' }))!.evals).toEqual([null, -20, -10, -25, -5]);
	});

	it('shifts them to count plies, with the start unmeasured', () => {
		// The leading null IS the fix: the site's array starts after the first
		// move, and everything downstream counts plies from the start.
		expect(fromGame(game())!.evals).toEqual([null, 20, 10, 25, 5]);
	});

	it('carries a gap through as a gap', () => {
		expect(fromGame(game({ evals: [20, null] }))!.evals).toEqual([null, 20, null]);
	});

	it('refuses a game with no moves', () => {
		expect(fromGame(game({ moves: undefined }))).toBeNull();
	});
});

describe('summarise', () => {
	// What each row of the list says. The list is the screen now, so a row that
	// cannot be told apart from the row above it is the whole feature failing.

	it('names the opponent as the thing you scan for', () => {
		const s = summarise(fromGame(game())!);
		expect(s.title).toBe('vs someone');
		expect(s.detail).toContain('win');
	});

	it('names the opening for a run, not the word "run"', () => {
		expect(summarise(fromRun(run())!).title).toBe('Italian Game');
	});

	it('scores the game, so one row can be chosen over another', () => {
		const s = summarise(fromGame(game())!);
		expect(s.accuracy).toBeGreaterThan(0);
		expect(s.scored).toBe(2); // our two plies as White
	});

	it('scores the opponent too', () => {
		expect(summarise(fromGame(game())!).opponentAccuracy).toBeGreaterThan(0);
	});

	it('counts the chances they gave and the ones we let go', () => {
		// White to play ply 3 with a gift of ~300cp, handed straight back.
		const g = game({ moves: ['e4', 'e5', 'Nf3', 'Nc6'], evals: [15, 315, 15, 15] });
		const s = summarise(fromGame(g)!);
		expect(s.offered).toBe(1);
		expect(s.missed).toBe(1);
	});

	it('says "not scored" as null rather than as zero', () => {
		// 0% is a claim about how you played. Null is the absence of one, and
		// printing it as 0% would libel every unanalysed game in the list.
		expect(summarise(fromGame(game({ evals: [] }))!).accuracy).toBeNull();
	});

	it('carries the link through for a real game and not for a run', () => {
		expect(summarise(fromGame(game())!).url).toBe('https://lichess.org/abc');
		expect(summarise(fromRun(run())!).url).toBeUndefined();
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

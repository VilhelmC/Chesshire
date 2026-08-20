// What the transfer measurement can see, and how it says so.
//
// The failure mode being guarded against is a report that reads as a verdict on
// the training when it is a fact about the sample. "No results yet" and "you
// need three more games" are the same state and very different sentences.

import { describe, it, expect } from 'vitest';
import {
	dataCoverage,
	gamesStillNeeded,
	transferAt,
	MIN_GAMES_PER_SIDE,
	type PlayedGame,
} from '../src/domain/transfer';

const DAY = 86_400_000;
const game = (id: string, at: number, moves?: string[]): PlayedGame => ({
	id,
	playedAt: at,
	...(moves ? { moves } : {}),
	mistakePaths: [],
});

describe('dataCoverage', () => {
	it('separates games it can use from games it cannot', () => {
		const c = dataCoverage([
			game('a', 0, ['e4', 'e5']),
			game('b', DAY),
			game('c', 2 * DAY, ['d4']),
		]);
		expect(c.usable).toBe(2);
		expect(c.unusable).toBe(1);
	});

	it('reports the span, because a count alone cannot distinguish two samples', () => {
		// Four games in one evening and four over two months are the same count
		// and completely different evidence.
		const evening = dataCoverage([
			game('a', 0, ['e4']),
			game('b', 3_600_000, ['e4']),
			game('c', 7_200_000, ['e4']),
			game('d', 10_800_000, ['e4']),
		]);
		const months = dataCoverage([
			game('a', 0, ['e4']),
			game('b', 20 * DAY, ['e4']),
			game('c', 40 * DAY, ['e4']),
			game('d', 60 * DAY, ['e4']),
		]);
		expect(evening.usable).toBe(months.usable);
		expect(evening.spanDays).toBe(0);
		expect(months.spanDays).toBe(60);
	});

	it('says nothing rather than zero when there is nothing usable', () => {
		const c = dataCoverage([game('a', 0), game('b', DAY)]);
		expect(c.usable).toBe(0);
		expect(c.from).toBeNull();
		expect(c.spanDays).toBeNull();
	});

	it('ignores unusable games when measuring the span', () => {
		// A move-less game from a year ago must not stretch the window it is not
		// part of.
		const c = dataCoverage([game('old', 0), game('a', 100 * DAY, ['e4']), game('b', 101 * DAY, ['e4'])]);
		expect(c.spanDays).toBe(1);
	});
});

describe('gamesStillNeeded', () => {
	const drills = [{ path: ['e4', 'e5'], ts: 10 * DAY }];
	const through = (n: number, from: number) =>
		Array.from({ length: n }, (_, i) => game(`g${from}-${i}`, from + i * DAY, ['e4', 'e5', 'Nf3']));

	it('reports the shortfall rather than an empty result', () => {
		const games = [...through(MIN_GAMES_PER_SIDE, 0), ...through(1, 11 * DAY)];
		const r = [transferAt(['e4', 'e5'], games, drills)];
		expect(r[0].meaningful).toBe(false);
		expect(gamesStillNeeded(r)).toBe(MIN_GAMES_PER_SIDE - 1);
	});

	it('reports zero once something is answerable', () => {
		const games = [...through(MIN_GAMES_PER_SIDE, 0), ...through(MIN_GAMES_PER_SIDE, 11 * DAY)];
		const r = [transferAt(['e4', 'e5'], games, drills)];
		expect(r[0].meaningful).toBe(true);
		expect(gamesStillNeeded(r)).toBe(0);
	});

	it('distinguishes "not enough games" from "nothing drilled"', () => {
		// Null means the shortfall is not the problem — there is nothing to
		// measure against yet, which needs a different sentence.
		const r = [transferAt(['e4', 'e5'], through(9, 0), [])];
		expect(gamesStillNeeded(r)).toBeNull();
	});

	it('takes the closest position to answerable, not the worst', () => {
		const games = [...through(MIN_GAMES_PER_SIDE, 0), ...through(3, 11 * DAY)];
		const close = transferAt(['e4', 'e5'], games, drills);
		const far = transferAt(['e4', 'e5', 'Nf3', 'Nc6'], games, [
			{ path: ['e4', 'e5', 'Nf3', 'Nc6'], ts: 10 * DAY },
		]);
		expect(gamesStillNeeded([far, close])).toBe(1);
	});
});

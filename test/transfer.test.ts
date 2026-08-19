import { describe, it, expect } from 'vitest';
import {
	transferAt,
	transferReport,
	coverage,
	describeChange,
	MIN_GAMES_PER_SIDE,
	type PlayedGame,
	type DrillEvent,
} from '../src/domain/transfer';

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
const TWO_KNIGHTS = [...ITALIAN, 'Nf6'];

let n = 0;
const game = (moves: string[], playedAt: number, mistakePaths: string[][] = []): PlayedGame => ({
	id: `g${++n}`,
	moves,
	playedAt,
	mistakePaths,
});

const drill = (path: string[], ts: number): DrillEvent => ({ path, ts });

describe('transferAt', () => {
	it('splits games at the moment the position was first drilled', () => {
		const games = [
			game(ITALIAN, 100, [ITALIAN]),
			game(ITALIAN, 200, [ITALIAN]),
			game(ITALIAN, 900),
			game(ITALIAN, 950),
		];
		const r = transferAt(ITALIAN, games, [drill(ITALIAN, 500)]);
		expect(r.firstDrilled).toBe(500);
		expect(r.before.games).toBe(2);
		expect(r.after.games).toBe(2);
		expect(r.before.mistakes).toBe(2);
		expect(r.after.mistakes).toBe(0);
	});

	it('counts games that reached the position even when nothing went wrong', () => {
		// The denominator is the entire point: fewer mistakes because you played
		// fewer Italians is not improvement.
		const games = [game(ITALIAN, 100, [ITALIAN]), game(ITALIAN, 110), game(ITALIAN, 120)];
		const r = transferAt(ITALIAN, games, [drill(ITALIAN, 999)]);
		expect(r.before.games).toBe(3);
		expect(r.before.rate).toBeCloseTo(1 / 3);
	});

	it('ignores games that never reached the position', () => {
		const games = [game(['d4', 'd5'], 100, [['d4']]), game(ITALIAN, 200)];
		const r = transferAt(ITALIAN, games, [drill(ITALIAN, 999)]);
		expect(r.before.games).toBe(1);
		expect(r.before.mistakes).toBe(0);
	});

	it('counts mistakes anywhere below the position, not only on the exact move', () => {
		// Drilling the Italian should show up as fewer mistakes anywhere in it.
		const deep = [...TWO_KNIGHTS, 'Ng5', 'd5'];
		const r = transferAt(ITALIAN, [game(deep, 100, [deep])], [drill(ITALIAN, 999)]);
		expect(r.before.mistakes).toBe(1);
	});

	it('does not count a mistake made outside the position', () => {
		const r = transferAt(TWO_KNIGHTS, [game(TWO_KNIGHTS, 100, [['e4', 'e5']])], []);
		expect(r.before.mistakes).toBe(0);
	});

	it('puts everything in the "before" window when the position was never drilled', () => {
		const r = transferAt(ITALIAN, [game(ITALIAN, 100), game(ITALIAN, 900)], []);
		expect(r.firstDrilled).toBeNull();
		expect(r.before.games).toBe(2);
		expect(r.after.games).toBe(0);
		expect(r.after.rate).toBeNull();
	});

	it('treats a drill on a deeper position as drilling this one too', () => {
		// You cannot drill 4.Ng5 without having played the Italian to get there.
		const r = transferAt(ITALIAN, [game(ITALIAN, 900)], [drill(TWO_KNIGHTS, 500)]);
		expect(r.firstDrilled).toBe(500);
		expect(r.after.games).toBe(1);
	});

	it('excludes games with no recorded moves rather than assuming a window', () => {
		const noMoves: PlayedGame = { id: 'x', playedAt: 100, mistakePaths: [ITALIAN] };
		const r = transferAt(ITALIAN, [noMoves, game(ITALIAN, 100)], [drill(ITALIAN, 999)]);
		expect(r.before.games).toBe(1);
		expect(r.before.mistakes).toBe(0);
	});
});

describe('refusing to report noise', () => {
	const drills = [drill(ITALIAN, 500)];
	const many = (count: number, at: number, mistakes: number) =>
		Array.from({ length: count }, (_, i) =>
			game(ITALIAN, at + i, i < mistakes ? [ITALIAN] : []),
		);

	it('gives no change until there are enough games on BOTH sides', () => {
		const thin = transferAt(ITALIAN, [...many(10, 100, 8), ...many(2, 900, 0)], drills);
		expect(thin.meaningful).toBe(false);
		expect(thin.change).toBeNull();
		// The counts are still reported — they are facts.
		expect(thin.before.games).toBe(10);
	});

	it('reports a change once both sides are big enough', () => {
		const ok = transferAt(
			ITALIAN,
			[...many(MIN_GAMES_PER_SIDE, 100, MIN_GAMES_PER_SIDE), ...many(MIN_GAMES_PER_SIDE, 900, 0)],
			drills,
		);
		expect(ok.meaningful).toBe(true);
		expect(ok.change).toBe(-1);
	});

	it('says so plainly when it got worse', () => {
		const worse = transferAt(
			ITALIAN,
			[...many(MIN_GAMES_PER_SIDE, 100, 0), ...many(MIN_GAMES_PER_SIDE, 900, MIN_GAMES_PER_SIDE)],
			drills,
		);
		expect(worse.change).toBe(1);
		expect(describeChange(worse)).toMatch(/worse, not better/);
	});

	it('explains what is missing rather than showing a blank', () => {
		const thin = transferAt(ITALIAN, [...many(2, 100, 1), ...many(1, 900, 0)], drills);
		expect(describeChange(thin)).toMatch(/2 games before, 1 after/);
		expect(describeChange(transferAt(ITALIAN, [], []))).toBe('not drilled yet');
	});
});

describe('transferReport', () => {
	it('puts the positions with real evidence first', () => {
		const games = [
			...Array.from({ length: 6 }, (_, i) => game(ITALIAN, 100 + i, [ITALIAN])),
			...Array.from({ length: 6 }, (_, i) => game(ITALIAN, 900 + i)),
			game(TWO_KNIGHTS, 100),
		];
		const out = transferReport([TWO_KNIGHTS, ITALIAN], games, [drill(ITALIAN, 500)]);
		expect(out[0].path).toEqual(ITALIAN);
		expect(out[0].meaningful).toBe(true);
	});
});

describe('coverage', () => {
	it('reports how much of the history can be placed at all', () => {
		const c = coverage([game(ITALIAN, 1), { id: 'x', playedAt: 1, mistakePaths: [] }]);
		expect(c).toEqual({ usable: 1, unusable: 1 });
	});
});

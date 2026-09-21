import { describe, it, expect } from 'vitest';
import {
	classifyBook,
	describeChoice,
	acceptable,
	opponentBook,
	punishable,
	withinRoot,
	withinAnyRoot,
	liveRoots,
	movesTowardRoots,
	SOUND_CP,
	BLUNDER_CP,
	EQUAL_CP,
} from '../src/domain/book';
import type { ExplorerResponse } from '../src/domain/types';

/** Explorer rows with the game counts implied by a share of 1000 games. */
function data(rows: { uci: string; san: string; pct: number; name?: string }[]): ExplorerResponse {
	return {
		white: 0,
		draws: 0,
		black: 0,
		opening: { eco: 'C50', name: 'Italian Game' },
		moves: rows.map((r) => ({
			uci: r.uci,
			san: r.san,
			white: Math.round(10 * r.pct),
			draws: 0,
			black: 0,
			opening: r.name ? { eco: 'C50', name: r.name } : null,
		})),
	};
}

// After 3.Bc4: the real shape of this position at a low band.
const AFTER_BC4 = data([
	{ uci: 'g8f6', san: 'Nf6', pct: 32, name: 'Two Knights Defence' },
	{ uci: 'f8c5', san: 'Bc5', pct: 28, name: 'Giuoco Piano' },
	{ uci: 'f8e7', san: 'Be7', pct: 6, name: 'Hungarian Defence' },
	{ uci: 'd7d6', san: 'd6', pct: 4, name: 'Semi-Italian' },
	{ uci: 'h7h6', san: 'h6', pct: 0.8 },
	{ uci: 'g8e7', san: 'Nge7', pct: 29.2 },
]);

describe('classifyBook', () => {
	it('marks the most-played sound move as best', () => {
		const moves = classifyBook(AFTER_BC4);
		expect(moves.find((m) => m.san === 'Nf6')?.verdict).toBe('main');
	});

	it('calls common sound moves book and uncommon ones rare', () => {
		const moves = classifyBook(AFTER_BC4);
		expect(moves.find((m) => m.san === 'Bc5')?.verdict).toBe('book');
		expect(moves.find((m) => m.san === 'd6')?.verdict).toBe('book');
		expect(moves.find((m) => m.san === 'h6')?.verdict).toBe('sound');
	});

	it('lets evaluation override popularity', () => {
		// The Damiano case: named theory, commonly played, and close to losing.
		// A frequency-only filter called this book, which is how it got missed.
		const losses = new Map([['g8e7', BLUNDER_CP + 40]]);
		const moves = classifyBook(AFTER_BC4, { losses });
		expect(moves.find((m) => m.san === 'Nge7')?.verdict).toBe('blunder');
		// And it must not be able to claim 'main' by being popular.
		expect(moves.find((m) => m.san === 'Nf6')?.verdict).toBe('main');
	});

	it('separates an inaccuracy from a blunder', () => {
		const moves = classifyBook(AFTER_BC4, { losses: new Map([['d7d6', SOUND_CP + 20]]) });
		expect(moves.find((m) => m.san === 'd6')?.verdict).toBe('inaccuracy');
	});

	it('returns nothing for a position with no games', () => {
		expect(classifyBook(data([]))).toEqual([]);
	});
});

describe('acceptable', () => {
	const moves = classifyBook(AFTER_BC4, { losses: new Map([['g8e7', 300]]) });

	it('bestBook takes the strongest PLAYED move, not the most popular one', () => {
		// This is what replaced 'One answer'. Will: "why would we care about which
		// move is most popular." The target is the best move anybody plays, which
		// is a different move whenever theory's favourite is not its strongest.
		const ok = acceptable(moves, 'bestBook').map((m) => m.san);
		expect(ok).toContain('Nf6');
		expect(ok).not.toContain('h6'); // sound but nobody plays it
		expect(ok).not.toContain('Nge7'); // unsound
	});

	it('bestBook counts ties, so a move that is as good is not marked wrong', () => {
		// Two played moves a rounding error apart are the same move as far as a
		// drill is concerned — the same tolerance the explainer prints as
		// "As good as Nxd4".
		const tied = classifyBook(AFTER_BC4, {
			losses: new Map([
				['g8f6', 0],
				['f8c5', EQUAL_CP - 1],
				['f8e7', EQUAL_CP + 40],
			]),
		});
		const ok = acceptable(tied, 'bestBook').map((m) => m.san);
		expect(ok).toContain('Nf6');
		expect(ok).toContain('Bc5');
		expect(ok).not.toContain('Be7');
	});

	it('bookSound takes played AND sound — theory minus its dubious parts', () => {
		const ok = acceptable(moves, 'bookSound').map((m) => m.san);
		expect(ok).toContain('Nf6');
		expect(ok).not.toContain('h6'); // sound, but not played
		expect(ok).not.toContain('Nge7'); // played enough, but unsound
	});

	it('free accepts anything sound, however rare', () => {
		// Soundness decides right and wrong; frequency decides what is worth
		// SAYING. This rung is what 'book' and 'free' both used to be.
		const ok = acceptable(moves, 'free').map((m) => m.san);
		expect(ok).toContain('Nf6');
		expect(ok).toContain('h6');
		expect(ok).not.toContain('Nge7');
	});

	it('bestEngine ignores the book entirely', () => {
		// A rarity that is the best move here is the ANSWER in this mode, which is
		// exactly why it is not a rung on the repertoire ladder.
		const rare = classifyBook(AFTER_BC4, {
			losses: new Map([
				['h7h6', 0],
				['g8f6', 120],
				['f8c5', 150],
			]),
		});
		const ok = acceptable(rare, 'bestEngine').map((m) => m.san);
		expect(ok).toContain('h6');
		expect(ok).not.toContain('Nf6');
	});

	it('narrows monotonically down the ladder', () => {
		// The rungs have to be a real ordering. Two of the three used to accept an
		// identical set, which is how a setting comes to look like a choice and
		// behave like one option.
		const best = acceptable(moves, 'bestBook').length;
		const sound = acceptable(moves, 'bookSound').length;
		const free = acceptable(moves, 'free').length;
		expect(best).toBeLessThanOrEqual(sound);
		expect(sound).toBeLessThanOrEqual(free);
		expect(best).toBeLessThan(free);
	});

	it('says what is unusual about a sound rarity, and nothing about theory', () => {
		// The deviation report is what lets `bestEngine` exist without breaking
		// repertoire training: leaving the book is always named, at every rung.
		const rare = moves.find((m) => m.san === 'h6')!;
		const main = moves.find((m) => m.san === 'Nf6')!;
		expect(describeChoice(rare)).toMatch(/off the beaten track/i);
		expect(describeChoice(main)).toBeNull();
	});

	it('never accepts a blunder, at any strictness', () => {
		for (const s of ['bestBook', 'bookSound', 'free', 'bestEngine'] as const) {
			expect(acceptable(moves, s).map((m) => m.san), s).not.toContain('Nge7');
		}
	});

	it('never leaves a position with no answer at all', () => {
		// Everything rare: a rung that asks for "played" would otherwise accept
		// nothing and mark every legal move wrong, which is a settings bug
		// presented as a lesson.
		const thin = classifyBook(data([{ uci: 'a2a3', san: 'a3', pct: 100 }]), {});
		for (const s of ['bestBook', 'bookSound', 'free', 'bestEngine'] as const) {
			expect(acceptable(thin, s).length, s).toBeGreaterThan(0);
		}
	});

	it('cannot be strict about a position nobody has scored', () => {
		// `cpLoss` is null until something pays for a search. Rejecting then would
		// mark the reader wrong for playing the right move because the engine had
		// not answered yet.
		const unscored = classifyBook(AFTER_BC4, {});
		expect(acceptable(unscored, 'bestBook').length).toBeGreaterThan(1);
	});
});

describe('opponentBook and punishable', () => {
	const moves = classifyBook(AFTER_BC4, { losses: new Map([['g8e7', 300]]) });

	it('offers the opponent real theory to continue with', () => {
		const ok = opponentBook(moves).map((m) => m.san).sort();
		expect(ok).toEqual(['Bc5', 'Be7', 'Nf6', 'd6']);
	});

	it('offers blunders that are actually played as punishment drills', () => {
		expect(punishable(moves).map((m) => m.san)).toEqual(['Nge7']);
	});

	it('does not offer a blunder nobody plays', () => {
		const rare = classifyBook(
			data([
				{ uci: 'g8f6', san: 'Nf6', pct: 99.9 },
				{ uci: 'h7h5', san: 'h5', pct: 0.1 },
			]),
			{ losses: new Map([['h7h5', 400]]) },
		);
		expect(punishable(rare)).toEqual([]);
	});
});

describe('root confinement', () => {
	const root = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];

	it('counts a path on the way to the root as inside it', () => {
		expect(withinRoot([], root)).toBe(true);
		expect(withinRoot(['e4', 'e5'], root)).toBe(true);
	});

	it('counts anything below the root as inside it', () => {
		expect(withinRoot([...root, 'Nf6', 'Ng5'], root)).toBe(true);
	});

	it('rejects a path that left the root', () => {
		expect(withinRoot(['e4', 'c5'], root)).toBe(false);
		expect(withinRoot(['d4'], root)).toBe(false);
	});

	it('treats no root as everything allowed', () => {
		expect(withinRoot(['d4', 'f5'], null)).toBe(true);
		expect(withinRoot(['d4'], [])).toBe(true);
	});

	it('names the move that heads towards the root, and stops once inside', () => {
		const rs = [{ path: root }];
		expect(movesTowardRoots([], rs)).toEqual(['e4']);
		expect(movesTowardRoots(['e4', 'e5'], rs)).toEqual(['Nf3']);
		expect(movesTowardRoots(root, rs)).toEqual([]);
		expect(movesTowardRoots([...root, 'Nf6'], rs)).toEqual([]);
	});

	it('demands nothing once the path has left the root', () => {
		expect(movesTowardRoots(['d4'], [{ path: root }])).toEqual([]);
	});
});

describe('several pinned openings', () => {
	const scotch = { path: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] };
	const italian = { path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] };
	const sicilian = { path: ['e4', 'c5'] };
	const all = [scotch, italian, sicilian];

	it('is inside the filter if inside ANY of them', () => {
		expect(withinAnyRoot(['e4', 'c5', 'Nf3'], all)).toBe(true);
		expect(withinAnyRoot([...italian.path, 'Nf6'], all)).toBe(true);
		expect(withinAnyRoot(['d4'], all)).toBe(false);
	});

	it('narrows as moves are played', () => {
		expect(liveRoots(['e4'], all).length).toBe(3);
		expect(liveRoots(['e4', 'e5'], all).length).toBe(2);
		expect(liveRoots(['e4', 'c5'], all).length).toBe(1);
	});

	it('offers every move that still heads towards something pinned', () => {
		// After 1.e4 both replies lead somewhere pinned; both must be accepted.
		expect(movesTowardRoots(['e4'], all).sort()).toEqual(['c5', 'e5']);
		// After 3 plies the Scotch and Italian still diverge one move later.
		expect(movesTowardRoots(['e4', 'e5', 'Nf3', 'Nc6'], all).sort()).toEqual(['Bc4', 'd4']);
	});

	it('never forces a single move when two roots diverge here', () => {
		// Forcing one arbitrarily would silently drop the other from the session.
		expect(movesTowardRoots(['e4'], all).length).toBe(2);
	});

	it('treats an empty pin list as no filter at all', () => {
		expect(withinAnyRoot(['d4', 'f5'], [])).toBe(true);
		expect(movesTowardRoots(['d4'], [])).toEqual([]);
	});
});

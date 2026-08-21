import { describe, it, expect } from 'vitest';
import {
	classifyBook,
	isTheory,
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

	it('repertoire accepts exactly one move', () => {
		const ok = acceptable(moves, 'repertoire');
		expect(ok.length).toBe(1);
		expect(ok[0].san).toBe('Nf6');
	});

	it('book accepts every sound move, popular or not', () => {
		// The policy this replaced required a frequency bar, which meant a SOUND
		// move could be marked wrong for being unpopular — training you to
		// reproduce common moves rather than good ones. Soundness decides right
		// and wrong; frequency decides what is worth saying about a move.
		const ok = acceptable(moves, 'book').map((m) => m.san);
		expect(ok).toContain('Nf6'); // theory
		expect(ok).toContain('h6'); // sound, rare — accepted now
		expect(ok).not.toContain('Nge7'); // unsound, still refused
	});

	it('still distinguishes theory from merely sound, without punishing either', () => {
		// The distinction survives; it just stopped being a gate.
		const theory = acceptable(moves, 'book').filter(isTheory).map((m) => m.san).sort();
		expect(theory).toEqual(['Bc5', 'Be7', 'Nf6', 'd6']);
	});

	it('says what is unusual about a sound rarity, and nothing about theory', () => {
		const rare = moves.find((m) => m.san === 'h6')!;
		const main = moves.find((m) => m.san === 'Nf6')!;
		expect(describeChoice(rare)).toMatch(/off the beaten track/i);
		expect(describeChoice(main)).toBeNull();
	});

	it('free accepts anything that is not unsound, however rare', () => {
		const ok = acceptable(moves, 'free').map((m) => m.san);
		expect(ok).toContain('h6');
		expect(ok).not.toContain('Nge7');
	});

	it('never accepts a blunder, at any strictness', () => {
		for (const s of ['repertoire', 'book', 'free'] as const) {
			expect(acceptable(moves, s).map((m) => m.san)).not.toContain('Nge7');
		}
	});

	it('never leaves a position with no answer at all', () => {
		// Everything rare: 'book' would otherwise accept nothing and mark every
		// legal move wrong, which is a settings bug presented as a lesson.
		const thin = classifyBook(data([{ uci: 'a2a3', san: 'a3', pct: 100 }]), {});
		for (const s of ['repertoire', 'book', 'free'] as const) {
			expect(acceptable(thin, s).length).toBeGreaterThan(0);
		}
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

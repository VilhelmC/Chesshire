import { describe, it, expect } from 'vitest';
import { findMistakes, DECIDED_CP, type PositionEval } from '../src/engine/analyseGame';
import { winPercent } from '../src/domain/accuracy';
import type { ImportedGame } from '../src/data/games';
import { applySan, sideToMove, INITIAL_FEN } from '../src/domain/chess';

/**
 * A stub engine driven by a per-ply script.
 *
 * The real engine is a Worker and cannot run here, so findMistakes takes the
 * analyser as an option. The stub is keyed by position index rather than FEN so
 * a test can say "the position after three plies is worth -200" without writing
 * FENs out by hand.
 */
function stubEngine(game: string[], scores: Record<number, number>, best = 'g1f3') {
	const fens: string[] = [INITIAL_FEN];
	let fen = INITIAL_FEN;
	for (const san of game) {
		fen = applySan(fen, san).fen;
		fens.push(fen);
	}
	const calls: string[] = [];
	const analyse = async (f: string): Promise<PositionEval | null> => {
		calls.push(f);
		const i = fens.indexOf(f);
		return { cpWhite: scores[i] ?? 0, bestUci: best };
	};
	return { analyse, calls, fens };
}

function game(moves: string[], extra: Partial<ImportedGame> = {}): ImportedGame {
	return {
		id: 'test:1',
		platform: 'lichess',
		url: 'https://lichess.org/test',
		playedAt: 0,
		speed: 'blitz',
		ourColour: 'w',
		opponent: 'someone',
		result: 'loss',
		moves,
		...extra,
	};
}

describe('findMistakes', () => {
	const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];

	it('flags a move that drops the evaluation, and only our moves', () => {
		// Ply 4 is White's third move (index 4). Say it costs 300cp.
		const { analyse } = stubEngine(MOVES, { 0: 20, 1: 20, 2: 20, 3: 20, 4: 20, 5: -280, 6: -280 });
		return findMistakes(game(MOVES), { analyse }).then(({ mistakes: out }) => {
			expect(out.length).toBe(1);
			expect(out[0].ply).toBe(4);
			expect(out[0].playedSan).toBe('Bc4');
			expect(out[0].loss).toBe(300);
			// Black's moves are not our flashcards even though the drop at ply 5
			// looks identical from the other side.
			expect(out.every((m) => sideToMove(m.fen) === 'w')).toBe(true);
		});
	});

	it('measures losses from our side when we are Black', async () => {
		// Same numbers, but now the fall from White's point of view is a GAIN for us.
		const { analyse } = stubEngine(MOVES, { 0: 20, 1: 20, 2: 20, 3: 20, 4: 20, 5: -280, 6: -280 });
		const { mistakes: out } = await findMistakes(game(MOVES, { ourColour: 'b' }), { analyse });
		// Ply 5 (Bc5, Black's third) went from -280 to -280 our-POV = +280 → no loss.
		expect(out.length).toBe(0);
	});

	it('ignores positions that were already decided', async () => {
		const big = DECIDED_CP + 200;
		const { analyse } = stubEngine(MOVES, { 4: big, 5: big - 400 });
		const { mistakes: out } = await findMistakes(game(MOVES), { analyse });
		expect(out).toEqual([]);
	});

	it('ignores drops smaller than the threshold', async () => {
		const { analyse } = stubEngine(MOVES, { 4: 20, 5: -60 });
		const { mistakes: out } = await findMistakes(game(MOVES), { analyse, minLoss: 150 });
		expect(out).toEqual([]);
		const { mistakes: out2 } = await findMistakes(game(MOVES), { analyse, minLoss: 50 });
		expect(out2.length).toBe(1);
	});

	it('does not flag a move the engine itself would have played', async () => {
		// Best move at ply 2 is Nf3 — which is what was played, so any apparent
		// loss there is measurement noise rather than a mistake.
		const { analyse } = stubEngine(MOVES, { 2: 300, 3: 0 }, 'g1f3');
		const { mistakes: out } = await findMistakes(game(MOVES), { analyse });
		expect(out.find((m) => m.ply === 2)).toBeUndefined();
	});

	it('uses site evaluations when they are there, without searching', async () => {
		// evals[i] is the position AFTER ply i, White's point of view.
		const evals: (number | null)[] = new Array(MOVES.length).fill(20);
		evals[4] = -280; // after our Bc4
		const { analyse, calls } = stubEngine(MOVES, {});
		const { mistakes: out } = await findMistakes(game(MOVES, { evals }), { analyse });

		expect(out.length).toBe(1);
		expect(out[0].ply).toBe(4);
		expect(out[0].source).toBe('site');
		// Exactly two searches: the start position (no site eval for ply -1) and
		// the one lookup for a move to ask for.
		expect(calls.length).toBeLessThanOrEqual(2);
	});

	it('reports progress and stops when cancelled', async () => {
		const { analyse } = stubEngine(MOVES, {});
		const seen: number[] = [];
		let n = 0;
		await findMistakes(game(MOVES), {
			analyse,
			onProgress: (done) => seen.push(done),
			shouldCancel: () => ++n > 2,
		});
		expect(seen.length).toBeLessThan(3);
	});

	it('survives a game whose moves stop being legal', async () => {
		const { analyse } = stubEngine(['e4', 'e5'], {});
		const { mistakes: out } = await findMistakes(game(['e4', 'e5', 'Qz9']), { analyse });
		expect(out).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// Coverage. The bug this guards against shipped: the engine failed to load,
	// every position was silently skipped, and the import reported "0 cards
	// from 20 games" — a statement about the user's play, made by a program
	// that had measured nothing.
	// -----------------------------------------------------------------------

	it('counts the positions it actually measured', async () => {
		const { analyse } = stubEngine(MOVES, { 4: 20, 5: -280 });
		const r = await findMistakes(game(MOVES), { analyse });
		expect(r.measured).toBeGreaterThan(0);
		expect(r.unmeasured).toBe(0);
	});

	it('counts positions it could not evaluate rather than swallowing them', async () => {
		const r = await findMistakes(game(MOVES), {
			analyse: async () => {
				throw new Error('Engine failed to load from /engine/stockfish.js');
			},
		});
		expect(r.mistakes).toEqual([]);
		expect(r.measured).toBe(0);
		// An empty mistake list with zero measured positions is the signature of
		// a dead engine, and must be distinguishable from a clean game.
		expect(r.unmeasured).toBeGreaterThan(0);
	});

	it('separates a clean game from an unmeasurable one', async () => {
		const { analyse } = stubEngine(MOVES, {});
		const clean = await findMistakes(game(MOVES), { analyse });
		const dead = await findMistakes(game(MOVES), {
			analyse: async () => {
				throw new Error('no engine');
			},
		});
		expect(clean.mistakes).toEqual(dead.mistakes); // both empty...
		expect(clean.measured).toBeGreaterThan(0); // ...but not the same thing
		expect(dead.measured).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// The threshold is a win-percentage drop, not a centipawn one.
//
// This is the substantive change, and it is not a tuning tweak: the two rules
// disagree about which moves deserve a card, in opposite directions at the two
// ends of the scale.
// ---------------------------------------------------------------------------

describe('what counts as a mistake', () => {
	const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'];

	it('ignores a large centipawn swing that changes nothing', async () => {
		// +700 to +400 is 300 centipawns — twice the old threshold — and barely
		// moves the likely outcome. Under the old rule this produced a card
		// teaching you to play more accurately in a position you had already won.
		expect(winPercent(700) - winPercent(400)).toBeLessThan(20);
		const { analyse } = stubEngine(MOVES, { 4: 700, 5: 400 });
		const { mistakes } = await findMistakes(game(MOVES), { analyse });
		expect(mistakes).toEqual([]);
	});

	it('catches a swing across equality', async () => {
		const { analyse } = stubEngine(MOVES, { 4: 120, 5: -160 });
		const { mistakes } = await findMistakes(game(MOVES), { analyse });
		expect(mistakes.length).toBe(1);
		expect(mistakes[0].ply).toBe(4);
	});

	it('still skips positions already decided', async () => {
		const big = DECIDED_CP + 200;
		const { analyse } = stubEngine(MOVES, { 4: big, 5: big - 600 });
		const { mistakes } = await findMistakes(game(MOVES), { analyse });
		expect(mistakes).toEqual([]);
	});

	it('is stricter than the old rule near equality and looser when winning', async () => {
		// The same 300cp swing, in two places on the scale. The old centipawn
		// rule could not tell these apart; that was the defect.
		const nearLevel = winPercent(150) - winPercent(-150);
		const whenWinning = winPercent(700) - winPercent(400);
		expect(nearLevel).toBeGreaterThan(whenWinning);
	});
});

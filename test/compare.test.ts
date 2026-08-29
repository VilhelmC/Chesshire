// `scoreMoves` — the logic around the engine, with the engine stubbed.
//
// The engine-level claims are measured elsewhere against a real Stockfish in
// Node: `scripts/m0-exactness.mjs` (one search per move is exact, a multi-move
// call is not) and `scripts/m1-gate.mjs` (every move comes back, scores are
// independent of the set, eight moves inside 800ms).
//
// What is testable HERE is everything that could corrupt what the engine said on
// its way to the caller: the point-of-view conversion, the loss anchoring, the
// deduplication, and the handling of moves that are not legal. Each of those has
// a way of being quietly wrong that no engine measurement would catch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const analysePosition = vi.fn();
vi.mock('../src/data/cloudEval', () => ({
	analysePosition: (...a: unknown[]) => analysePosition(...a),
	toColourPov: (cpWhite: number, colour: 'w' | 'b') => (colour === 'w' ? cpWhite : -cpWhite),
}));

const { scoreMoves, bestOf, mateIn } = await import('../src/engine/compare');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Black to move, so the point-of-view conversion has something to do. */
const BLACK = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

/** Answer with a fixed score per restricted move, White's point of view. */
function stub(byMove: Record<string, number>, best = 'e2e4') {
	analysePosition.mockImplementation(
		async (_fen: string, _d: number, _pv: number, _mt: number | undefined, searchMoves?: string[]) => {
			if (!searchMoves?.length) return { pvs: [{ cpWhite: 0, pv: [best] }] };
			const uci = searchMoves[0];
			if (!(uci in byMove)) return { pvs: [] };
			return { pvs: [{ cpWhite: byMove[uci], pv: [uci, 'e7e5'] }] };
		},
	);
}

beforeEach(() => analysePosition.mockReset());

describe('scoreMoves', () => {
	it('scores each move with its OWN restricted search', () => {
		stub({ e2e4: 40, d2d4: 30, a2a3: -20 });
		return scoreMoves(START, ['e2e4', 'd2d4', 'a2a3'], { includeBest: false }).then((r) => {
			// One call per move — the finding this module exists to honour. A single
			// multi-move call reverses the verdict on ~4% of pairs.
			const restricted = analysePosition.mock.calls.filter((c) => c[4]?.length);
			expect(restricted).toHaveLength(3);
			for (const c of restricted) expect(c[4]).toHaveLength(1);
			expect(r.map((x) => x.uci)).toEqual(['e2e4', 'd2d4', 'a2a3']);
		});
	});

	it('ranks best first and measures loss against the best in the set', async () => {
		stub({ e2e4: 40, d2d4: 30, a2a3: -20 });
		const r = await scoreMoves(START, ['a2a3', 'e2e4', 'd2d4'], { includeBest: false });
		expect(r.map((x) => x.uci)).toEqual(['e2e4', 'd2d4', 'a2a3']);
		expect(r.map((x) => x.loss)).toEqual([0, -10, -60]);
	});

	it('anchors loss on the position’s BEST move, not the best of a bad set', async () => {
		// Two mistakes compared against each other would report the lesser one as
		// `loss: 0`, which reads as "this is fine". Including the engine's own
		// choice — scored the same restricted way, so it lands on the same scale —
		// is what stops that.
		stub({ b1a3: -80, g1h3: -120, e2e4: 40 }, 'e2e4');
		const r = await scoreMoves(START, ['b1a3', 'g1h3']);
		expect(r.map((x) => x.uci)).toEqual(['e2e4', 'b1a3', 'g1h3']);
		expect(r.find((x) => x.uci === 'b1a3')!.loss).toBe(-120);
	});

	it('turns the score to the MOVER’s point of view', async () => {
		// The engine speaks side-to-move; `cloudEval` stores White's. Getting this
		// backwards flips every verdict for one colour and nothing for the other,
		// which is the kind of bug that survives a whole test suite.
		stub({ e7e5: -30, d7d5: -50 }, 'e7e5');
		const r = await scoreMoves(BLACK, ['e7e5', 'd7d5'], { includeBest: false });
		// −30 for White is +30 for Black, and Black is to move.
		expect(r.find((x) => x.uci === 'e7e5')!.cp).toBe(30);
		expect(r.find((x) => x.uci === 'd7d5')!.cp).toBe(50);
		// And so d7d5 is the better move HERE, despite the lower White-relative score.
		expect(r[0].uci).toBe('d7d5');
	});

	it('drops a move the engine will not score rather than inventing one', async () => {
		stub({ e2e4: 40 });
		const r = await scoreMoves(START, ['e2e4', 'd2d4'], { includeBest: false });
		expect(r.map((x) => x.uci)).toEqual(['e2e4']);
	});

	it('drops an illegal move without asking the engine about it', async () => {
		stub({ e2e4: 40 });
		const r = await scoreMoves(START, ['e2e4', 'e2e9'], { includeBest: false });
		expect(r.map((x) => x.uci)).toEqual(['e2e4']);
		// The engine was never troubled with it.
		expect(analysePosition.mock.calls.some((c) => c[4]?.[0] === 'e2e9')).toBe(false);
	});

	it('asks about a repeated move once', async () => {
		stub({ e2e4: 40 });
		await scoreMoves(START, ['e2e4', 'e2e4', 'e2e4'], { includeBest: false });
		expect(analysePosition.mock.calls.filter((c) => c[4]?.length)).toHaveLength(1);
	});

	it('names moves in standard notation', async () => {
		stub({ e2e4: 40, g1f3: 20 });
		const r = await scoreMoves(START, ['e2e4', 'g1f3'], { includeBest: false });
		expect(r.map((x) => x.san).sort()).toEqual(['Nf3', 'e4']);
	});
});

describe('bestOf', () => {
	it('asks an UNRESTRICTED question, so the cloud can answer it', async () => {
		stub({}, 'd2d4');
		expect(await bestOf(START)).toBe('d2d4');
		// No `searchmoves`: a restricted search can never hit the cloud cache, and
		// this probe only needs the move, never its score.
		expect(analysePosition.mock.calls[0][4]).toBeUndefined();
	});
});

describe('mateIn', () => {
	it('inverts the mapping stockfish.ts uses', () => {
		// `parseInfo` folds mate into ±(10000 − plies·10). These two must stay in
		// step; the numbers below are that formula, written out.
		expect(mateIn(10000 - 1 * 10)).toBe(1);
		expect(mateIn(10000 - 3 * 10)).toBe(3);
		expect(mateIn(-10000 - -2 * 10)).toBe(-2);
	});

	it('says nothing about an ordinary score', () => {
		expect(mateIn(0)).toBeNull();
		expect(mateIn(850)).toBeNull();
		expect(mateIn(-8999)).toBeNull();
	});
});

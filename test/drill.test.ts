import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExplorerResponse } from '../src/domain/types';

// ---------------------------------------------------------------------------
// The bug these tests exist for:
//
// The trainer sampled any move that was not the one in our chosen line and
// presented it as a deviation to "punish". 1.e4 e5 2.Nf3 Nf6 is the Petroff —
// established theory, not a mistake. "Non-book" was the wrong concept: we were
// still in book, just not the book we picked.
//
// Note that the explorer's ECO name cannot be the filter either. Damiano's
// Defence (2...f6) is named theory and IS a blunder. The filter is evaluation.
// ---------------------------------------------------------------------------

const fetchExplorer = vi.fn<(fen: string) => Promise<ExplorerResponse>>();
const analysePosition = vi.fn<(fen: string) => Promise<unknown>>();

vi.mock('../src/data/explorer', () => ({ fetchExplorer: (f: string) => fetchExplorer(f) }));
vi.mock('../src/data/cloudEval', () => ({
	analysePosition: (f: string) => analysePosition(f),
	toColourPov: (cp: number, c: 'w' | 'b') => (c === 'w' ? cp : -cp),
}));

const { makeDrill } = await import('../src/engine/drill');
const { playSanLine, applyUci } = await import('../src/domain/chess');

const LINE = {
	id: 'test',
	name: 'Test line',
	colour: 'w' as const,
	moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6',
};

function mv(uci: string, san: string, games: number) {
	return { uci, san, white: games / 2, draws: 0, black: games / 2 };
}

/** Evaluations keyed by the position's board field, in White centipawns. */
const EVALS: Record<string, number> = {};
function boardOf(fen: string) {
	return fen.split(' ')[0];
}
function setEval(fen: string, cpWhite: number, pv = 'g1f3') {
	EVALS[boardOf(fen)] = cpWhite;
	PVS[boardOf(fen)] = pv;
}
const PVS: Record<string, string> = {};

beforeEach(() => {
	fetchExplorer.mockReset();
	analysePosition.mockReset();
	for (const k of Object.keys(EVALS)) delete EVALS[k];

	analysePosition.mockImplementation(async (fen: string) => ({
		fen,
		depth: 30,
		source: 'cloud',
		pvs: [{ cpWhite: EVALS[boardOf(fen)] ?? 20, pv: [PVS[boardOf(fen)] ?? legalMove(fen)] }],
	}));
});

/** Any legal move, so the drill builder always has something to return. */
function legalMove(fen: string): string {
	for (const cand of ['g1f3', 'b1c3', 'd2d4', 'e1g1', 'f3e5', 'a2a3', 'h2h3', 'd2d3']) {
		try {
			applyUci(fen, cand);
			return cand;
		} catch {
			/* try next */
		}
	}
	return 'a2a3';
}

describe('deviation selection', () => {
	it('never offers a sound alternative as a mistake to punish', async () => {
		const after1e4 = playSanLine('1. e4').fen;
		const petroff = playSanLine('1. e4 e5 2. Nf3 Nf6').fen;

		fetchExplorer.mockImplementation(async (fen: string) => {
			if (boardOf(fen) === boardOf(playSanLine('1. e4 e5 2. Nf3').fen)) {
				return {
					white: 0,
					draws: 0,
					black: 0,
					// Nc6 is our line; Nf6 (Petroff) is the only alternative and is sound.
					moves: [mv('b8c6', 'Nc6', 7000), mv('g8f6', 'Nf6', 3000)],
				};
			}
			return { white: 0, draws: 0, black: 0, moves: [] };
		});

		// Baseline +20, and the Petroff leaves it at +25 — not a mistake.
		setEval(playSanLine('1. e4 e5 2. Nf3').fen, 20);
		setEval(petroff, 25);
		setEval(after1e4, 20);

		const drill = await makeDrill(LINE, { deviationChance: 1, rng: () => 0.5 });
		// No mistake was available anywhere, so it must fall back to a book drill
		// rather than presenting the Petroff as something to refute.
		expect(drill.kind).toBe('book');
	});

	it('offers a move that really is a mistake', async () => {
		const damiano = playSanLine('1. e4 e5 2. Nf3 f6').fen;

		fetchExplorer.mockImplementation(async (fen: string) => {
			if (boardOf(fen) === boardOf(playSanLine('1. e4 e5 2. Nf3').fen)) {
				return {
					white: 0,
					draws: 0,
					black: 0,
					moves: [mv('b8c6', 'Nc6', 7000), mv('f7f6', 'f6', 2000)],
				};
			}
			return { white: 0, draws: 0, black: 0, moves: [] };
		});

		setEval(playSanLine('1. e4 e5 2. Nf3').fen, 18);
		setEval(damiano, 162, 'f3e5'); // Damiano: +1.62, refuted by Nxe5

		const drill = await makeDrill(LINE, { deviationChance: 1, rng: () => 0.5 });
		expect(drill.kind).toBe('deviation');
		expect(drill.trigger!.san).toBe('f6');
		expect(drill.severity).toBe('blunder');
		expect(drill.answer.san).toBe('Nxe5');
	});

	it('prefers a blunder over a mere inaccuracy at the same position', async () => {
		fetchExplorer.mockImplementation(async (fen: string) => {
			if (boardOf(fen) === boardOf(playSanLine('1. e4 e5 2. Nf3').fen)) {
				return {
					white: 0,
					draws: 0,
					black: 0,
					moves: [
						mv('b8c6', 'Nc6', 7000),
						mv('d7d6', 'd6', 4000), // slightly loose, and much more common
						mv('f7f6', 'f6', 500), // outright bad, and rare
					],
				};
			}
			return { white: 0, draws: 0, black: 0, moves: [] };
		});

		setEval(playSanLine('1. e4 e5 2. Nf3').fen, 18);
		setEval(playSanLine('1. e4 e5 2. Nf3 d6').fen, 95); // +77 — inaccuracy
		setEval(playSanLine('1. e4 e5 2. Nf3 f6').fen, 162, 'f3e5'); // +144 — blunder

		const drill = await makeDrill(LINE, { deviationChance: 1, rng: () => 0.5 });
		// Frequency alone would pick d6 eight times out of nine.
		expect(drill.trigger!.san).toBe('f6');
		expect(drill.severity).toBe('blunder');
	});

	it('reports the move the deviation replaced', async () => {
		fetchExplorer.mockImplementation(async (fen: string) => {
			if (boardOf(fen) === boardOf(playSanLine('1. e4 e5 2. Nf3').fen)) {
				return {
					white: 0,
					draws: 0,
					black: 0,
					moves: [mv('b8c6', 'Nc6', 7000), mv('f7f6', 'f6', 2000)],
				};
			}
			return { white: 0, draws: 0, black: 0, moves: [] };
		});
		setEval(playSanLine('1. e4 e5 2. Nf3').fen, 18);
		setEval(playSanLine('1. e4 e5 2. Nf3 f6').fen, 162, 'f3e5');

		const drill = await makeDrill(LINE, { deviationChance: 1, rng: () => 0.5 });
		expect(drill.trigger!.insteadOf).toBe('Nc6');
	});
});

describe('book drills', () => {
	it('asks for our own move from the line', async () => {
		fetchExplorer.mockResolvedValue({ white: 0, draws: 0, black: 0, moves: [] });
		const drill = await makeDrill(LINE, { deviationChance: 0, rng: () => 0 });
		expect(drill.kind).toBe('book');
		expect(drill.ourColour).toBe('w');
		// The very first of our moves in this line.
		expect(drill.answer.san).toBe('e4');
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExplorerResponse } from '../src/domain/types';
import { playSanLine } from '../src/domain/chess';

// The explorer module is mocked wholesale, which also keeps Dexie (and its
// IndexedDB dependency) out of the node test environment.
const fetchExplorer = vi.fn<(fen: string) => Promise<ExplorerResponse>>();
vi.mock('../src/data/explorer', () => ({ fetchExplorer: (fen: string) => fetchExplorer(fen) }));
// Past the seed line our moves are chosen by evaluating popular candidates.
vi.mock('../src/data/cloudEval', () => ({
	analysePosition: async () => ({ fen: '', depth: 20, source: 'local', pvs: [{ cpWhite: 20, pv: ['a2a3'] }] }),
	toColourPov: (cp: number, c: 'w' | 'b') => (c === 'w' ? cp : -cp),
}));

const { buildRepertoire } = await import('../src/domain/repertoire');

/** Build an explorer response from [san/uci, games] pairs. */
function resp(moves: [string, string, number][]): ExplorerResponse {
	return {
		white: 0,
		draws: 0,
		black: 0,
		moves: moves.map(([uci, san, games]) => ({
			uci,
			san,
			// split so scoreForSideToMove is a round number: half wins, half losses
			white: Math.round(games / 2),
			draws: 0,
			black: games - Math.round(games / 2),
		})),
	};
}

const AFTER_E4 = resp([
	['e7e5', 'e5', 6000],
	['c7c5', 'c5', 3000],
	['e7e6', 'e6', 1000],
]);

const AFTER_NF3 = resp([
	['b8c6', 'Nc6', 7000],
	['g8f6', 'Nf6', 2000],
	['d7d6', 'd6', 1000],
]);

const AFTER_BC4 = resp([
	['g8f6', 'Nf6', 5000],
	['f8c5', 'Bc5', 4000],
	['c6d4', 'Nd4', 1000],
]);

// Keyed by FEN so the tree can branch and revisit in any order.
const BY_FEN: Record<string, ExplorerResponse> = {};
function keyOf(fen: string) {
	return fen.split(' ').slice(0, 4).join(' ');
}

beforeEach(() => {
	fetchExplorer.mockReset();
	for (const k of Object.keys(BY_FEN)) delete BY_FEN[k];

	BY_FEN[keyOf(playSanLine('1. e4').fen)] = AFTER_E4;
	BY_FEN[keyOf(playSanLine('1. e4 e5 2. Nf3').fen)] = AFTER_NF3;
	BY_FEN[keyOf(playSanLine('1. e4 e5 2. Nf3 Nc6 3. Bc4').fen)] = AFTER_BC4;

	// Unknown positions return an empty book, which stops expansion there.
	fetchExplorer.mockImplementation(async (fen: string) =>
		BY_FEN[keyOf(fen)] ?? { white: 0, draws: 0, black: 0, moves: [] },
	);
});

const SPEC = { id: 'italian', colour: 'w' as const, line: '1. e4 e5 2. Nf3 Nc6 3. Bc4' };

describe('buildRepertoire', () => {
	it('records every reply as a drill candidate, not just the unexpanded ones', async () => {
		const r = await buildRepertoire(SPEC);
		// 1...e5 is both the most popular reply AND expanded. It must still appear
		// as a candidate: in the real tree 5...Nxd5 is common and near-losing, and
		// selecting candidates by "what we did not expand" would hide it.
		const e5 = r.deviations.find((d) => d.san === 'e5');
		expect(e5).toBeDefined();
		expect(e5!.expanded).toBe(true);
	});

	it('marks which replies the tree continued through', async () => {
		const r = await buildRepertoire(SPEC);
		const expanded = r.deviations.filter((d) => d.expanded);
		expect(expanded.length).toBeGreaterThan(0);
		// Expansion follows popularity.
		expect(expanded.every((d) => d.frequency >= 0.1)).toBe(true);
	});

	it('multiplies frequencies down the trunk', async () => {
		const r = await buildRepertoire(SPEC);
		// 0.6 (e5) * 0.7 (Nc6) — the Bc4 node is the end of the line and must not
		// reduce the mass further.
		expect(r.trunkSurvivalMass).toBeCloseTo(0.42, 6);
	});

	it('does not zero the trunk at the end of the seed line', async () => {
		const r = await buildRepertoire(SPEC);
		expect(r.trunkSurvivalMass).toBeCloseTo(0.42, 6);
	});

	it('records replies at every ply of the tree, not only the seed line', async () => {
		const r = await buildRepertoire(SPEC);
		const plies = new Set(r.deviations.map((d) => d.ply));
		// A five-ply linear walk only ever saw plies 1, 3 and 5 — which is why the
		// first live sweep found almost nothing worth drilling.
		expect(plies.has(1)).toBe(true);
		expect(plies.has(3)).toBe(true);
		expect(plies.has(5)).toBe(true);
	});

	it('weights deviation mass by the chance of reaching its node', async () => {
		const r = await buildRepertoire(SPEC);
		const byName = (n: string, ply: number) =>
			r.deviations.find((d) => d.san === n && d.ply === ply)!;

		// 1...c5 is reached with probability 1 -> mass = its own frequency
		expect(byName('c5', 1).mass).toBeCloseTo(0.3, 6);
		// 2...Nf6 needs 1...e5 first -> 0.6 * 0.2
		expect(byName('Nf6', 3).mass).toBeCloseTo(0.12, 6);
		// 3...Nd4 needs e5 and Nc6 -> 0.6 * 0.7 * 0.1
		expect(byName('Nd4', 5).mass).toBeCloseTo(0.042, 6);
	});

	it('reports early-deviation mass as the complement of trunk survival', async () => {
		const r = await buildRepertoire(SPEC);
		expect(r.earlyDeviationMass).toBeCloseTo(1 - r.trunkSurvivalMass, 6);
	});

	it('accounts for every unit of probability at the first opponent node', async () => {
		const r = await buildRepertoire(SPEC);
		const ply1 = [...r.deviations, ...r.dropped].filter((d) => d.ply === 1);
		// Nothing may be silently lost at a node: the replies must sum to its mass.
		expect(ply1.reduce((s, d) => s + d.mass, 0)).toBeCloseTo(1, 6);
	});

	it('records the position after the deviation, not before', async () => {
		const r = await buildRepertoire(SPEC);
		const c5 = r.deviations.find((d) => d.san === 'c5')!;
		expect(c5.fen).toContain('rnbqkbnr/pp1ppppp/8/2p5/4P3');
		expect(c5.path).toEqual(['e4']);
	});

	it('warns when the explorer sample is too small to trust', async () => {
		fetchExplorer.mockReset();
		fetchExplorer.mockResolvedValue(resp([['e7e5', 'e5', 10]]));

		const r = await buildRepertoire(SPEC);
		expect(r.warnings.some((w) => w.includes('Sparse data'))).toBe(true);
	});

	it('survives an explorer failure without throwing', async () => {
		fetchExplorer.mockReset();
		fetchExplorer.mockRejectedValue(new Error('401 no token'));

		const r = await buildRepertoire(SPEC);
		expect(r.warnings[0]).toContain('401 no token');
		expect(r.deviations).toEqual([]);
	});

	it('marks a failed build incomplete so the UI cannot report flattering numbers', async () => {
		fetchExplorer.mockReset();
		fetchExplorer.mockRejectedValue(new Error('401 no token'));

		const r = await buildRepertoire(SPEC);
		expect(r.complete).toBe(false);
		// Nothing was measured, so the derived numbers are meaningless and must
		// never reach the UI.
		expect(r.earlyDeviationMass).toBe(0);
	});

	it('marks a fully-queried build complete', async () => {
		const r = await buildRepertoire(SPEC);
		expect(r.complete).toBe(true);
	});

	it('stops at the ply limit', async () => {
		const r = await buildRepertoire(SPEC, { maxPlies: 3 });
		expect(r.stats.maxPly).toBeLessThanOrEqual(3);
	});

	it('respects the node cap', async () => {
		const r = await buildRepertoire(SPEC, { maxNodes: 4 });
		expect(r.stats.nodes).toBeLessThanOrEqual(4);
	});
});

// Couplings — where the exchanges stop adding up.
//
// ---------------------------------------------------------------------------
// PLAN.md M5. §6 as amended by AMEND-6-TWO-CONDITIONS.md.
//
// Every value here was read off scripts/couple-read.mjs first (rule 4), and the
// definitions were counted at corpus scale before the module existed (rule 5):
// scripts/couple-census.mjs showed §6.1's four kinds fire on up to 92.7% of
// plies as MECHANISMS, and scripts/couple-unified.mjs showed the two conditions
// land at 41.3% of solver plies with at most 8 pairs in one position.
//
// scripts/couple-agree.mjs then checked couple.ts against an independent
// transcription of the same definition over 712 positions: 100% agreement. The
// property tests below are the part of that check that runs every time.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { seeValue, other } from '../src/domain/exchange';
import { chains, couplings, resolve, parity, competesForTempo, weight, say, squaresOf, overloaded } from '../src/domain/couple';
import type { Coupling } from '../src/domain/couple';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as Square;
const commitments = (cs: Coupling[]) => cs.filter((c): c is Extract<Coupling, { kind: 'commitment' }> => c.kind === 'commitment');
const resolutions = (cs: Coupling[]) => cs.filter((c): c is Extract<Coupling, { kind: 'resolution' }> => c.kind === 'resolution');

describe("§6.1's claim, tested rather than assumed", () => {
	// "If two exchange chains share no piece, no line and no tempo, their values
	// add and there is no tree at all." Two rooks facing two rooks down the a and
	// h files: four chains, and nothing couples to anything.
	it('finds no branch point when the chains are islands', () => {
		const board = at('r6r/8/4k3/8/8/8/8/RR3KRR w - - 0 1').board;
		expect(chains(board)).toHaveLength(4);
		expect(couplings(board)).toEqual([]);
	});

	it('finds no chains at all on an empty board', () => {
		const board = at('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board;
		expect(chains(board)).toEqual([]);
		expect(couplings(board)).toEqual([]);
	});
});

describe('commitment — the piece that cannot be in two places', () => {
	// A king holding two pawns a knight attacks. Both are held WHILE IT STAYS,
	// which is the whole point: measuring overloads on chains that are already
	// losing found 1.7% and would have hidden every real one, since a defended
	// square has SEE <= 0 by construction.
	const FEN = '4k3/8/8/8/2n5/8/1P1P4/2K5 b - - 0 1';

	it('names the piece, what it holds, and what leaving costs', () => {
		const board = at(FEN).board;
		const cs = commitments(couplings(board));
		expect(cs).toHaveLength(1);
		expect(makeSquare(cs[0].piece)).toBe('c1');
		expect(cs[0].holds.map(makeSquare)).toEqual(['b2', 'd2']);
		expect(cs[0].cost).toBe(200);
		expect(cs[0].mechanism).toBe('contestedDefender');
	});

	it('is invisible to the resolution test, which is why it is a second condition', () => {
		const board = at(FEN).board;
		// Neither exchange runs — SEE declines both — so resolving either changes
		// nothing anywhere, and a single test keyed on resolution finds no
		// coupling here at all.
		for (const c of chains(board)) {
			expect(c.value).toBe(0);
			expect(resolve(board, c).occupied).toEqual(board.occupied);
		}
		expect(resolutions(couplings(board))).toEqual([]);
	});

	it('reads as a sentence about the coupling, per §6.6', () => {
		const board = at(FEN).board;
		expect(say(couplings(board)[0], board)).toBe('the king on c1 cannot hold b2 and d2 at once — 200');
	});

	it('ranks the pieces doing two jobs', () => {
		const board = at(FEN).board;
		const top = overloaded(board);
		expect(top).toHaveLength(1);
		expect(makeSquare(top[0].piece)).toBe('c1');
	});
});

describe('resolution — one chain running changes another', () => {
	// Uqazm, the puzzle §6's absence made unreadable. After 1...Bd7-e8 the black
	// bishop both defends c6 and attacks f7, so the f7 exchange consumes it and
	// c6 goes from held to loose. That is the x-ray shape arriving through a
	// participant rather than through a line.
	// Derived by PLAYING the puzzle's first move rather than transcribed. My
	// hand-written FENs have been wrong six times in this project, twice in this
	// file alone, and a wrong FEN in a golden test is a confident assertion about
	// a position that does not exist.
	const POS = (() => {
		const p = at('r2q2k1/p1pb1Rpp/2p5/3pr1PQ/3N4/2P5/P1P3PP/R5K1 b - - 0 16').clone();
		p.play({ from: sq('d7'), to: sq('e8') });
		return p;
	})();

	it('finds the coupling Uqazm turns on', () => {
		const cs = couplings(POS.board);
		const r = resolutions(cs).find((c) => makeSquare(c.to) === 'c6');
		expect(r, 'no coupling onto c6').toBeDefined();
		expect(makeSquare(r!.from)).toBe('f7');
		expect([r!.was, r!.becomes]).toEqual([0, 100]);
		expect(r!.mechanism).toBe('contestedDefender');
	});

	// The other half of the same position, and the reason PLAN.md's done-when
	// names h7: the king on g8 is holding both g7 and h7, which is what makes a
	// sacrifice there arrive.
	it('finds the king holding g7 and h7 at once', () => {
		const c = commitments(couplings(POS.board)).find((x) => makeSquare(x.piece) === 'g8');
		expect(c, 'g8 not reported as overloaded').toBeDefined();
		expect(c!.holds.map(makeSquare)).toEqual(['g7', 'h7']);
		expect(c!.cost).toBe(200);
	});
});

describe('harvest parity stays outside the index, as §6.1 said it would', () => {
	// "It is a parity, not a piece or a square, so an index keyed on occupancy
	// alone will miss it." So it is arithmetic on lengths the exchange already
	// returned, and a declined exchange spends no tempo and competes for none.
	it('reads parity off the chain length', () => {
		const p = at('r2q2k1/p1pb1Rpp/2p5/3pr1PQ/3N4/2P5/P1P3PP/R5K1 b - - 0 16').clone();
		p.play({ from: sq('d7'), to: sq('e8') });
		const board = p.board;
		for (const c of chains(board)) expect(parity(c)).toBe((c.length % 2) as 0 | 1);
	});

	it('does not let a declined exchange compete for a tempo', () => {
		const board = at('4k3/8/8/8/2n5/8/1P1P4/2K5 b - - 0 1').board;
		const cs = chains(board);
		expect(cs.every((c) => c.length === 0)).toBe(true);
		for (const a of cs) for (const b of cs) expect(competesForTempo(a, b)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The properties, over positions nobody picked. The commitment condition is
// re-derived inline here from the amendment's statement — an independent
// implementation, which is the check that has actually found bugs in this
// project rather than the one that feels thorough.
// ---------------------------------------------------------------------------
describe('the conditions hold on positions nobody picked', () => {
	const walk = (n: number) => {
		const out: ReturnType<typeof at>[] = [];
		const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		let pos = at(START);
		let seed = 20260826;
		const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
		for (let i = 0; i < n; i++) {
			const moves: { from: Square; to: Square }[] = [];
			for (const from of pos.board[pos.turn]) for (const to of pos.dests(from)) moves.push({ from, to: to as Square });
			if (!moves.length) { pos = at(START); continue; }
			const mv = moves[rnd(moves.length)];
			const pr = pos.board.get(mv.from)?.role === 'pawn' && (mv.to >> 3 === 0 || mv.to >> 3 === 7);
			pos = pos.clone();
			pos.play(pr ? { ...mv, promotion: 'queen' } : mv);
			out.push(pos);
		}
		return out;
	};
	const CASES = walk(250);

	it('reports a commitment only where the counterfactual really bites', () => {
		for (const pos of CASES) {
			for (const c of commitments(couplings(pos.board))) {
				const gone = pos.board.clone();
				gone.take(c.piece);
				expect(c.holds.length).toBeGreaterThanOrEqual(2);
				for (const s of c.holds) {
					const owner = pos.board.get(s)!.color;
					// Held while it stays...
					expect(seeValue(pos.board, s, other(owner)), `${makeSquare(s)} was already lost`).toBeLessThanOrEqual(0);
					// ...and lost when it goes. Both halves, or it is not an overload.
					expect(seeValue(gone, s, other(owner)), `${makeSquare(s)} survives without ${makeSquare(c.piece)}`).toBeGreaterThan(0);
				}
			}
		}
	});

	it('reports a resolution only where the value actually moved', () => {
		for (const pos of CASES) {
			for (const c of resolutions(couplings(pos.board))) {
				expect(c.was).not.toBe(c.becomes);
				const target = pos.board.get(c.to);
				expect(target, 'coupled onto an empty square').toBeDefined();
				const after = resolve(pos.board, chains(pos.board).find((x) => x.square === c.from)!);
				expect(seeValue(after, c.to, other(target!.color))).toBe(c.becomes);
			}
		}
	});

	// A declined exchange is the case the second condition exists for, so it had
	// better really change nothing.
	it('leaves the board untouched when the exchange is declined', () => {
		for (const pos of CASES) {
			for (const c of chains(pos.board)) {
				if (c.length !== 0) continue;
				expect(resolve(pos.board, c).occupied, `${makeSquare(c.square)} moved something`).toEqual(pos.board.occupied);
			}
		}
	});

	// Resolving a chain is an occupancy edit over its own participants. If it
	// touches anything else it is not bookkeeping, it is a replay.
	it('only ever edits the squares its own chain is about', () => {
		for (const pos of CASES) {
			for (const c of chains(pos.board)) {
				const after = resolve(pos.board, c);
				const allowed = new Set<Square>([c.square, ...c.attackers, ...c.defenders]);
				for (let s = 0 as Square; s < 64; s = (s + 1) as Square) {
					if (allowed.has(s)) continue;
					expect(after.get(s), `${makeSquare(s)} changed`).toEqual(pos.board.get(s));
				}
			}
		}
	});

	it('is a function of the board and nothing else', () => {
		for (const pos of CASES.slice(0, 80)) {
			const a = couplings(pos.board);
			const b = couplings(pos.board);
			expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		}
	});

	it('needs two chains before it can couple anything', () => {
		for (const pos of CASES) {
			if (chains(pos.board).length >= 2) continue;
			expect(couplings(pos.board)).toEqual([]);
		}
	});

	it('weighs every coupling at something worth branching on', () => {
		for (const pos of CASES) {
			for (const c of couplings(pos.board)) {
				expect(weight(c)).toBeGreaterThan(0);
				for (const s of squaresOf(c)) expect(s).toBeGreaterThanOrEqual(0);
			}
		}
	});

	// §6.2: depth is the number of couplings and branching is the arity of each,
	// BOTH KNOWN BEFORE the computation begins. That is only a useful claim if
	// the number is small, so the number is asserted rather than hoped for.
	it('stays small enough to branch on', () => {
		let worst = 0;
		let seen = 0;
		for (const pos of CASES) {
			const n = couplings(pos.board).length;
			worst = Math.max(worst, n);
			if (n) seen++;
		}
		expect(worst, `${worst} couplings in one position is not a tree`).toBeLessThanOrEqual(16);
		// And it must fire sometimes, or every property above is vacuous — the
		// unreachable-branch failure that filed 170 blind plies as ties.
		expect(seen).toBeGreaterThan(0);
	});
});

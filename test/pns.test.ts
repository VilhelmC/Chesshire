// The proof engine, tested WITHOUT chess.
//
// `pns.ts` is domain-free, so its tests are too. The M1 gate runs it against the
// mate corpus and that is a strong check — but it checks the engine AND the
// adapter together, and a bug in one can hide behind the other. It did: the
// refutation flag was inverted, and 334 proved mates said nothing about it,
// because the caller wrote `if (proved) ... else if (refuted)` and never asked
// for a negative. So the negatives are asked for here, on trees small enough to
// verify by reading.
//
// ---------------------------------------------------------------------------
// PARITY IS THE TRAP, and the first version of this file fell into it.
//
// Verdicts are MOVER-RELATIVE — 'moverWins' means whoever is to move at that
// node achieves their own goal. So a terminal's meaning flips with the ply it
// sits on, and a test tree written without counting plies asserts the opposite
// of what it looks like it asserts. Three tests here "failed" against a correct
// engine for exactly that reason.
//
// Depth exhaustion is the same trap in permanent form: running out of plies is a
// FAILURE for the attacker and a SUCCESS for the defender. It is the one verdict
// that is not symmetric, and it is why `Verdict` is mover-relative rather than
// win/loss. The harness below models it the way the chess adapter has to.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { solve, INF, type Problem, type Verdict } from '../src/domain/pns';

/**
 * A game as a literal: what follows what, and who has already won where.
 *
 * The attacker moves at the root and the mover alternates every ply, so whose
 * turn it is at a node is `(maxDepth - depthLeft)` being even.
 */
function game(tree: Record<string, string[]>, ends: Record<string, Verdict>, maxDepth: number): Problem<string> {
	const attackerToMove = (depthLeft: number) => (maxDepth - depthLeft) % 2 === 0;
	return {
		key: (s) => s,
		children: (s) => tree[s] ?? [],
		terminal: (s, depthLeft) =>
			ends[s] ?? (depthLeft <= 0 ? (attackerToMove(depthLeft) ? 'moverLoses' : 'moverWins') : null),
	};
}

describe('the proof engine', () => {
	it('proves a goal one move away', () => {
		// root (attacker) -> a, where the mover — the opponent — has already lost.
		const p = game({ root: ['a', 'b'] }, { a: 'moverLoses', b: 'moverWins' }, 1);
		const r = solve(p, 'root', 1);
		expect(r.proved).toBe(true);
		expect(r.refuted).toBe(false);
		expect(r.line).toEqual(['root', 'a']);
	});

	it('REFUTES a goal that is not there, rather than shrugging', () => {
		// Every child is a success for the opponent. This is the half alpha-beta
		// cannot do, and the reason for using proof numbers at all.
		const p = game({ root: ['a', 'b'] }, { a: 'moverWins', b: 'moverWins' }, 1);
		const r = solve(p, 'root', 1);
		expect(r.proved).toBe(false);
		expect(r.refuted).toBe(true);
	});

	it('never reports proved and refuted at once', () => {
		// The inverted flag was invisible precisely because callers test `proved`
		// first. Both branches of every resolved problem are asserted here.
		for (const ends of [
			{ a: 'moverLoses' as const, b: 'moverWins' as const },
			{ a: 'moverWins' as const, b: 'moverWins' as const },
		]) {
			const r = solve(game({ root: ['a', 'b'] }, ends, 1), 'root', 1);
			expect(r.proved && r.refuted).toBe(false);
			expect(r.proved || r.refuted).toBe(true);
		}
	});

	it('requires EVERY reply to be answered at an AND node', () => {
		// root(A) -> m, where B chooses x or y, and A finishes from either. The
		// verdicts sit at ply 3, where B is to move — one ply deeper than they look.
		const tree = { root: ['m'], m: ['x', 'y'], x: ['px'], y: ['py'] };
		const both = game(tree, { px: 'moverLoses', py: 'moverLoses' }, 3);
		expect(solve(both, 'root', 3).proved).toBe(true);

		// One reply that survives is enough to refute the whole thing.
		const one = game(tree, { px: 'moverLoses', py: 'moverWins' }, 3);
		const r = solve(one, 'root', 3);
		expect(r.proved).toBe(false);
		expect(r.refuted).toBe(true);
	});

	it('respects the depth bound', () => {
		const tree = { root: ['m'], m: ['n'], n: ['win'] };
		const ends = { win: 'moverLoses' as const };
		expect(solve(game(tree, ends, 3), 'root', 3).proved).toBe(true);
		// Asked for one ply, the same position must be REFUTED — not "unknown",
		// and not proved by running out of depth, which is the defender's success.
		expect(solve(game(tree, ends, 1), 'root', 1).refuted).toBe(true);
	});

	it('gives the principal variation, not just a verdict', () => {
		const tree = { root: ['dud', 'good'], good: ['forced'], forced: ['mate'], dud: [] };
		const p = game(tree, { dud: 'moverWins', mate: 'moverLoses' }, 3);
		const r = solve(p, 'root', 3);
		expect(r.proved).toBe(true);
		expect(r.line).toEqual(['root', 'good', 'forced', 'mate']);
	});

	it('treats a node with no children and no verdict as a refutation, not a crash', () => {
		// A domain that forgets to classify a leaf gets a definite answer rather
		// than an invented one. Refusing beats guessing.
		const p: Problem<string> = { key: (s) => s, children: () => [], terminal: () => null };
		expect(() => solve(p, 'root', 2)).not.toThrow();
		expect(solve(p, 'root', 2).proved).toBe(false);
	});

	it('is not fooled by a transposition — the same state at the same depth is one node', () => {
		// a and b both lead to the same c. Expanded once, it should be reused.
		const p = game({ root: ['a', 'b'], a: ['c'], b: ['c'], c: ['win'] }, { win: 'moverLoses' }, 5);
		const r = solve(p, 'root', 5);
		expect(r.proved).toBe(true);
		expect(r.nodes).toBeLessThanOrEqual(4);
	});

	it('honours the node limit by saying it does not know', () => {
		const wide: Record<string, string[]> = {};
		for (let i = 0; i < 200; i++) wide[`n${i}`] = [`n${i * 2 + 1}`, `n${i * 2 + 2}`];
		const r = solve(game(wide, {}, 12), 'n0', 12, 5);
		expect(r.proved).toBe(false);
		expect(r.refuted).toBe(false);
	});

	it('names WITNESSES in `via` — sound, and not promised to be complete', () => {
		// THE CONTRACT, AND THE BUG IT IS HERE TO STOP.
		//
		// `via` was documented as "every child through which the mover achieves
		// their goal", and a caller counted it. The engine is depth-first: it stops
		// as soon as `phi(root)` crosses its threshold, which takes ONE child. Every
		// other child keeps its `init` numbers and is indistinguishable from a child
		// that loses. In `ladder.ts` the count read 1 where the truth was 29.
		//
		// So what may be relied on is SOUNDNESS — everything named really does
		// achieve — and not completeness. Both halves are asserted, because a later
		// engine that returns all of them must not fail this test either.
		const tree: Record<string, string[]> = { root: [] };
		for (const c of ['a', 'b', 'c', 'd', 'e']) {
			tree.root.push(c);
			// Each child needs EXPANDING before it resolves: a losing grandchild is
			// what makes the child a win for the root's mover, and only the child the
			// search actually walks gets a table entry.
			tree[c] = [`${c}1`];
		}
		// At a grandchild the ROOT'S MOVER is on turn again, so 'moverWins' there is
		// what makes the child in between a loss for the opponent — the verdicts are
		// mover-relative and flip with ply parity, which is what made three of this
		// file's earlier tests wrong.
		const ends: Record<string, Verdict> = {
			a1: 'moverWins',
			b1: 'moverWins',
			c1: 'moverWins',
			d1: 'moverWins',
			e1: 'moverWins',
		};
		const p = game(tree, ends, 4);
		const r = solve(p, 'root', 4);
		expect(r.proved).toBe(true);
		expect(r.via.length).toBeGreaterThan(0);
		// Sound: each named child is one the root's mover really wins through.
		for (const c of r.via) expect(solve(p, c, 3).refuted).toBe(true);
		// And a lower bound: five children qualify, and the search need not say so.
		expect(r.via.length).toBeLessThanOrEqual(5);
	});

	it('keeps INF finite enough to sum without overflowing', () => {
		// delta is a SUM over children. With INF at Number.MAX_SAFE_INTEGER, a node
		// with two refuted children would overflow into nonsense.
		expect(INF * 64).toBeLessThan(Number.MAX_SAFE_INTEGER);
	});
});

// The exchange complex — one object, both sides, no roles.
//
// ---------------------------------------------------------------------------
// §1 and §9 as corrected by AMEND-0-SYMMETRIC.md.
//
// Will: "there is no attacker-defender. We are playing a symmetric game. There
// is only a player whose turn it is and the current position."
//
// The refactor is proved meaning-preserving before anything is built on it:
// `obligations(board)` must equal `ledger(pos,'white') ∪ ledger(pos,'black')`,
// row for row. `scripts/complex-equiv.mjs` checks that on 712 corpus positions
// (712 identical); the property below checks it on positions nobody picked.
//
// The last test in this file is a mechanical guard rather than a behaviour, and
// it is the one that would have caught this five milestones ago.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { V, other } from '../src/domain/exchange';
import { ledger } from '../src/domain/ledger2';
import { obligations, complex, fingerprint, material, isLive, isMateWeight, owedBy, worstFor, type Obligation } from '../src/domain/complex';

const at = (fen: string) => positionFromFen(fen);
/**
 * MATE IS COMPARED AS "MATE", not as its number.
 *
 * `ledger2` writes `Infinity` for a king row; this build writes `MATE - k·STEP`
 * so that a mate in one can outrank a mate in three, which `Infinity` cannot
 * express. That is a deliberate change of what the weight MEANS, made after the
 * refactor, and this test is about the refactor — one build instead of two halves.
 * Comparing the two representations digit for digit would say nothing about
 * either, exactly as `cluster: false` is used in `gamma.test.ts` to hold §6's
 * re-pricing out of the same comparison.
 */
const weightKey = (w: number) => (isMateWeight(w) || !Number.isFinite(w) ? 'mate' : String(w));

const key = (r: Obligation) =>
	`${makeSquare(r.square)}|${r.from !== undefined ? makeSquare(r.from) : '-'}|${r.role}|${weightKey(r.weight)}|${r.deadline}|${r.claimant}|${r.kind}|${[...r.needs].sort().join('.')}|${[...r.enablers].sort().join('.')}`;

const walk = (n: number) => {
	const out: ReturnType<typeof at>[] = [];
	const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let pos = at(START);
	let seed = 90210;
	const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
	for (let i = 0; i < n; i++) {
		const moves: { from: Square; to: Square }[] = [];
		for (const f of pos.board[pos.turn]) for (const t of pos.dests(f)) moves.push({ from: f, to: t as Square });
		if (!moves.length) { pos = at(START); continue; }
		const mv = moves[rnd(moves.length)];
		const pr = pos.board.get(mv.from)?.role === 'pawn' && (mv.to >> 3 === 0 || mv.to >> 3 === 7);
		pos = pos.clone();
		pos.play(pr ? { ...mv, promotion: 'queen' } : mv);
		out.push(pos);
	}
	return out;
};
const CASES = walk(200);

describe('one build, not two halves', () => {
	// The whole refactor, asserted rather than assumed. If this ever fails, the
	// symmetric build has changed what the rows MEAN and not merely where they
	// come from.
	//
	// It held at 712/712 corpus positions, and it holds here.
	//
	it('contains exactly what the two role-parameter calls produced', () => {
		for (const pos of CASES) {
			const old = [...ledger(pos, 'white'), ...ledger(pos, 'black')].map(key).sort();
			const now = obligations(pos.board).map(key).sort();
			expect(now, `divergence on ${pos.turn} to move`).toEqual(old);
		}
	});

	it("reads one side's share off the one list, rather than rebuilding it", () => {
		for (const pos of CASES.slice(0, 60)) {
			const c = complex(pos);
			for (const side of ['white', 'black'] as Color[]) {
				const mine = owedBy(c, side);
				for (const o of mine) expect(o.claimant).toBe(other(side));
				// The two readings partition the whole list, with nothing left over.
				expect(owedBy(c, 'white').length + owedBy(c, 'black').length).toBe(c.obligations.length);
			}
		}
	});

	it('gives the same rows whoever is to move', () => {
		// Turn is a property of the NODE, not of the rows. Building the same board
		// with the other side to move must not change a single obligation — the
		// thing `tauStar` existed to paper over.
		for (const pos of CASES.slice(0, 60)) {
			const a = obligations(pos.board).map(key).sort();
			expect(obligations(pos.board).map(key).sort()).toEqual(a);
		}
	});
});

describe('the value has a fixed reference', () => {
	// One number, not two. §9's minimax maximises it for White and minimises it
	// for Black, which is only expressible because the reference does not move
	// with whose turn it is.
	it("counts material from White's side, positive when White is ahead", () => {
		expect(material(at('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').board)).toBe(V.rook);
		expect(material(at('r3k3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBe(-V.rook);
		expect(material(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1').board)).toBe(0);
	});

	it('leaves the kings out, since V[king] is infinite and would swamp it', () => {
		expect(Number.isFinite(material(at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board))).toBe(true);
		expect(material(at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').board)).toBe(0);
	});
});

describe('the fingerprint is the quotient', () => {
	// §9: "two positions with the same complex are the same state." So this is
	// what decides whether two moves are genuinely equivalent or the computation
	// is simply not seeing the difference — a hard test rather than a judgement.
	it('is stable for the same position', () => {
		for (const pos of CASES.slice(0, 40)) expect(fingerprint(complex(pos))).toBe(fingerprint(complex(pos)));
	});

	it('separates the same board with the other side to move', () => {
		// The one asymmetry the system has, and it must be in the identity.
		const w = at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');
		const b = at('4k3/8/8/4r3/8/8/8/4RK2 b - - 0 1');
		expect(fingerprint(complex(w))).not.toBe(fingerprint(complex(b)));
	});

	it('separates positions whose obligations differ', () => {
		const seen = new Map<string, string>();
		let collisions = 0;
		for (const pos of CASES) {
			const f = fingerprint(complex(pos));
			const fen = pos.board.occupied.toString() + pos.turn;
			const had = seen.get(f);
			if (had !== undefined && had !== fen) collisions++;
			seen.set(f, fen);
		}
		// Collisions are legal — that is what a quotient IS — but they must be
		// rare enough that the identity is doing work rather than erasing it.
		expect(collisions).toBeLessThan(CASES.length / 4);
	});
});

describe('what was deleted stays deleted', () => {
	// `confidence = 0.944^(τ-1)` was a PROBABILITY, and everything here is
	// deterministic: a deadline is met or it is not. It existed because distances
	// were computed on a frozen board and drift — a statistical patch over a
	// computation that was not being done, the same class of error as the
	// tie-break that preceded this amendment.
	it('carries no confidence discount', () => {
		for (const pos of CASES.slice(0, 40)) {
			for (const o of obligations(pos.board)) {
				expect(o, 'the discount came back').not.toHaveProperty('confidence');
				expect(Number.isInteger(o.weight) || !Number.isFinite(o.weight), `${o.weight} is not a whole SEE`).toBe(true);
			}
		}
	});

	// The mechanical guard, and the one that would have caught this five
	// milestones ago. A QUERY may name a side — "which of side's pieces bear
	// here" is a fact. A CONSTRUCTOR may not, because a side parameter on a
	// constructor builds half a complex and forces the other half to be
	// reassembled by subtraction.
	it('exports no constructor that takes a side', () => {
		const src = readFileSync(join(process.cwd(), 'src/domain/complex.ts'), 'utf8');
		const code = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
			.join('\n');
		for (const banned of [/\bowed\s*:\s*Color/, /\btaker\s*:\s*Color/, /\battacker\s*:\s*Color/, /\bclaimant\s*:\s*Color\s*\)/]) {
			expect(code, `a role parameter is back: ${banned}`).not.toMatch(banned);
		}
		// `claimant` as a FIELD is right and must stay — it is a fact about the
		// row, not a switch on what gets built.
		expect(code).toMatch(/claimant:\s*Color;/);
	});
});

describe('the complex holds the whole state', () => {
	// `couplings` used to be a field here and nothing but the overlay read it.
	// §6's decomposition lives in `cluster.ts` now and works off sites; the field
	// was the last trace of a version where the complex carried branch points it
	// never consulted, and it cost 18 ms a ply to keep.
	it('carries the board and the turn alongside the rows', () => {
		for (const pos of CASES.slice(0, 40)) {
			const c = complex(pos);
			expect(c.turn).toBe(pos.turn);
			expect(c.board).toBe(pos.board);
		}
	});

	it('reports the worst live debt against a side, and zero when there is none', () => {
		const c = complex(at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1'));
		expect(worstFor(c, 'black')).toBe(V.rook);
		expect(worstFor(complex(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1')), 'white')).toBe(0);
	});

	it('is ordered the same way every time', () => {
		for (const pos of CASES.slice(0, 40)) {
			const a = obligations(pos.board).map(key);
			const b = obligations(pos.board).map(key);
			expect(a).toEqual(b);
			for (let i = 1; i < a.length; i++) {
				const rows = obligations(pos.board);
				expect(rows[i - 1].weight >= rows[i].weight, 'row order is not stable').toBe(true);
			}
		}
	});

	it('never files a row on an empty square unless it is a promotion', () => {
		for (const pos of CASES) {
			for (const o of obligations(pos.board)) {
				if (pos.board.get(o.square)) continue;
				expect(o.kind, `${makeSquare(o.square)} is empty`).toBe('promotion');
			}
		}
	});

	it('agrees with isLive on both triggers', () => {
		for (const pos of CASES.slice(0, 60)) {
			for (const o of obligations(pos.board)) {
				const blocked = o.needs.filter((s) => pos.board.occupied.has(s));
				const unfilled = o.enablers.filter((s) => !pos.board.occupied.has(s));
				expect(isLive(o, pos.board)).toBe(blocked.length === 0 && unfilled.length === 0);
			}
		}
	});
});

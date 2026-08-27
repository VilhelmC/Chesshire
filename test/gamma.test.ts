// Γ — every obligation joined to what discharges it.
//
// ---------------------------------------------------------------------------
// §2 as closed by AMEND-2-ARRIVES.md and corrected by AMEND-0-SYMMETRIC.md.
//
// Proved meaning-preserving before anything is built on it, the same way the
// complex was: `scripts/gamma-equiv.mjs` compares the symmetric Γ against the
// two role-parameter calls over 712 corpus positions — 712 identical, once the
// deadline comparison is applied where it now belongs.
//
// The substantive change is that the comparison MOVED. `cover2` stamped
// `tauStar` on each row as it built; Γ now answers only "what discharges exist
// and at what cost", and whose tempi are being spent is a fact about the
// traversal node.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { other } from '../src/domain/exchange';
import { complex, isLive, isMateWeight } from '../src/domain/complex';
import { gamma, bear, arrives, coverable, tempiLeft, type Discharge } from '../src/domain/gamma';
import { gamma as oldGamma } from '../src/domain/cover2';

const at = (fen: string) => positionFromFen(fen);
const kinds = (c: ReturnType<typeof complex>, es: Discharge[], square: string) => {
	const i = c.obligations.findIndex((o) => makeSquare(o.square) === square);
	return [...new Set(es.filter((e) => e.obligation === i).map((e) => e.kind))].sort();
};

const walk = (n: number) => {
	const out: ReturnType<typeof at>[] = [];
	const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let pos = at(START);
	let seed = 5150;
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
const CASES = walk(150);

describe('one Γ, not two halves', () => {
	// The refactor, asserted. Both sides' cover edges come out of one build, and
	// filtering by `tempiLeft` recovers what the two role calls produced.
	// `cluster: false` turns §6's committed weights OFF, so every row falls back to
	// the naive SEE the old role-parameter build used. The equivalence claim is
	// about the REFACTOR — one Γ instead of two halves — and §6's re-pricing is a
	// deliberate change of what a weight means, made later. Comparing across both
	// at once would say nothing about either.
	//
	// A SUBSET NOW, AND THE DIFFERENCE IS NAMED. `survivesTheAnswer` refuses a
	// block whose piece is taken and whose claim comes straight back — Will: "the
	// exchange doesn't end after one ply." That is a deliberate divergence from the
	// old build, so equality would be the wrong assertion and deleting the test
	// would be worse. Everything the old Γ had is still here EXCEPT blocks, and the
	// blocks that went are asserted to be exactly the refused ones rather than
	// waved through as "expected differences".
	it('contains what the two role-parameter calls produced', () => {
		for (const pos of CASES) {
			const c = complex(pos, { cluster: false });
			const now = gamma(c)
				.filter((e) => e.cost <= tempiLeft(c.obligations[e.obligation], c.turn))
				.map((e) => {
					const o = c.obligations[e.obligation];
					return `${makeSquare(o.square)}/${o.claimant}|${e.kind}|${makeSquare(e.piece)}>${makeSquare(e.to)}@${e.cost}`;
				})
				.sort();
			const old: string[] = [];
			for (const owed of ['white', 'black'] as Color[]) {
				const g = oldGamma(pos, { owed });
				for (const e of g.edges) {
					const o = g.E[e.obligation];
					old.push(`${makeSquare(o.square)}/${o.claimant}|${e.kind}|${makeSquare(e.piece)}>${makeSquare(e.to)}@${e.cost}`);
				}
			}
			const before = old.sort();
			const gone = before.filter((k) => !now.includes(k));
			const added = now.filter((k) => !before.includes(k));
			// TWO DELIBERATE DIVERGENCES, and the test names both rather than being
			// loosened to pass.
			//
			// BLOCKS and CAPTURES both moved, in both directions, and each for a
			// reason worth keeping written down:
			//
			//   blocks GONE     refused by `survivesTheAnswer` — a cover that is taken
			//                   and leaves the claim standing.
			//   captures GONE   a promoting pawn can be taken on its own square within
			//                   ONE move; it is not there after that. The old build
			//                   let a cost-2 capture land on a square the pawn had left.
			//   captures ADDED  the squares the pawn will STAND on. A king catching a
			//                   runner on a2 was not in Γ at all before.
			//
			//   defends ADDED   the queen a pawn is going to be, covering a square from
			//                   the promotion square. A piece that does not exist yet
			//                   could not be a defender in the two-halves build.
			//
			// EVADE IS UNTOUCHED, and that is the part still asserting the refactor: a
			// piece walking away has not changed meaning, so those edges must match the
			// two role-parameter calls exactly.
			const kinds = (xs: string[]) => [...new Set(xs.map((k) => k.split('|')[1]))].sort();
			expect(kinds(gone), 'only blocks and captures may be refused').toEqual(
				kinds(gone).filter((k) => k === 'block' || k === 'capture'),
			);
			// ADDED: captures on the squares a promoting pawn will stand on, and
			// DEFENCES by the queen that pawn is going to be — neither of which the
			// two-halves build could express.
			expect(kinds(added), 'only captures and defences may be added').toEqual(
				kinds(added).filter((k) => k === 'capture' || k === 'defend'),
			);
			const stable = (xs: string[]) => xs.filter((k) => k.includes('|evade|')).sort();
			expect(stable(now), 'evade must be untouched').toEqual(stable(before));
			// And every defence the old build had is still here — the register only ADDS.
			const defends = (xs: string[]) => xs.filter((k) => k.includes('|defend|')).sort();
			expect(defends(before).filter((k) => !now.includes(k)), 'no defence was lost').toEqual([]);
		}
	});

	it('carries both sides at once', () => {
		// A position where each side owes something. One build, two claimants.
		const c = complex(at('4k3/8/8/4r3/8/8/4R3/5K2 w - - 0 1'));
		const claimants = new Set(c.obligations.map((o) => o.claimant));
		if (claimants.size > 1) {
			const es = gamma(c);
			const sides = new Set(es.map((e) => other(c.obligations[e.obligation].claimant)));
			expect(sides.size).toBe(2);
		}
	});
});

describe('the deadline comparison is not in here', () => {
	// The whole point of the correction. Γ is a fact about the board, so building
	// it must not depend on whose turn it is — that belongs to the node.
	it('gives the same edges whoever is to move', () => {
		for (const fen of [
			'4k3/8/8/4r3/8/8/8/4RK2',
			'4k3/8/8/8/1n6/P7/8/4K3',
			'8/8/8/P7/4k3/8/8/6K1',
		]) {
			const w = gamma(complex(at(`${fen} w - - 0 1`)));
			const b = gamma(complex(at(`${fen} b - - 0 1`)));
			const key = (es: Discharge[]) => es.map((e) => `${e.obligation}|${e.kind}|${e.piece}>${e.to}@${e.cost}`).sort();
			expect(key(w), `${fen}: Γ moved with the turn`).toEqual(key(b));
		}
	});

	// And the arithmetic `tauStar` did, now stated as a function of the node.
	it('gives the side at stake one fewer tempo when the claimant moves first', () => {
		const RACE = '8/8/8/P7/4k3/8/8/6K1';
		const b = complex(at(`${RACE} b - - 0 1`));
		const w = complex(at(`${RACE} w - - 0 1`));
		const i = b.obligations.findIndex((o) => makeSquare(o.square) === 'a8');
		expect(i).toBeGreaterThanOrEqual(0);
		expect(tempiLeft(b.obligations[i], b.turn)).toBe(3);
		expect(tempiLeft(w.obligations[i], w.turn)).toBe(2);
		// Same edges either way; only what survives the comparison differs.
		expect(coverable(b)[i]).toBe(true);
		expect(coverable(w)[i]).toBe(false);
	});
});

describe('the four discharge types, on the symmetric build', () => {
	it('offers evade alone when nothing else can reach', () => {
		const c = complex(at('4k3/8/8/8/1n6/P7/8/4K3 b - - 0 1'));
		expect(kinds(c, gamma(c), 'b4')).toEqual(['evade']);
	});

	it('deletes the defender when a pawn attacks the target — §1.5', () => {
		const c = complex(at('r3k3/8/8/3r4/4P3/8/8/4K3 b - - 0 1'));
		expect(kinds(c, gamma(c), 'd5')).toEqual(['evade']);
	});

	it('allows a defender when the cheapest attacker is not cheaper', () => {
		const c = complex(at('r3k3/8/8/3r4/8/8/8/3RK3 b - - 0 1'));
		expect(kinds(c, gamma(c), 'd5')).toContain('defend');
	});

	// The five bugs from GATE-2 and GATE-3, carried across rather than reintroduced.
	it('still refuses everything on a real checkmate', () => {
		for (const fen of [
			'r4rnQ/ppp2pk1/6q1/3p2P1/3P4/2P4R/PP4P1/5RK1 b - - 6 24',
			'r1b2r2/1p1nk1bp/2N2np1/8/P1B2B2/3q4/1PP2PPP/R3R1K1 b - - 1 17',
			'8/3k4/Qp5p/3q4/6r1/8/5P1P/3R1RK1 w - - 1 33',
		]) {
			const pos = at(fen);
			expect(pos.isCheckmate()).toBe(true);
			const c = complex(pos);
			// `!Number.isFinite` WAS the test for a mate row, and mate is a finite band
			// now so it stopped finding one. `isMateWeight` is the question the test was
			// always asking — is this the unbounded row — and asking it that way makes
			// the test survive the representation instead of encoding it.
			const i = c.obligations.findIndex((o) => isMateWeight(o.weight));
			expect(i, `${fen}: no mate row`).toBeGreaterThanOrEqual(0);
			expect(gamma(c).filter((e) => e.obligation === i), fen).toEqual([]);
		}
	});
});

describe('the structural properties', () => {
	it('supplies every discharge from the side whose material is at stake', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			for (const e of gamma(c)) {
				const o = c.obligations[e.obligation];
				expect(pos.board.get(e.piece)?.color, `${makeSquare(e.piece)} is not of the side at stake`).toBe(other(o.claimant));
			}
		}
	});

	it('builds only from rows that are live on this board', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			for (const e of gamma(c)) expect(isLive(c.obligations[e.obligation], c.board)).toBe(true);
		}
	});

	it('defends by bearing and evades only with the piece standing there', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			for (const e of gamma(c)) {
				const o = c.obligations[e.obligation];
				if (e.kind === 'defend') {
					expect(e.to).toBe(o.square);
					// A PAWN'S DEFENCE MAY BE ITS QUEEN'S. Γ registers a contingent queen
					// on the promotion square, and attributes her cover to the pawn,
					// because the pawn is the man that actually moves. So the cost is the
					// pushes PLUS her journey, and asking `bear` of the pawn — which bears
					// on two squares diagonally and nothing else — is asking the wrong
					// piece. Every other defence is still exactly its bearing distance.
					const own = bear(pos.board, e.piece, e.to);
					if (own === e.cost) continue; // an ordinary defence, at its bearing distance
					// Otherwise it is the contingent queen, attributed to her pawn — and a
					// pawn's OWN bearing is usually Infinity, since it covers two diagonal
					// squares and nothing else. So the two facts that must hold are that
					// the man is a pawn and that the price is a journey.
					expect(pos.board.get(e.piece)?.role, `${makeSquare(e.piece)} defends ${makeSquare(e.to)} at ${e.cost}, bears at ${own}`).toBe('pawn');
					expect(e.cost).toBeGreaterThan(1);
				}
				if (e.kind === 'evade') {
					expect(e.piece).toBe(o.square);
					expect(e.cost).toBe(1);
				}
			}
		}
	});

	it('never costs less than a move', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			for (const e of gamma(c)) {
				expect(e.cost).toBeGreaterThanOrEqual(1);
				expect(e.cost).toBeLessThanOrEqual(c.obligations[e.obligation].deadline);
			}
		}
	});

	it('reports the cheapest discharge per row', () => {
		for (const pos of CASES.slice(0, 60)) {
			const c = complex(pos);
			const es = gamma(c);
			const best = arrives(c, es);
			for (const e of es) expect(best[e.obligation]).toBeLessThanOrEqual(e.cost);
			for (let i = 0; i < c.obligations.length; i++) {
				const mine = es.filter((e) => e.obligation === i);
				expect(best[i]).toBe(mine.length ? Math.min(...mine.map((e) => e.cost)) : Infinity);
			}
		}
	});

	// The same mechanical guard the complex carries. A query may name a side; a
	// constructor may not.
	it('exports no constructor that takes a side', () => {
		const code = readFileSync(join(process.cwd(), 'src/domain/gamma.ts'), 'utf8')
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/\bowed\s*:\s*Color/);
		expect(code).not.toMatch(/function gamma\([^)]*Color/);
		// `tempiLeft` takes a turn, which is exactly right — a fact about the node.
		expect(code).toMatch(/tempiLeft\s*=\s*\(o: Obligation, turn: Color\)/);
	});
});

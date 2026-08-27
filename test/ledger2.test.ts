// What the ledger owes, and when.
//
// ---------------------------------------------------------------------------
// PLAN.md M3c. Every number below came off scripts/ledgerprobe.mjs before it was
// written down — which caught two real bugs in this file's first version, both
// of which would have read as principled in review.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { reach } from '../src/domain/reach';
import { ledger, worst, isLive, blockedBy } from '../src/domain/ledger2';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as Square;
const read = (fen: string, owed: Color) =>
	ledger(at(fen), owed).map(
		(o) => `${o.kind[0]}:${o.from !== undefined ? makeSquare(o.from) + '->' : ''}${makeSquare(o.square)}=${o.weight}/t${o.deadline}`,
	);

describe('cost-1 rows — what the old ledger already saw', () => {
	it('prices a hanging piece as an exchange, not a piece value', () => {
		expect(read('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1', 'black')).toContain('i:e5=500/t1');
	});

	// No special case anywhere: V[king] = Infinity makes check the debt that must
	// be serviced before any other, straight out of the value assignment.
	it('makes check an infinite debt', () => {
		const pos = at('4k3/8/8/8/8/8/8/4RK2 b - - 0 1');
		const E = ledger(pos, 'black');
		expect(E.some((o) => o.weight === Infinity)).toBe(true);
		expect(worst(E, pos.board)).toBe(Infinity);
	});
});

describe('cost-k rows — the 21.7% the baseline called "nothing happening"', () => {
	// The done-when for M3: an obligation that exists BEFORE the pawn moves.
	it('sees a promotion four moves out', () => {
		expect(read('4k3/8/8/8/P7/8/8/4K3 w - - 0 1', 'black')).toEqual(['p:a4->a8=800/t4']);
	});

	// The gate `race.ts` had, and the reason I nearly shipped it again. Its
	// justification — "the cost-1 pass has that one anyway" — is false here: the
	// cost-1 pass finds captures of pieces that EXIST, and a pawn stepping onto an
	// empty last rank is not one. Gating on d <= 1 made the most urgent promotion
	// in chess invisible.
	it('still sees a promotion one move out', () => {
		expect(read('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', 'black')).toEqual(['p:a7->a8=800/t1']);
	});

	// §1.1, and the rF0aS bug. `V[queen] − V[pawn]` and stop is wrong: the new
	// queen can be taken the moment she lands. Deferring the collection does not
	// defer the recapture.
	it('prices a promotion at the exchange on the square it lands on', () => {
		// a8 is covered by the rook, so queening there is worth nothing and the row
		// disappears. What remains is a LATENT row for a7xb8 — real (an enemy piece
		// arriving on b8 would open it) and not owed, which is the distinction
		// AMEND-1-LATENT-RACE.md turns on.
		const pos = at('4k3/P7/8/8/8/8/8/r3K3 w - - 0 1');
		const E = ledger(pos, 'black');
		expect(E.filter((o) => isLive(o, pos.board))).toEqual([]);
		expect(worst(E, pos.board)).toBe(0);
		const latent = E.find((o) => o.kind === 'promotion');
		expect(latent?.enablers.map(makeSquare)).toContain('b8');
	});

	// A promotion path is not a file. The double step from the seventh is why
	// c7 reaches the first rank in five rather than six.
	it('counts the double step', () => {
		const E = ledger(at('8/p1p5/P2pp2P/1p2p3/3kP3/8/5Kp1/8 b - - 0 1'), 'white');
		const c7 = E.find((o) => o.from === sq('c7'));
		expect(c7?.deadline).toBe(5);
	});

	// A move may not land on the enemy king, even though an attack may BEAR on
	// it. Without that distinction a black pawn walked d6-d5-e4-e3-xf2-f1 to
	// promote in five, capturing the king in transit.
	//
	// Asserted at the walk rather than at the ledger: since latent rows exist, d6
	// legitimately appears with an enabler now, so the ledger can no longer say
	// this on its own.
	it('does not route a pawn through the enemy king', () => {
		const board = at('8/p1p5/P2pp2P/1p2p3/3kP3/8/5Kp1/8 b - - 0 1').board;
		for (const optimistic of [false, true]) {
			const r = reach(board, sq('d6'), { limit: 6, pawnMayCaptureAnywhere: optimistic });
			expect(r.dist.has(sq('f2')), `king square, optimistic=${optimistic}`).toBe(false);
		}
	});
});

describe('deadlines are priced, not just recorded', () => {
	it('computes τ rather than hardcoding it', () => {
		const E = ledger(at('4k3/8/8/8/P7/8/8/4K3 w - - 0 1'), 'black');
		expect(E.some((o) => o.deadline !== 1)).toBe(true);
	});

	// CHECKPOINT-M2 measured 94.4% of distances surviving a ply, and the drift
	// compounds — so a claim four tempi out rests on three plies of geometry that
	// may already have moved. The discount is that number, not a chosen one.
	it('discounts a deferred claim by how far off it is', () => {
		const a = at('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
		const b = at('4k3/8/8/8/P7/8/8/4K3 w - - 0 1');
		const near = ledger(a, 'black')[0];
		const far = ledger(b, 'black')[0];
		expect(near.confidence).toBe(1);
		expect(far.confidence).toBeLessThan(1);
		expect(far.weight).toBe(near.weight);
		expect(worst([far], b.board)).toBeLessThan(worst([near], a.board));
	});
});

// ---------------------------------------------------------------------------
// AMEND-1-LATENT-RACE.md. The amendment adds latent rows; it must never remove
// a live one. The first version ranked latent and live candidates against each
// other, and since a floor ignores what is in the way it is always the smaller
// number — so a pawn with a real route was demoted to a watch-this-square note.
// Measured on the blind bucket: 76 live rows became 36. These two hold the fix.
// ---------------------------------------------------------------------------
describe('latent rows are a fallback, never a rival', () => {
	const walk = (n: number) => {
		// Random legal playouts, so the property is asserted against positions I
		// did not choose. My hand-written FENs have been wrong often enough.
		const out: ReturnType<typeof at>[] = [];
		let pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		let seed = 12345;
		const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
		for (let i = 0; i < n; i++) {
			const moves: { from: Square; to: Square }[] = [];
			for (const from of pos.board[pos.turn]) for (const to of pos.dests(from)) moves.push({ from, to: to as Square });
			if (!moves.length) { pos = at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); continue; }
			const mv = moves[rnd(moves.length)];
			const pr = pos.board.get(mv.from)?.role === 'pawn' && (mv.to >> 3 === 0 || mv.to >> 3 === 7);
			pos = pos.clone();
			pos.play(pr ? { ...mv, promotion: 'queen' } : mv);
			out.push(pos);
		}
		return out;
	};

	// Asserted about the row's OWN square, not about every promotion square.
	//
	// A pawn can have a live route to a square where the promotion is worth
	// nothing — it queens into a capture — and `promotionWorth <= 0` drops that
	// candidate before the live/latent split, which is correct and made the
	// broader form of this test fail on a b3 pawn walking to a8. The cross-square
	// half of the invariant is held by the corpus measurement in
	// CHECKPOINT-M3.md: live rows on the blind bucket must stay at 76/142.
	it('never files a latent promotion for a square that is reachable now', () => {
		for (const pos of walk(400)) {
			for (const owed of ['white', 'black'] as Color[]) {
				for (const o of ledger(pos, owed)) {
					if (o.kind !== 'promotion' || isLive(o, pos.board) || o.from === undefined) continue;
					const d = reach(pos.board, o.from, { limit: 6 }).dist.get(o.square);
					expect(d === undefined || d < 1, `${makeSquare(o.from)} latent on ${makeSquare(o.square)} but reaches it in ${d}`).toBe(true);
				}
			}
		}
	});

	it('names only squares the route actually steps onto', () => {
		for (const pos of walk(400)) {
			for (const owed of ['white', 'black'] as Color[]) {
				for (const o of ledger(pos, owed)) {
					// `needs` never names the obligation's own square: occupying a
					// destination is a capture, not an obstruction, which is the same
					// reason `reach.critical` excludes it. `enablers` MAY name it — a
					// pawn on g7 promoting on f8 needs something to be on f8, and that
					// is a real trigger rather than the reach-set noise the first
					// version filed.
					expect(o.needs, 'needs names its own square').not.toContain(o.square);
					// The two triggers are opposite conditions on a square, so a square
					// cannot carry both. If one ever did, the split by occupancy that
					// AMEND-1B introduced would be reading the board twice and
					// disagreeing with itself.
					for (const e of o.enablers) expect(o.needs, `${makeSquare(e)} is both`).not.toContain(e);
					// An unfilled enabler is what makes a row latent. A filled one is a
					// capture step the route depends on — the pawn asymmetry, and the
					// reason this cannot be asserted as "enablers are always empty".
					if (isLive(o, pos.board)) {
						for (const e of o.enablers) expect(pos.board.get(e), `${makeSquare(e)} live but unfilled`).toBeDefined();
					}
				}
			}
		}
	});

	// AMEND-1B-NEEDS-IS-THE-ROUTE.md. `needs` is the ROUTE, under AMEND-7's
	// definition, so it is read against the board rather than by its length. The
	// earlier form asserted every `needs` square was occupied, which was the
	// obstruction reading — the same field name meaning two things in two
	// modules, and the reason this amendment exists.
	it('reads live off the board, not off the length of a field', () => {
		for (const pos of walk(400)) {
			for (const owed of ['white', 'black'] as Color[]) {
				for (const o of ledger(pos, owed)) {
					const blocked = o.needs.filter((s) => pos.board.occupied.has(s));
					const unfilled = o.enablers.filter((s) => !pos.board.occupied.has(s));
					expect(isLive(o, pos.board)).toBe(blocked.length === 0 && unfilled.length === 0);
					expect(blockedBy(o, pos.board)).toEqual(blocked);
					// A latent row is latent for a stated reason, never by accident.
					if (!isLive(o, pos.board)) expect(blocked.length + unfilled.length).toBeGreaterThan(0);
				}
			}
		}
	});
});

// Γ, and the covering condition.
//
// ---------------------------------------------------------------------------
// PLAN.md M4. §2 as closed by AMEND-2-ARRIVES.md, §3's three failure modes.
//
// Every value below was read off scripts/gamma-probe.mjs before it was written
// down (rule 4), which is how the two defects in this file's first version were
// found: the defend branch was gated on a piece standing on S, so a promotion
// square — empty by definition — could never be covered; and classify2 asked the
// single-ply cover question of a race three tempi out and called the answer
// `cardinality`.
//
// The per-obligation assertions are deliberate. "This position has only one
// cover" is hard to construct and easy to get wrong — my hand-written FENs have
// been wrong five times in this project. "This OBLIGATION has only evade edges"
// is the same claim, checkable, and does not require the rest of the board to
// cooperate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { V, other, capturersOn } from '../src/domain/exchange';
import { attacks } from 'chessops/attacks';
import { ledger, isLive } from '../src/domain/ledger2';
import { gamma, cover, concede, classify2, bear, due } from '../src/domain/cover2';
import type { Gamma } from '../src/domain/cover2';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as Square;
const G = (fen: string, owed?: Color) => {
	const pos = at(fen);
	return { pos, g: gamma(pos, { owed }), owed: owed ?? pos.turn };
};
/** The discharge types offered for obligation `i`, deduplicated. */
const kinds = (g: Gamma, i: number) => [...new Set(g.edges.filter((e) => e.obligation === i).map((e) => e.kind))].sort();
const rowOn = (g: Gamma, square: string) => g.E.findIndex((o) => o.square === sq(square));

describe('the four discharge types', () => {
	// A knight attacked by a pawn. Defending is impossible for a PROVED reason —
	// §1.5's corollary, since a pawn is cheaper than a knight — and there is
	// nothing to block on a pawn's attack and nothing in range to take it. So the
	// obligation offers exactly one kind, and the knight has to move.
	it('offers evade alone when nothing else can reach', () => {
		const { g } = G('4k3/8/8/8/1n6/P7/8/4K3 b - - 0 1', 'black');
		const i = rowOn(g, 'b4');
		expect(g.E[i].weight).toBe(V.knight);
		expect(kinds(g, i)).toEqual(['evade']);
	});

	// The same pawn one file over is a promotion obligation five tempi out, and
	// THAT one is answerable four ways. Same board, same ledger, different row —
	// which is the point: nothing in the code asks how far away an obligation is
	// except by comparing a number to τ*.
	it('offers capture, block and defend against a race', () => {
		const { g } = G('4k3/8/8/8/1n6/P7/8/4K3 b - - 0 1', 'black');
		const i = rowOn(g, 'a8');
		expect(g.E[i].deadline).toBe(5);
		expect(kinds(g, i)).toEqual(['block', 'capture', 'defend']);
	});

	// AMEND-1B's second defect. A promotion square is EMPTY, so a branch gated on
	// `board.get(S)` never ran and no race could be answered by covering the
	// queening square — which AMEND-2-ARRIVES §3 names as the entire reason
	// "interpose at the deadline" is not a discharge type of its own.
	it('covers an empty promotion square, which the first version could not', () => {
		const { g } = G('8/8/8/P7/4k3/8/8/6K1 b - - 0 1', 'black');
		const i = rowOn(g, 'a8');
		expect(g.edges.filter((e) => e.obligation === i && e.kind === 'defend')).toHaveLength(1);
		expect(g.coverable[i]).toBe(true);
	});
});

describe("§1.5's corollary gates defence, and nothing else does", () => {
	// Adding a defender discharges a threat ONLY IF the cheapest attacker is worth
	// at least the target. Rook takes rook is an even trade, so a defender changes
	// the answer and the edge exists.
	it('allows a defender when the cheapest attacker is not cheaper', () => {
		const { g } = G('r3k3/8/8/3r4/8/8/8/3RK3 b - - 0 1', 'black');
		const i = rowOn(g, 'd5');
		expect(kinds(g, i)).toContain('defend');
	});

	// One pawn added, and the same defender is gone — not by valuation but by
	// proof: after Pxd5 a pawn stands on d5, so S(1) <= 100 and S(0) >= 400
	// whatever else defends. This is most of the pruning and it has a proof
	// behind it rather than a threshold.
	it('deletes the defender when a pawn attacks the rook', () => {
		const { g } = G('r3k3/8/8/3r4/4P3/8/8/4K3 b - - 0 1', 'black');
		const i = rowOn(g, 'd5');
		expect(kinds(g, i)).toEqual(['evade']);
	});
});

describe('the tempo correction — AMEND-2-ARRIVES §2', () => {
	// τ counts the CLAIMANT's tempi; the cover is spent in the owed side's. The
	// black king needs three moves to bear on a8 and the pawn needs three pushes.
	// Whether that is in time is decided entirely by who moves next, and this is
	// the single most likely place for cover2.ts to be quietly wrong.
	const RACE = '8/8/8/P7/4k3/8/8/6K1';

	it('is an edge when the cover arrives exactly on the deadline', () => {
		const { g } = G(`${RACE} b - - 0 1`, 'black');
		const i = rowOn(g, 'a8');
		expect(g.tau[i]).toBe(3);
		expect(bear(at(`${RACE} b - - 0 1`).board, sq('e4'), sq('a8'))).toBe(3);
		expect(g.coverable[i]).toBe(true);
		expect(classify2(g, at(`${RACE} b - - 0 1`).board, 'black')).toBe('covered');
	});

	it('is not an edge with the turn flipped', () => {
		const { g, pos } = G(`${RACE} w - - 0 1`, 'black');
		const i = rowOn(g, 'a8');
		expect(g.tau[i]).toBe(2);
		expect(g.coverable[i]).toBe(false);
		expect(classify2(g, pos.board, 'black')).toBe('latency');
	});
});

describe("§3's three failure modes", () => {
	// A knight forking king and rook. Both rows have edges — the king can step
	// aside, the rook can run — and no single move takes both. That is
	// cardinality, and it is the one mode a max over obligations cannot express,
	// which is what the frozen cover.ts computed while citing §3.3.
	it('reads a fork as cardinality, with the concession naming what it costs', () => {
		const { g, pos } = G('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1', 'white');
		expect(g.E).toHaveLength(2);
		expect(g.coverable).toEqual([true, true]);
		expect(cover(g).move).toBeNull();
		expect(classify2(g, pos.board, 'white')).toBe('cardinality');

		const k = concede(pos, g, 'white');
		expect(k.loss).toBe(V.rook);
		expect(k.worst && makeSquare(k.worst.square)).toBe('a1');
	});

	// A pawn on the seventh with the king across the board. Edges exist in the
	// unfiltered graph — the king CAN reach a8, given long enough — and none
	// survives the deadline. Latency is emptiness after filtering, which is why
	// classify2 re-asks the question with the deadline removed rather than
	// guessing from the edge count.
	it('separates latency from emptiness by asking again without the deadline', () => {
		const { g, pos } = G('8/P7/8/8/8/6k1/8/6K1 b - - 0 1', 'black');
		expect(g.coverable).toEqual([false]);
		expect(classify2(g, pos.board, 'black')).toBe('latency');
	});

	it('calls a quiet position covered', () => {
		const { g, pos } = G('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
		expect(g.E).toHaveLength(0);
		expect(classify2(g, pos.board, 'white')).toBe('covered');
	});
});

// ---------------------------------------------------------------------------
// The structural invariants, over positions I did not choose. These are what
// actually hold the file: a golden position asserts one reading, a property
// asserts the shape of every reading.
// ---------------------------------------------------------------------------
describe('Γ is structural, on positions nobody picked', () => {
	const walk = (n: number) => {
		const out: ReturnType<typeof at>[] = [];
		const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		let pos = at(START);
		let seed = 987654321;
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
	const CASES = walk(300);

	it('never offers a discharge that arrives late', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const e of g.edges) {
					expect(e.cost, 'cost below 1 is not a move').toBeGreaterThanOrEqual(1);
					expect(e.cost, `${e.kind} arrives at ${e.cost}, deadline ${g.tau[e.obligation]}`).toBeLessThanOrEqual(g.tau[e.obligation]);
				}
			}
		}
	});

	it('offers nothing at all when there is no tempo to spend', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const e of g.edges) expect(g.tau[e.obligation]).toBeGreaterThanOrEqual(1);
			}
		}
	});

	// The distinction AMEND-2-ARRIVES §1.1 exists for. To defend S is to bear on
	// it, not to move to it — a rook on a1 bears on a8 at cost 0 and lands there
	// at cost 1 — and a defend edge that meant "land" would be capturing your own
	// piece whenever S is occupied by the side that owes.
	it('defends by bearing, never by landing on its own piece', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const e of g.edges) {
					if (e.kind !== 'defend') continue;
					expect(e.to, 'defend must name the obligation square').toBe(g.E[e.obligation].square);
					expect(bear(pos.board, e.piece, e.to)).toBe(e.cost);
				}
			}
		}
	});

	it('only ever evades with the piece that is standing there', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const e of g.edges) {
					if (e.kind !== 'evade') continue;
					expect(e.piece).toBe(g.E[e.obligation].square);
					expect(e.cost).toBe(1);
					expect(pos.board.get(e.piece)?.color).toBe(owed);
				}
			}
		}
	});

	// §1.5 as a property rather than as two positions.
	it('never offers a defender the cheap-attacker lemma forbids', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const e of g.edges) {
					if (e.kind !== 'defend') continue;
					const target = pos.board.get(g.E[e.obligation].square);
					if (!target) continue; // an empty square is worth 0; every attacker clears it
					const attackers = g.E[e.obligation].from !== undefined ? [g.E[e.obligation].from!] : [];
					for (const a of attackers) {
						expect(V[pos.board.get(a)?.role ?? 'pawn'], 'defended against a cheaper attacker').toBeGreaterThanOrEqual(V[target.role]);
					}
				}
			}
		}
	});

	// A cover is a claim about every row due NOW. If it names a move, that move
	// must carry a cost-1 edge for each of them — this is the set-cover condition
	// itself, checked rather than trusted.
	it('names a move only when it really answers every debt due', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				const c = cover(g);
				if (!c.move) continue;
				for (const i of due(g)) {
					const hit = g.edges.some((e) => e.obligation === i && e.cost === 1 && e.piece === c.move!.from && e.to === c.move!.to);
					expect(hit, `${makeSquare(c.move.from)}${makeSquare(c.move.to)} misses e${i}`).toBe(true);
				}
			}
		}
	});

	// The concession and the cover are two readings of one graph and must agree:
	// a position with a covering move concedes nothing, and one without concedes
	// something. If they ever disagree, one of them is not reading Γ.
	it('concedes nothing exactly when a covering move exists', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				if (!due(g).length) continue;
				const k = concede(pos, g, owed);
				expect(k.loss).toBeGreaterThanOrEqual(0);
				if (cover(g).move) expect(k.loss, 'covered but conceding').toBe(0);
			}
		}
	});

	// AMEND-2-ARRIVES §5. A defender already bearing on S would mean the ledger
	// filed a debt that its own SEE had already answered, since w IS a SEE and a
	// SEE counts the defenders. Asserted rather than handled as a case: if this
	// ever fires, the ledger is wrong and Γ is right to have no opinion.
	it('never finds a defender already in place', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				for (const e of gamma(pos, { owed }).edges) expect(e.cost).toBeGreaterThan(0);
			}
		}
	});

	// Γ is built from the LIVE ledger. A latent row is a square to watch, not a
	// debt, and asking who can discharge something that is not yet owed would
	// fill the graph with covers for claims nobody has made.
	it('builds only from rows that are live on this board', () => {
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				for (const o of g.E) expect(isLive(o, pos.board)).toBe(true);
				expect(g.E.length).toBeLessThanOrEqual(ledger(pos, owed).length);
			}
		}
	});

	// The mode is a total function on Γ, and each answer means something distinct.
	it('classifies every position into exactly one mode', () => {
		const seen = new Set<string>();
		for (const pos of CASES) {
			for (const owed of ['white', 'black'] as Color[]) {
				const g = gamma(pos, { owed });
				const m = classify2(g, pos.board, owed);
				expect(['covered', 'cardinality', 'emptiness', 'latency']).toContain(m);
				seen.add(m);
				if (m === 'covered') continue;
				// Anything not covered has a stated cause: a row with no discharge in
				// time, or two rows due at once with no move that answers both.
				const uncoverable = g.coverable.some((c) => !c);
				expect(uncoverable || due(g).length >= 2, `${m} with no cause`).toBe(true);
			}
		}
		// The corpus must actually exercise more than one branch, or the property
		// above is vacuous — which is the unreachable-branch failure that filed 170
		// blind plies as ties.
		expect(seen.size, `only saw ${[...seen].join(', ')}`).toBeGreaterThan(1);
	});
});

// ---------------------------------------------------------------------------
// The set-cover question is single-ply, so it is asked of the rows due NOW.
// This case was SEARCHED for, not built: a mutation audit showed that dropping
// the `due` restriction broke nothing in the suite, which meant the defect the
// probe had already found — a coverable race reported as `cardinality` — was
// unheld. scripts/find-due-case.mjs walked 12,000 random plies to find a
// position where the two readings actually disagree.
// ---------------------------------------------------------------------------
describe('the cover answers what is due, not what is deferred', () => {
	const FEN = 'rnb2r2/1p1pkB1N/2p3p1/2b1p2n/p3P3/1PP2P1P/P1NK4/2R4R w - - 1 29';

	it('names a move while a deferred row stays open', () => {
		const { g, pos } = G(FEN, 'white');
		const dueRows = due(g);
		expect(dueRows).toHaveLength(1);
		expect(makeSquare(g.E[dueRows[0]].square)).toBe('f7');
		// A promotion five tempi out, which this move does nothing about.
		const later = g.E.map((_, i) => i).filter((i) => !dueRows.includes(i));
		expect(later.length).toBeGreaterThan(0);
		expect(g.tau[later[0]]).toBeGreaterThan(1);

		const c = cover(g);
		expect(c.move && makeSquare(c.move.from) + makeSquare(c.move.to)).toBe('f7c4');
		expect(c.uncovered).toHaveLength(0);
		// The deferred row is genuinely NOT answered by that move. If `cover` were
		// taken over all of E it would have to reject f7c4 and report a deficiency
		// that does not exist — one row due, answered, and a debt with tempi left.
		const carried = g.edges.some((e) => e.obligation === later[0] && e.cost === 1 && e.piece === c.move!.from && e.to === c.move!.to);
		expect(carried).toBe(false);
		expect(classify2(g, pos.board, 'white')).toBe('covered');
	});
});

describe('the same board, the other side', () => {
	// The ledger is built symmetrically and cannot be built any other way — a
	// ray's blockers are of both colours. So Γ must answer for either side of one
	// position without being told which is "the attacker".
	it('answers for the side not to move', () => {
		const pos = at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');
		const g = gamma(pos, { owed: 'black' });
		expect(g.E).toHaveLength(1);
		expect(g.tau[0], 'black spends nothing when white moves next').toBe(0);
		expect(g.edges).toHaveLength(0);
		expect(concede(pos, g, 'black').loss).toBe(V.rook);
		expect(other('black')).toBe('white');
	});
});

// ---------------------------------------------------------------------------
// Three bugs found by probing checkmates, all of them in M4 rather than in the
// missing §1 rows the M7 gate had blamed. Together they were worth 9.5 points
// of solve rate: 42.7% -> 52.2% on the corpus.
//
// The route in was one measurement: on 334 real checkmates, Γ called 99.4% of
// them `covered`. A detector that cannot see mate cannot rank a mating move.
// ---------------------------------------------------------------------------
describe('Γ and check — three ways it was wrong', () => {
	const mated = (fen: string) => {
		const pos = at(fen);
		return { pos, g: gamma(pos, { owed: pos.turn }) };
	};

	// `seeValue` is documented as NEVER NEGATIVE — "nobody is forced into an
	// exchange" — so the original gate `seeValue(board, a, owed) < 0` was dead
	// code that rejected nothing. Γ offered the king capturing the mating queen.
	it('will not let a king capture a defended attacker', () => {
		// Black Kg7 in check from Qh8, which Rh3 defends down the open h-file.
		const { g } = mated('r4rnQ/ppp2pk1/6q1/3p2P1/3P4/2P4R/PP4P1/5RK1 b - - 6 24');
		const check = g.E.findIndex((o) => !Number.isFinite(o.weight));
		expect(check, 'no infinite row on a checkmate').toBeGreaterThanOrEqual(0);
		expect(g.edges.filter((e) => e.obligation === check)).toEqual([]);
		expect(g.coverable[check]).toBe(false);
	});

	// The net is what decides: what you take minus what they take back once you
	// are standing there. Gating on "do they get anything back" would throw away
	// a queen won for a rook, which is the commonest sacrifice in the corpus.
	it('still allows a capture that wins material through a recapture', () => {
		// Black rook on a5 takes the checking queen on e5; d4 recaptures. 900 for
		// 500 is a discharge, not a loss.
		const pos = at('4k3/8/8/r3Q3/3P4/8/8/4K3 b - - 0 1');
		const g = gamma(pos, { owed: 'black' });
		const check = g.E.findIndex((o) => !Number.isFinite(o.weight));
		if (check >= 0) {
			const caps = g.edges.filter((e) => e.obligation === check && e.kind === 'capture');
			expect(caps.length, 'refused a capture that wins a queen for a rook').toBeGreaterThan(0);
		}
	});

	// An infinite debt has no LATER, so relaxing its deadline is incoherent.
	// Without this every checkmate read as `latency` — the answer exists but
	// arrives late — because a piece six moves away counted as an answer.
	it('calls checkmate emptiness, never latency', () => {
		const { pos, g } = mated('r4rnQ/ppp2pk1/6q1/3p2P1/3P4/2P4R/PP4P1/5RK1 b - - 6 24');
		expect(pos.isCheckmate()).toBe(true);
		expect(classify2(g, pos.board, pos.turn)).toBe('emptiness');
	});

	// AMEND-1.4-KINGS-ADJACENT. `max(0, ∞ − ∞)` is NaN and every comparison
	// against NaN is false, so a guard written as "skip when the value is bad"
	// fails OPEN. Two kings contesting one square is the only place in the
	// codebase where that arithmetic arises.
	it('will not evade to a square the enemy king attacks', () => {
		// White Kh7 in check from Qh5. Kg7 is illegal — the black king on f6
		// covers g7 — and SEE cannot say so, because both kings would be captured
		// on g7 in one chain.
		const { pos, g } = mated('6Q1/7K/5k2/7q/8/8/8/8 w - - 1 71');
		expect(pos.isCheckmate()).toBe(true);
		const check = g.E.findIndex((o) => !Number.isFinite(o.weight));
		expect(g.edges.filter((e) => e.obligation === check && e.kind === 'evade')).toEqual([]);
		expect(classify2(g, pos.board, pos.turn)).toBe('emptiness');
	});
});

// ---------------------------------------------------------------------------
// The residue, and the two rules that closed it. Γ recognised 0.6% of the
// corpus's 334 checkmates before this milestone and 100% after.
// ---------------------------------------------------------------------------
describe('Γ and check — the last two', () => {
	// AMEND-2-ARRIVES §4.1. A capture removes ONE claimant and a move captures at
	// most one piece, so under double check neither capturing nor blocking
	// discharges anything. 18 of the 23 remaining failures were exactly this.
	//
	// Stated generally rather than as a rule about check: the obligation must be
	// GONE on the board the discharge leaves, not merely smaller.
	// Taken from the corpus rather than invented — `yS8R3`'s final position, where
	// the black king on e7 is checked by BOTH the rook on e1 and the knight on
	// c6. Γ used to offer taking either one.
	it('refuses a capture that leaves the other checker checking', () => {
		const pos = at('r1b2r2/1p1nk1bp/2N2np1/8/P1B2B2/3q4/1PP2PPP/R3R1K1 b - - 1 17');
		expect(pos.isCheckmate()).toBe(true);
		expect(capturersOn(pos.board, sq('e7'), 'white').map(makeSquare).sort()).toEqual(['c6', 'e1']);
		const g = gamma(pos, { owed: 'black' });
		const check = g.E.findIndex((o) => !Number.isFinite(o.weight));
		expect(check).toBeGreaterThanOrEqual(0);
		// Capturing c6 leaves e1 checking, and blocking e-file leaves c6. Neither
		// discharges, so neither is an edge — and only evade could remain.
		expect(g.edges.filter((e) => e.obligation === check)).toEqual([]);
		expect(classify2(g, pos.board, 'black')).toBe('emptiness');
	});

	// AMEND-1.4-KINGS-ADJACENT §2. §1.1 excludes absolutely pinned attackers from
	// an exchange — correct for every target but one. A pin is a threat to the
	// pinned piece's own king, and capturing the ENEMY king ends the chain before
	// that can be collected, so the pin does not bind there.
	//
	// This was the entire residue after the double-check fix: five kings evading
	// onto squares whose only guard was pinned, where `capturersOn` returned
	// empty and SEE returned 0.
	it('counts a pinned guard when the square is contested by a king', () => {
		// Asserted as a property rather than from a diagram: wherever Γ offers a
		// king an evade square, nothing of the enemy's may capture there — pinned
		// pieces included, which is the whole point.
		// The three positions where this rule actually decides, taken from the
		// corpus: in each, the king's only flight square is guarded by a piece
		// that is itself pinned. `capturersOn` returned empty, SEE returned 0,
		// and Γ offered the move.
		let ran = 0;
		for (const fen of [
			'8/3k4/Qp5p/3q4/6r1/8/5P1P/3R1RK1 w - - 1 33',
			'2k4r/pp1r2pp/8/4pQ2/8/P5P1/1PP2PBP/2Kq4 w - - 0 25',
			'rnb2Bnr/pppp2kp/8/3PN3/4P3/8/PPP5/RN2KR1q b Q - 3 16',
			'6Q1/7K/5k2/7q/8/8/8/8 w - - 1 71',
		]) {
			const pos = at(fen);
			const g = gamma(pos, { owed: pos.turn });
			for (const e of g.edges) {
				// The KING's evade only. An ordinary piece may legitimately step onto
				// an attacked square when it is defended there — that is an exchange,
				// and SEE prices it. A king has no such option, because V[king] is
				// infinite and one attacker is enough.
				if (e.kind !== 'evade' || Number.isFinite(g.E[e.obligation].weight)) continue;
				const after = pos.board.clone();
				const piece = after.take(e.piece)!;
				after.take(e.to);
				after.set(e.to, piece);
				// Checked with RAW GEOMETRY, not with `capturersOn`.
				//
				// The rule being tested lives inside `capturersOn`, so asserting
				// through it compares the implementation to itself — a mutation
				// making pins bind again passed this test, because it changed both
				// sides of the comparison. An independent implementation is the only
				// kind of check that has ever found a bug in this project.
				const guards: string[] = [];
				for (const f of after[other(pos.turn)]) {
					const q = after.get(f);
					if (q && attacks(q, f, after.occupied).has(e.to)) guards.push(makeSquare(f));
				}
				ran++;
				expect(guards, `king evaded onto ${makeSquare(e.to)}`).toEqual([]);
			}
			// Every one of these is checkmate, so the right number of king evade
			// edges is zero — which makes the loop above vacuous and the assertion
			// worthless on its own. What is actually being tested is that Γ REJECTS
			// the moves it used to offer, so that is what is asserted.
			// The CHECK must be uncoverable. Other obligations in the position may
			// well be answerable and that is not the claim — asserting over all of
			// them was too strong and failed on a position carrying a loose rook.
			const gg = gamma(pos, { owed: pos.turn });
			const j = gg.E.findIndex((o) => !Number.isFinite(o.weight));
			expect(j, `${fen}: no infinite row on a checkmate`).toBeGreaterThanOrEqual(0);
			expect(gg.coverable[j], fen).toBe(false);
			expect(classify2(gg, pos.board, pos.turn)).toBe('emptiness');
		}
		// And the vacuity is stated rather than hidden: no king evade survived, on
		// any of them. If one ever does, the loop above starts doing work.
		expect(ran).toBe(0);
	});
});

// The concession, unrolled — and the escalation ladder.
//
// ---------------------------------------------------------------------------
// PLAN.md M6. §4 as closed by AMEND-4-UNROLLING.md, and §5.
//
// `unroll` is arithmetic over a fixed exchange complex and touches no board, so
// most of it is tested on SYNTHETIC rows. That is not a shortcut: a recurrence
// tested only through positions is tested through whatever positions I managed
// to construct, and my hand-written FENs have been wrong seven times here. The
// recurrence's own claims — alternation, termination, the tie-break — are
// claims about arithmetic and are checked as arithmetic.
//
// There is deliberately NO zugzwang test. §3.2's successor condition does not
// fire on any corpus zugzwang, and neither does the tempo-slack repair;
// AMEND-4-UNROLLING.md §3 records the gap rather than papering over it. A test
// asserting the absence is at the bottom, so the gap stays visible.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { V } from '../src/domain/exchange';
import { ledger, isLive, type Obligation } from '../src/domain/ledger2';
import { gamma, concede as concedeOnce, due } from '../src/domain/cover2';
import { unroll, plays, concedes, ladder, reckon, say, MAX_ROWS, type Play } from '../src/domain/concede2';

const at = (fen: string) => positionFromFen(fen);
const sq = (s: string) => parseSquare(s) as Square;

/** A synthetic obligation. Only `weight` and `square` matter to the recurrence. */
const row = (name: string, weight: number): Obligation => ({
	square: sq(name),
	role: 'rook',
	weight,
	deadline: 1,
	claimant: 'black' as Color,
	kind: 'immediate',
	needs: [],
	enablers: [],
	confidence: 1,
});
/** A synthetic move covering the rows named by their bit positions. */
const play = (from: string, to: string, ...bits: number[]): Play => ({
	from: sq(from),
	to: sq(to),
	covers: bits.reduce((n, b) => n | (1 << b), 0),
});

describe('§4 as a single max — the case it already handled', () => {
	it('concedes nothing when one move covers everything', () => {
		const u = unroll([row('a1', 500), row('b1', 300)], [play('c1', 'c2', 0, 1)]);
		expect(u.loss).toBe(0);
		expect(u.move && makeSquare(u.move.from)).toBe('c1');
		expect(u.line).toEqual([]);
	});

	it('concedes the costliest thing left when no move covers both', () => {
		const u = unroll([row('a1', 500), row('b1', 300)], [play('a1', 'a2', 0), play('b1', 'b2', 1)]);
		// Save the rook, concede the bishop — never the other way round.
		expect(u.loss).toBe(300);
		expect(u.move && makeSquare(u.move.from)).toBe('a1');
		expect(u.line.map((o) => makeSquare(o.square))).toEqual(['b1']);
	});
});

describe('§4 unrolled — the case it did not', () => {
	// The whole point of the amendment. Four rows, every move covering exactly
	// one: you save one, they take one, you save one, they take one. A single
	// max reports 500 and the truth is 1000 — the second harvest is invisible to
	// a formula that stops after one ply.
	const FOUR = [row('a1', 500), row('b1', 500), row('c1', 500), row('d1', 500)];
	const SINGLES = [play('a1', 'a2', 0), play('b1', 'b2', 1), play('c1', 'c2', 2), play('d1', 'd2', 3)];

	it('counts every harvest, not just the first', () => {
		expect(unroll(FOUR, SINGLES).loss).toBe(1000);
	});

	it('names the order the debts are collected in', () => {
		const u = unroll(FOUR, SINGLES);
		expect(u.line).toHaveLength(2);
		expect(u.worst).toBe(u.line[0]);
	});

	it('collapses to one harvest when three rows can be answered in time', () => {
		const three = FOUR.slice(0, 3);
		expect(unroll(three, SINGLES.slice(0, 3)).loss).toBe(500);
	});

	// You get a ply back after every harvest, so a move that covers two changes
	// the arithmetic and not just the first term.
	it('rewards the move that answers two', () => {
		const both = [play('e1', 'e2', 0, 1), ...SINGLES.slice(2)];
		expect(unroll(FOUR, both).loss).toBe(500);
		expect(unroll(FOUR, SINGLES).loss).toBe(1000);
	});

	// Written expecting 1000 and corrected to 2000 by running it. With no move
	// covering anything there is nothing to save on the plies you get back, so
	// every row is harvested rather than every other one. The 1000 above is what
	// singleton covers buy you; this is the floor they are measured against.
	it('concedes every row when nothing covers anything', () => {
		expect(unroll(FOUR, []).loss).toBe(2000);
	});
});

describe('the recurrence keeps its promises', () => {
	// ∅ is in the option set because you must move, not because standing still is
	// a move. A strict `<` let it win ties on ordering alone, and the sentence
	// read "no move is best" on a position where a move was equally good.
	it('breaks ties toward the move that covers more', () => {
		const u = unroll([row('a1', 180), row('b1', 180)], [play('a1', 'a2', 0)]);
		expect(u.loss).toBe(180);
		expect(u.move, 'reported no move where one was equally good').not.toBeNull();
		expect(makeSquare(u.move!.from)).toBe('a1');
	});

	// The move and the line must come from the SAME branch. The first version
	// recomputed the argmin by rescanning and paired it with whichever line the
	// recursion happened to take, printing "c7c1 is best — c7" for a move that
	// vacates c7.
	it('pairs the move with its own line', () => {
		const u = unroll([row('c7', 180), row('g7', 180)], [play('c7', 'c1', 0), play('g7', 'g1', 1)]);
		expect(makeSquare(u.move!.from)).toBe('c7');
		expect(u.line.map((o) => makeSquare(o.square)), 'line contradicts the move').toEqual(['g7']);
	});

	// THE core of §4, and my first suite did not test it. A mutation making the
	// opponent harvest the CHEAPEST rather than the costliest passed everything,
	// because every case I had written left at most one row standing after the
	// cover — and max and min agree on a set of one. Three rows and one covering
	// move leaves two, which is where the quantifier finally has a choice.
	it('lets the opponent take the costliest thing left, not the cheapest', () => {
		// EVERY row needs a covering move, which the first attempt at this test
		// missed. With only one cover, whatever they leave standing is harvested
		// next anyway, so both orders total the same and max and min agree — the
		// mutation walked straight through it. Give each row an answer and the
		// choice finally matters: they take the bishop (300) and you save the
		// pawn; taking the pawn first would concede 100 and save the bishop.
		const rows = [row('a1', 500), row('b1', 300), row('c1', 100)];
		const u = unroll(rows, [play('a1', 'a2', 0), play('b1', 'b2', 1), play('c1', 'c2', 2)]);
		expect(u.loss).toBe(300);
		expect(u.line.map((o) => makeSquare(o.square))).toEqual(['b1']);
	});

	// Likewise: the reported move must be the one whose cover set the min chose,
	// not simply the first available. A mutation returning `moves[0]` passed,
	// because in every case I had written the chosen move happened to be first.
	it('reports the chosen move even when it is not the first one offered', () => {
		const rows = [row('a1', 500), row('b1', 300)];
		const u = unroll(rows, [play('b1', 'b2', 1), play('a1', 'a2', 0)]);
		expect(makeSquare(u.move!.from), 'reported the first move rather than the best').toBe('a1');
		expect(u.line.map((o) => makeSquare(o.square))).toEqual(['b1']);
	});

	it('refuses rather than truncating above the stated bound', () => {
		const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => row('a1', 100 + i));
		const u = unroll(many, []);
		expect(u.refused).toBe(true);
		expect(u.loss).toBe(0);
		expect(say(u)).toContain('refusing rather than truncating');
	});

	it('has nothing to unroll when nothing is owed', () => {
		expect(unroll([], []).loss).toBe(0);
		expect(say(unroll([], []))).toBe('nothing owed');
	});

	// Depth is |E| and every step deletes at least the harvested row, so the
	// answer is bounded by taking every row once. Asserted because §4's
	// termination argument is exactly this and it is cheap to check.
	it('never concedes more than every debt once', () => {
		const rows = [row('a1', 500), row('b1', 300), row('c1', 900), row('d1', 100), row('e1', 320)];
		const total = rows.reduce((n, r) => n + r.weight, 0);
		for (const moves of [[], [play('a1', 'a2', 0)], [play('a1', 'a2', 0, 1)]]) {
			expect(unroll(rows, moves).loss).toBeLessThanOrEqual(total);
		}
	});
});

describe('against real positions', () => {
	// At |E| <= 2 the unrolling and §4's single max must agree exactly — the
	// general form has to contain the special one, or it is a different formula
	// wearing the same name.
	it('agrees with the single-ply concession where the single ply is the whole story', () => {
		for (const [fen, owed] of [
			['4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1', 'white'],
			['4k3/2R3R1/4n3/8/8/8/8/4K3 w - - 0 1', 'white'],
			['4k3/8/8/4r3/8/8/8/4RK2 b - - 0 1', 'black'],
		] as [string, Color][]) {
			const pos = at(fen);
			const g = gamma(pos, { owed });
			if (due(g).length > 2) continue;
			expect(concedes(pos, owed).loss, fen).toBe(concedeOnce(pos, g, owed).loss);
		}
	});

	it('reads the fork as one debt paid and one conceded', () => {
		const pos = at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1');
		const u = concedes(pos, 'white');
		expect(u.loss).toBe(V.rook);
		expect(u.line.map((o) => makeSquare(o.square))).toEqual(['a1']);
		expect(say(u)).toBe('e1d1 is best and still concedes 500 — a1 (500)');
	});

	it('builds its option set from Γ and nothing else', () => {
		const pos = at('4k3/2R3R1/4n3/8/8/8/8/4K3 w - - 0 1');
		const g = gamma(pos, { owed: 'white' });
		const ms = plays(g);
		// Every play is a cost-1 edge in Γ, and covers only rows due this ply.
		const mask = (1 << due(g).length) - 1;
		for (const m of ms) {
			expect(m.covers & ~mask).toBe(0);
			expect(g.edges.some((e) => e.cost === 1 && e.piece === m.from && e.to === m.to)).toBe(true);
		}
	});
});

describe('§5 — the ladder, bounded by stake and not by plies', () => {
	// "My largest available threat at deadline τ is a max over an existing
	// structure rather than an exploration." Each rung must strictly exceed the
	// standing stake, so the climb is short by construction.
	it('climbs only on threats worth more than the standing stake', () => {
		const pos = at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');
		const l = ladder(pos, 'white', 100);
		for (const r of l.rungs) expect(r.threat.weight).toBeGreaterThan(r.over);
		for (let i = 1; i < l.rungs.length; i++) expect(l.rungs[i].over).toBeGreaterThan(l.rungs[i - 1].over);
		expect(l.cycles).toBe(false);
	});

	it('does not climb at all when nothing beats the stake', () => {
		const pos = at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');
		expect(ladder(pos, 'white', Infinity).rungs).toEqual([]);
	});

	// STRICTLY exceed. §4.2's bound is what makes the ladder short, and a rung
	// that merely matches the stake buys nothing while making the climb
	// unbounded.
	//
	// The `cycles` half is the part that bites. Relaxing the search predicate to
	// `>=` leaves `rungs` empty anyway — because the redundant guard inside the
	// loop catches it and reports a cycle instead. I had commented that guard
	// "unreachable by the predicate above", which is true only while the
	// predicate is right; it is there precisely for when it is not, and this
	// asserts it rather than trusting the comment.
	it('will not climb on a threat that merely matches the stake', () => {
		const pos = at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1');
		const top = ladder(pos, 'white', 0).rungs[0];
		expect(top, 'no threat to climb on — the position is wrong for this test').toBeDefined();
		const equal = ladder(pos, 'white', top.threat.weight);
		expect(equal.rungs, 'climbed on an equal stake').toEqual([]);
		expect(equal.cycles, 'stopped for the wrong reason').toBe(false);
	});

	// §4.4: check is the maximal element, so the ladder stops there rather than
	// looking for something bigger. Derived from V[king] = Infinity, not asserted.
	it('stops at check, because nothing exceeds it', () => {
		// Black in check, so black's ledger carries an infinite row and white's
		// ladder can climb to it. V[king] = Infinity does the work; §4.4 is a
		// consequence of the value assignment, not a rule bolted on.
		const pos = at('4k3/8/8/8/8/8/8/4RK2 b - - 0 1');
		const l = ladder(pos, 'white', 0);
		expect(l.rungs.length).toBeGreaterThan(0);
		expect(l.stake).toBe(Infinity);
		expect(l.rungs[l.rungs.length - 1].threat.weight).toBe(Infinity);
		expect(l.cycles).toBe(false);
	});

	// The ladder reads STANDING threats, not ones a move would create. §5 says
	// "a max over an existing structure", and that is exactly what it is — the
	// attacking direction, where you go looking for a threat to make, is the
	// reverse lookup Γ does for defence and is not built. Asserted so the
	// boundary is visible rather than discovered later.
	it('reads standing threats only, which is a stated boundary', () => {
		// White to move can play Rd8+, but black owes nothing right now.
		const pos = at('4k3/8/8/8/8/8/8/3RK3 w - - 0 1');
		expect(ladder(pos, 'white', 0).rungs).toEqual([]);
	});

	it('reports the whole reckoning as two ledgers, not one number', () => {
		const pos = at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1');
		const r = reckon(pos, 'white');
		expect(r.loss).toBe(V.rook);
		expect(r).toHaveProperty('ladder');
		expect(r.ladder.cycles).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The gap, asserted so it stays visible.
// ---------------------------------------------------------------------------
describe('zugzwang is a named gap, not a silent one', () => {
	// §3.2 says: covered now, uncovered after every move. On the textbook
	// opposition — black to move loses, and it is zugzwang in every book — the
	// ledger owes nothing and ALL FIVE legal moves leave nothing owed. The
	// condition is correct and not computable from Γ, because Γ records whether
	// a discharge ARRIVES and zugzwang is about whether it can be MAINTAINED.
	//
	// If this test ever fails, §1's table has grown the tempo row it is missing
	// and AMEND-4-UNROLLING.md §3 should be revisited — which is the point of
	// asserting an absence rather than leaving one.
	it('still cannot see the textbook opposition', () => {
		const pos = at('8/8/8/3k4/8/3K4/3P4/8 b - - 0 1');
		const owed = pos.turn;
		expect(ledger(pos, owed).filter((o) => isLive(o, pos.board))).toEqual([]);
		let quiet = 0;
		let total = 0;
		for (const from of pos.board[owed]) {
			for (const to of pos.dests(from)) {
				const n = pos.clone();
				n.play({ from, to: to as Square });
				total++;
				if (!ledger(n, owed).filter((o) => isLive(o, n.board)).length) quiet++;
			}
		}
		expect(total).toBe(5);
		expect(quiet, 'a move now creates an obligation — §3.2 may be computable after all').toBe(5);
	});
});

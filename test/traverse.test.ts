// The traversal — collapsing the tree backwards.
//
// ---------------------------------------------------------------------------
// §3.1, §6 and §9 on the symmetric complex. This is what `rank.ts` was a search
// standing in for, and the tests are chosen to hold the properties that made
// that search wrong rather than only the outputs it happened to get right.
//
// The one that matters most is `mirrors`: reflect the board and swap the
// colours, and the value must negate exactly. Will: "everything should
// obviously be symmetric." A one-line property that no asymmetric build can
// pass, and which the role-parameter code could not have been asked at all —
// it had no single value to negate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSquare, makeSquare } from 'chessops/util';
import { makeFen } from 'chessops/fen';
import type { Square, Color } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { V, other } from '../src/domain/exchange';
import { complex, material, isLive, isMateWeight } from '../src/domain/complex';
import { gamma } from '../src/domain/gamma';
import { traverse, deficient, say, MAX_ROWS } from '../src/domain/traverse';

const at = (fen: string) => positionFromFen(fen);
const value = (fen: string) => traverse(complex(at(fen))).value;

/** Reflect the board and swap the colours. The value must negate. */
function mirror(fen: string): string {
	const [board, turn, ...rest] = fen.split(' ');
	const flipped = board
		.split('/')
		.reverse()
		.map((rank) => rank.replace(/[a-zA-Z]/g, (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())))
		.join('/');
	return [flipped, turn === 'w' ? 'b' : 'w', '-', '-', ...rest.slice(2)].join(' ');
}

const walk = (n: number) => {
	const out: ReturnType<typeof at>[] = [];
	const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let pos = at(START);
	let seed = 777;
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
const CASES = walk(120);

describe('the value comes out of the complex, with nothing played', () => {
	it('leaves an answerable debt alone', () => {
		// The rook is attacked and it is its owner's move: it runs.
		expect(value('4k3/8/8/4r3/8/8/8/4RK2 b - - 0 1')).toBe(0);
	});

	it('collects one that cannot be answered', () => {
		// Same board, the other side to move: the rook goes.
		expect(value('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1')).toBe(V.rook);
	});

	// A fork is two debts and one tempo. The king is saved because it must be;
	// the rook is collected. Nothing was played to discover that — the schedule
	// simply cannot cover both, which is §3's cardinality.
	it('pays the debt it can and loses the other', () => {
		const before = material(at('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1').board);
		expect(before).toBe(V.rook - V.knight);
		expect(value('4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1')).toBe(before - V.rook);
	});

	// Checkmate reads Infinity off the complex ALONE. No move is made, and no
	// horizon is involved: the king's obligation has no discharge in Γ at all.
	it('reads checkmate as infinite without playing anything', () => {
		const fen = 'r4rnQ/ppp2pk1/6q1/3p2P1/3P4/2P4R/PP4P1/5RK1 b - - 6 24';
		expect(at(fen).isCheckmate()).toBe(true);
		// MATE IS A BAND, NOT A FLOAT. It used to be `Infinity`, which is right about
		// the stake and cannot express that a mate in one beats a mate in three —
		// which is what mate-in-1 kept tying on. `isMateWeight` is how the change is
		// asked about, so this asserts what the test was always for: nothing made of
		// material can reach it.
		expect(isMateWeight(value(fen))).toBe(true);
		expect(value(fen)).toBeGreaterThan(100 * V.queen);
	});

	// The deadline decides the race, and the ONLY thing that differs between
	// these two is whose turn it is.
	it('decides a race on the tempi, not on a lookahead', () => {
		const RACE = '8/8/8/P7/4k3/8/8/6K1';
		expect(value(`${RACE} b - - 0 1`)).toBe(V.pawn);
		expect(value(`${RACE} w - - 0 1`)).toBe(V.pawn + 800);
	});

	it('says nothing is owed when nothing is', () => {
		const c = complex(at('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
		const t = traverse(c);
		expect(t.value).toBe(0);
		expect(deficient(t)).toBe(false);
		expect(say(c, t)).toBe('nothing owed');
	});
});

describe('symmetry, as a property rather than a promise', () => {
	// Reflect and swap colours: the value must negate exactly. An asymmetric
	// build cannot pass this, and the role-parameter code could not even be
	// ASKED — it produced "what side S owes", which has no sign to flip.
	it('negates under reflection', () => {
		for (const fen of [
			'4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1',
			'4k3/8/8/4r3/8/8/8/4RK2 b - - 0 1',
			'4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1',
			'4k3/2R3R1/4n3/8/8/8/8/4K3 w - - 0 1',
			'8/8/8/P7/4k3/8/8/6K1 b - - 0 1',
			'8/8/8/P7/4k3/8/8/6K1 w - - 0 1',
		]) {
			const a = value(fen);
			const b = value(mirror(fen));
			expect(b, `${fen} did not mirror`).toBe(a === 0 ? 0 : -a);
		}
	});

	// The first version of this test looped over the corpus and asserted only
	// that the loop ran. It was a placeholder that read as coverage — the same
	// shape as the tests a mutation audit later found were vacuous — so it does
	// the work now or it does not exist.
	it('negates under reflection on positions nobody picked', () => {
		let checked = 0;
		let mirrored = 0;
		for (const pos of CASES) {
			const fen = makeFen(pos.toSetup());
			let flipped: ReturnType<typeof at>;
			// A mirrored position is not always legal — a pawn on the first rank,
			// a king already in check with the wrong side to move. Those are the
			// reflection's problem, not the traversal's, so they are skipped and
			// counted rather than silently dropped.
			try { flipped = at(mirror(fen)); } catch { continue; }
			checked++;
			const a = traverse(complex(pos)).value;
			const b = traverse(complex(flipped)).value;
			if (b === (a === 0 ? 0 : -a)) mirrored++;
			else expect.fail(`${fen} gave ${a}, its mirror gave ${b}`);
		}
		expect(checked, 'no position mirrored legally — the property is untested').toBeGreaterThan(20);
		expect(mirrored).toBe(checked);
	});
});

describe('Hall’s condition, where §3 says it lives', () => {
	// A piece cannot be in two places AT ONCE — but §4's alternation runs over
	// several rounds, and a piece may well move twice across them. So the property
	// is per ROUND: within one round a piece goes to exactly one square, and two
	// commitments sharing a round are §3.1's move that answers two.
	//
	// The old matching forbade a piece moving twice at all. That was the
	// single-ply reading of Hall's condition, and it is gone with `feasible()`.
	it('sends each piece to one square per round, and answers two where it can', () => {
		let shared = 0;
		for (const pos of CASES) {
			const c = complex(pos);
			const t = traverse(c);
			const seen = new Map<string, { to: Square; cost: number }>();
			for (const s of t.schedule) {
				const k = `${s.side}/${s.round}/${s.piece}`;
				const had = seen.get(k);
				if (!had) {
					seen.set(k, { to: s.to, cost: s.cost });
					continue;
				}
				shared++;
				expect(
					had.to === s.to && had.cost === s.cost,
					`${makeSquare(s.piece)} went to ${makeSquare(had.to)} and ${makeSquare(s.to)} in one round`,
				).toBe(true);
			}
			// And within a round, one move per side: a player makes one move.
			const perRound = new Map<string, Set<number>>();
			for (const s of t.schedule) {
				const k = `${s.side}/${s.round}`;
				const at = perRound.get(k) ?? new Set<number>();
				at.add(s.piece * 64 + s.to);
				perRound.set(k, at);
			}
			for (const [k, at] of perRound) expect(at.size, `two moves in round ${k}`).toBe(1);
		}
		expect(shared, 'no move answered two rows in the sample — §3.1 is untested').toBeGreaterThan(0);
	});

	it('only ever schedules a discharge Γ actually offers', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			const edges = gamma(c);
			for (const s of traverse(c, edges).schedule) {
				const hit = edges.some((e) => e.obligation === s.obligation && e.piece === s.piece && e.cost === s.cost);
				expect(hit, `scheduled a discharge that does not exist`).toBe(true);
			}
		}
	});

	it('spends each side’s tempi only on its own obligations', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			for (const s of traverse(c).schedule) {
				expect(s.side).toBe(other(c.obligations[s.obligation].claimant));
				expect(pos.board.get(s.piece)?.color).toBe(s.side);
			}
		}
	});

});

describe('the arithmetic is the material', () => {
	// §4's alternation, on the smallest position that shows it.
	//
	// Four rooks, all four hanging, White to move. The old traversal picked a best
	// feasible subset to save and SUMMED the rest, so it had White collecting both
	// a8 and h8 while Black collected only h1: +500. The truth is 0 — each side
	// takes one rook, because a collector spends a move on each and the other side
	// moves in between.
	//
	// This is the case that found the largest error in the project, and it is four
	// pieces on an empty board.
	it('lets a collector take one thing per move', () => {
		const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1';
		const c = complex(at(fen));
		const t = traverse(c);
		expect(material(c.board)).toBe(0);
		expect(t.value, 'both prongs collected at once').toBe(0);
		// One rook each, not two and one.
		const per = { white: 0, black: 0 };
		for (const o of t.collected) per[o.claimant]++;
		expect(per.white).toBe(1);
		expect(per.black).toBe(1);
	});

	// Every live row is accounted for exactly once: taken or answered.
	it('accounts for every live row exactly once', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			const t = traverse(c);
			if (t.refused) continue;
			const answered = new Set(t.schedule.map((s) => s.obligation));
			for (const [i, o] of c.obligations.entries()) {
				if (!isLive(o, c.board)) continue;
				const taken = t.collected.includes(o);
				const paid = answered.has(i);
				expect(taken && paid, `${makeSquare(o.square)} was both paid and collected`).toBe(false);
				expect(taken || paid, `${makeSquare(o.square)} was neither paid nor collected`).toBe(true);
			}
		}
	});

	it('is material plus exactly what was collected', () => {
		for (const pos of CASES) {
			const c = complex(pos);
			const t = traverse(c);
			if (!Number.isFinite(t.value)) continue;
			let expected = material(pos.board);
			for (const o of t.collected) expected += o.claimant === 'white' ? o.weight : -o.weight;
			expect(t.value).toBe(expected);
		}
	});

	// Constructed rather than found: the bound is far above anything the corpus
	// produces, so the refusal path needs asking for directly.
	const row = (claimant: Color) => ({
		square: parseSquare('a1') as Square, role: 'rook' as const, weight: 100, deadline: 1,
		claimant, kind: 'immediate' as const, needs: [], enablers: [],
	});
	const bare = () => complex(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));

	it('refuses rather than truncating above the stated bound', () => {
		const c = bare();
		const many = { ...c, obligations: Array.from({ length: MAX_ROWS + 1 }, () => row('white')) };
		const t = traverse(many);
		expect(t.refused).toBe(true);
		expect(say(many, t)).toContain('refusing rather than truncating');
	});

	// The bound is PER SIDE, because the enumeration is per side: 2^n over each
	// side's own rows, never over the union. Held rows took the corpus total to 22
	// while the largest single side stayed well under, so a bound on the total
	// would refuse positions whose actual search is trivial — a refusal reads as
	// "cannot be computed", which would be a lie about those.
	it('bounds each side separately, not the two together', () => {
		const c = bare();
		const split = {
			...c,
			obligations: [
				...Array.from({ length: MAX_ROWS }, () => row('white')),
				...Array.from({ length: MAX_ROWS }, () => row('black')),
			],
		};
		expect(split.obligations.length).toBeGreaterThan(MAX_ROWS);
		expect(traverse(split).refused, 'refused a position neither side alone exceeds').toBe(false);
	});
});

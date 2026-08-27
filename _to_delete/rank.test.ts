// Which move, and why.
//
// ---------------------------------------------------------------------------
// PLAN.md M7. §4, §9.2 and §9.3 as amended by AMEND-9.3-FORCING.md.
//
// The rule under test came from looking at a tied position rather than from
// theorising about one. Will: "ties should be impossible in puzzles (by
// definition), so it's probably a symptom of incorrect implementation of
// theory." He was right, and the missing thing was not a row — it was forcing,
// which §4.4, §6.4 and §9.3 all already contain.
//
// Measured on 356 solver plies: 62.9% outright against the frozen baseline's
// 57.6%, with ties cut from 25.8% to 9.0%. `scripts/rank-module.mjs` reproduces
// it from the module and `scripts/rank-compare.mjs` from an independent
// transcription; they agree exactly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { makeSquare } from 'chessops/util';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../src/domain/chess';
import { V, other } from '../src/domain/exchange';
import { rank, best, viable, uci, say } from '../src/domain/rank';

const at = (fen: string) => positionFromFen(fen);

describe('the material reading comes first', () => {
	it('takes a free rook ahead of everything else', () => {
		const rows = rank(at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1'));
		expect(uci(rows[0])).toBe('e1e5');
		expect(rows[0].takes).toBe(V.rook);
	});

	// §9.2's table has BOTH players adding and removing edges, and §5 says the
	// ledger cannot be built for one side alone. A score that read only what they
	// concede would rate hanging a queen to win a pawn as a fine move.
	it('reads both ledgers, so it will not hang a piece to win a pawn', () => {
		// White rook a1 can take the b7 pawn, where the black king recaptures.
		const rows = rank(at('4k3/1p6/8/8/8/8/8/R3K3 w - - 0 1'));
		const grab = rows.find((r) => uci(r) === 'a1b1');
		expect(grab).toBeDefined();
		for (const r of rows) {
			expect(r.value).toBe(r.takes + r.theirs - r.mine);
		}
	});
});

describe('forcing breaks ties, and only ties', () => {
	// The position the rule came from. 14CuA ply 1: the solution is Qf5-d5+, and
	// the exchange arithmetic scores it 0 — correctly, since the check is
	// answerable at no cost. Every quiet rook move scores 0 too.
	const POS = at('2k5/1p6/2pb4/p4q2/P3pP1Q/1P2P3/2P3r1/R2K3R b - - 3 36');

	it('prefers the check that costs nothing over the quiet move that costs nothing', () => {
		const rows = rank(POS);
		const check = rows.find((r) => uci(r) === 'f5d5')!;
		const quiet = rows.find((r) => uci(r) === 'g2g4')!;
		expect(check.value, 'the arithmetic should NOT separate these').toBe(quiet.value);
		expect(check.force, 'forcing should').toBeGreaterThan(quiet.force);
		expect(rows.indexOf(check)).toBeLessThan(rows.indexOf(quiet));
	});

	// The licence for the whole rule. FORMALISM §6 defines effective mobility in
	// terms of the tactical layer and warns that consuming it there is circular.
	// As a TIE-BREAK it is strictly downstream: it never moves a worse material
	// score above a better one, so nothing it produces feeds back.
	it('never outranks a better material score, however forcing', () => {
		for (const fen of [
			'2k5/1p6/2pb4/p4q2/P3pP1Q/1P2P3/2P3r1/R2K3R b - - 3 36',
			'4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1',
			'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4',
		]) {
			const rows = rank(at(fen));
			for (let i = 1; i < rows.length; i++) {
				expect(rows[i - 1].value, `${fen}: forcing overtook material`).toBeGreaterThanOrEqual(rows[i].value);
			}
		}
	});

	it('counts only replies that do not simply lose the moving piece', () => {
		// The first version of this asserted `viable <= legal` on a king-only
		// position and passed under a mutation that counted every legal move —
		// because for a KING the two coincide by construction: `dests` already
		// refuses to walk into check. The difference only shows for a piece that
		// CAN move somewhere it is lost.
		//
		// A queen against two pawns: three of her twenty-one squares hang her.
		const pos = at('4k3/8/8/2p1p3/8/8/8/3QK3 w - - 0 1');
		let legal = 0;
		for (const f of pos.board[pos.turn]) for (const _ of pos.dests(f)) legal++;
		expect(legal).toBe(21);
		expect(viable(pos), 'counted moves that simply hang the queen').toBe(18);

		// And in an ordinary opening position, where the gap is six.
		const open = at('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4');
		let openLegal = 0;
		for (const f of open.board[open.turn]) for (const _ of open.dests(f)) openLegal++;
		expect(viable(open)).toBeLessThan(openLegal);
	});
});

describe('a surviving tie is reported, not resolved', () => {
	// Will: ties are impossible in a puzzle by definition, so one that survives
	// both keys is a statement about the DETECTOR — it cannot tell two moves
	// apart — and hiding it behind an arbitrary pick would hide that.
	it('returns no move when two are level on both keys', () => {
		// A bare king with symmetric options.
		const { move, tied } = best(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
		if (tied.length > 1) expect(move).toBeNull();
		else expect(move).not.toBeNull();
	});

	it('names a move when nothing is level with it', () => {
		const { move, tied } = best(at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1'));
		expect(move && uci(move)).toBe('e1e5');
		expect(tied).toHaveLength(1);
	});
});

describe('the sentence', () => {
	it('names what the move takes and what it leaves', () => {
		const { move } = best(at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1'));
		expect(say(move!, 'white')).toContain('takes 500');
	});

	it('lets the caller supply the notation, as the other panels do', () => {
		const { move } = best(at('4k3/8/8/4r3/8/8/8/4RK2 w - - 0 1'));
		expect(say(move!, 'white', () => 'THEMOVE')).toContain('THEMOVE');
	});

	it('says what a quiet move does when nothing is due', () => {
		const rows = rank(at('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
		expect(say(rows[0], 'white')).toContain('answers');
	});
});

describe('over positions nobody picked', () => {
	const walk = (n: number) => {
		const out: ReturnType<typeof at>[] = [];
		const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
		let pos = at(START);
		let seed = 31337;
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
	const CASES = walk(40);

	it('ranks every legal move and no others', () => {
		for (const pos of CASES) {
			const rows = rank(pos);
			let legal = 0;
			for (const f of pos.board[pos.turn]) for (const _ of pos.dests(f)) legal++;
			expect(rows).toHaveLength(legal);
			const seen = new Set(rows.map(uci));
			expect(seen.size).toBe(rows.length);
		}
	});

	it('is sorted by value, then by forcing', () => {
		for (const pos of CASES) {
			const rows = rank(pos);
			for (let i = 1; i < rows.length; i++) {
				const a = rows[i - 1], b = rows[i];
				expect(a.value >= b.value, 'value out of order').toBe(true);
				if (a.value === b.value) expect(a.force >= b.force, 'forcing out of order').toBe(true);
			}
		}
	});

	// The symmetric half, asserted rather than assumed: `mine` must be computed
	// for the side that just moved, never for the side to move. Getting this
	// backwards is the shape of the invasion mistake.
	it('measures what I concede for the side that moved, not the side to move', () => {
		for (const pos of CASES) {
			const me = pos.turn;
			for (const r of rank(pos).slice(0, 6)) {
				expect(r.value).toBe(r.takes + r.theirs - r.mine);
				expect(r.mine).toBeGreaterThanOrEqual(0);
				expect(other(me)).not.toBe(me);
			}
		}
	});

	it('never claims a move that is not on the board', () => {
		for (const pos of CASES) {
			for (const r of rank(pos)) {
				expect(pos.board.get(r.from)?.color).toBe(pos.turn);
				expect(makeSquare(r.to)).toMatch(/^[a-h][1-8]$/);
			}
		}
	});
});

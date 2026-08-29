// The sentences have to say what the numbers say.
//
// ---------------------------------------------------------------------------
// A narrator is the one component that can be confidently wrong: it reads a
// tree of numbers and produces English, and English that disagrees with the
// numbers is worse than no English at all — it is the app telling the reader
// something it does not believe.
//
// So these check the joins where a sign or a subject can flip: a value is from
// the MOVER's point of view, and the sentence has to name whoever is actually
// ahead.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { narrate } from '../src/domain/narrate';
import type { Branch } from '../src/domain/chain';
import { makeSan } from 'chessops/san';
import { parseSquare } from 'chessops/util';
import type { Chess } from 'chessops/chess';
import type { NormalMove } from 'chessops/types';

const at = (fen: string) => positionFromFen(fen);
const mv = (from: string, to: string, promotion?: 'queen'): NormalMove =>
	({ from: parseSquare(from), to: parseSquare(to), ...(promotion ? { promotion } : {}) }) as NormalMove;

const deps = {
	name: (pos: Chess, m: NormalMove) => makeSan(pos, m),
	amount: (cp: number) => `${(cp / 100).toFixed(1)} pawns`,
	play: (pos: Chess, m: NormalMove) => {
		const n = pos.clone();
		n.play(m);
		return n;
	},
	takes: (pos: Chess, m: NormalMove) => {
		const victim = pos.board.get(m.to);
		const V = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
		return victim ? V[victim.role] : 0;
	},
};

describe('narration', () => {
	const pos = at('2R5/P2k4/1Kp3p1/5p2/1P2b1p1/6P1/r6P/8 w - - 7 53');
	const branch: Branch = {
		move: mv('a7', 'a8', 'queen'),
		value: 400,
		forced: false,
		options: 1,
		legal: 20,
		replies: [
			{ move: mv('a2', 'a8'), value: -400, forced: false, options: 1, legal: 18, replies: [] },
		],
	};

	it('says who is ahead, not who is moving', () => {
		const n = narrate(pos, branch, [], deps);
		// +400 to White, who is the mover here.
		expect(n.closing).toContain('White ahead by 4.0 pawns');
		// And the same number from Black's side of a Black-to-move position must
		// not come out as "Black ahead".
		const flipped = narrate(pos, { ...branch, value: -400 }, [], deps);
		expect(flipped.closing).toContain('Black ahead by 4.0 pawns');
	});

	it('opens with what the move actually takes', () => {
		const n = narrate(pos, branch, [], deps);
		expect(n.opening).toMatch(/a8=Q/);
		// The promotion square is empty — the move captures nothing.
		expect(n.opening).toContain('takes nothing immediately');
	});

	it('names the reply and says how constrained it was', () => {
		const n = narrate(pos, branch, [], deps);
		expect(n.line[0]).toContain('Black');
		expect(n.line[0]).toContain('Rxa8');
		expect(n.line[0]).toMatch(/one reply that holds/);
	});

	it('compares against the best alternative', () => {
		const n = narrate(pos, branch, [{ move: mv('c8', 'c7'), score: 0 }], deps);
		expect(n.closing).toContain('Rc7');
		expect(n.closing).toContain('4.0 pawns less');
	});
});

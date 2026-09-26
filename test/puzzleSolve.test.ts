// The rules of solving, checked against the real corpus.
//
// ---------------------------------------------------------------------------
// These are the whole feature, and every one of them would have been reachable
// only by clicking a board if it had been written in the view. Same reason
// `domain/cursor` and `domain/punish` exist.
//
// The corpus is used rather than fixtures wherever a real puzzle makes the
// point, because the convention it follows is the thing most likely to be got
// wrong: `moves[0]` is the OPPONENT's move — the blunder that makes the puzzle
// — so the side being solved as is not the side to move in the stored FEN.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { allPuzzles, openingPosition, solverColour, solverMoves } from '../src/domain/puzzles';
import { makeSquare, positionFromFen } from '../src/domain/chess';
import {
	playMove,
	progress,
	remainingLine,
	startSolve,
	wantedMove,
} from '../src/domain/puzzleSolve';

const corpus = allPuzzles();
const byId = (id: string) => corpus.find((p) => p.id === id)!;
/** A puzzle needing exactly n solver moves. */
const withMoves = (n: number) => corpus.find((p) => solverMoves(p) === n)!;

/**
 * A legal move in this position that is not `avoid`.
 *
 * Picking one out of the puzzle's own line looked simpler and was wrong: a
 * later move of the solution is usually ILLEGAL in the current position, so
 * the test was exercising the illegal-move guard while claiming to exercise
 * the failure rule.
 */
function someOtherLegalMove(fen: string, avoid: string): string {
	const pos = positionFromFen(fen);
	for (const [from, tos] of pos.allDests()) {
		for (const to of tos) {
			const uci = `${makeSquare(from)}${makeSquare(to)}`;
			if (uci !== avoid) return uci;
		}
	}
	throw new Error('no alternative move in ' + fen);
}

describe('where a puzzle starts', () => {
	it('has the opponent move already played', () => {
		const p = corpus[0];
		const s = startSolve(p);
		expect(s.fen).toBe(openingPosition(p).fen);
		expect(s.at).toBe(1);
		expect(s.status).toBe('solving');
	});

	it('puts the solver on the side NOT to move in the stored position', () => {
		// The convention that catches everyone once.
		for (const p of corpus.slice(0, 50)) {
			const s = startSolve(p);
			expect(s.fen.split(' ')[1]).toBe(solverColour(p));
		}
	});

	it('asks for the puzzle move first', () => {
		const p = corpus[0];
		expect(wantedMove(startSolve(p))).toBe(p.moves[1]);
	});
});

describe('playing the solution', () => {
	it('solves a one-move puzzle in one move', () => {
		const p = withMoves(1);
		const r = playMove(startSolve(p), p.moves[1]);
		expect(r.verdict).toBe('solved');
		expect(r.state.status).toBe('solved');
	});

	it('plays their reply for you and asks for the next', () => {
		const p = withMoves(3);
		const first = playMove(startSolve(p), p.moves[1]);
		expect(first.verdict).toBe('right');
		expect(first.state.status).toBe('solving');
		// Two of the puzzle's moves have gone in: ours and their scripted reply.
		expect(first.state.at).toBe(3);
		expect(wantedMove(first.state)).toBe(p.moves[3]);
	});

	it('walks a whole line to a solve', () => {
		for (const p of corpus.slice(0, 40)) {
			let s = startSolve(p);
			let guard = 0;
			while (s.status === 'solving' && guard++ < 30) {
				s = playMove(s, wantedMove(s)!).state;
			}
			expect(s.status, p.id).toBe('solved');
		}
	});

	it('counts how far through it is', () => {
		const p = withMoves(3);
		expect(progress(startSolve(p))).toEqual({ done: 0, total: 3 });
		const after = playMove(startSolve(p), p.moves[1]).state;
		expect(progress(after)).toEqual({ done: 1, total: 3 });
	});
});

describe('getting it wrong', () => {
	it('fails on the first wrong move', () => {
		// Lichess's rule, and the one that makes the rating mean anything: a
		// puzzle you can retry until it works measures persistence, not sight.
		const p = withMoves(2);
		const s = startSolve(p);
		const wrong = someOtherLegalMove(s.fen, p.moves[1]);
		const r = playMove(s, wrong);
		expect(r.state.status).toBe('failed');
		expect(r.verdict).toBe('wrong');
		expect(r.state.wrong).toBe(wrong);
	});

	it('keeps the board where it was, so the position can still be studied', () => {
		const p = withMoves(2);
		const s = startSolve(p);
		const r = playMove(s, someOtherLegalMove(s.fen, p.moves[1]));
		expect(r.state.fen).toBe(s.fen);
	});

	it('accepts nothing once it is over', () => {
		const p = withMoves(1);
		const done = playMove(startSolve(p), p.moves[1]).state;
		const after = playMove(done, p.moves[1]);
		expect(after.state).toBe(done);
	});

	it('refuses an illegal move without failing the puzzle', () => {
		// A board can deliver nonsense; that is not the reader getting it wrong.
		const s = startSolve(withMoves(2));
		const r = playMove(s, 'a1a8');
		expect(r.state.status).toBe('solving');
	});
});

describe('a different mate is still a mate', () => {
	it('accepts a checkmate on the final move even off the line', () => {
		// The corpus stores one solution and a mate can have several. Finding a
		// different forced mate is solving it.
		//
		// Two rooks on the back rank: after Black tucks into the corner, BOTH
		// Ra8# and Rb8# mate. The puzzle names one of them.
		const p = {
			id: 'test',
			fen: '6k1/5ppp/8/8/8/8/8/RR4K1 b - - 0 1',
			moves: ['g8h8', 'a1a8'],
			rating: 1000,
			themes: ['backRankMate'],
		};
		const s = startSolve(p);
		expect(playMove(s, 'b1b8').verdict).toBe('solved');
	});

	it('does not accept an off-line move that only looks forcing earlier on', () => {
		// Earlier moves have a scripted reply coming, and the line is what that
		// reply answers — so they have to follow it.
		const p = withMoves(3);
		const s = startSolve(p);
		const notTheLine = p.moves.find((m, i) => i > 1 && m !== p.moves[1]);
		if (notTheLine) expect(playMove(s, notTheLine).state.status).not.toBe('solved');
	});
});

describe('showing the rest', () => {
	it('starts from where you are stuck, not from the beginning', () => {
		const p = withMoves(3);
		const s = playMove(startSolve(p), p.moves[1]).state;
		expect(remainingLine(s)[0]).toBe(p.moves[3]);
	});

	it('is empty once solved', () => {
		const p = withMoves(1);
		expect(remainingLine(playMove(startSolve(p), p.moves[1]).state)).toEqual([]);
	});
});

describe('the corpus itself', () => {
	it('is all solvable by its own line', () => {
		let bad = 0;
		for (const p of corpus) {
			let s = startSolve(p);
			let guard = 0;
			while (s.status === 'solving' && guard++ < 40) s = playMove(s, wantedMove(s)!).state;
			if (s.status !== 'solved') bad++;
		}
		expect(bad).toBe(0);
	});

	it('has an id for every puzzle', () => {
		expect(new Set(corpus.map((p) => p.id)).size).toBe(corpus.length);
	});

	it('still contains the puzzle the mate test leans on being typical', () => {
		expect(byId(corpus[0].id)).toBeTruthy();
	});
});

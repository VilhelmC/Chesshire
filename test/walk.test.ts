// The positions between two positions.
//
// ---------------------------------------------------------------------------
// Replaying the plies of a jump is the difference between "something changed"
// and "we went back that way". The only thing that can go wrong in it is the
// off-by-one at each end — include the start and the board stutters on a
// position it is already showing, include the end and it lands twice, once
// without its `lastMove` highlight.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { walkBack, walkBackTo, walkThrough } from '../src/domain/walk';
import { lineFromSan, positionsOf, stepAt } from '../src/domain/line';
import { INITIAL_FEN } from '../src/domain/chess';

const P = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];

describe('walking between two plies', () => {
	it('excludes both ends, going back', () => {
		expect(walkThrough(P, 5, 1)).toEqual({ to: 'p1', through: ['p4', 'p3', 'p2'] });
	});

	it('excludes both ends, going forward', () => {
		expect(walkThrough(P, 1, 5)).toEqual({ to: 'p5', through: ['p2', 'p3', 'p4'] });
	});

	it('declines a single step, which already animates correctly', () => {
		// Chessground's own animation is exactly right for one move; interposing
		// a step would only delay it.
		expect(walkThrough(P, 3, 4)).toBeNull();
		expect(walkThrough(P, 4, 3)).toBeNull();
	});

	it('declines a jump to where it already is', () => {
		expect(walkThrough(P, 2, 2)).toBeNull();
	});

	it('declines rather than throwing on an index it does not have', () => {
		// The caller is deriving these from a path that can change underneath it;
		// a missing walk is a jump, which is survivable, and a crash is not.
		expect(walkThrough(P, 0, 99)).toBeNull();
		expect(walkThrough(P, -1, 2)).toBeNull();
		expect(walkThrough([], 0, 1)).toBeNull();
	});

	it('names the destination it walked to', () => {
		// The board checks this against the position it is being set to, so a
		// stale walk cannot be replayed at the wrong moment.
		expect(walkThrough(P, 0, 3)?.to).toBe('p3');
	});
});

describe('walking back out of a borrowed line', () => {
	// A line's cursor is −1 before its first move, so index 0 of the positions
	// is that starting board and the cursor sits at `at + 1`.
	const LINE = ['start', 'after1', 'after2', 'after3'];

	it('unplays the moves in reverse and lands on the game', () => {
		expect(walkBackTo(LINE, 2, 'game')).toEqual({
			to: 'game',
			through: ['after2', 'after1', 'start'],
		});
	});

	it('still walks back the one move when only one has been played', () => {
		// Unlike `walkThrough`, one step here is worth showing: the destination is
		// a position the line does not contain, so this is two hops, not one.
		expect(walkBackTo(LINE, 0, 'game')).toEqual({ to: 'game', through: ['start'] });
	});

	it('has nothing to unplay at the head of the line', () => {
		expect(walkBackTo(LINE, -1, 'game')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// AND THE OFFSET A BORROWED LINE IS INDEXED BY.
//
// A line's cursor is −1 before its first move, so `positionsOf` is one entry
// longer than the line and the cursor at `at` sits at `at + 1`. Every caller
// animating between two cursor positions depends on that, and getting it wrong
// shows the destination twice or skips the first move — both of which look like
// a timing bug rather than an arithmetic one when you are watching pieces move.
// ---------------------------------------------------------------------------
describe('the positions a line passes through', () => {
	const line = lineFromSan(INITIAL_FEN, ['e4', 'e5', 'Nf3']);

	it('is one longer than the line, because it includes where it started', () => {
		expect(positionsOf(line)).toHaveLength(4);
		expect(positionsOf(line)[0]).toBe(INITIAL_FEN);
	});

	it('puts the cursor at `at + 1`', () => {
		const p = positionsOf(line);
		expect(p[-1 + 1]).toBe(stepAt(line, -1).fen);
		expect(p[0 + 1]).toBe(stepAt(line, 0).fen);
		expect(p[2 + 1]).toBe(stepAt(line, 2).fen);
	});

	it('walks the whole line back to its start, one move at a time', () => {
		// "Back to the start of the line" — the control that was still teleporting.
		const p = positionsOf(line);
		const walk = walkThrough(p, 2 + 1, -1 + 1);
		expect(walk).toEqual({ to: p[0], through: [p[2], p[1]] });
	});
});

describe('the walk back to an earlier ply and off down a different move', () => {
	// Will: "I asked you before that whenever we rewind the animation is a single
	// move at a time. That is not happening when user clicks 'new reply'."
	//
	// "New reply" is a rewind FOLLOWED BY a different move, so the board ends up
	// somewhere this game's positions do not contain — which is why neither
	// `walkThrough` nor `walkBackTo` described it, and why nothing animated.
	const fens = ['p0', 'p1', 'p2', 'p3', 'p4'];

	it('steps back through every ply, including the one being returned to', () => {
		// From ply 4 back to ply 1, then off to a position that is not in the game.
		expect(walkBack(fens, 4, 1, 'other')).toEqual({
			to: 'other',
			through: ['p3', 'p2', 'p1'],
		});
	});

	it('handles a branch from the position one ply back', () => {
		expect(walkBack(fens, 2, 1, 'other')).toEqual({ to: 'other', through: ['p1'] });
	});

	it('does not show the same position twice running', () => {
		// The destination can BE the ply returned to, when nothing has been played
		// from it yet. Repeating it is a dropped frame that reads as a stutter.
		expect(walkBack(fens, 3, 1, 'p1')).toEqual({ to: 'p1', through: ['p2'] });
		// …and with nothing left in between, there is no walk at all.
		expect(walkBack(fens, 2, 1, 'p1')).toBe(null);
	});

	it('refuses a walk that is not backwards, or is out of range', () => {
		expect(walkBack(fens, 1, 3, 'other')).toBe(null);
		expect(walkBack(fens, 2, 2, 'other')).toBe(null);
		expect(walkBack(fens, 9, 1, 'other')).toBe(null);
		expect(walkBack(fens, 3, -1, 'other')).toBe(null);
	});
});

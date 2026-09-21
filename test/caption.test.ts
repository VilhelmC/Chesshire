// The line above the board says the same thing on every board.
//
// ---------------------------------------------------------------------------
// Will: "perhaps that message should be part of the standard machinery
// everything consumes, so a board is always displayed with the line it belongs
// to if such a line exists."
//
// Two claims to hold down. The arithmetic — which move number a ply is on —
// because it was wrong in one of the four copies and nobody noticed. And the
// PRECEDENCE of the two name sources, because that is the rule that had been
// applied independently in three files and is the one that decides whether the
// same position gets two names on two tabs.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { moveNumber, nameOf, whereYouAre } from '../src/domain/caption';
import { nameForPath, openingForPath } from '../src/domain/openings';

describe('the move number a ply sits on', () => {
	it('counts the move about to be played, not the one just made', () => {
		// Nothing played: White is on move 1.
		expect(moveNumber(0)).toBe(1);
		// 1.e4 played: Black is still on move 1.
		expect(moveNumber(1)).toBe(1);
		// 1.e4 e5: White is on move 2.
		expect(moveNumber(2)).toBe(2);
		// Will's example: eight half-moves in, it is move 5.
		expect(moveNumber(8)).toBe(5);
		expect(moveNumber(9)).toBe(5);
	});

	it('does not go below one', () => {
		// A negative ply is a bug upstream, and "move 0" would carry it onto the
		// screen as though it meant something.
		expect(moveNumber(-3)).toBe(1);
	});
});

describe('which source names the position', () => {
	const path = ['e4', 'e5', 'Nf3', 'Nc6', 'd4'];

	it('takes the explorer over the table, because it saw the position', () => {
		// The table has its own answer for this path; the explorer's wins.
		expect(nameForPath(path)?.name).toBeTruthy();
		expect(nameOf({ path, opening: 'Scotch Game' })).toBe('Scotch Game');
	});

	it('falls back to the table when the explorer said nothing', () => {
		// Both flavours of "said nothing": never fetched, and fetched and null.
		const fromTable = nameForPath(path)?.name ?? null;
		expect(fromTable).toBeTruthy();
		expect(nameOf({ path })).toBe(fromTable);
		expect(nameOf({ path, opening: null })).toBe(fromTable);
	});

	it('treats an empty name as no name', () => {
		// The explorer returns '' for a position it half-recognises, and `??`
		// would have kept it — which puts a caption reading ", move 3" on screen.
		expect(nameOf({ path, opening: '  ' })).toBe(nameForPath(path)?.name ?? null);
	});

	it('is null only before a move has been played', () => {
		// Measured, not assumed: EVERY legal first move is in the table, and
		// `nameForPath` inherits the longest named prefix. So once one move has
		// been played there is always a name, however far the game has since
		// wandered — which is the point. The caption asks what line this position
		// BELONGS to, and a game that opened 1.a3 is still in Anderssen's at move
		// 30. The bare "move n" branch below is the defensive one, and this is the
		// note that says so.
		expect(nameOf({ path: [] })).toBe(null);
		expect(nameOf({ path: ['a3', 'h6', 'a4', 'h5', 'Ra3'] })).toBe("Anderssen's opening");
	});
});

describe('the line itself', () => {
	it('is silent at the start, where nobody needs telling', () => {
		expect(whereYouAre({ path: [] })).toBe(null);
		expect(whereYouAre({ path: [], ply: 0 })).toBe(null);
	});

	it('reads "<name>, move <n>"', () => {
		expect(whereYouAre({ path: ['e4', 'e5', 'Nf3', 'Nc6'], opening: 'Scotch Game' })).toBe(
			'Scotch Game, move 3',
		);
	});

	it('still says which move it is when nothing names the position', () => {
		// The half that is always available. A board that cannot say WHAT it is
		// can always say WHERE it is, and saying nothing was the old behaviour.
		// Reachable only with no path at all — see the note above.
		expect(whereYouAre({ path: [], ply: 5 })).toBe('move 3…');
	});

	it('marks a black move with the notation that means it', () => {
		// "3…" is Black's third. The mistake deck's rows were already written
		// this way, and a card's row and the line above its board describe the
		// same card — disagreeing about whose move it was reads as a bug.
		expect(whereYouAre({ path: ['e4', 'e5', 'Nf3'] })).toContain('…');
		expect(whereYouAre({ path: ['e4', 'e5'] })).not.toContain('…');
	});

	it('takes an explicit ply over the path length', () => {
		// A mistake card carries the ply it was made at, and cards old enough to
		// have no path have nothing else to go on.
		expect(whereYouAre({ path: [], ply: 8 })).toBe('move 5');
	});
});

describe('the openings index', () => {
	// `nameForPath` went from "asked when you pin an opening" to "asked on every
	// render of every board", so it was reindexed. These pin the behaviour the
	// scan had, since the scan is no longer there to compare against.
	it('finds the longest named prefix', () => {
		const deep = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5'];
		const hit = nameForPath(deep);
		expect(hit).not.toBe(null);
		// It is a prefix, and it is the longest one that is named.
		expect(deep.slice(0, hit!.path.length)).toEqual(hit!.path);
		for (let n = deep.length; n > hit!.path.length; n--) {
			expect(openingForPath(deep.slice(0, n))).toBe(null);
		}
	});

	it('matches exactly for a path that is itself a name', () => {
		const hit = nameForPath(['e4', 'e5', 'Nf3', 'Nc6', 'd4']);
		expect(hit?.path).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'd4']);
	});

	it('knows nothing about an empty path', () => {
		expect(nameForPath([])).toBe(null);
		expect(openingForPath([])).toBe(null);
	});
});

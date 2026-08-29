// PIN — and the two thirds of it that did not survive measurement.
//
// ---------------------------------------------------------------------------
// WHAT WAS BUILT. One geometry, three names. A slider bears along a ray; one man
// of the other side stands on it; behind that man, on the same ray, stands
// another. Which name it gets depends on what the two are worth:
//
//   ABSOLUTE PIN   the man behind is the KING. The shield cannot legally leave
//                  the ray at all. A rule of chess, not a judgement.
//   RELATIVE PIN   the man behind is worth MORE. The shield may move and loses
//                  material when it does.
//   SKEWER         the man behind is worth LESS. The shield is the prize, and it
//                  is the one being asked to step aside.
//
// ---------------------------------------------------------------------------
// WHAT SURVIVED. `scripts/m5-ablate.mjs`, 2,656 solver plies, stratified by
// rating x plies-left:
//
//   absolute, created by the answer   LIFT +43.6%   decoration 1.4%   n=69
//   relative, created by the answer   LIFT  +1.5%   decoration 8.0%   n=215
//   skewer,   created by the answer   LIFT  +1.0%   decoration 3.3%   n=89
//
// The absolute pin is a detector on a par with forks (+50.5% / 2.4%). The other
// two are at the base rate: they fire, and knowing they fired tells a reader
// nothing they did not already know from the position being hard.
//
// THE FAILURE IS THE CONCEPT AND NOT THE DEFINITION, which is the control that
// had to be run before deleting anything. "V[behind] > V[front]" fires on a pawn
// shielding a knight, which is not what anybody means by a relative pin, so the
// concept was narrowed six ways to see whether a better definition rescued it:
//
//   relative + the pinner survives     +1.6%    relative + a real piece   +0.0%
//   relative + we can pile on          +7.8%    (n=39)
//   relative + all three               -6.1%    (n=7)
//   relative + the stake is a queen    -6.9%    0% recall, n=44
//
// Narrowing does not rescue it; the two rows with any lift have collapsed to
// anecdote size. The skewer behaves the same way — +14.7% at n=9, which is not a
// detector but a handful of positions. Both are deleted, per Rule 9, with the
// reasoning kept here rather than the code.
//
// RULE 8, and it passes. +43.6% against `pin` is only about pins if it is not
// +43.6% against everything. The same row against unrelated themes: fork -7.8%,
// backRankMate -6.8%, advancedPawn -6.7%, sacrifice -4.9%, skewer -5.7%. The one
// positive is `discoveredAttack` at +4.8% — a genuine cousin, since uncovering a
// line is how many pins arrive — and a tenth of the size.
//
// ---------------------------------------------------------------------------
// AND SO THIS FILE WRAPS `pinsFor` RATHER THAN REIMPLEMENTING IT.
//
// The first version reimplemented the ray walk, on the reasoning that
// `exchange.ts`'s `pinsFor` returns the legal-move mask a search wants rather
// than the three men an overlay draws, and cannot see the relative case at all.
// The second half of that was true and is now irrelevant: there is no relative
// case to see. What is left is exactly what `pinsFor` has found since the
// solver arc, and a second implementation of the same geometry is a second thing
// to keep correct. `scripts/m5-equiv.mjs` checked the two agree on every solver
// ply before the original was removed.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Color, NormalMove, Square } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import type { Board } from 'chessops/board';
import { other, pinsFor } from '../exchange';
import { after, moves, type Mark } from './core';

export type Pin = {
	/** The slider doing it. */
	pinner: Square;
	/** The man that cannot move — the one an overlay rings first. */
	shield: Square;
	/** The king it is stuck in front of. */
	king: Square;
	/** Whose man is stuck. */
	colour: Color;
};

/**
 * Every absolute pin against `colour`'s men.
 *
 * Both colours are worth drawing and the caller chooses: "what of mine cannot
 * move" and "what of theirs cannot move" are the same overlay from two sides,
 * and a learner needs both.
 */
export function pinsOn(board: Board, colour: Color): Pin[] {
	const king = board.kingOf(colour);
	if (king === undefined) return [];
	const out: Pin[] = [];
	for (const [shield, allowed] of pinsFor(board, colour)) {
		// `pinsFor` returns the squares the shield may still legally move to: the
		// span between pinner and king, plus the pinner itself. The pinner is
		// therefore the one square in that set the OTHER side occupies, which is
		// how the overlay recovers the third man from a mask built for a search.
		let pinner: Square | undefined;
		for (const square of allowed.intersect(board[other(colour)])) pinner = square;
		if (pinner === undefined) continue;
		out.push({ pinner, shield, king, colour });
	}
	return out;
}

/** Every absolute pin on the board, both colours. */
export function pins(pos: Chess): Pin[] {
	return [...pinsOn(pos.board, 'white'), ...pinsOn(pos.board, 'black')];
}

/** The ones binding the side to move — what of theirs cannot move. */
export function pinsAgainstMover(pos: Chess): Pin[] {
	return pinsOn(pos.board, pos.turn);
}

/** The ones the side to move holds on the opponent. */
export function pinsHeld(pos: Chess): Pin[] {
	return pinsOn(pos.board, other(pos.turn));
}

const key = (p: Pin) => `${p.pinner}|${p.shield}`;

/**
 * Pins this move CREATES against the opponent.
 *
 * The reading that measured: a `pin`-themed puzzle labels the move that SETS the
 * pin, not a position that happens to contain one. The difference is not small —
 * "the mover already holds a pin" fires on 27.9% of plies for +9.0%, where this
 * fires on 2.6% for +43.6%. A detector that reports the standing state of the
 * board is describing the board; one that reports what a move did is describing
 * the move.
 */
export function pinsCreated(pos: Chess, move: NormalMove): Pin[] {
	const us = pos.turn;
	const had = new Set(pinsOn(pos.board, other(us)).map(key));
	return pinsOn(after(pos, move).board, other(us)).filter((p) => !had.has(key(p)));
}

/** Moves that pin something of the opponent's against its king. */
export function pinningMoves(pos: Chess): NormalMove[] {
	return moves(pos).filter((m) => pinsCreated(pos, m).length > 0);
}

// ---------------------------------------------------------------------------

/** Turn a pin into something drawable. The shield comes first: it is the subject. */
export function pinMark(p: Pin): Mark {
	return {
		squares: [p.shield, p.king, p.pinner],
		note: `${makeSquare(p.shield)} is pinned to the king by ${makeSquare(p.pinner)}`,
	};
}

// Material at a distance: who gets there first.
//
// ---------------------------------------------------------------------------
// The failure attribution (MISSING.md) put four of the twelve unfixable plies in
// one family: king-and-pawn endgames where the material is real — Stockfish has
// them at +333 to +593 — and arrives ten or more plies out, after a king walks
// across the board and a pawn queens. The stop counter says the attacker had no
// coercive move at all, so the branch returned its stand-pat value immediately.
// No amount of extra searching reaches that; it has to be computable where the
// search stops.
//
// Will: "I think we should go ahead and build the king-and-pawn term (though this
// is actually a generic race motif and could have other piece type
// participants)."
//
// Which is the right generalisation, and it is the same shape as race.ts. That
// file asks one question — can this pawn reach the eighth rank before anything
// stops it — and the answer is a comparison of distances in the pieces' own move
// graphs. The question here is the general one:
//
//     Can I reach a square attacking that target before they can reach a square
//     defending it, by enough of a margin that the capture is not answered?
//
// A king walking at a backward pawn is one instance. A knight heading for a
// square nothing covers is another. The pawn race is the third, and race.ts
// stays separate because promotion changes the piece's value, which this does
// not model.
//
// Everything is biased in the defender's favour, for the same reason as in
// race.ts: this term can produce material out of a quiet position, so it must
// under-fire rather than over-fire.
//
//   * The attacker's king may not walk through squares the enemy attacks; the
//     defender's may. One is the rule, the other is generosity.
//   * The defender's distances ignore pins and legality entirely.
//   * The attacker needs a clear margin, not a tie.
//   * The prize must be undefended when it is taken, checked by `see` on the
//     board as it will then be, not as it is now.
//   * The value is discounted per move of the walk, because material three moves
//     away is not material now — the same discount race.ts applies to pushes.
// ---------------------------------------------------------------------------

import { attacks } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Chess } from 'chessops/chess';
import type { Color, Square, Role } from 'chessops/types';
import { V, other, capturersOn } from './exchange';

/**
 * Where this term is allowed to look at all.
 *
 * The first version asked the question everywhere, and it was unusable: any
 * position with a loose enemy piece ran a breadth-first search for every one of
 * my pieces against every one of theirs, at every leaf. It never finished a
 * sixty-position benchmark.
 *
 * It is also the wrong question everywhere. A march takes moves, and moves are
 * only available when nobody is doing anything more urgent — which is what an
 * endgame is. In a middlegame the same material is decided by the tactics the
 * search already sees. So: few enough pieces that walking is a plan, and only
 * kings and knights doing the walking, at pawns nobody is defending.
 */
const MAX_PIECES = 5;

/** How far a piece may travel for this to count as a race rather than a plan. */
const MAX_MARCH = 4;

/** Charged per move of the walk: material four moves away is not material now. */
const PER_MOVE = 60;

/** The margin the attacker needs. A tie goes to the defender, always. */
const MARGIN = 1;

/**
 * Fewest moves for the piece on `from` to stand somewhere it attacks `target`.
 *
 * Breadth-first over the piece's own move graph on the current occupancy, so a
 * slider is blocked by what is actually in the way and a king walks one square at
 * a time. `avoid` are squares this piece may not stand on — for a king, every
 * square the enemy attacks, since walking into check is not a move.
 */
export function timeToAttack(
	pos: Chess,
	from: Square,
	target: Square,
	avoid: SquareSet,
	limit: number,
): number {
	const piece = pos.board.get(from);
	if (!piece) return Infinity;
	const own = pos.board[piece.color];
	const hits = (sq: Square) =>
		attacks({ role: piece.role, color: piece.color }, sq, pos.board.occupied).has(target);
	if (hits(from)) return 0;

	let frontier = SquareSet.empty().with(from);
	let seen = frontier;
	for (let d = 1; d <= limit; d++) {
		let next = SquareSet.empty();
		for (const sq of frontier) {
			const to = attacks({ role: piece.role, color: piece.color }, sq, pos.board.occupied)
				.diff(own)
				.diff(avoid);
			for (const t of to.diff(seen)) {
				if (hits(t)) return d;
				next = next.with(t);
			}
		}
		if (next.isEmpty()) return Infinity;
		seen = seen.union(next);
		frontier = next;
	}
	return Infinity;
}

/** Every square `side` attacks, as one set. */
function coverage(pos: Chess, side: Color): SquareSet {
	let out = SquareSet.empty();
	for (const from of pos.board[side]) {
		const p = pos.board.get(from);
		if (p) out = out.union(attacks(p, from, pos.board.occupied));
	}
	return out;
}

/** The board as it will be when the prize is taken, so `see` can be asked. */
function afterCapture(pos: Chess, target: Square, by: Role, c: Color) {
	const board = pos.board.clone();
	board.take(target);
	board.set(target, { role: by, color: c });
	return board;
}

/**
 * What `c` can win by marching, priced from `c`'s point of view.
 *
 * `toMove` decides the tempo: the side to move is a move ahead in every race it
 * is running.
 */
function invasionGain(pos: Chess, c: Color, toMove: Color): number {
	const them = other(c);
	const myCover = coverage(pos, c);
	const theirCover = coverage(pos, them);
	let best = 0;

	for (const target of pos.board.pieces(them, 'pawn')) {
		const prize = pos.board.get(target);
		if (!prize) continue;
		// Already contested: this is an exchange question, and `see` and the search
		// answer exchange questions properly. The term is for the material nobody
		// is fighting over yet.
		if (myCover.has(target)) continue;

		for (const from of pos.board[c]) {
			const mover = pos.board.get(from);
			if (!mover) continue;
			// Kings and knights only. A king walking at a pawn is the case this term
			// exists for; a rook or bishop reaching one is nearly always inside the
			// search's horizon already, and asking about them is what made this
			// unaffordable.
			if (mover.role !== 'king' && mover.role !== 'knight') continue;

			// A king may not walk through the enemy's fire; nothing else cares.
			const avoid = mover.role === 'king' ? theirCover : SquareSet.empty();
			const mine = timeToAttack(pos, from, target, avoid, MAX_MARCH);
			if (!Number.isFinite(mine) || mine === 0) continue;

			// How long the defence needs to cover the square. The defender's king is
			// not slowed by our coverage — generosity, deliberately.
			let theirs = Infinity;
			for (const guard of pos.board[them]) {
				if (guard === target) continue;
				const t = timeToAttack(pos, guard, target, SquareSet.empty(), MAX_MARCH);
				if (t < theirs) theirs = t;
			}

			// The side to move is a move ahead; a tie goes to the defender.
			const tempo = toMove === c ? 0 : 1;
			if (mine + tempo + MARGIN > theirs) continue;

			// And the prize must actually be takeable when we get there: if they can
			// recapture profitably, the march wins nothing.
			const board = afterCapture(pos, target, mover.role, c);
			if (capturersOn(board, target, them).length) continue;

			const gain = V[prize.role] - PER_MOVE * mine;
			if (gain > best) best = gain;
		}
	}
	return best;
}

/**
 * The race, priced from the side to move's point of view.
 *
 * Both sides are asked, and the answer is the difference: a march I win is worth
 * nothing if they are winning a bigger one at the same time.
 */
export function invasionValue(pos: Chess): number {
	const c = pos.turn;
	return invasionGain(pos, c, c) - invasionGain(pos, other(c), c);
}

/**
 * Cheap gate: is there anything undefended worth marching at?
 *
 * Most positions leave here. Without it this runs a breadth-first search per
 * piece per target at every leaf, which is not affordable.
 */
export function anyInvasion(pos: Chess): boolean {
	// Endgames only, and cheaply: count first, walk later.
	for (const c of ['white', 'black'] as const) {
		if (pos.board[c].size() - 1 > MAX_PIECES) return false;
	}
	for (const c of ['white', 'black'] as const) {
		const cover = coverage(pos, c);
		for (const sq of pos.board.pieces(other(c), 'pawn')) {
			if (!cover.has(sq)) return true;
		}
	}
	return false;
}

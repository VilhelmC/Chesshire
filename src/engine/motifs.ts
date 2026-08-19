// Tactical motif detection — SPEC.md §4 step 6.
//
// Heuristic and board-diff based, deliberately not ML. These exist to GROUP
// progress ("you solve forks 91% of the time, pins 42%") and to caption
// feedback lines. They never decide whether a move is correct — the engine
// does that. A wrong motif label is cosmetic; a wrong evaluation is not.

import {
	attacks,
	bishopAttacks,
	rookAttacks,
	between,
	ray,
} from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Square, Color, Role } from 'chessops/types';
import { positionFromFen, parseSquare, uciToMove } from '../domain/chess';
import type { Chess } from 'chessops/chess';
import type { Motif } from '../domain/types';

const VALUE: Record<Role, number> = {
	pawn: 1,
	knight: 3,
	bishop: 3,
	rook: 5,
	queen: 9,
	king: 100,
};

/** Material for `colour`, in pawns. */
function material(pos: Chess, colour: Color): number {
	let total = 0;
	for (const role of ['pawn', 'knight', 'bishop', 'rook', 'queen'] as Role[]) {
		total += pos.board.pieces(colour, role).size() * VALUE[role];
	}
	return total;
}

/** Squares attacked by `colour`, ignoring pins and legality. */
function attackedBy(pos: Chess, colour: Color): SquareSet {
	let set = SquareSet.empty();
	for (const sq of pos.board[colour]) {
		const piece = pos.board.get(sq);
		if (!piece) continue;
		set = set.union(attacks(piece, sq, pos.board.occupied));
	}
	return set;
}

/**
 * Detect motifs created by playing `uci` in `fen`.
 * `fen` is the position BEFORE the move; the mover is the side to move there.
 */
export function detectMotifs(fen: string, uci: string): Motif[] {
	const found = new Set<Motif>();

	let before: Chess;
	let after: Chess;
	try {
		before = positionFromFen(fen);
		const move = uciToMove(uci);
		// chessops' play() does not validate. Feeding it an illegal move yields a
		// nonsense position and a confidently wrong motif, so check first.
		if (!move || !before.isLegal(move)) return [];
		after = before.clone();
		after.play(move);
	} catch {
		return [];
	}

	const us: Color = before.turn;
	const them: Color = us === 'white' ? 'black' : 'white';
	const to = parseSquare(uci.slice(2, 4));
	if (to === undefined) return [];

	// --- material ------------------------------------------------------------
	const gained = material(before, them) - material(after, them);
	if (gained >= 1) found.add(gained >= 3 ? 'hanging_piece' : 'pawn_win');

	// --- check ---------------------------------------------------------------
	const theirKing = after.board.pieces(them, 'king').first();
	const ourAttacks = attackedBy(after, us);
	const givesCheck = theirKing !== undefined && ourAttacks.has(theirKing);
	if (givesCheck) found.add('king_exposure');

	// --- what the moved piece now hits --------------------------------------
	const moved = after.board.get(to);
	if (moved) {
		const hits = attacks(moved, to, after.board.occupied).intersect(after.board[them]);
		const valuable: Square[] = [];
		for (const sq of hits) {
			const role = after.board.getRole(sq);
			if (role && VALUE[role] >= 3) valuable.push(sq);
		}
		// A fork is one piece attacking two things worth taking. Check plus a
		// loose piece counts — that is the commonest beginner-level fork.
		if (valuable.length >= 2) found.add('fork');
		else if (givesCheck && valuable.length >= 1) found.add('fork');
		else if (hits.size() >= 2) found.add('double_attack');
	}

	// --- undefended enemy pieces we now attack -------------------------------
	const theirDefences = attackedBy(after, them);
	for (const sq of ourAttacks.intersect(after.board[them])) {
		const role = after.board.getRole(sq);
		if (!role || role === 'king') continue;
		if (VALUE[role] >= 3 && !theirDefences.has(sq)) {
			found.add('hanging_piece');
			break;
		}
	}

	// --- pins and skewers ----------------------------------------------------
	for (const motif of slidingMotifs(after, us, them)) found.add(motif);

	// --- fallbacks -----------------------------------------------------------
	if (found.size === 0) {
		const devBefore = developed(before, us);
		const devAfter = developed(after, us);
		found.add(devAfter > devBefore ? 'development_lead' : 'space_grab');
	}

	return [...found];
}

/**
 * Scan our sliders for a ray that passes through one enemy piece and hits a
 * second. Cheaper than a full pin analysis and catches the shapes that matter
 * at this level.
 */
function slidingMotifs(pos: Chess, us: Color, them: Color): Motif[] {
	const out: Motif[] = [];

	for (const from of pos.board[us]) {
		const piece = pos.board.get(from);
		if (!piece || !['bishop', 'rook', 'queen'].includes(piece.role)) continue;

		const lines =
			piece.role === 'bishop'
				? bishopAttacks(from, SquareSet.empty())
				: piece.role === 'rook'
					? rookAttacks(from, SquareSet.empty())
					: bishopAttacks(from, SquareSet.empty()).union(rookAttacks(from, SquareSet.empty()));

		for (const target of lines.intersect(pos.board[them])) {
			// Everything strictly between must be empty for `target` to be the
			// first piece on this ray.
			if (between(from, target).intersects(pos.board.occupied)) continue;

			// Continue past `target` along the same ray to find what is behind it.
			const behind = firstBeyond(pos, from, target);
			if (behind === undefined) continue;
			const behindPiece = pos.board.get(behind);
			if (!behindPiece || behindPiece.color !== them) continue;

			const frontRole = pos.board.getRole(target)!;
			const backRole = behindPiece.role;

			if (backRole === 'king' || VALUE[backRole] > VALUE[frontRole]) {
				// Something more valuable (or the king) is stuck behind.
				out.push('pin');
			} else if (VALUE[frontRole] > VALUE[backRole] && VALUE[backRole] >= 3) {
				// Front piece moves away and we win the one behind — only a real
				// skewer if what is behind is actually worth winning.
				out.push('skewer');
			}
			// Otherwise the alignment is coincidental, not a tactic.
		}
	}

	return out;
}

/** The next occupied square beyond `target`, along the ray from `from`. */
function firstBeyond(pos: Chess, from: Square, target: Square): Square | undefined {
	const line = ray(from, target);
	if (line.isEmpty()) return undefined;

	const step = target > from ? 1 : -1;
	const candidates = [...line]
		.filter((sq) => (step > 0 ? sq > target : sq < target))
		.sort((a, b) => (step > 0 ? a - b : b - a));

	for (const sq of candidates) {
		if (pos.board.occupied.has(sq)) return sq;
	}
	return undefined;
}

/** Minor and major pieces off their home rank — a crude development count. */
function developed(pos: Chess, colour: Color): number {
	const homeRank = colour === 'white' ? 0 : 7;
	let n = 0;
	for (const role of ['knight', 'bishop', 'rook', 'queen'] as Role[]) {
		for (const sq of pos.board.pieces(colour, role)) {
			if (Math.floor(sq / 8) !== homeRank) n++;
		}
	}
	return n;
}

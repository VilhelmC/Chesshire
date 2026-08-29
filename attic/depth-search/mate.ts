// A mate one move away is an obligation, not a horizon problem.
//
// ---------------------------------------------------------------------------
// Will, on puzzle PsyHA: "detector is missing the unescapable checkmate threat
// implied by Rf3–h3 … I think you are not accounting for distance correctly on
// obligations. The threat of a checkmate is an obligation at distance 1 in the
// move graph, right? Requires a resolution."
//
// That is the right diagnosis and the right vocabulary. The search already
// treats a CHECK as an obligation of infinite cost (§4.4) and extends through
// it. It did not treat a mate one move away as anything at all, because its only
// notion of an outstanding obligation was `atRisk` — "is a piece of mine
// hanging" — which prices captures and is silent about mate. So a quiet move
// whose entire point is that it threatens mate scored as a quiet move: nothing.
//
// Two functions here, and they are the same question asked from the two sides:
//
//   mateIn1        the side to move can mate now — the leaf must not stand pat,
//                  because standing pat prices the position at zero when it is
//                  actually over.
//   mateThreatened the side to move is one move from being mated if they do
//                  nothing — an obligation at distance 1, which the search must
//                  spend a ply resolving rather than evaluating past.
//
// COST is the whole design problem. A mate scan is a legality pass over the
// opponent's replies, and doing that at every leaf of a depth-4 search is not
// affordable. So both functions open with a cheap necessary condition — the
// king has to be short of squares, and something has to be able to reach it —
// and only positions that pass it are scanned properly. The gate can MISS a
// mate; it can never invent one, because what follows it is a real
// checkmate test rather than an estimate.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Chess } from 'chessops/chess';
import type { Color, Square } from 'chessops/types';
import { other } from './exchange';

/** Squares the king could step to, ignoring who is watching them. */
function stepsOf(pos: Chess, king: Square, c: Color): SquareSet {
	return attacks({ role: 'king', color: c }, king, pos.board.occupied).diff(pos.board[c]);
}

/**
 * Could the side to move plausibly be mating? Cheap, and allowed to say yes
 * wrongly — the caller checks properly — but never allowed to say no wrongly for
 * a position where the king is genuinely hemmed in.
 */
function worthScanning(pos: Chess): boolean {
	const them = other(pos.turn);
	const king = pos.board.kingOf(them);
	if (king === undefined) return false;
	// Squares the king could step to at all. Cheap: one attack lookup, no
	// coverage pass — computing what we attack, at every leaf, was most of what
	// this cost.
	const steps = stepsOf(pos, king, them);
	if (steps.size() <= 3) return true;
	// A king with room is only getting mated in one by a queen arriving beside
	// it, so that case gets its own test rather than a looser bound for everyone.
	const ring = steps.with(king);
	for (const from of pos.board.pieces(pos.turn, 'queen')) {
		if (!attacks({ role: 'queen', color: pos.turn }, from, pos.board.occupied).intersect(ring).isEmpty()) {
			return true;
		}
	}
	return false;
}

/**
 * Moves that could possibly give check — direct, or by discovery.
 *
 * The first version cloned and played every legal move and asked the position
 * whether it was mate. That is a legality pass per move at every leaf, and it
 * tripled the cost of the whole search. Only a checking move can mate, and
 * whether a move gives check is answerable with set arithmetic: either the piece
 * lands where it attacks the king, or it vacates a square that a slider of ours
 * was firing through.
 */
function checkingMoves(pos: Chess): { from: Square; to: Square }[] {
	const c = pos.turn;
	const them = other(c);
	const king = pos.board.kingOf(them);
	if (king === undefined) return [];

	// Squares whose vacation could open a line: anything between one of our
	// sliders and their king.
	let discoverers = SquareSet.empty();
	for (const role of ['bishop', 'rook', 'queen'] as const) {
		for (const from of pos.board.pieces(c, role)) {
			if (!attacks({ role, color: c }, from, pos.board.occupied).has(king)) {
				// Not currently bearing on the king — but it may be through exactly one
				// of our own men, which is what a discovery is.
				const ray = between(from, king);
				if (ray.isEmpty()) continue;
				const blockers = ray.intersect(pos.board.occupied);
				if (blockers.size() === 1) discoverers = discoverers.union(blockers.intersect(pos.board[c]));
			}
		}
	}

	const out: { from: Square; to: Square }[] = [];
	for (const [from, tos] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const opens = discoverers.has(from);
		for (const to of tos) {
			if (opens) {
				out.push({ from, to });
				continue;
			}
			// Where the piece would attack from, on the board it would leave behind.
			const occ = pos.board.occupied.without(from).with(to);
			const role = piece.role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0) ? 'queen' : piece.role;
			if (attacks({ role, color: c }, to, occ).has(king)) out.push({ from, to });
		}
	}
	return out;
}

/** Does the side to move have a move that mates outright? */
export function mateIn1(pos: Chess): boolean {
	if (!worthScanning(pos)) return false;
	for (const { from, to } of checkingMoves(pos)) {
		const promotes = pos.board.get(from)?.role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0);
		for (const promotion of promotes ? (['queen', 'knight'] as const) : [undefined]) {
			const after = pos.clone();
			try {
				after.play(promotion ? { from, to, promotion } : { from, to });
			} catch {
				continue;
			}
			if (after.isCheckmate()) return true;
		}
	}
	return false;
}

/**
 * Is the side to move one move from being mated, if they do nothing?
 *
 * The null move is a probe, not a move: it asks what the position contains
 * rather than claiming a pass is legal. It is never taken while in check —
 * there the obligation is already explicit and the check extension handles it.
 */
export function mateThreatened(pos: Chess): boolean {
	if (pos.isCheck()) return false;
	const passed = pos.clone();
	// Flipping the side to move is exactly the probe; the en-passant right
	// belongs to the move that was not made, so it goes.
	(passed as unknown as { turn: Color }).turn = other(pos.turn);
	(passed as unknown as { epSquare: Square | undefined }).epSquare = undefined;
	try {
		return mateIn1(passed);
	} catch {
		return false;
	}
}

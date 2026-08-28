// The ladder's goals, as problems the proof engine can work on.
//
// ---------------------------------------------------------------------------
// `pns.ts` knows no chess. This is where chess enters: what a goal is, when it
// is reached, and — the part that makes it affordable — which moves can possibly
// serve it.
//
// The measured claim behind the generator, from CASES-KING-RUNG-VALIDATED.md:
// restricting our moves to those bearing on the king's zone reproduces the
// specification EXACTLY on 60/60 mateIn2 positions while considering 31% of
// them, and the answer survives the filter in 334/334 across depths 1-3.
// ---------------------------------------------------------------------------

import { attacks, kingAttacks } from 'chessops/attacks';
import { makeFen } from 'chessops/fen';
import type { Chess } from 'chessops/chess';
// NORMAL MOVES ONLY. chessops' `Move` is `NormalMove | DropMove`, and a drop
// is a crazyhouse move with no `from` square. Nothing here can be a drop, and
// naming that in the type means `move.from` is not a runtime hope.
import type { Color, NormalMove, Role, Square } from 'chessops/types';
import { SquareSet } from 'chessops/squareSet';
import type { Problem } from './pns';

const PROMOTIONS: Role[] = ['queen', 'rook', 'bishop', 'knight'];

/** Every legal move, promotions written out. The unrestricted generator. */
export function allMoves(pos: Chess): NormalMove[] {
	const out: NormalMove[] = [];
	for (const [from, dests] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const last = piece.color === 'white' ? 7 : 0;
		for (const to of dests) {
			if (piece.role === 'pawn' && to >> 3 === last) for (const promotion of PROMOTIONS) out.push({ from, to, promotion });
			else out.push({ from, to });
		}
	}
	return out;
}

/**
 * The king's zone: his square and everything adjacent to it.
 *
 * The mating configuration has to attack the king and cover his flights, so
 * every man that participates bears on one of these squares. A move that
 * touches none of them cannot be part of a mate delivered on THIS ply.
 */
export function zoneOf(king: Square): SquareSet {
	return kingAttacks(king).with(king);
}

/**
 * Does this move put its man where it bears on the zone — or into the zone?
 *
 * THE PIECE THAT ARRIVES, NOT THE ONE THAT LEFT. A promotion is a different man,
 * and asking about the pawn gives the wrong answer: `rRPBO`'s mate is g7g8=N, a
 * knight on g8, and a pawn on g8 bears on nothing that matters. Promotion has
 * now broken three separate things in this theory (see
 * CASES-KING-RUNG-VALIDATED.md section 4) and this is the fourth place it would
 * have.
 */
export function bearsOnZone(pos: Chess, move: NormalMove, zone: SquareSet): boolean {
	if (zone.has(move.to)) return true;
	const was = pos.board.get(move.from);
	if (!was) return false;
	const arriving = move.promotion ? { color: was.color, role: move.promotion } : was;
	const occupied = pos.board.occupied.without(move.from).with(move.to);
	return attacks(arriving, move.to, occupied).intersects(zone);
}

/**
 * The moves worth trying for a mate against `defender`.
 *
 * ONLY EVER APPLIED AT AN OR NODE, and that restriction is not an optimisation
 * detail — it is soundness. At an OR node we need ONE move to work, so narrowing
 * the candidates can only lose a proof we would have found, and the measurement
 * says it does not. At an AND node the DEFENDER picks, and every reply must be
 * refuted; filtering their moves would let us prove mates against a defender who
 * politely declines to play the saving move. The generator below is never called
 * for them.
 */
export function relevantMoves(pos: Chess, defender: Color): NormalMove[] {
	const king = pos.board.kingOf(defender);
	const every = allMoves(pos);
	if (king === undefined) return every;
	const zone = zoneOf(king);
	return every.filter((m) => bearsOnZone(pos, m, zone));
}

const after = (pos: Chess, move: NormalMove): Chess => {
	const next = pos.clone();
	next.play(move);
	return next;
};

/** Board, turn, castling and en passant — the four fields that make a position. */
const positionKey = (pos: Chess): string => makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ');

export type MateOpts = {
	/** Restrict our moves to the king's zone. Off reproduces the M1 baseline. */
	narrow?: boolean;
	/** Seed leaf numbers from mobility rather than (1, 1). */
	seed?: boolean;
};

/**
 * "Can `attacker` force mate within the depth?" as a `Problem`.
 *
 * Every verdict is expressed from the point of view of whoever is to move at the
 * node, which is what lets the engine stay side-agnostic — and is the trap that
 * made three of its unit tests wrong. Depth exhaustion is the asymmetric one: it
 * is a failure for the attacker and a success for the defender.
 */
export function mateGoal(attacker: Color, opts: MateOpts = {}): Problem<Chess> {
	const defender: Color = attacker === 'white' ? 'black' : 'white';
	return {
		key: positionKey,
		children: (pos) => {
			// The narrowing is ours alone. See `relevantMoves`.
			const moves = opts.narrow && pos.turn === attacker ? relevantMoves(pos, defender) : allMoves(pos);
			return moves.map((m) => after(pos, m));
		},
		terminal: (pos, depthLeft) => {
			// Checkmate first, so a mate delivered exactly as the depth runs out counts.
			if (pos.isCheckmate()) return 'moverLoses';
			if (pos.isStalemate() || pos.isInsufficientMaterial())
				return pos.turn === attacker ? 'moverLoses' : 'moverWins';
			if (depthLeft <= 0) return pos.turn === attacker ? 'moverLoses' : 'moverWins';
			return null;
		},
		init: opts.seed
			? (pos) => {
					// MOBILITY, AS INITIALISATION — never as a cut.
					//
					// A mover needs ONE of their moves to work and an opponent must answer
					// ALL of them, so `phi = 1, delta = moves` is the honest first guess at
					// an unexpanded leaf. It is mover-relative like everything else here,
					// so one expression serves both node types.
					//
					// Wrong seeds cost time and cannot change the answer: every number is
					// recomputed from children the moment a node is expanded. That is the
					// whole difference between seeding and pruning, and it is the line this
					// project has crossed by accident three times.
					let n = 0;
					for (const dests of pos.allDests().values()) n += dests.size();
					return [1, Math.max(1, n)];
				}
			: undefined,
	};
}

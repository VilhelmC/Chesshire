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

// ---------------------------------------------------------------------------
// MATERIAL RUNGS
//
// Mate has a one-call terminal test. "Wins a rook in three" does not, and that
// is the whole difficulty of this milestone: what counts as WON has to be
// defined, and defined in a way that cannot be gamed by a line that stops
// mid-exchange with a piece hanging.
// ---------------------------------------------------------------------------

import { V, other, seeValue } from './exchange';
import type { Board } from 'chessops/board';

/**
 * Material from one side's point of view, kings excluded.
 *
 * Written here rather than imported from `complex.ts`, which is scheduled for
 * the attic. Five lines is cheaper than a dependency on a module we are
 * replacing.
 */
export function materialFor(board: Board, side: Color): number {
	let n = 0;
	for (const square of board.occupied) {
		const piece = board.get(square);
		if (!piece || piece.role === 'king') continue;
		n += piece.color === side ? V[piece.role] : -V[piece.role];
	}
	return n;
}

/**
 * What the position is worth once the exchange in progress settles.
 *
 * A raw material count at the horizon is not an evaluation, it is a snapshot of
 * a trade halfway through: a line that ends with our queen taken but our
 * recapture unplayed reads as a disaster, and one that ends with a piece
 * hanging reads as a triumph. So the side to move is credited with the best
 * exchange available to them, which is a single ply of quiescence.
 *
 * SEE IS EXACT FOR THAT, and that is not a hopeful assumption: the opt-out
 * bound (offbook/AMEND-RUNG-ORDER.md) says the gain at a square never exceeds
 * the value of the man standing there, because nobody recaptures into a loss.
 * What this does NOT capture is interaction BETWEEN squares — two hanging men,
 * only one of which can be saved. That is a real limit of the horizon and it is
 * why the search has a depth rather than relying on this.
 */
export function settled(board: Board, mover: Color, attacker: Color): number {
	// SEE ONLY WHAT IS ACTUALLY ATTACKED, and this is not a micro-optimisation.
	//
	// The first version ran a full exchange on every enemy man: sixteen SEEs at
	// every terminal node, 160 microseconds a call, and since a material goal
	// terminates on an EVALUATION rather than on `isCheckmate()` this is the
	// single hottest thing in the search. It made M3 unmeasurable — a 3-ply
	// puzzle solved in 5 nodes and 7ms, a 9-ply one did not finish.
	//
	// Almost none of those men are attacked. Building the mover's attack set once
	// costs one pass over their pieces and turns the SEEs from sixteen into the
	// handful that could actually change hands.
	let reach = SquareSet.empty();
	for (const from of board[mover]) {
		const piece = board.get(from);
		if (piece) reach = reach.union(attacks(piece, from, board.occupied));
	}
	let best = 0;
	for (const square of board[other(mover)].intersect(reach)) {
		const v = seeValue(board, square, mover);
		if (Number.isFinite(v) && v > best) best = v;
	}
	return materialFor(board, attacker) + (mover === attacker ? best : -best);
}

export type MaterialOpts = {
	seed?: boolean;
};

// ---------------------------------------------------------------------------
// THE ZONE FILTER DOES NOT TRANSFER TO MATERIAL, and it was measured rather
// than assumed. There is no `target` option here, and that absence is the
// finding.
//
// PLAN-PNS-LADDER.md assumed the mate generator would carry over: narrow our
// moves to the target's zone the way the king rung narrows to his. Over twelve
// material puzzles at three plies, the full generator proved nine and the
// narrowed one proved six. `eCTH5`, `FkBOW` and `PxKx3` were all lost.
//
// The reason is structural, not a tuning failure. A KING cannot be traded and
// cannot be replaced, so every configuration that mates him bears on his zone —
// which is why 334/334 answers survived that filter. A MATERIAL goal is a
// SWING, not a square: the winning line may deflect a defender on the far side
// of the board, clear a line, or simply win a different man than the one being
// pursued. None of those touch the nominated target's zone, and all of them are
// answers.
//
// The shape of the right generator is known and is not this. A configuration's
// requirements include its DEFENDERS and its LINES, so the moves that serve it
// are those that bear on the target's zone PLUS those that capture or deflect
// what defends it PLUS those that clear the way — which is the `clears` /
// `fills` / `kills` triple from CHECKPOINT-GRAPH-EDITS-2.md, asked of a
// configuration instead of a move. That is the next thing to build, and it has
// to pass the same no-answer-lost gate M2 passed before it goes anywhere near
// a price.
// ---------------------------------------------------------------------------

/**
 * "Can `attacker` force a material gain of at least `want`, within the depth?"
 *
 * `want` is measured against `base`, the settled value at the root, so the
 * question is about the SWING rather than about the absolute count.
 *
 * The generator narrows to a target's zone exactly as the king rung narrows to
 * his — and for the same reason. A move that neither touches the target square
 * nor bears on anywhere the target could run cannot be part of winning it on
 * this ply. As with mate, the narrowing is applied to US and never to them.
 */
export function materialGoal(attacker: Color, want: number, base: number, opts: MaterialOpts = {}): Problem<Chess> {
	return {
		key: positionKey,
		children: (pos) => allMoves(pos).map((m) => after(pos, m)),
		terminal: (pos, depthLeft) => {
			// Mate settles any material question — it is worth more than the board.
			if (pos.isCheckmate()) return 'moverLoses';
			if (pos.isStalemate() || pos.isInsufficientMaterial()) {
				// A draw banks nothing, so the attacker succeeds only if they wanted
				// nothing. Stated rather than assumed, because `want <= 0` is a real
				// question the rung ladder asks at its bottom.
				const ok = want <= 0;
				return pos.turn === attacker ? (ok ? 'moverWins' : 'moverLoses') : ok ? 'moverLoses' : 'moverWins';
			}
			if (depthLeft <= 0) {
				const ok = settled(pos.board, pos.turn, attacker) - base >= want;
				return pos.turn === attacker ? (ok ? 'moverWins' : 'moverLoses') : ok ? 'moverLoses' : 'moverWins';
			}
			return null;
		},
		init: opts.seed
			? (pos) => {
					let n = 0;
					for (const dests of pos.allDests().values()) n += dests.size();
					return [1, Math.max(1, n)];
				}
			: undefined,
	};
}

// The exchange at a square. FORMALISM §1.
//
// ---------------------------------------------------------------------------
// This is the only primitive in the tactical layer. Everything above it —
// obligations, the covering condition, the mistake decomposition — is built from
// repeated calls to this function and nothing else.
//
// It replaces `contest.ts`'s `foldAt`, and the differences are the ones the
// formalism argued for rather than the ones that happened to fix a fixture:
//
//   * the participant set is recomputed against a shrinking occupancy, so
//     batteries and x-rays fall out instead of being special-cased (§1.1);
//   * pins are recomputed at every step, because a pin can be broken mid-chain
//     when the pinner is captured (§6.1);
//   * the king is priced at Infinity and needs no legality rule at all — the
//     recurrence declines a king capture into a defended square, and declines
//     capturing a king, on arithmetic alone (§1.4);
//   * a promoting capture is priced as one (§1.1a);
//   * en passant removes a pawn that is not on the target square (§1.1b).
//
// Its correctness is not asserted. `test/exchange.test.ts` checks it against an
// exhaustive minimax over every capture ordering, on generated positions.
// ---------------------------------------------------------------------------

import { attacks, between, ray } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Square, Color, Role, Piece } from 'chessops/types';
import { Board } from 'chessops/board';

/** Material, and only material. FORMALISM §1: the king is genuinely infinite. */
export const V: Record<Role, number> = {
	pawn: 100,
	knight: 320,
	bishop: 330,
	rook: 500,
	queen: 900,
	king: Infinity,
};

export const other = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const lastRank = (c: Color): number => (c === 'white' ? 7 : 0);

export type Step = {
	side: Color;
	from: Square;
	role: Role;
	/** Value taken off the board at this step, including any promotion bonus. */
	captured: number;
	/** True when this capture promotes. */
	promotes: boolean;
	/** S(j) — what the side to move here gets by continuing. */
	gain: number;
	/** False once declining beats continuing. */
	happens: boolean;
};

export type Exchange = {
	/** S(0), from the attacker's point of view. Never negative. */
	value: number;
	steps: Step[];
	/** How many steps actually happen. */
	depth: number;
	/** Participants at step 0, for the caller's explanation. */
	attackers: Square[];
	defenders: Square[];
};

const EMPTY: Exchange = { value: 0, steps: [], depth: 0, attackers: [], defenders: [] };

/**
 * Pieces of `colour` that cannot leave their pin ray, and where they may go.
 *
 * Recomputed per step by the caller rather than once: capturing the pinner
 * releases the pinned piece, and a chain that does not notice keeps a defender
 * out of the count that is free by then.
 */
export function pinsFor(board: Board, colour: Color): Map<Square, SquareSet> {
	const out = new Map<Square, SquareSet>();
	const king = board.kingOf(colour);
	if (king === undefined) return out;

	for (const from of board[other(colour)]) {
		const piece = board.get(from);
		if (!piece) continue;
		if (piece.role !== 'rook' && piece.role !== 'bishop' && piece.role !== 'queen') continue;
		if (ray(from, king).isEmpty()) continue;
		if (!attacks(piece, from, SquareSet.empty()).has(king)) continue;

		const bt = between(from, king);
		const blockers = bt.intersect(board.occupied);
		if (blockers.size() !== 1) continue;
		const blocker = blockers.first();
		if (blocker === undefined || !board[colour].has(blocker)) continue;

		// A pinned piece may still act along the ray, including onto the pinner.
		out.set(blocker, bt.with(from));
	}
	return out;
}

/**
 * Everything of `side` that may legally capture on `target` right now.
 *
 * §1.1's participation rule excludes absolutely pinned attackers — correct for
 * every target but one. A pinned piece is excluded because after it captures,
 * the pinner takes its king: an infinite loss, so the recurrence declines. If
 * the target IS the enemy king there is no after — the chain terminates at the
 * first infinity — so the pin does not bind.
 *
 * That is the ordinary rule of chess (a pinned piece still guards squares
 * against the enemy king) arriving as a consequence of V[king] = Infinity,
 * rather than as a rule about pins. AMEND-1.4-KINGS-ADJACENT.md §2.
 *
 * It touches only hypotheticals: in a legal position no target is ever a king,
 * so no real exchange changes. Which is also why it went unnoticed — the only
 * caller that asks about a square holding a king is the covering test, and it
 * was the thing being debugged. It was the entire residue of Γ's checkmate
 * failures: five kings "evading" onto squares whose only guard was pinned.
 */
export function capturersOn(board: Board, target: Square, side: Color): Square[] {
	const prize = board.get(target);
	const pinned = prize?.role === 'king' && prize.color !== side ? new Map<Square, SquareSet>() : pinsFor(board, side);
	const out: Square[] = [];
	for (const from of board[side]) {
		if (from === target) continue;
		const piece = board.get(from);
		if (!piece) continue;
		if (!attacks(piece, from, board.occupied).has(target)) continue;
		// A pawn's forward moves are not captures; `attacks` already gives only
		// its diagonals, so nothing extra is needed here.
		const allowed = pinned.get(from);
		if (allowed && !allowed.has(target)) continue;
		out.push(from);
	}
	return out;
}

/** Does this capture promote, and what is it worth as a bonus? */
export function promotionOf(piece: Piece, target: Square): number {
	return piece.role === 'pawn' && target >> 3 === lastRank(piece.color)
		? V.queen - V.pawn
		: 0;
}

/**
 * The exchange at `target`, with `attacker` to start.
 *
 * `board` is not mutated. The piece standing on `target` is the initial prize;
 * if the square is empty there is nothing to compute.
 */
/**
 * The exchange, resolved over EVERY ordering rather than by cheapest-first.
 *
 * ---------------------------------------------------------------------------
 * Cheapest-first is not exact here, and the reason is structural rather than a
 * detail. The exchange argument that justifies ascending order — swap two
 * adjacent captures to put the cheaper first, and the mover is weakly better off
 * — assumes the participant multiset is FIXED. It is not: which piece captures
 * decides which square is vacated, and therefore which slider behind it is
 * revealed. Swapping two captures changes the set of participants, so the
 * argument does not apply.
 *
 * The generated reference found it before I did, in a position where a rook and
 * a queen both attack h7:
 *
 *   * ♖h6×h7 vacates h6 and reveals ♛h4 down the file — the recapture wins;
 *   * ♕e4×h7 leaves ♖h6 in place, backing up the square, so the king may not
 *     recapture at all — and White wins a pawn.
 *
 * Cheapest-first plays the rook and reports 0. The right answer is 100.
 *
 * Exhaustive ordering also makes the promotion special case unnecessary: a
 * promoting capture is simply one of the branches, priced correctly, and the max
 * picks it when it is best. There is nothing left to evaluate twice.
 *
 * The branching factor is the number of capturers of one side — typically two or
 * three — so this is cheap in the only sense that matters. `NODES` is a backstop
 * for pathological squares, not an expected path.
 * ---------------------------------------------------------------------------
 */
const NODES = 20_000;

type Best = { value: number; line: Omit<Step, 'gain' | 'happens'>[] };

/**
 * Least valuable attacker first — and it is a correctness fix, not a speed one.
 *
 * The loop below keeps a STRICT improvement (`value > best.value`), so among
 * captures worth the same it keeps whichever it saw first. `capturersOn` returns
 * squares in board order, so "first" meant "lowest square index": on
 * `rnb1r1k1/p1p1b2p/3p2pn/1pP2qNR/P2P1p2/4P1P1/RP1N4/2B1KB2 w` the exchange on b5
 * recaptured with the f1 BISHOP where the mirrored position used the a4 PAWN.
 * Same value, different line, and the line is not a detail — `cluster.ts` reads
 * it to know which pieces an exchange consumed.
 *
 * Standard SEE takes with the cheapest attacker for the obvious reason: it keeps
 * the dearer ones in reserve. Sorting by that makes the tie-break both correct
 * and mirror-invariant, since a piece's value and its attack count are facts
 * about the position and a square index is a fact about the coordinates.
 *
 * Caught by the reflection property, which has now found four order-dependent
 * tie-breaks in this project and is the single most productive test in it.
 */
function order(b: Board, cands: Square[]): Square[] {
	const rank = (s: Square): [number, number] => {
		const p = b.get(s);
		if (!p) return [Infinity, 0];
		return [V[p.role], attacks(p, s, b.occupied).size()];
	};
	return [...cands].sort((x, y) => {
		const a = rank(x), z = rank(y);
		return a[0] - z[0] || a[1] - z[1];
	});
}

function resolve(b: Board, target: Square, side: Color, budget: { n: number }): Best {
	const prize = b.get(target);
	if (!prize) return { value: 0, line: [] };

	const cands = order(b, capturersOn(b, target, side));
	if (!cands.length) return { value: 0, line: [] };

	// Declining is always available, and is what makes the value non-negative.
	let best: Best = { value: 0, line: [] };

	for (const from of cands) {
		if (--budget.n < 0) break;
		const piece = b.get(from);
		if (!piece) continue;

		const bonus = promotionOf(piece, target);
		const captured = V[prize.role] + bonus;

		const next = b.clone();
		next.take(from);
		next.take(target);
		next.set(target, bonus > 0 ? { role: 'queen', color: side } : piece);

		const reply = resolve(next, target, other(side), budget);
		const value = captured - reply.value;
		if (value > best.value) {
			best = {
				value,
				line: [
					{ side, from, role: piece.role, captured, promotes: bonus > 0 },
					...reply.line,
				],
			};
		}
	}

	return best;
}

export function see(board: Board, target: Square, attacker: Color): Exchange {
	const prize = board.get(target);
	if (!prize) return EMPTY;

	const attackers = capturersOn(board, target, attacker);
	const defenders = capturersOn(board, target, other(attacker));

	const best = resolve(board.clone(), target, attacker, { n: NODES });

	// The line returned is the one actually played, so every step in it happens.
	// S(j) is recovered from the tail for display: what the side to move at step
	// j gets by continuing.
	const gains: number[] = new Array(best.line.length + 1).fill(0);
	for (let j = best.line.length - 1; j >= 0; j--) {
		gains[j] = Math.max(0, best.line[j].captured - gains[j + 1]);
	}

	return {
		value: best.value,
		steps: best.line.map((s, j) => ({ ...s, gain: gains[j], happens: true })),
		depth: best.line.length,
		attackers,
		defenders,
	};
}

/**
 * What the exchange at `target` is worth to `attacker` — the number alone.
 *
 * FORMALISM §1.2. Never negative: nobody is forced into an exchange.
 */
export function seeValue(board: Board, target: Square, attacker: Color): number {
	return see(board, target, attacker).value;
}

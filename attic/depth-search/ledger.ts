// What each side owes, and by when.
//
// ---------------------------------------------------------------------------
// DEFICIENCY.md §1: *a player is obliged to prevent any change in relative
// material.* That single sentence is what removes the motif list — there is no
// fork detector here, no pin detector, no trapped-piece detector. There is a
// list of prospective material changes, and the motifs are what the covering
// condition (cover.ts) does with it.
//
// This is the τ = 1 slice. Every obligation here is collectable on the next
// ply, which is `FORMALISM.md` §3.1 exactly. The deferred rows of §1's table —
// promotion, invasion, mate in k — need `arrives()` defined per discharge type
// (§2, still open) and a distance index (§7), and they are deliberately absent
// rather than approximated. §8 says the deadline test is where the judgement
// lives and where this codebase has already been wrong twice; isolating it
// means that when the number moves after deadlines are added, we know what
// moved it.
//
// The correctness surface is the ledger, not the machinery over it. A tactic
// this misses should diagnose as "an obligation type is absent from the table"
// rather than as "the search was too shallow" — which is the entire trade the
// formalism makes, and the thing the harness has to measure.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Square, Color, Role } from 'chessops/types';
import { seeValue, other } from './exchange';

/**
 * One prospective change in relative material.
 *
 * `weight` is a SEE and never a raw piece value (DEFICIENCY.md §1.1). A rook
 * attacked by a knight and defended twice is not a 500-point debt; it is
 * whatever the exchange actually comes to, which may be nothing at all.
 */
export type Obligation = {
	/** Where the material changes hands. */
	square: Square;
	/** What stands there — for the sentence, not for the arithmetic. */
	role: Role;
	/** The magnitude. Always a SEE. */
	weight: number;
	/** Plies until collectable. Always 1 in this slice. */
	deadline: number;
	/** Who collects if it goes unanswered. */
	claimant: Color;
};

/**
 * Everything `owed` is on the hook for, largest first.
 *
 * The king needs no special case. `V[king] = Infinity`, so a king under attack
 * produces an infinite obligation and everything downstream treats check as the
 * debt that must be serviced before any other — which is `FORMALISM.md` §1.4
 * and §4.4 falling out of the value assignment rather than being asserted.
 */
export function ledger(pos: Chess, owed: Color): Obligation[] {
	const taker = other(owed);
	const out: Obligation[] = [];
	for (const square of pos.board[owed]) {
		const piece = pos.board.get(square);
		if (!piece) continue;
		const weight = seeValue(pos.board, square, taker);
		if (weight > 0) out.push({ square, role: piece.role, weight, deadline: 1, claimant: taker });
	}
	// Descending, because every consumer wants the largest debt first: the
	// covering condition tests it first, and the annotation names it first.
	return out.sort((a, b) => b.weight - a.weight);
}

/** The largest single debt, or 0. `Infinity` means check. */
export const worst = (E: Obligation[]): number => (E.length ? E[0].weight : 0);

/**
 * The total, for reporting only — never for deciding.
 *
 * Two debts of a pawn each do not add up to a piece, because the opponent
 * collects one per tempo and you get a move in between. The covering condition
 * is what decides; this exists so a harness can say how loaded a position is.
 */
export const owedTotal = (E: Obligation[]): number =>
	E.reduce((n, e) => (Number.isFinite(e.weight) ? n + e.weight : n), 0);

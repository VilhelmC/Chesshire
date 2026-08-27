// Which move, and why.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §4 (the concession), §9.2 (both players edit Γ) and §9.3
// as amended by AMEND-9.3-FORCING.md. PLAN.md M7.
//
// NOT on `no-search.test.ts`'s guarded list, and deliberately so. Every module
// that is guarded answers a question about ONE position: what is owed, what
// covers it, what it costs. Choosing between moves needs the position each move
// leaves, and that is one ply of enumeration over candidates the index supplies
// — not a search. There is no recursion here, no depth parameter, and nowhere
// to put one. DETECTOR.md §3 says the same thing about `cover`: "depth 1: I
// move, they harvest."
//
// The score is symmetric by construction. What they concede after my move, less
// what I concede — §9.2's table has both players adding and removing the same
// kinds of edge, and a score that reads only one side's ledger is the failure
// that made the invasion row misprice.
// ---------------------------------------------------------------------------

import { makeSquare } from 'chessops/util';
import type { Chess } from 'chessops/chess';
import type { Color, Square } from 'chessops/types';
import { V, other, seeValue } from './exchange';
import { concedes, type Unrolled } from './concede2';

export type Ranked = {
	from: Square;
	to: Square;
	promotion?: 'queen';
	/** Material this move takes outright. */
	takes: number;
	/** What they concede once it is played — §4's L(E) for them. */
	theirs: number;
	/** What I concede for having played it. The symmetric half. */
	mine: number;
	/** `takes + theirs - mine`. The whole of the material reading. */
	value: number;
	/**
	 * How few non-losing replies it leaves them, negated so larger is better.
	 *
	 * AMEND-9.3-FORCING.md. A TIE-BREAK and never a term: summed into `value` it
	 * would be the circularity FORMALISM §6 forbids, since effective mobility is
	 * defined in terms of the tactical layer. Used only where `value` ties, it is
	 * strictly downstream and nothing feeds back.
	 */
	force: number;
	/** The reasoning behind `theirs`, for the sentence. */
	why: Unrolled;
};

/**
 * Moves that do not simply lose the moving piece — §1.7 acceptance, counted.
 *
 * Not `Mob_rel`: that is `{m : L(E) <= 0}` and consuming it inside the tactical
 * layer is what §6 warns against. This uses SEE alone and stays inside §§1–5's
 * vocabulary.
 */
export function viable(pos: Chess): number {
	let n = 0;
	const side = pos.turn;
	for (const from of pos.board[side]) {
		for (const to of pos.dests(from)) {
			const b = pos.board.clone();
			const piece = b.take(from);
			if (!piece) continue;
			b.take(to as Square);
			b.set(to as Square, piece);
			if (seeValue(b, to as Square, other(side)) <= 0) n++;
		}
	}
	return n;
}

/** Every legal move, with the position it leaves. One ply, no recursion. */
function* candidates(pos: Chess): Generator<{ from: Square; to: Square; promotion?: 'queen'; next: Chess }> {
	const back = pos.turn === 'white' ? 7 : 0;
	for (const from of pos.board[pos.turn]) {
		const piece = pos.board.get(from);
		for (const to of pos.dests(from)) {
			const promotion = piece?.role === 'pawn' && (to as Square) >> 3 === back ? ('queen' as const) : undefined;
			let next: Chess;
			try {
				next = pos.clone();
				next.play({ from, to: to as Square, promotion });
			} catch {
				continue;
			}
			yield { from, to: to as Square, promotion, next };
		}
	}
}

/**
 * Every move, scored and ordered.
 *
 * The order is lexicographic: material first, forcing only among equals. That is
 * not a tuning choice — it is the only arrangement in which the tie-break stays
 * downstream of the tactical layer instead of feeding into it.
 */
export function rank(pos: Chess): Ranked[] {
	const out: Ranked[] = [];
	for (const c of candidates(pos)) {
		const takes = pos.board.get(c.to) ? V[pos.board.get(c.to)!.role] : 0;
		// Both ledgers, always. §5: "the ledger is built symmetrically and cannot
		// be built any other way."
		const why = concedes(c.next, c.next.turn);
		const mine = concedes(c.next, other(c.next.turn)).loss;
		out.push({
			from: c.from,
			to: c.to,
			promotion: c.promotion,
			takes,
			theirs: why.loss,
			mine,
			value: takes + why.loss - mine,
			force: -viable(c.next),
			why,
		});
	}
	return out.sort((a, b) => (b.value === a.value ? b.force - a.force : b.value - a.value));
}

/**
 * The move, and whether anything else is genuinely level with it.
 *
 * A tie is reported rather than resolved. Will: "ties should be impossible in
 * puzzles by definition", and that makes a surviving tie a fact worth surfacing
 * — it says the detector cannot tell two moves apart, which is a claim about the
 * detector and not about the position.
 */
export function best(pos: Chess): { move: Ranked | null; tied: Ranked[] } {
	const rows = rank(pos);
	if (!rows.length) return { move: null, tied: [] };
	const top = rows[0];
	const tied = rows.filter((r) => r.value === top.value && r.force === top.force);
	return { move: tied.length === 1 ? top : null, tied };
}

/** The move in coordinate notation, for harnesses and tests. */
export const uci = (r: Ranked): string => `${makeSquare(r.from)}${makeSquare(r.to)}${r.promotion ? 'q' : ''}`;

/**
 * Why this move, in §4's terms: the argmin and what it still costs.
 *
 * The renderer is injected for the same reason `explainCover` injects one —
 * figurine notation needs a `Chess` and lives in the view, so a domain module
 * reaching for it would have the dependency backwards.
 */
export function say(
	r: Ranked,
	side: Color,
	name: (from: Square, to: Square) => string = (f, t) => `${makeSquare(f)}${makeSquare(t)}`,
): string {
	const m = name(r.from, r.to);
	const bits: string[] = [];
	if (r.takes) bits.push(`takes ${r.takes}`);
	if (Number.isFinite(r.theirs) ? r.theirs > 0 : true) {
		bits.push(Number.isFinite(r.theirs) ? `leaves ${other(side)} conceding ${r.theirs}` : `mates`);
	}
	if (r.mine > 0) bits.push(Number.isFinite(r.mine) ? `costs ${r.mine}` : 'loses the king');
	if (!bits.length) bits.push(`nothing is due — it leaves ${-r.force} answers`);
	return `${m}: ${bits.join(', ')}`;
}

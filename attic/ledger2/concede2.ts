// The concession, unrolled — and the escalation ladder.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §4 (marked Open until AMEND-4-UNROLLING.md closed it) and
// §5. PLAN.md M6.
//
// §4 gives the single-ply concession and says the general case unrolls: the
// opponent spends a ply harvesting, you get a ply back, and the recursion
// continues on what remains. This is that recursion.
//
//   L(∅) = 0
//   L(E) = min over R of  max over e in E\R of  ( w_e + L(E \ R \ {e}) )
//
// You pick a move, which covers some subset R; they take the costliest thing
// you left; you move again on what survives. ∅ is always an available R because
// you must move even when no move covers anything.
//
// This file touches no board at all. It is arithmetic over a fixed exchange
// complex — the strongest form of the no-search property in this codebase, and
// the boundary the amendment draws: re-deriving the ledger at each level would
// mean building a position at each level, and a recursion that builds positions
// is what the formalism replaces.
//
// There is NO zugzwang detector here. §3.2's successor condition does not fire
// on any of the corpus's 56 zugzwang puzzles, and neither does the obvious
// repair over tempo slack. AMEND-4-UNROLLING.md §3 records why: Γ says whether
// a discharge ARRIVES, and zugzwang is about whether it can be MAINTAINED.
// That is a named gap in §1's table, per §9.5, and not something to approximate.
// ---------------------------------------------------------------------------

import { makeSquare } from 'chessops/util';
import type { Chess } from 'chessops/chess';
import type { Color, Square } from 'chessops/types';
import { other } from './exchange';
import { ledger, isLive, type Obligation } from './ledger2';
import { gamma, due, type Gamma } from './cover2';

/**
 * The largest `|E|` this will unroll.
 *
 * Measured over 356 solver plies, both sides: |E| never exceeded 6, and the
 * rows due on a ply never exceeded 4. Sixteen is far above anything observed
 * and still only 65,536 memo states.
 *
 * Stated rather than assumed, and enforced by refusing rather than truncating.
 * A silent cut reads as a computed answer — which is how 170 blind plies were
 * once filed as ties — and the corpus is 150 puzzles, not chess.
 */
export const MAX_ROWS = 16;

/** How many rows a cover set answers. */
const popcount = (n: number): number => {
	let c = 0;
	for (let x = n; x; x &= x - 1) c++;
	return c;
};

export type Play = {
	/** The move, as the piece and where it goes. */
	from: Square;
	to: Square;
	/** Which rows it covers, as a bitmask over `E`. */
	covers: number;
};

export type Unrolled = {
	/** L(E). Zero means nothing is conceded. */
	loss: number;
	/** The argmin — your best move, or null if no move covers anything. */
	move: { from: Square; to: Square } | null;
	/**
	 * The `e` attaining the max: what it still costs you.
	 *
	 * The argmin and this together are §4's sentence, and having both is the
	 * whole reason the computation holds nouns instead of returning a number.
	 */
	worst: Obligation | null;
	/** How the loss accumulates, in the order it would be collected. */
	line: Obligation[];
	/** True when `|E|` exceeded MAX_ROWS and nothing was computed. */
	refused: boolean;
};

/** Every distinct cost-1 move in Γ, with the rows it covers as a bitmask. */
export function plays(g: Gamma): Play[] {
	const live = due(g);
	const index = new Map(live.map((i, n) => [i, n]));
	const byMove = new Map<string, Play>();
	for (const e of g.edges) {
		if (e.cost !== 1) continue;
		const bit = index.get(e.obligation);
		if (bit === undefined) continue;
		const k = `${e.piece}:${e.to}`;
		let row = byMove.get(k);
		if (!row) byMove.set(k, (row = { from: e.piece, to: e.to, covers: 0 }));
		row.covers |= 1 << bit;
	}
	return [...byMove.values()];
}

/**
 * §4's recurrence, over the rows due this ply.
 *
 * Memoised on the surviving-row bitmask, which is the whole state: `w` and the
 * cover sets are fixed at the top, so two paths reaching the same surviving set
 * face the same problem. That is what makes depth |E| tractable rather than
 * merely finite.
 */
export function unroll(rows: Obligation[], moves: Play[]): Unrolled {
	if (rows.length > MAX_ROWS) return { loss: 0, move: null, worst: null, line: [], refused: true };
	if (!rows.length) return { loss: 0, move: null, worst: null, line: [], refused: false };

	const all = (1 << rows.length) - 1;
	// ∅ is always available: you must move even when no move covers anything, and
	// a model where you may decline to move is a model of a different game.
	const options = [0, ...new Set(moves.map((m) => m.covers))];
	// `covered` — the R the min chose — is returned WITH the loss and the line,
	// not recomputed afterwards.
	//
	// The first version recomputed the argmin by rescanning for any move whose
	// value equalled the answer, and paired it with the line from whichever
	// branch `best` happened to take. On a knight forking two rooks that printed
	// "c7c1 is best and still concedes 180 — c7", a move that vacates c7 paired
	// with a line saying c7 is lost. Same shape as the explanation-keyed-by-
	// position bug: two answers computed separately and presented as one.
	type Best = { loss: number; line: number[]; covered: number };
	const memo = new Map<number, Best>();

	const best = (open: number): Best => {
		if (!open) return { loss: 0, line: [], covered: 0 };
		const hit = memo.get(open);
		if (hit) return hit;
		// Guard against reentry before the answer exists. The recursion is over a
		// strictly shrinking set so this cannot fire, and it is here because "cannot
		// fire" is a claim about code that has been wrong before in this project.
		memo.set(open, { loss: Infinity, line: [], covered: 0 });

		let mine: Best = { loss: Infinity, line: [], covered: 0 };
		for (const covered of options) {
			const left = open & ~covered;
			// They harvest the costliest thing left, then you move again.
			let theirs = { loss: 0, line: [] as number[] };
			for (let i = 0; i < rows.length; i++) {
				if (!(left & (1 << i))) continue;
				const rest = best(left & ~(1 << i));
				const total = rows[i].weight + rest.loss;
				if (total > theirs.loss) theirs = { loss: total, line: [i, ...rest.line] };
			}
			// Ties go to the option that covers MORE.
			//
			// ∅ is in `options` because you must move, not because doing nothing is
			// a move. Two rooks forked and each worth 180: saving one concedes 180,
			// and so does saving neither — so a strict `<` let ∅ win on order alone
			// and the sentence read "no move is best", which is false and unhelpful.
			// Where the material is equal, covering something is better in every
			// respect this fixed-complex model does not measure.
			const better = theirs.loss < mine.loss ||
				(theirs.loss === mine.loss && popcount(covered) > popcount(mine.covered));
			if (better) mine = { ...theirs, covered };
		}
		memo.set(open, mine);
		return mine;
	};

	const answer = best(all);
	// The move is one that covers exactly what the min chose to cover. Several
	// moves may share a cover set; by this model they are the same move, and
	// telling them apart needs what the position looks like afterwards, which is
	// the fixed-complex approximation's stated boundary.
	const chosen = answer.covered ? (moves.find((m) => m.covers === answer.covered) ?? null) : null;
	const move = chosen ? { from: chosen.from, to: chosen.to } : null;

	const line = answer.line.map((i) => rows[i]);
	return { loss: answer.loss, move, worst: line[0] ?? null, line, refused: false };
}

/** The concession for a position, from its own ledger and cover graph. */
export function concedes(pos: Chess, owed: Color = pos.turn): Unrolled & { E: Obligation[] } {
	const g = gamma(pos, { owed });
	const rows = due(g).map((i) => g.E[i]);
	return { ...unroll(rows, plays(g)), E: rows };
}

// ---------------------------------------------------------------------------
// §5. Counter-obligation — the one discharge that covers nothing.
// ---------------------------------------------------------------------------

export type Rung = {
	/** The threat, from the SYMMETRIC ledger — what the other side owes. */
	threat: Obligation;
	/** The stake it has to beat, which is the previous rung's. */
	over: number;
};

export type Ladder = {
	rungs: Rung[];
	/** The stake at the top. Infinity is check, per §4.4's maximal element. */
	stake: number;
	/**
	 * True when a rung failed to raise the stake.
	 *
	 * §9.4: "the failure mode of a quotient game is a cycle." §4.2's
	 * strictly-increasing stake rules it out among interruptions and §8.1 is
	 * precisely where it does not. Reported rather than looped on, which is that
	 * residue made directly testable instead of inferred from a proof that does
	 * not close.
	 */
	cycles: boolean;
};

/**
 * The escalation ladder — §5.
 *
 * NOT search. The ledger is built symmetrically and cannot be built any other
 * way, so my largest available threat at deadline τ is a max over a structure
 * that already exists. What remains is a climb, and `FORMALISM.md` §4.2 bounds
 * it: each rung must strictly exceed the standing stake, material is bounded,
 * and check is the maximal element.
 */
export function ladder(pos: Chess, owed: Color, stake: number): Ladder {
	// Their ledger, not mine. If I owe `stake`, what do THEY owe that is worth
	// more — that is the move that changes the reckoning rather than covering.
	const theirs = ledger(pos, other(owed)).filter((o) => isLive(o, pos.board));
	const rungs: Rung[] = [];
	let standing = stake;
	let cycles = false;

	// Sorted by what they are actually worth once distance is priced in, so the
	// climb takes the biggest step available at each rung rather than the first.
	const pool = [...theirs].sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
	const used = new Set<Obligation>();

	for (;;) {
		const next = pool.find((o) => !used.has(o) && o.weight > standing);
		if (!next) break;
		if (!(next.weight > standing)) {
			// Unreachable by the predicate above, and kept because §9.4 says the
			// failure mode of this game is a cycle and a loop that trusts its own
			// guard is how one would arrive.
			cycles = true;
			break;
		}
		rungs.push({ threat: next, over: standing });
		standing = next.weight;
		used.add(next);
		if (!Number.isFinite(standing)) break; // Check. Nothing exceeds it (§4.4).
		if (rungs.length > theirs.length) {
			cycles = true;
			break;
		}
	}
	return { rungs, stake: standing, cycles };
}

/**
 * The whole reckoning: what you concede, against what you can threaten back.
 *
 * §5's "the reckoning is between two ledgers with different deadlines", and the
 * order matters — you concede first, and the ladder is what you get for it.
 */
export function reckon(pos: Chess, owed: Color = pos.turn) {
	const mine = concedes(pos, owed);
	const back = ladder(pos, owed, mine.loss);
	return { ...mine, ladder: back, net: mine.loss - (back.rungs.length ? back.stake : 0) };
}

/** §4's sentence: your best move, and what it still costs you. */
export function say(u: Unrolled): string {
	if (u.refused) return `too many obligations to unroll (over ${MAX_ROWS}) — refusing rather than truncating`;
	if (!u.loss) return u.move ? `${makeSquare(u.move.from)}${makeSquare(u.move.to)} answers everything` : 'nothing owed';
	const m = u.move ? `${makeSquare(u.move.from)}${makeSquare(u.move.to)}` : 'no move';
	const cost = u.line.map((o) => `${makeSquare(o.square)} (${Number.isFinite(o.weight) ? o.weight : 'the king'})`).join(', then ');
	return `${m} is best and still concedes ${Number.isFinite(u.loss) ? u.loss : 'the king'} — ${cost}`;
}

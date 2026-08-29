// Coercion decides what to LOOK AT. Material decides what it is worth.
//
// ---------------------------------------------------------------------------
// Will, correcting me: "A move should not be played because it offers coercion,
// but it should be explored because it offers coercion. Schematically the
// algorithm would, check current position for immediately winnable exchanges,
// flag coercive moves for exploration, then calculate value of all coercive
// moves by projecting board position into future (branching on feasible opponent
// replies), and recurse with the new position as the input. We don't return
// until all branches have been calculated to a scored leaf."
//
// He is right, and the distinction is the whole design. The tie-break I built
// used coercion as a TERMINAL criterion: where material was silent, the most
// coercive move won. That is a category error — a coercive move that leads
// nowhere then gets ranked first, which is a wrong answer rather than a wasted
// search. Used as an EXPANSION criterion the same signal is free of that failure
// mode: a coercive move that leads nowhere gets explored, scored on material at
// a settled leaf, and ranked low. The cost of being wrong is time.
//
// The 57%-against-19% measurement said the same thing, read correctly. That is
// what a good move-ordering heuristic looks like. It is not evidence for a
// scoring rule.
//
// So this is a search with no depth counter. A branch ends when the position is
// SETTLED — nothing coercive left to try — rather than when a ply budget runs
// out, which is what makes it a different object from `net`:
//
//   attacker   stand pat (bank what quiescence already gives), plus every
//              coercive move — `obliging`, which is checks, captures,
//              promotions and new threats.
//   defender   only replies that HOLD: those within a pawn of their best, by a
//              shallow reading. A reply that simply loses more material is not a
//              reply they have.
//   leaf       no coercive move, or the budget is spent: the value is what
//              quiescence says, plus the static terms.
//
// Two things keep it honest. The defender filter is by MATERIAL, not by move
// type — an earlier attempt to prune the defender to captures-and-checks
// invented wins, because the move that saves them is so often a quiet block. And
// a hard ply cap plus a node budget guarantee termination, since a position with
// a check available always has a coercive move.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Color, NormalMove, Square } from 'chessops/types';
import { allMoves, atRisk, immediate, obliging, quiesce, type Budget, type Opts } from './resolve';
import { V, other } from './exchange';
import { mateIn1 } from './mate';

type Move = NormalMove;

/** How far off the best a reply may be and still count as one they have. */
const HOLDS_MARGIN = 100;

/**
 * Depth at which we stop believing this terminates on its own.
 *
 * Not a search depth — a safety net. A settled position ends the branch long
 * before this in almost every case; the cap exists because "there is always a
 * check available" is a real property of some positions.
 */
const PLY_CAP = 8;

/**
 * How many holding replies still counts as coercion.
 *
 * This is the constraint that makes the whole thing terminate, and it is Will's
 * own: "branching on feasible opponent replies". If the opponent has a dozen
 * replies that hold, the move did not coerce them — it suggested something. So
 * the branch settles there and takes its material value, rather than expanding a
 * tree that is not a forced chain in the first place.
 *
 * Without it the search runs for minutes per position: every check and every
 * capture opens a full-width subtree, none of which is a chain.
 */
const MAX_REPLIES = 6;

/** Per-call overrides, so one process can compare settings. */
export type ChainOpts = Opts & {
	maxReplies?: number;
	plyCap?: number;
	/** Coercion by effect rather than by move type — see WIDE below. */
	wide?: boolean;
	/** Let the defender answer with a counter-threat — see COUNTER below. */
	counters?: boolean;
};

/** Why branches stopped, so a failure can be attributed rather than guessed at. */
export const CHAIN_STATS = { settledWide: 0, settledQuiet: 0, plyCap: 0, budget: 0, mate: 0 };

/**
 * Coercion is not a kind of move.
 *
 * Will: "I do think however these are also conceptually coercion so I don't
 * really see why they shouldn't be included." Zugzwang coerces — every move the
 * opponent has makes their position worse, which is the purest case of being
 * compelled. A king walking towards a pawn coerces — it sets an obligation with
 * a deadline several moves out. Neither is a check, a capture or a threat, so
 * neither appeared in `obliging`, which classifies by move TYPE.
 *
 * With this on, the attacker offers every legal move and the test one ply later
 * decides which of them coerced: if the opponent is left with few replies that
 * hold, the move compelled them, whatever kind of move it was. The type filter
 * becomes an optimisation rather than a definition.
 *
 * MEASURED, and it does not pay yet. On 107 solver plies it costs three times the
 * wall clock and moves found/missed within noise. The reason is not that the
 * extra moves are worthless — it is that the extra branches all settle at the
 * same material value, because the positions they reach (a king walking towards
 * a pawn) can only be priced by a term that does not exist yet. So the switch
 * stays, off, with the measurement attached: it is the right definition and the
 * wrong economics until the leaf can price what it reaches. See KINGS.md.
 */
const WIDE = false;

// Measured at 84% found either way, with misses at 6% wide against 8% narrow —
// and 2.4x the time. The narrow default ships because this runs in a browser tab
// on every ply; `{ wide: true }` is what the harnesses pass.

/**
 * The defender may counter-threaten.
 *
 * Will: "I also think it seems wrong that defender doesn't expand coercing
 * moves." Right — a zwischenzug is the standard refutation of a forcing line,
 * and the material filter throws it away precisely because it does not win
 * material on the spot. Counter-threats are added to the defender's list on top
 * of the replies that hold.
 */
const COUNTER = true;

/**
 * What a settled position is worth.
 *
 * Quiescence resolves the captures — and a mate available right now is not a
 * quiet position, which quiescence has no way to notice. `net` learned this at
 * its own leaf; this search does not go through `net`, so it was scoring a
 * mate-in-one leaf at zero and losing every mating puzzle in the sample.
 */
function settled(pos: Chess, alpha: number, beta: number, budget: Budget, pv: Move[] | undefined, opts: ChainOpts): number {
	if (!opts.noMate && mateIn1(pos)) return Infinity;
	return quiesce(pos, alpha, beta, budget, pv, opts);
}

/** Replies the defender actually has, with the shallow value that qualified them. */
function holdingReplies(pos: Chess, budget: Budget, opts: ChainOpts): { m: Move; v: number }[] {
	const moves = allMoves(pos);
	if (moves.length <= 1) return moves.map((m) => ({ m, v: 0 }));
	const scored: { m: Move; v: number }[] = [];
	for (const m of moves) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		const im = immediate(pos, m);
		scored.push({ m, v: im - quiesce(after, -Infinity, Infinity, budget, undefined, opts) });
	}
	if (!scored.length) return [];
	const best = Math.max(...scored.map((x) => x.v));
	return scored.filter((x) => x.v >= best - HOLDS_MARGIN).sort((a, b) => b.v - a.v);
}

/** Replies the defender actually has: everything within a pawn of their best. */
function repliesThatHold(pos: Chess, budget: Budget, opts: ChainOpts): Move[] {
	const moves = allMoves(pos);
	if (moves.length <= 1) return moves;
	// Nothing to filter down to: a wide list is not going to survive the coercion
	// test below, and pricing every one of them with quiescence first is the
	// single most expensive thing this search can do.
	if (moves.length > 24) return moves;
	const scored: { m: Move; v: number }[] = [];
	for (const m of moves) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		const im = immediate(pos, m);
		scored.push({ m, v: im - quiesce(after, -Infinity, Infinity, budget, undefined, opts) });
	}
	if (!scored.length) return moves;
	const best = Math.max(...scored.map((s) => s.v));
	return scored.filter((s) => s.v >= best - HOLDS_MARGIN).map((s) => s.m);
}

/**
 * What the opponent would win if this side did nothing.
 *
 * `atRisk` answers a narrower question — is something of mine hanging RIGHT NOW —
 * and in an attack the answer is usually no while the position is still lost: the
 * threat is one move away, not on the board. A null move asks the wider question
 * directly. It is a probe, not a move, and it is never taken while in check.
 */
function threatAgainst(pos: Chess, budget: Budget, opts: ChainOpts): number {
	if (pos.isCheck()) return Infinity;
	const passed = pos.clone();
	(passed as unknown as { turn: Color }).turn = other(pos.turn);
	(passed as unknown as { epSquare: Square | undefined }).epSquare = undefined;
	try {
		return quiesce(passed, -Infinity, Infinity, budget, undefined, opts);
	} catch {
		return 0;
	}
}

/** The defender's holding replies, plus any counter-threat they have. */
function withCounters(pos: Chess, holds: Move[]): Move[] {
	const seen = new Set(holds.map((m) => m.from * 4096 + m.to * 8 + (m.promotion ? 1 : 0)));
	const out = [...holds];
	for (const m of obliging(pos)) {
		const k = m.from * 4096 + m.to * 8 + (m.promotion ? 1 : 0);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(m);
	}
	return out;
}

/**
 * The value of this position to the side to move, searched along coercion.
 *
 * `attacker` is the side whose moves are pruned to the coercive ones. Pruning
 * that side can only lose a win we might have found; pruning the other invents
 * wins that are not there.
 */
export function chainValue(
	pos: Chess,
	alpha: number,
	beta: number,
	budget: Budget,
	attacker: Color,
	ply = 0,
	pv?: Move[],
	opts: ChainOpts = {},
): number {
	if (--budget.nodes < 0) {
		budget.exhausted = true;
		CHAIN_STATS.budget++;
		return settled(pos, alpha, beta, budget, pv, opts);
	}
	if (ply >= (opts.plyCap ?? PLY_CAP)) {
		CHAIN_STATS.plyCap++;
		return settled(pos, alpha, beta, budget, pv, opts);
	}

	const attacking = pos.turn === attacker;

	if (attacking) {
		// Bank what is already there: stopping is always an option, and it is what
		// "the forced phase resolves here" means (§4.1).
		let best = settled(pos, alpha, beta, budget, pv, opts);
		if (best > alpha) alpha = best;
		if (alpha >= beta) return best;

		// Everything, when coercion is defined by what a move DOES rather than what
		// kind of move it is; the settle test one ply down does the pruning.
		const coercive = (opts.wide ?? WIDE) ? allMoves(pos) : obliging(pos);
		if (!coercive.length) {
			CHAIN_STATS.settledQuiet++;
			return best;
		}
		// Most valuable first, so the cheap cutoffs happen early.
		coercive.sort((a, b) => immediate(pos, b) - immediate(pos, a));

		for (const m of coercive) {
			const after = pos.clone();
			try {
				after.play(m);
			} catch {
				continue;
			}
			const childPv: Move[] | undefined = pv ? [] : undefined;
			const im = immediate(pos, m);
			const score =
				im - chainValue(after, im - beta, im - alpha, budget, attacker, ply + 1, childPv, opts);
			if (score > best) {
				best = score;
				if (pv) {
					pv.length = 0;
					pv.push(m, ...(childPv ?? []));
				}
			}
			if (best > alpha) alpha = best;
			if (alpha >= beta) break;
		}
		return best;
	}

	// Defender: no standing pat — they are answering an obligation — but only the
	// replies that hold are theirs to choose from.
	const replies = repliesThatHold(pos, budget, opts);
	if (!replies.length) return pos.isCheck() ? -Infinity : 0;
	// Not coerced: this is a choice, not a forced reply, so the chain ends here
	// and the position is worth what quiescence says it is worth.
	//
	// Except in check, which is never a choice. The first version applied the
	// bound here too and lost every mate in the sample: "replies that hold" is
	// measured in MATERIAL, and when the threat is mate, material says every king
	// move holds. So the one obligation whose cost is infinite was the one the
	// coercion test could not see — the reply set stayed wide and the chain
	// settled exactly where the mate lived.
	// A wide reply set is evidence that the move did not coerce — but only in a
	// position where nothing is outstanding. Where a piece is hanging, "many
	// replies hold" means the material filter cannot see what is happening rather
	// than that the defender is comfortable: in an attack most replies hold
	// materially and lose anyway. That is where the attacking failures were being
	// lost — `CsybP` settled on width 727 times in a single ply, in a position the
	// engine scores at +656.
	//
	// Removing the bound there does not work: it never settles, and the search
	// runs for minutes. Widening it does — the threshold triples while something
	// is hanging, and holds otherwise.
	const outstanding = atRisk(pos) >= V.knight || threatAgainst(pos, budget, opts) >= V.knight;
	const bound = (opts.maxReplies ?? MAX_REPLIES) * (outstanding ? 3 : 1);
	if (!pos.isCheck() && replies.length > bound) {
		CHAIN_STATS.settledWide++;
		return settled(pos, alpha, beta, budget, pv, opts);
	}

	// A defender who is constrained on material may still have a counter-threat,
	// and that is the standard refutation of a forcing line. The material filter
	// discards it by construction: a zwischenzug wins nothing on the spot.
	const expand = (opts.counters ?? COUNTER) ? withCounters(pos, replies) : replies;

	let best = -Infinity;
	let considered = 0;
	for (const m of expand) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		considered++;
		const childPv: Move[] | undefined = pv ? [] : undefined;
		const im = immediate(pos, m);
		const score =
			im - chainValue(after, im - beta, im - alpha, budget, attacker, ply + 1, childPv, opts);
		if (score > best) {
			best = score;
			if (pv) {
				pv.length = 0;
				pv.push(m, ...(childPv ?? []));
			}
		}
		if (best > alpha) alpha = best;
		if (alpha >= beta) break;
	}
	// `considered === 0` means nothing was looked at — NOT that everything lost.
	// Collapsing the two deletes mate: a node where every reply loses is a mate
	// one ply further out, and rewriting its -Infinity as 0 says "nothing
	// happens" about being mated. `net` learned this once already; I reproduced
	// the bug here by copying the shape of the code and not its history.
	return considered === 0 ? 0 : best;
}

export type ChainScored = { move: Move; score: number; line?: Move[] };

/**
 * Every legal move at the root, valued by the coercion search.
 *
 * The root is complete — every legal move, not just the coercive ones — because
 * the question being asked is "what should be played", and a quiet move can be
 * the answer. Coercion governs what happens BELOW the root, which is exactly the
 * separation this file exists to make.
 */
export function chainMoves(
	pos: Chess,
	perMove = 60_000,
	opts: ChainOpts = {},
): { scored: ChainScored[]; exhausted: number } {
	const side = pos.turn;
	const out: ChainScored[] = [];
	let exhausted = 0;
	for (const m of allMoves(pos)) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		const budget: Budget = { nodes: perMove };
		const line: Move[] = [];
		const v = immediate(pos, m) - chainValue(after, -Infinity, Infinity, budget, side, 1, line, opts);
		if (budget.exhausted) exhausted++;
		out.push({ move: m, score: v, line: [m, ...line] });
	}
	return { scored: out.sort((a, b) => b.score - a.score), exhausted };
}


// ---------------------------------------------------------------------------
// The reason the chain is worth having.
//
// Will: "Basing the heuristic on the chain would be much better than search
// because it actually builds the logical structure that we can use as
// motivation. We show systematically that the plausible branches that matter
// (both players playing rationally) result in lower final score than solution.
// This is what we want since the whole point of the detector is to be able to
// annotate mistakes and puzzles to explain the black box Stockfish eval, which
// offers little direct pedagogy."
//
// A search returns a number. This returns the argument for the number: the move,
// what the opponent can still do about it, and what each of those comes to. It
// is the same computation as `chainValue` — the same holding-reply sets, the same
// leaf values — kept rather than discarded.
// ---------------------------------------------------------------------------

export type Branch = {
	move: Move;
	/** Value to the side who played `move`, in centipawns. */
	value: number;
	/** True when the opponent has exactly one LEGAL move: forced in the strict sense. */
	forced: boolean;
	/**
	 * How many replies hold — stay within a pawn of their best. One is not the
	 * same as `forced`: it means everything else concedes, which is a claim about
	 * the position rather than about the rules, and the two read very differently
	 * in an explanation.
	 */
	options: number;
	/** Legal moves available, for telling those two apart. */
	legal: number;
	/** The opponent's replies, best first. Empty at the depth limit. */
	replies: Branch[];
};

/** How many of the opponent's replies to keep in the explanation. */
const EXPLAIN_WIDTH = 3;

/**
 * Build the argument for one move: what it forces, and what each answer is worth.
 *
 * `plies` counts half-moves of explanation, not search depth — the values under
 * it come from the full chain search, so a two-ply explanation still rests on
 * everything the search found beneath it.
 */
export function explain(pos: Chess, move: Move, plies = 3, perMove = 40_000, opts: ChainOpts = {}): Branch | null {
	const after = pos.clone();
	try {
		after.play(move);
	} catch {
		return null;
	}
	const budget: Budget = { nodes: perMove };
	const im = immediate(pos, move);
	const value = im - chainValue(after, -Infinity, Infinity, budget, pos.turn, 1, undefined, opts);

	// -1 means "not looked at", which is not the same as "they have none" — the
	// first version printed "0 replies hold" at every leaf, which reads as a claim
	// about the position rather than about where the explanation stopped.
	let replies: Branch[] = [];
	let options = -1;
	let legal = -1;
	if (plies > 0) {
		// The shallow values are already computed to decide which replies hold, so
		// they order the list for free. Only the best few are searched properly —
		// explaining all forty was forty full chain searches per node, and took
		// three quarters of a minute for one move.
		const holds = holdingReplies(after, { nodes: perMove }, opts);
		options = holds.length;
		legal = allMoves(after).length;
		for (const { m: r } of holds.slice(0, EXPLAIN_WIDTH)) {
			const child = explain(after, r, plies - 1, Math.max(3_000, Math.floor(perMove / 4)), opts);
			if (child) replies.push(child);
		}
		replies.sort((a, b) => b.value - a.value);
	}

	return { move, value, forced: legal === 1, options, legal, replies };
}

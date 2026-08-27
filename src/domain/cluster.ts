// §6's decomposition — the object the tree is actually over.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §6.1, §6.2 and §6.3.
//
// §0's change table, on what §2.2 becomes:
//
//   "It DOES decompose, except at couplings, of which there are four kinds (§6).
//    THE TREE IS OVER COUPLINGS, NOT OVER PLIES."
//
// and §6.1:
//
//   "If two exchange chains share no piece, no line and no tempo, their values
//    add and there is no tree at all — a sum of closed-form exchanges. Every
//    branch point in the computation is a COUPLING. … Depth is the number of
//    couplings; branching is the arity of each."
//
// WHAT THIS REPLACES, and it is the finding of AUDIT-THEORY-VS-CODE.md.
//
// `traverse.ts` branches on ROUNDS of §4's alternation. §4 is real, but it is the
// concession over an obligation set — §6 is the decomposition, and it was skipped.
// `couple.ts` has computed all four coupling kinds since M5 and the only consumer
// in the whole domain was the board overlay; `traverse.test.ts` even carried a
// test named "does not consult the couplings" asserting that hiding them changed
// nothing. This file is that omission repaired.
//
// The consequence is not only fidelity. One 2^n recurrence over every row of a
// side puts exchanges that should simply ADD into competition for the same tempi,
// which is exactly the over-crediting six checkpoints of cause tables kept
// finding and kept patching inside the wrong object.
//
// Will:
//
//   "A board position is a portfolio of options of exchanges (or priced
//    obligations), some of which are branched or entangled. … each move changes
//    how pieces are partitioned between exchange clusters (which piece
//    contributes where), which affected cluster's value potentially changes."
//
// SITES, NOT CHAINS. `couple.chains` requires BOTH sides to bear on a square, so
// a hanging piece is not a chain at all — the four-rook position decomposed to
// nothing. Will's phrase is "exchanges (or priced obligations)" and it is one
// set: every square an enemy piece attacks is a place material can change hands,
// two-sided or not. `couple.ts`'s narrower reading is right for what it does and
// wrong for what a cluster is over.
// ---------------------------------------------------------------------------

import { between } from 'chessops/attacks';
import { makeSquare } from 'chessops/util';
import type { Board } from 'chessops/board';
import type { Color, Square } from 'chessops/types';
import { V, other } from './exchange';
import { stateOf, bearing, line, without, type State } from './state';

/** A square where material can change hands. §6.3's leaf, before any commitment. */
export type Site = {
	square: Square;
	owner: Color;
	/** Who would be taking. */
	taker: Color;
	attackers: Square[];
	defenders: Square[];
	/** SEE for the taker. Zero means the exchange is declined, not absent. */
	value: number;
	/** How many captures actually happen — an output, §6.3. */
	length: number;
	/** The men the exchange consumes, in order. §6.2 commits exactly these. */
	spent: Square[];
};

/**
 * Every exchange site, both sides, one pass — READ OFF THE GRAPH.
 *
 * `bearing` and `value` come from `state.ts`, which answers from the contingency
 * index rather than the board. §9: "the state is not the board, it is the
 * exchange complex." This is the first of the M3–M7 modules to be moved onto it;
 * `state.test.ts` pins the two answers equal, so the port is a substitution and
 * not a change of meaning.
 */
export function sites(s: State): Site[] {
	const out: Site[] = [];
	for (const [square, piece] of s.men) {
		// A KING IS NOT AN EXCHANGE SITE. It cannot be captured, so there is no
		// exchange to price; its SEE is infinite and would swamp any cluster it
		// landed in — the knight fork decomposed to -Infinity before this line.
		// Check is §1's `mate` row at weight ∞, an OBLIGATION, and obligations are
		// a different layer from §6's exchanges.
		if (piece.role === 'king') continue;
		const taker = other(piece.color);
		const attackers = bearing(s, square, taker);
		if (!attackers.length) continue; // nobody is bearing on it: no exchange here
		const defenders = bearing(s, square, piece.color);
		const ex = line(s, square, taker);
		out.push({
			square,
			owner: piece.color,
			taker,
			attackers,
			defenders,
			value: ex.value,
			length: ex.depth,
			spent: ex.spent,
		});
	}
	return out.sort((a, b) => a.square - b.square);
}

/** One independent piece of the position. §6.1's "their values add". */
export type Cluster = {
	sites: Site[];
	/** Pieces taking part in more than one of its sites. §6.2's branch points. */
	contested: Square[];
};

/**
 * Are two sites entangled? — §6.1's three ways, asked directly.
 *
 * A PIECE   their participant sets intersect. §6.1's contested defender.
 * A LINE    one site's square lies between an attacker and its target on the
 *           other. §6.1's contested square — interference and blocking — and the
 *           x-ray case falls out of it, since an x-ray IS a square on two rays.
 * TEMPO IS NOT HERE, and that is the correction that made this file coherent.
 *
 * §6.1 lists "no piece, no line and no tempo" as the three ways two chains can be
 * independent, and the first version put all three in. But two exchanges the same
 * side can win always compete for a tempo — the side has one move — so the tempo
 * clause merges nearly everything and the decomposition collapses. Worse, it
 * DOUBLE-COUNTS: the four-rook position came out at +1000 because each file was
 * priced as a clean win and nothing noticed White can only take one.
 *
 * The tempo race is §3's covering problem and §4's concession, and `traverse.ts`
 * computes it. What §6 answers is a different question: WHICH PIECE CONTRIBUTES
 * WHERE. So this file says what each exchange is WORTH once contested pieces are
 * committed, and the scheduler says which of them are actually COLLECTED. Two
 * questions, two mechanisms, composed — rather than one mechanism doing both
 * badly, which is what six checkpoints of cause tables were looking at.
 */
function entangled(a: Site, b: Site): boolean {
	const pa = new Set([...a.attackers, ...a.defenders, a.square]);
	for (const p of [...b.attackers, ...b.defenders, b.square]) if (pa.has(p)) return true;

	for (const [x, y] of [
		[a, b],
		[b, a],
	] as const) {
		for (const at of x.attackers) if (between(at, x.square).has(y.square)) return true;
	}

	return false;
}

/** The position as independent clusters. Union-find over `entangled`. */
export function clusters(ss: Site[]): Cluster[] {
	const n = ss.length;
	const parent = Array.from({ length: n }, (_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++) if (entangled(ss[i], ss[j])) parent[find(i)] = find(j);

	const by = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const r = find(i);
		by.set(r, (by.get(r) ?? []).concat(i));
	}

	const out: Cluster[] = [];
	for (const [, idx] of by) {
		const mine = idx.map((i) => ss[i]).sort((a, b) => a.square - b.square);
		const seen = new Map<Square, number>();
		for (const s of mine) for (const p of [...s.attackers, ...s.defenders]) seen.set(p, (seen.get(p) ?? 0) + 1);
		out.push({ sites: mine, contested: [...seen].filter(([, k]) => k > 1).map(([p]) => p).sort((a, b) => a - b) });
	}
	return out.sort((a, b) => a.sites[0].square - b.sites[0].square);
}

/** Above this a cluster is priced flat rather than enumerated. */
export const MAX_SITES = 10;

/**
 * What each site in a cluster is worth once contested pieces are committed.
 *
 * ---------------------------------------------------------------------------
 * §6.2, and it is the correction `commit.ts` needed and did not get:
 *
 *   "If the defender committed every contested piece up front, the value would
 *    be a min over assignments of a sum of independent chains: A MATCHING,
 *    nothing more. The tree exists because commitment is SEQUENTIAL. The
 *    defender learns the attacker's order as it happens and allocates in
 *    response, so alternation is real."
 *
 * `commit.ts` built the matching. It tied, the tie fell to enumeration order, and
 * it was deleted for that. The reason it tied is stated right there: a matching
 * has no order to break ties with, and the sequential game does — whoever moves
 * picks, and the other answers.
 *
 * A VECTOR, NOT A TOTAL. The output is a value per site, because the caller is
 * §1's ledger: each site becomes an obligation with a weight, and which of those
 * obligations are actually collected is §3's covering problem. This file must not
 * decide that — the first version did, by making the cluster a turn-taking game,
 * and it double-counted the tempo the scheduler was already counting.
 *
 * The line the minimax takes commits pieces in order. A site's value is the
 * exchange AT THE MOMENT IT WOULD BE RUN, on the board those commitments have
 * produced. Sites the line never runs are priced on the board it ends with —
 * they are still threats, and what they are worth is what they would be worth
 * then.
 * ---------------------------------------------------------------------------
 */
export function valuesOf(st: State, cl: Cluster, turn: Color): Map<Square, number> {
	const out = new Map<Square, number>(cl.sites.map((s) => [s.square, s.value]));
	if (cl.sites.length < 2 || !cl.contested.length) return out;
	if (cl.sites.length > MAX_SITES) return out;

	type Node = { total: number; pick: number };
	/** Lexicographic, for the mirror-invariant tie-break below. */
	const cmp = (a: number[], b: number[]): number => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const d = (a[i] ?? 0) - (b[i] ?? 0);
			if (d) return d;
		}
		return 0;
	};
	const memo = new Map<string, Node>();
	const NONE = -1;

	// §6.2's "on the board those commitments have produced" — but there is no
	// board. Committing men is dropping them from the occupancy; the edges are
	// static and the ones anchored on a departed square stop being read. No
	// clone, no take, and nothing rebuilt per node of the game below.
	const afterSpending = (gone: number[]): State => without(st, gone as Square[]);

	/** Whoever is to move runs one of their sites, or passes. Two passes end it. */
	const walk = (open: number, gone: number[], side: Color, passed: boolean): Node => {
		const k = `${open}:${gone.join(',')}:${side[0]}:${passed ? 1 : 0}`;
		const had = memo.get(k);
		if (had) return had;

		// Passing is always available — §6.3's max(0, ·), and §9.3's pass in the
		// quotient. Two in a row and the cluster is settled. Without that explicit
		// terminal the two sides flip to each other forever, which is how the first
		// version of this file overflowed the stack.
		let best: Node = { total: passed ? 0 : walk(open, gone, other(side), true).total, pick: NONE };
		const now = afterSpending(gone);
		let bestRank: number[] = [];

		for (let i = 0; i < cl.sites.length; i++) {
			if (!(open & (1 << i))) continue;
			const s = cl.sites[i];
			if (s.taker !== side) continue;
			if (!now.men.has(s.square)) continue;
			const ex = line(now, s.square, side);
			if (!(ex.value > 0)) continue;

			// Running it spends exactly the pieces that MOVED, read off the line the
			// exchange plays. §6.3: chain length is an output of the same backward
			// pass that produces the value, so `spent` already names who took part
			// and re-deriving it from the participant sets would be guessing at
			// something already computed.
			const rest = [...new Set([...gone, ...(ex.spent as number[]), s.square as number])].sort((x, z) => x - z);
			const gain = side === 'white' ? ex.value : -ex.value;
			const total = gain + walk(open & ~(1 << i), rest, other(side), false).total;
			const better = side === 'white' ? total > best.total : total < best.total;

			// EQUAL TOTALS STILL DIFFER, and this is the third time this project has
			// been caught by it. Two orders can be worth the same to the cluster and
			// still leave different values on different squares — and the caller is
			// the ledger, which reads the squares. `commit.ts` broke such ties by
			// enumeration order, which is square order, which mirroring reverses; so
			// did the domination filter in `traverse.ts`. The reflection property
			// caught all three.
			//
			// So ties are broken on facts that MIRROR: what the exchange is worth,
			// how long it runs, how many pieces are on each side of it, and what is
			// standing there. A square index appears nowhere.
			const owner = now.men.get(s.square);
			const rank = [ex.value, -ex.depth, -s.defenders.length, s.attackers.length, owner ? V[owner.role] : 0];
			const ties = !better && total === best.total && best.pick !== NONE;
			if (best.pick === NONE || better || (ties && cmp(rank, bestRank) > 0)) {
				best = { total, pick: i };
				bestRank = rank;
			}
		}

		memo.set(k, best);
		return best;
	};

	// Walk the line the minimax takes and record what each site was worth when it
	// ran. Then price whatever it never ran on the board the line ends with.
	let open = (1 << cl.sites.length) - 1;
	let gone: number[] = [];
	let side = turn;
	let passed = false;
	for (let guard = 0; guard < 2 * cl.sites.length + 2; guard++) {
		const n = memo.get(`${open}:${gone.join(',')}:${side[0]}:${passed ? 1 : 0}`) ?? walk(open, gone, side, passed);
		if (n.pick === NONE) {
			if (passed) break;
			passed = true;
			side = other(side);
			continue;
		}
		const s = cl.sites[n.pick];
		const ex = line(afterSpending(gone), s.square, side);
		out.set(s.square, ex.value);
		gone = [...new Set([...gone, ...(ex.spent as number[]), s.square as number])].sort((x, z) => x - z);
		open &= ~(1 << n.pick);
		side = other(side);
		passed = false;
	}
	// SITES THE LINE NEVER RUNS KEEP THEIR NAIVE VALUE, and that is a correction.
	//
	// The first version priced them on the board the line ends with. That assumes
	// the cluster's whole exchange sequence completes before anything else in the
	// position matters — which is a claim about TEMPO, and tempo is §3's covering
	// problem, not §6's. It cost 2.6 points on the gate and 3.4 on option-set
	// recall, because a threat re-priced to zero stops being a row and the row is
	// what names the candidate move.
	//
	// §6.2 licenses one thing: what an exchange is worth once the pieces that
	// cannot be in two places have been committed. That is a statement about the
	// exchanges the commitment sequence actually runs. Everything else is
	// unchanged, and saying otherwise is this file reaching into the next one.
	return out;
}

/**
 * Every site on the board, priced with commitments settled — §6 in one call.
 *
 * This is what §1's ledger should weigh its immediate rows by. The naive SEE at a
 * square assumes every defender is free to defend it; this says what the square
 * is worth once the pieces that cannot be in two places have been committed by
 * the sequential game that commits them.
 */
export function priced(st: State, turn: Color): Map<Square, number> {
	const out = new Map<Square, number>();
	for (const cl of clusters(sites(st))) for (const [sq, v] of valuesOf(st, cl, turn)) out.set(sq, v);
	return out;
}

/** The same, from a board — the one call that still needs one. */
export const pricedOn = (board: Board, turn: Color): Map<Square, number> => priced(stateOf(board), turn);

/**
 * The exchange portfolio, from White's reference — §6.1's sum ACROSS clusters.
 *
 * Diagnostic only. It is NOT the position's value: which of these exchanges
 * actually get collected is the tempo race, and that is §3 and §4's business.
 */
export function portfolio(board: Board, turn: Color): number {
	const st = stateOf(board);
	let n = 0;
	for (const [sq, v] of priced(st, turn)) {
		if (!(v > 0)) continue;
		const p = st.men.get(sq);
		if (p) n += p.color === 'black' ? v : -v;
	}
	return n;
}

/** What the decomposition says, for the panel and the sentence. */
export function say(board: Board, turn: Color): string {
	const st = stateOf(board);
	const cls = clusters(sites(st));
	if (!cls.length) return 'no exchange is live';
	return cls
		.map((cl) => {
			const v = valuesOf(st, cl, turn);
			const where = cl.sites.map((s) => `${makeSquare(s.square)}:${v.get(s.square)}`).join(' ');
			const tail = cl.contested.length ? ` (${cl.contested.map(makeSquare).join(', ')} doing two jobs)` : '';
			return `${where}${tail}`;
		})
		.join(' · ');
}

export { V };

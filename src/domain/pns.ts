// Depth-first proof-number search — the proof engine, and it knows no chess.
//
// ---------------------------------------------------------------------------
// WHY THIS RATHER THAN ALPHA-BETA.
//
// The ladder's framing is "a sequential proof by exclusion that no higher value
// tactic exists". That needs negatives that are CERTIFICATES rather than
// failures to find. Alpha-beta proves a bound; it cannot say "there is no mate",
// only "I did not find one within my window and depth". Proof-number search
// proves a goal in both directions: `phi = 0` proves it, `delta = INF` refutes
// it, and the tree that did so is the proof.
//
// It is also the right shape for tactics without being told so. PNS expands the
// node nearest to RESOLVING, and a forcing move has few children, so its numbers
// are small, so it is expanded first. "Try checks first" falls out of the
// arithmetic instead of being a hand-written heuristic — which matters in this
// project, where hand-written heuristics have been rejected three times and were
// wrong each time.
//
// DF-PN rather than plain PNS: plain PNS keeps the whole tree in memory, which
// is the standard reason it is not used in practice. Depth-first with thresholds
// keeps a path plus a transposition table.
//
// ---------------------------------------------------------------------------
// PHI AND DELTA, NOT PROOF AND DISPROOF.
//
// Written the usual way, PNS needs two cases everywhere: an OR node takes the
// min of children's proof numbers and the sum of their disproof numbers, and an
// AND node does the reverse. Duplicated code that must stay in step is where
// this kind of algorithm goes wrong.
//
// So every number here is stated FROM THE NODE'S OWN MOVER'S POINT OF VIEW:
//
//   phi(n)   how hard it is for the mover at n to achieve their goal
//   delta(n) how hard it is to stop them
//
// and both node types then obey one pair of equations, because a child's mover
// is the opponent and their roles swap:
//
//   phi(n)   = min over children of delta(c)
//   delta(n) = sum over children of phi(c)
//
// A terminal where the mover achieves their goal is (0, INF); one where they
// fail is (INF, 0). At the root — our move, our goal — `phi = 0` is proved and
// `delta = INF` is refuted.
//
// ---------------------------------------------------------------------------
// GRAPH HISTORY INTERACTION, AND WHY IT IS ABSENT HERE.
//
// PNS with a transposition table is famously unsound about repetition: the same
// position reached by two paths can have two values, because a repetition is a
// draw and whether one has occurred depends on the path. Caching one value under
// one key is then wrong.
//
// This search does not have that problem, and the reason is worth writing down
// rather than being lucky about. The table is keyed on **(state, depthLeft)**
// and `depthLeft` strictly decreases at every ply. The search space is therefore
// a DAG with no cycles at all — a position at depth 3 and the same position at
// depth 1 are different nodes, and no node can be its own descendant.
//
// This holds ONLY because the search is depth-bounded. An unbounded PNS over the
// same domain would need real GHI handling, and if this engine is ever run
// without a bound that is the first thing to fix.
// ---------------------------------------------------------------------------

/** Large enough to stand for "impossible", small enough to add without overflow. */
export const INF = 1 << 28;

/**
 * What a terminal node is worth TO THE PLAYER WHOSE TURN IT IS.
 *
 * Deliberately mover-relative rather than "win/loss", so the engine never needs
 * to know which side it is working for. The domain decides — including what
 * running out of depth means, which is not the same answer at both node types:
 * for the attacker, depth exhaustion is a failure to mate; for the defender it
 * is a success at surviving.
 */
export type Verdict = 'moverWins' | 'moverLoses' | null;

export interface Problem<S> {
	/** A verdict, or null when the node is not resolved and must be expanded. */
	terminal(state: S, depthLeft: number): Verdict;
	/** Successor states. An empty list must have been reported as terminal. */
	children(state: S): S[];
	/** Stable identity for the transposition table. Depth is added by the engine. */
	key(state: S): string;
	/**
	 * Optional (phi, delta) for an unexpanded leaf, instead of (1, 1).
	 *
	 * THIS IS WHERE DOMAIN KNOWLEDGE BELONGS — as initialisation, never as a cut.
	 * A target with no safe escape can be seeded `phi = 1`; one with six can be
	 * seeded higher. Wrong seeds cost time; they cannot change the answer, because
	 * every number is recomputed from children as soon as a node is expanded. A
	 * pruning heuristic in the same place could change the answer, which is the
	 * distinction this project keeps getting wrong and having to correct.
	 */
	init?(state: S, depthLeft: number): [phi: number, delta: number];
}

export type Result<S> = {
	/** True when the root's goal is proved. */
	proved: boolean;
	/** True when it is REFUTED — the certificate that no such tactic exists. */
	refuted: boolean;
	/** Nodes expanded. The cost, for the gates. */
	nodes: number;
	/** The principal variation, root first, as far as the proof determines it. */
	line: S[];
	/**
	 * WITNESSES: children through which the root's mover was SHOWN to achieve
	 * their goal. **Not the complete set, and the difference matters.**
	 *
	 * The first version of this comment claimed it was "every reply that
	 * survives", and a panel built on that claim printed "1 reply survives" for a
	 * position with twenty-nine. The reason is the search's whole design: df-pn
	 * stops the moment `phi(root)` crosses its threshold, which takes ONE child
	 * with `delta = 0`. Every other child keeps its `init` numbers, so it is
	 * indistinguishable here from a child that loses. Measured on `ohoTK` after
	 * ♕f5–b1: `via` = 1, the truth = 29.
	 *
	 * So this is a LOWER BOUND on the saving resources — enough to say "they have
	 * an answer, and here is one", never enough to say "they have exactly n". A
	 * caller that needs the enumeration — Hall's condition needs it, since "every
	 * survivor gives up a man worth V" quantifies over all of them — must solve
	 * each child separately and pay for it. `ladder.ts`'s `survivingReplies` is
	 * that, and it is deliberately on-demand rather than folded in here, because
	 * an enumeration nobody asked for costs a solve per legal move.
	 *
	 * Empty when the mover does not achieve their goal.
	 */
	via: S[];
};

type Pair = { phi: number; delta: number };

/**
 * Prove or refute the root's goal within `maxDepth` plies.
 *
 * `nodeLimit` is a safety valve, not a search parameter: hitting it returns
 * neither proved nor refuted, which is an honest "don't know" rather than a
 * wrong answer.
 */
export function solve<S>(problem: Problem<S>, root: S, maxDepth: number, nodeLimit = 2_000_000): Result<S> {
	const tt = new Map<string, Pair>();
	let nodes = 0;
	let exhausted = false;

	const at = (state: S, depthLeft: number): string => `${problem.key(state)}|${depthLeft}`;

	/** A node's numbers: from the table, from a terminal, or from `init`. */
	const look = (state: S, depthLeft: number): Pair => {
		const k = at(state, depthLeft);
		const had = tt.get(k);
		if (had) return had;
		const t = problem.terminal(state, depthLeft);
		if (t) return t === 'moverWins' ? { phi: 0, delta: INF } : { phi: INF, delta: 0 };
		const [phi, delta] = problem.init?.(state, depthLeft) ?? [1, 1];
		return { phi, delta };
	};

	/**
	 * Expand `state` until its numbers cross the thresholds handed down to it.
	 *
	 * The thresholds are what makes this depth-first: a node keeps working only
	 * while it is still the most-proving line, and hands control back the moment
	 * it stops being so.
	 */
	const mid = (state: S, depthLeft: number, thPhi: number, thDelta: number): void => {
		if (nodes >= nodeLimit) {
			exhausted = true;
			return;
		}
		const k = at(state, depthLeft);
		const t = problem.terminal(state, depthLeft);
		if (t) {
			tt.set(k, t === 'moverWins' ? { phi: 0, delta: INF } : { phi: INF, delta: 0 });
			return;
		}
		const kids = problem.children(state);
		if (!kids.length) {
			// No moves and not terminal: the domain failed to classify it. Refusing
			// is better than inventing a value for a node nobody described.
			tt.set(k, { phi: INF, delta: 0 });
			return;
		}
		nodes++;

		for (;;) {
			// phi = min of children's delta; delta = sum of children's phi.
			let phi = INF;
			let delta = 0;
			let best = 0;
			let bestDelta = INF;
			let secondDelta = INF;
			for (let i = 0; i < kids.length; i++) {
				const c = look(kids[i], depthLeft - 1);
				delta += c.phi;
				if (c.delta < bestDelta) {
					secondDelta = bestDelta;
					bestDelta = c.delta;
					best = i;
				} else if (c.delta < secondDelta) {
					secondDelta = c.delta;
				}
			}
			phi = bestDelta;
			if (delta > INF) delta = INF;

			if (phi >= thPhi || delta >= thDelta) {
				tt.set(k, { phi, delta });
				return;
			}
			if (nodes >= nodeLimit) {
				exhausted = true;
				tt.set(k, { phi, delta });
				return;
			}

			// The most-proving child, and the thresholds that keep it working only
			// while it stays the most promising line.
			const c = look(kids[best], depthLeft - 1);
			const childThPhi = thDelta === INF ? INF : Math.min(INF, thDelta - (delta - c.phi));
			const childThDelta = Math.min(thPhi, secondDelta === INF ? INF : secondDelta + 1);
			mid(kids[best], depthLeft - 1, childThPhi, childThDelta);
		}
	};

	mid(root, maxDepth, INF, INF);
	const r = look(root, maxDepth);

	// The principal variation, walked back out of the table: at each node take the
	// child with the smallest delta, which is the one the proof went through.
	const line: S[] = [root];
	if (r.phi === 0) {
		let s = root;
		let d = maxDepth;
		while (d > 0 && !problem.terminal(s, d)) {
			const kids = problem.children(s);
			if (!kids.length) break;
			let pick = kids[0];
			let bestDelta = INF + 1;
			for (const c of kids) {
				const v = look(c, d - 1);
				if (v.delta < bestDelta) {
					bestDelta = v.delta;
					pick = c;
				}
			}
			line.push(pick);
			s = pick;
			d--;
		}
	}

	// The achieving children: `phi(root) = min over children of delta(child)`, so
	// the ones that achieve it are exactly those with `delta = 0`.
	const via: S[] = [];
	if (r.phi === 0) {
		for (const c of problem.children(root)) if (look(c, maxDepth - 1).delta === 0) via.push(c);
	}

	return {
		// A resolved node is (0, INF) or (INF, 0), and BOTH have `delta = INF` in
		// one of the two cases — so the refutation test has to read `phi`, not
		// `delta`. Reading `delta` made `refuted` true for every proved mate as
		// well, which stayed invisible for as long as the caller wrote
		// `if (proved) ... else if (refuted)`. The proving half was 100% correct
		// with the refuting half inverted; only asking for a refutation on purpose
		// found it.
		proved: !exhausted && r.phi === 0,
		refuted: !exhausted && r.phi >= INF,
		nodes,
		line,
		via,
	};
}

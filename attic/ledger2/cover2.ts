// Γ, and the covering condition.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §2 (the cover graph), §3 (deficiency and its three failure
// modes), as closed by AMEND-2-ARRIVES.md. PLAN.md M4.
//
// The frozen `cover.ts` computed a max over obligations, cited §3.3, and passed
// review. It is a SET COVER OF SIZE ONE — is there one move whose Resolves
// contains all of E — and a max cannot express "one move answers both", which
// is the whole of the pedagogy and the difference between a fork and two
// separate threats.
//
// Nothing here generates a move list or plays a move. Candidates come from the
// distance index by reverse lookup (§9.3): for each square the ledger cares
// about, which pieces reach it within τ. Boards are cloned for SEE only —
// occupancy edits, which is §7's three lookups, not a replay.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import type { Board } from 'chessops/board';
import type { Chess } from 'chessops/chess';
import type { Color, Square } from 'chessops/types';
import { V, other, seeValue, capturersOn, pinsFor } from './exchange';
import type { Obligation } from './ledger2';
import { ledger, isLive } from './ledger2';
import { reach, distance } from './reach';
import type { Reach } from './reach';

/**
 * How a discharge is measured — AMEND-2-ARRIVES §1.1.
 *
 * `land` is standing on the square; `bear` is attacking it. To defend S is not
 * to move to S, which would be capturing your own piece. The first draft used
 * one function for both and would have made every defence a tempo too slow and
 * every occupied square undefendable.
 */
export type Kind = 'evade' | 'capture' | 'block' | 'defend';

export type Discharge = {
	/** Index into the ledger this Γ was built from. */
	obligation: number;
	kind: Kind;
	/** Who supplies it. */
	piece: Square;
	/** The required square reached — `R(e)` in the table. */
	to: Square;
	/** `arrives(p, e)`, in the owed side's tempi. */
	cost: number;
};

export type Gamma = {
	E: Obligation[];
	edges: Discharge[];
	/**
	 * Per obligation: does ANY discharge arrive in time?
	 *
	 * The distinction §3 turns on. An obligation with no edges at all is
	 * emptiness; one whose edges all arrive late is latency; and neither is
	 * cardinality, which is about edges that exist and cannot all be taken.
	 */
	coverable: boolean[];
	/** `τ*` per obligation, after §2's tempo correction. */
	tau: number[];
};

/**
 * The deadline in the OWED side's tempi.
 *
 * `deadline` counts the claimant's. If the claimant moves next they spend one
 * before the defender spends any, so the defender has one fewer. FORMALISM §5
 * says the same thing as `k_D <= k_A`. This is the single most likely place for
 * this file to be quietly wrong, which is why it is one named function.
 */
export const tauStar = (o: Obligation, turn: Color, owed: Color): number =>
	turn === owed ? o.deadline : o.deadline - 1;

/**
 * Plies until `piece` at `from` ATTACKS `to`. Zero if it already does.
 *
 * FORMALISM §5's `d(p, S)` — "can attack or defend S in k plies" — which is the
 * bearing distance and not the landing one. Measured on the current occupancy,
 * an approximation in both directions that §5 states rather than hides.
 */
export function bear(board: Board, from: Square, to: Square, r?: Reach): number {
	const piece = board.get(from);
	if (!piece) return Infinity;
	if (attacks(piece, from, board.occupied).has(to)) return 0;
	const walk = r ?? reach(board, from, { limit: 6 });
	let best = Infinity;
	for (const [sq, d] of walk.dist) {
		if (d === 0 || d >= best) continue;
		// The occupancy it will face has this piece elsewhere. Cheap correction,
		// and the direction that matters: a rook does not block its own line.
		const occ = board.occupied.without(from).with(sq);
		if (attacks(piece, sq, occ).has(to)) best = d;
	}
	return best;
}

/**
 * Where the claim comes from — the squares an attacker of `S` stands on.
 *
 * The ledger's cost-1 rows do not carry `from`: the attacker is whatever the
 * exchange at the square says it is, and there may be several. `capturersOn`
 * already excludes absolutely pinned attackers, per §1.1's participation rule.
 */
const attackersOf = (board: Board, o: Obligation, taker: Color): Square[] =>
	o.from !== undefined ? [o.from] : capturersOn(board, o.square, taker);

/**
 * The squares that must be empty for the claim to stand — `needs(e)`.
 *
 * For a cost-1 slider that is `between(attacker, S)`. For a deferred row the
 * ledger already carries the path's forced set. One field, both readings, which
 * is AMEND-7-ONE-EDGE's payoff and the reason "interpose at the deadline" is
 * not a discharge type of its own.
 */
function lineOf(board: Board, o: Obligation, taker: Color): Square[] {
	if (o.deadline > 1) return o.needs.filter((s) => s !== o.square);
	const out = new Set<Square>();
	for (const a of attackersOf(board, o, taker)) {
		for (const mid of between(a, o.square)) out.add(mid);
	}
	out.delete(o.square);
	return [...out];
}

/**
 * Is the obligation actually gone on this board? — AMEND-2-ARRIVES §4.1.
 *
 * The obligation must be cleared, not merely reduced. A discharge that shrinks
 * the debt without clearing it is priced by §4's concession, which re-reads the
 * exchange on the board the move leaves behind; counting it as an edge here
 * would make Γ claim an answer it does not have.
 *
 * Infinity is the case that matters and it needs no special handling: after
 * capturing one of two checkers the king's square still carries an infinite
 * exchange, so double check falls out rather than being a rule.
 */
const discharged = (after: Board, o: Obligation, taker: Color): boolean =>
	seeValue(after, o.square, taker) <= 0;

/** The board with one piece moved. An occupancy edit, for SEE only. */
function shifted(board: Board, from: Square, to: Square): Board {
	const b = board.clone();
	const piece = b.take(from);
	if (!piece) return b;
	b.take(to);
	b.set(to, piece);
	return b;
}

export type GammaOpts = {
	/** Whose obligations. Defaults to the side to move. */
	owed?: Color;
	/** A ledger already computed for `owed`. */
	E?: Obligation[];
	/** How far a discharge may travel. */
	limit?: number;
};

/**
 * The cover graph for `owed`.
 *
 * Reverse lookup throughout, per §9.3: for each obligation, for each square that
 * would discharge it, which of the owed side's pieces get there in time.
 *
 * Takes a board and a turn rather than a `Chess`, because those are the only two
 * things it reads. The alternative was a cast in `classify2`, which needs to ask
 * this same question with a deadline removed — and a cast that exists to satisfy
 * a parameter nothing uses is a signature that was too wide.
 */
export function gammaOn(board: Board, turn: Color, E: Obligation[], opts: GammaOpts = {}): Gamma {
	const owed = opts.owed ?? turn;
	const taker = other(owed);
	const limit = opts.limit ?? 6;
	const tau = E.map((o) => tauStar(o, turn, owed));
	const edges: Discharge[] = [];

	// One walk per piece, reused across every obligation.
	const walks = new Map<Square, Reach>();
	const walk = (p: Square) => {
		let r = walks.get(p);
		if (!r) walks.set(p, (r = reach(board, p, { limit })));
		return r;
	};

	// Absolute pins delete edges rather than being checked per move — §2.1, and
	// it is why no legal move list is needed here.
	const pinned = pinsFor(board, owed);
	const mayGo = (p: Square, to: Square): boolean => {
		const ray = pinned.get(p);
		return ray === undefined || ray.has(to);
	};

	for (let i = 0; i < E.length; i++) {
		const o = E[i];
		const t = tau[i];
		if (t < 1) continue; // Nothing can be spent. Latency, decided already.

		// ---- 1. evade. Only the piece standing on S, and only somewhere safe.
		//
		// The gate is identity, not valuation: a piece that runs to a square where
		// it is taken again has not discharged anything, it has relocated the debt.
		const target = board.get(o.square);
		if (target && target.color === owed) {
			for (const to of walk(o.square).dist) {
				if (to[1] !== 1) continue;
				if (!mayGo(o.square, to[0])) continue;
				if (seeValue(shifted(board, o.square, to[0]), to[0], taker) > 0) continue;
				edges.push({ obligation: i, kind: 'evade', piece: o.square, to: to[0], cost: 1 });
			}
		}

		// ---- 2. capture the attacker. R = {a}, landing, and the capture must not
		// lose material NET — AMEND-2-ARRIVES §4's second exception.
		//
		// The first version wrote `seeValue(board, a, owed) < 0`, which is DEAD
		// CODE: `seeValue` is documented as never negative — "nobody is forced into
		// an exchange" — so the gate rejected nothing at all. Measured consequence:
		// on 334 real checkmates Γ offered the king capturing the mating piece as a
		// discharge, and called 99.4% of them `covered`.
		//
		// The test has to be per capturing piece and it has to be a NET. What you
		// take, minus what they take back on that square once you are standing
		// there:
		//
		//   king takes a defended queen     900 − ∞   = −∞   rejected, and this is
		//                                                    exactly §1.4's claim
		//                                                    that the legality of
		//                                                    check is a consequence
		//                                                    of V[king] = ∞
		//   rook takes a queen defended by a pawn   900 − 500 = +400   allowed
		//   rook takes a pawn defended by a pawn    100 − 500 = −400   rejected
		//
		// Gating on "do they get anything back" instead would have thrown away the
		// second line, which is a queen won for a rook.
		for (const a of attackersOf(board, o, taker)) {
			const prize = board.get(a);
			if (!prize) continue;
			for (const p of board[owed]) {
				if (p === a) continue;
				const c = distance(walk(p), a);
				if (!Number.isFinite(c) || c < 1 || c > t) continue;
				if (c === 1 && !mayGo(p, a)) continue;
				// Only a capture that happens NOW can be priced on the board as it
				// stands. A cost-k arrival is priced when it arrives, which is the
				// fixed-complex boundary this milestone works within.
				if (c === 1) {
					const after = shifted(board, p, a);
					const back = seeValue(after, a, taker);
					if (V[prize.role] - back < 0) continue;
					// And it has to actually DISCHARGE — AMEND-2-ARRIVES §4.1.
					//
					// Capturing an attacker removes ONE claimant, and a move captures at
					// most one piece. Under double check the other checker still claims
					// the king, so the obligation is untouched and this is not an edge.
					// 18 of the 23 remaining checkmate failures were exactly that.
					//
					// Stated generally rather than as a rule about check: the obligation
					// must be gone on the board the discharge leaves, not merely smaller.
					// A partial reduction is priced by the concession, which already
					// re-reads the exchange on that same board.
					if (!discharged(after, o, taker)) continue;
				}
				edges.push({ obligation: i, kind: 'capture', piece: p, to: a, cost: c });
			}
		}

		// ---- 3. block the line. R = needs(e) \ {S}, landing, no gate.
		//
		// A block that hangs the blocker IS a discharge; it just costs, and the
		// cost is §4's arithmetic. Gating it here would double-count.
		for (const r of lineOf(board, o, taker)) {
			for (const p of board[owed]) {
				if (p === o.square) continue; // moving the target is type 1
				const c = distance(walk(p), r);
				if (!Number.isFinite(c) || c < 1 || c > t) continue;
				if (c === 1 && !mayGo(p, r)) continue;
				// Blocking one line of a double check leaves the other. Same rule as
				// the capture gate, and for the same reason — AMEND-2-ARRIVES §4.1.
				if (c === 1 && !discharged(shifted(board, p, r), o, taker)) continue;
				edges.push({ obligation: i, kind: 'block', piece: p, to: r, cost: c });
			}
		}

		// ---- 4. defend. R = {S}, BEARING, gated by §1.5.
		//
		// The cheap-attacker lemma is a proof that adding a defender cannot change
		// the answer, so the edge does not exist — the same sense in which a
		// blocked ray's edge does not exist. This is not pricing, and it is most
		// of the pruning.
		//
		// NOT gated on a piece standing on S. A promotion square is empty, and the
		// first version's `if (target && ...)` meant no race could ever be answered
		// by covering the queening square — which AMEND-2-ARRIVES §3 names as the
		// entire reason "interpose at the deadline" is not a discharge type of its
		// own. The lemma is about the piece being defended; with no piece,
		// `worth = 0` and every attacker clears the bar.
		const cheapest = Math.min(...attackersOf(board, o, taker).map((a) => V[board.get(a)?.role ?? 'pawn']));
		const worth = target ? V[target.role] : 0;
		if (Number.isFinite(cheapest) && cheapest >= worth) {
			for (const p of board[owed]) {
				if (p === o.square) continue;
				const c = bear(board, p, o.square, walk(p));
				if (c < 1 || c > t) continue;
				edges.push({ obligation: i, kind: 'defend', piece: p, to: o.square, cost: c });
			}
		}
	}

	const coverable = E.map((_, i) => edges.some((d) => d.obligation === i));
	return { E, edges, coverable, tau };
}

/** The cover graph for a position. Builds the ledger if one is not supplied. */
export function gamma(pos: Chess, opts: GammaOpts = {}): Gamma {
	const owed = opts.owed ?? pos.turn;
	const E = (opts.E ?? ledger(pos, owed)).filter((o) => isLive(o, pos.board));
	return gammaOn(pos.board, pos.turn, E, { ...opts, owed });
}

/**
 * The obligations due on THIS ply — `τ* <= 1`.
 *
 * The set-cover question is single-ply, so it is asked of the rows that must be
 * answered now. Asking it of a race three tempi out reported a position with one
 * perfectly coverable obligation as `cardinality`: the only edge cost 3, no
 * cost-1 move covered it, and the fall-through called that an oversubscription.
 *
 * A deferred row is answered by `Gamma.coverable`, which is Γ's other reading —
 * AMEND-2-ARRIVES §5 names them as two and this is where conflating them bites.
 */
export const due = (g: Gamma): number[] => g.E.map((_, i) => i).filter((i) => g.tau[i] <= 1);

export type Cover = {
	/** The one move that answers everything due now, if there is one. */
	move: { from: Square; to: Square } | null;
	/** Obligations that move leaves due, or all of them if there is no move. */
	uncovered: Obligation[];
};

/**
 * The set cover of size one — §3.1.
 *
 * Only a cost-1 discharge is a move you can play now, so the cover is taken over
 * those, against the obligations due now. A cost-3 edge says the obligation is
 * answerable given three tempi; it does not name a move, and reading it as one
 * is the scheduling problem this milestone does not solve.
 */
export function cover(g: Gamma): Cover {
	const live = due(g);
	if (!live.length) return { move: null, uncovered: [] };

	const byMove = new Map<string, { from: Square; to: Square; covers: Set<number> }>();
	for (const d of g.edges) {
		if (d.cost !== 1) continue;
		const k = `${d.piece}:${d.to}`;
		let row = byMove.get(k);
		if (!row) byMove.set(k, (row = { from: d.piece, to: d.to, covers: new Set() }));
		row.covers.add(d.obligation);
	}

	let best: { from: Square; to: Square; covers: Set<number> } | null = null;
	for (const row of byMove.values()) {
		const hit = live.filter((i) => row.covers.has(i)).length;
		if (hit === live.length) return { move: { from: row.from, to: row.to }, uncovered: [] };
		if (!best || hit > live.filter((i) => best!.covers.has(i)).length) best = row;
	}
	const missed = best ? live.filter((i) => !best!.covers.has(i)) : live;
	return { move: null, uncovered: missed.map((i) => g.E[i]) };
}

/**
 * The concession — DEFICIENCY.md §4.
 *
 *   L(E) = min over m of max over e not resolved by m of SEE(π·m, S_e)
 *
 * Deficiency is `L(E) > 0`; its size is `L(E)`; and the annotation is the argmin
 * together with the `e` attaining the max. That pair is the sentence: this is
 * your best move, and this is what it still costs you.
 *
 * The max is taken over what a move LEAVES, which is why it does not replace the
 * cover test — a max over obligations cannot say "one move answers both", and
 * reading it as if it could is exactly what the baseline did.
 */
export type Concession = {
	/** The best move available, or null if nothing at all can be played. */
	move: { from: Square; to: Square } | null;
	/** What it still costs. Zero means the position is covered. */
	loss: number;
	/** The obligation attaining the max — the second half of the sentence. */
	worst: Obligation | null;
	/**
	 * The heaviest debt that is NOT due this ply and cannot be answered in time.
	 *
	 * Reported beside `loss` rather than folded into it. A race lost three tempi
	 * out has `loss = 0` — correctly, since nothing is collectable on this ply —
	 * and a caller reading only `loss` would report it as costing nothing. Two
	 * numbers, because they are two facts, and averaging them would invent a
	 * third that is neither.
	 */
	deferred: Obligation | null;
};

export function concede(pos: Chess, g: Gamma, owed: Color): Concession {
	// §4's L(E) is a single-ply formula, so it is evaluated over the rows due on
	// that ply. Folding a race three tempi out into the max would price a debt
	// with tempi left as if it were due now — the same overstatement AMEND-1's
	// confidence discount exists to avoid. Deferred rows are reported by
	// `Gamma.coverable`; the multi-ply form is the scheduling problem, unbuilt.
	const live = due(g);
	const lost = g.E.filter((_, i) => !g.coverable[i] && g.tau[i] > 1);
	const deferred = lost.length ? lost.reduce((a, b) => (b.weight * b.confidence > a.weight * a.confidence ? b : a)) : null;
	if (!live.length) return { move: null, loss: 0, worst: null, deferred };

	const covers = new Map<string, { from: Square; to: Square; set: Set<number> }>();
	for (const d of g.edges) {
		if (d.cost !== 1) continue;
		const k = `${d.piece}:${d.to}`;
		let row = covers.get(k);
		if (!row) covers.set(k, (row = { from: d.piece, to: d.to, set: new Set() }));
		row.set.add(d.obligation);
	}

	let best: Concession | null = null;
	const taker = other(owed);
	for (const row of covers.values()) {
		const after = shifted(pos.board, row.from, row.to);
		let loss = 0;
		let worst: Obligation | null = null;
		for (const i of live) {
			if (row.set.has(i)) continue;
			// Re-read on the board the move leaves behind. §8: measuring on the
			// occupancy the mover has vacated is where this codebase has been wrong
			// twice, and it is the one line that has to be read that way.
			const still = seeValue(after, g.E[i].square, taker);
			if (still > loss) {
				loss = still;
				worst = g.E[i];
			}
		}
		if (!best || loss < best.loss) best = { move: { from: row.from, to: row.to }, loss, worst, deferred };
	}
	if (best) return best;

	// Nothing discharges anything. The debt stands in full.
	const top = live.map((i) => g.E[i]).reduce((a, b) => (b.weight > a.weight ? b : a));
	return { move: null, loss: top.weight, worst: top, deferred };
}

/**
 * Which way Γ failed — §3's three modes.
 *
 * Order matters and is the spec's: latency is emptiness after filtering, and
 * emptiness is the degenerate case of cardinality. So the more specific
 * diagnosis is checked first.
 */
export type Mode = 'covered' | 'cardinality' | 'emptiness' | 'latency';

export function classify2(g: Gamma, board: Board, owed: Color): Mode {
	if (!g.E.length) return 'covered';

	// Uncoverable first. An obligation with no discharge in time decides the mode
	// on its own, whatever the rest of the position can arrange.
	for (let i = 0; i < g.E.length; i++) {
		if (g.coverable[i]) continue;
		// No edge in time. Is that because there is no route, or no tempo? Ask the
		// same question with the deadline removed: an edge that appears once τ is
		// ignored was there all along and simply arrives late.
		const o = g.E[i];
		// An infinite debt has no LATER. Relaxing its deadline asks "could you
		// answer this given more time", and there is no more time: collecting it
		// ends the game. So an uncoverable infinite row is emptiness — mate — and
		// that falls out of V[king] = Infinity rather than being a special case
		// for check, which §1.4 refuses.
		//
		// Without this every checkmate classified as `latency`, because a piece
		// six moves away counted as an answer that merely arrives late.
		if (!Number.isFinite(o.weight)) return 'emptiness';
		const unhurried = gammaOn(board, owed, [{ ...o, deadline: 99 }], { owed, limit: 6 });
		return unhurried.coverable[0] ? 'latency' : 'emptiness';
	}

	// Everything is coverable given its own tempi. What remains is whether the
	// rows due NOW can be taken together — and one row due now, coverable, is not
	// an oversubscription however many deferred rows sit beside it.
	if (due(g).length < 2) return 'covered';
	return cover(g).move ? 'covered' : 'cardinality';
}

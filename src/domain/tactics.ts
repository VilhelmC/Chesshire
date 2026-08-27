// Obligations and the covering condition. FORMALISM §3, DETECTOR §§1–2.
//
// ---------------------------------------------------------------------------
// Everything here is repeated calls to `see` and nothing else. There is no
// second model, no tempo currency, no per-square verdict — the three previous
// attempts all failed by inventing one of those.
//
//   obligations(board, c)  what side c has at risk        (naming, structure)
//   harvest(pos)           what the side to move takes    (the number)
//   cover(pos, c)          is there ONE move that answers all of it
//
// The split between `obligations` and `harvest` is deliberate and they can
// disagree. `obligations` is a static sweep: it asks, of every piece, whether
// the exchange on its square pays. `harvest` asks what the opponent can
// actually collect with one legal move, so it knows about check, pins, and
// whose turn it is. When the sweep says a rook is hanging and the harvest says
// zero, the difference IS the interruption — they are in check and cannot take
// it. That disagreement is information, not an inconsistency.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Square, Color, Role, NormalMove } from 'chessops/types';

/** Standard chess has no drops, so every move has a from-square. */
type Move = NormalMove;
import type { Board } from 'chessops/board';
import type { Chess } from 'chessops/chess';
import { see, capturersOn, V, other, type Exchange } from './exchange';

export type Obligation = {
	square: Square;
	role: Role;
	/** Material at risk, per FORMALISM §1. Infinity for a king in check. */
	w: number;
	/** The chain, kept for commentary: who takes what, in order. */
	exchange: Exchange;
	/** The cheapest attacker's value — §1.5 decides from this whether defending is possible. */
	cheapestAttacker: number;
};

/**
 * What side `c` has at risk. FORMALISM §3.1.
 *
 * A pure sweep over `c`'s pieces. Check joins the list as an ordinary member
 * with $w = \infty$ — no special case, per §1.4.
 */
export function obligations(board: Board, c: Color, inCheck = false): Obligation[] {
	const out: Obligation[] = [];
	for (const s of board[c]) {
		const piece = board.get(s);
		if (!piece) continue;
		if (piece.role === 'king') {
			if (inCheck) {
				out.push({
					square: s,
					role: 'king',
					w: Infinity,
					exchange: see(board, s, other(c)),
					cheapestAttacker: 0,
				});
			}
			continue;
		}
		const e = see(board, s, other(c));
		if (e.value > 0) {
			let cheapest = Infinity;
			for (const a of e.attackers) {
				const p = board.get(a);
				if (p && V[p.role] < cheapest) cheapest = V[p.role];
			}
			out.push({ square: s, role: piece.role, w: e.value, exchange: e, cheapestAttacker: cheapest });
		}
	}
	return out.sort((a, b) => b.w - a.w);
}

/**
 * What one move by `m`'s mover is worth in material, net of the recapture.
 *
 * Move-specific rather than square-specific: `see` at a square resolves the
 * whole chain from whoever it likes, which is a different question from "what
 * does THIS move win".
 */
export function gainOf(pos: Chess, m: Move): number {
	const mover = pos.board.get(m.from);
	if (!mover) return 0;

	const occupant = pos.board.get(m.to);
	// Not a capture when it is our own piece: chessops encodes castling as
	// king-takes-own-rook, and counting that as +500 ranked castling above real
	// tactics wherever it was legal.
	const captured = occupant && occupant.color !== mover.color ? occupant : undefined;
	let taken = captured ? V[captured.role] : 0;
	// En passant: the pawn removed is not on the destination square.
	if (!captured && mover.role === 'pawn' && (m.from & 7) !== (m.to & 7)) taken = V.pawn;
	const promo = m.promotion ? V[m.promotion] - V.pawn : 0;

	const after = pos.clone();
	try {
		after.play(m);
	} catch {
		return 0;
	}

	// Mate is worth the king, and the king is worth Infinity (FORMALISM §1.4).
	//
	// Not a special case bolted on: `gainOf` measures the material consequence of
	// a move, and the consequence of mate is that the king comes off. Without
	// this the detector preferred winning a knight to delivering mate — which the
	// puzzle set showed immediately, since it was the single largest class of
	// misses.
	if (after.isCheckmate()) return Infinity;

	const back = see(after.board, m.to, other(mover.color)).value;
	return taken + promo - back;
}

/**
 * The most material the side to move can take with one legal move.
 *
 * This is the number `cover` minimises against, and it is defined over LEGAL
 * moves rather than over the obligation sweep on purpose: a side in check
 * cannot collect, a pinned attacker cannot capture, and both fall out of the
 * move list instead of needing a rule.
 */
export function harvest(pos: Chess): { value: number; move: Move | null } {
	let best: { value: number; move: Move | null } = { value: 0, move: null };
	for (const [from, tos] of pos.allDests()) {
		for (const to of tos) {
			const moves: Move[] =
				pos.board.get(from)?.role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0)
					? [{ from, to, promotion: 'queen' }]
					: [{ from, to }];
			for (const m of moves) {
				const g = gainOf(pos, m);
				if (g > best.value) best = { value: g, move: m };
			}
		}
	}
	return best;
}

// ---------------------------------------------------------------------------
// Candidate moves. DETECTOR §2.
//
// SEE at a target changes only if a move changes the attacker set, the defender
// set, the occupancy of a ray into it, or the piece standing on it. This
// enumerates those, and the enumeration is a claim the differential test in
// test/tactics.test.ts is there to check.
// ---------------------------------------------------------------------------

const SLIDERS: Role[] = ['bishop', 'rook', 'queen'];

export function candidates(pos: Chess, c: Color, E: Obligation[]): Move[] {
	const all: Move[] = [];
	for (const [from, tos] of pos.allDests()) {
		for (const to of tos) {
			if (pos.board.get(from)?.role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0)) {
				all.push({ from, to, promotion: 'queen' });
				all.push({ from, to, promotion: 'knight' });
			} else all.push({ from, to });
		}
	}
	if (!E.length) return all;

	// In check there is nothing to choose between: the move list is already the
	// evasions, and nothing outranks an infinite obligation (§4.4).
	if (pos.isCheck()) return all;

	const T = new Set(E.map((e) => e.square));
	// (W was here, for a stake test that turned out to be unsound — see below.)

	// Everything of the opponent's that bears on a threatened square, and the
	// rays those sliders come down.
	const A = new Set<Square>();
	let R = SquareSet.empty();
	for (const s of T) {
		for (const a of capturersOn(pos.board, s, other(c))) {
			A.add(a);
			const p = pos.board.get(a);
			if (p && SLIDERS.includes(p.role)) R = R.union(between(a, s));
		}
	}

	// Squares that block one of OUR OWN lines into a threatened square: vacating
	// one is a discovered defence.
	let B = SquareSet.empty();
	for (const s of T) {
		for (const from of pos.board[c]) {
			const p = pos.board.get(from);
			if (!p || !SLIDERS.includes(p.role)) continue;
			if (!attacks(p, from, SquareSet.empty()).has(s)) continue;
			const bt = between(from, s);
			if (bt.intersect(pos.board.occupied).size() === 1) B = B.union(bt.intersect(pos.board.occupied));
		}
	}

	const out: Move[] = [];
	for (const m of all) {
		const mover = pos.board.get(m.from);
		if (!mover) continue;

		// Escape: a threatened piece moves.
		if (T.has(m.from)) {
			out.push(m);
			continue;
		}
		// Remove the attacker.
		if (A.has(m.to)) {
			out.push(m);
			continue;
		}
		// Interpose on a slider's ray.
		if (R.has(m.to)) {
			out.push(m);
			continue;
		}
		// Discovered defence: vacate our own blocked line.
		if (B.has(m.from)) {
			out.push(m);
			continue;
		}
		// Add a defender — but only where §1.5 permits it to matter at all.
		let defends = false;
		for (const e of E) {
			if (e.cheapestAttacker < V[e.role]) continue; // §1.5: hopeless
			const landed = { role: m.promotion ?? mover.role, color: c };
			const occ = pos.board.occupied.without(m.from).with(m.to);
			if (attacks(landed, m.to, occ).has(e.square)) {
				defends = true;
				break;
			}
		}
		if (defends) {
			out.push(m);
			continue;
		}

		// Every capture and every promotion, unconditionally.
		//
		// This began as `gainOf(m) > W` — an interruption must be worth more than
		// the stake it forfeits, FORMALISM §4.2 — and the differential test found
		// five positions where it discards the best move. The reading was wrong.
		// Forfeiting is not all-or-nothing: with a rook hanging (W = 500) and a
		// knight available (gain = 320), the counter-capture does not have to beat
		// the rook, it has to beat the best DEFENCE. Three of the five had gain
		// exactly equal to W, which the strict inequality then dropped as well.
		//
		// §4.2 is a statement about when an interruption is correct, not a licence
		// to prune moves before asking. Captures are a short list; enumerate them.
		const occ = pos.board.get(m.to);
		const captures = occ !== undefined && occ.color !== c;
		const enPassant = mover.role === 'pawn' && (m.from & 7) !== (m.to & 7) && !captures;
		if (captures || enPassant || m.promotion) {
			out.push(m);
			continue;
		}

		// A check spends their tempo and can outrank anything (§4.4).
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		if (after.isCheck()) out.push(m);
	}
	return out;
}

// ---------------------------------------------------------------------------
// The covering condition. FORMALISM §3.3, DETECTOR §1.
// ---------------------------------------------------------------------------

export type Verdict = {
	/** What `c` had at risk before moving. */
	obligations: Obligation[];
	/** The move that answers everything, if one exists. */
	cover: Move | null;
	/** The least-bad move, cover or not. */
	best: Move | null;
	/** What `c` concedes with best play. Zero when a cover exists. */
	concession: number;
	/** What they take after `best`, when anything. */
	harvest: Move | null;
};

/**
 * Is there ONE move that answers all of it? FORMALISM §3.3.
 *
 * `c` must be the side to move. A deficiency is exactly `cover === null`.
 */
export function cover(pos: Chess, opts: { all?: boolean } = {}): Verdict {
	const c = pos.turn;
	const E = obligations(pos.board, c, pos.isCheck());
	if (!E.length) {
		return { obligations: [], cover: null, best: null, concession: 0, harvest: null };
	}

	const pool = opts.all ? candidates(pos, c, []) : candidates(pos, c, E);

	let best: Move | null = null;
	let bestCost = Infinity;
	let bestHarvest: Move | null = null;
	let bestClean = false;

	for (const m of pool) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		const h = harvest(after);
		const cost = h.value - gainOf(pos, m);
		if (cost < bestCost) {
			bestCost = cost;
			best = m;
			bestHarvest = h.move;
			bestClean = h.value <= 0;
		}
	}

	return {
		obligations: E,
		cover: bestClean ? best : null,
		best,
		concession: Math.max(0, bestCost === Infinity ? 0 : bestCost),
		harvest: bestClean ? null : bestHarvest,
	};
}

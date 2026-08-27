// The transition graph over relevant moves. DETECTOR §3, FORMALISM §4.
//
// ---------------------------------------------------------------------------
// `cover` answers at depth one: I move, they harvest. That is enough for a
// hanging piece and for a fork, and it is not enough for a sacrifice, an
// attraction, or a mate in two — which is exactly what the puzzle set said
// (DETECTOR §9.4 predicted those three would be the bottom of the table, and
// they were).
//
// This is the same object one ply at a time: material, alternation, and
// rationality, over the relevant-move graph. Three things keep it from being the
// search that sank `race.ts`:
//
//   * the leaf is 0 — no heuristic evaluation, so nothing can be smuggled in;
//   * the move set is derived (captures, promotions, checks, escapes), not
//     hand-picked;
//   * the number is a property of the POSITION, never attributed to a square.
//
// Mate needs no special case here and that is the point. A side with no legal
// move while in check returns -Infinity, so its parent scores +Infinity — which
// is FORMALISM §1.4's v(K) = ∞ arriving on its own rather than being asserted.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Role, Square, Color, NormalMove } from 'chessops/types';
import type { Chess } from 'chessops/chess';
import { V, other } from './exchange';
import { raceValue, anyCandidate } from './race';
import { invasionValue, anyInvasion } from './invade';
import { mateIn1, mateThreatened } from './mate';

type Move = NormalMove;

/**
 * Knobs, so a failure can be ABLATED rather than guessed at.
 *
 * `why.mjs` used to report which feature was present when a move was missed,
 * which turned out to be correlation: switching the pruning off changed nothing,
 * even though 27% of failures had the engine's reply outside the pruned list. A
 * cause is something that, when removed, fixes the answer — so each of these can
 * be turned off one at a time and the failure re-run.
 */
export type Opts = {
	noPrune?: boolean;
	noTT?: boolean;
	noRace?: boolean;
	noThreat?: boolean;
	noMate?: boolean;
	noInvade?: boolean;
	noCoerce?: boolean;
};

const SLIDERS: Role[] = ['bishop', 'rook', 'queen'];

/** Raw material this move takes off, before any reply. */
export function immediate(pos: Chess, m: Move): number {
	const mover = pos.board.get(m.from);
	if (!mover) return 0;
	const occupant = pos.board.get(m.to);
	// Castling is encoded king-to-ROOK-SQUARE, so the destination holds one of
	// OUR pieces. Reading that as a capture scored every castling move at +500,
	// which outranks most real tactics — and castling is legal in a large share
	// of positions. It was sitting at the top of the move list as `e1h1`.
	const cap = occupant && occupant.color !== mover.color ? occupant : undefined;
	let v = cap ? V[cap.role] : 0;
	// En passant: the pawn removed is not on the destination square.
	if (!cap && mover.role === 'pawn' && (m.from & 7) !== (m.to & 7)) v = V.pawn;
	if (m.promotion) v += V[m.promotion] - V.pawn;
	return v;
}

/** Every legal move, with promotions expanded to queen and knight. */
export function allMoves(pos: Chess, dests?: Map<Square, SquareSet>): Move[] {
	const out: Move[] = [];
	for (const [from, tos] of dests ?? pos.allDests()) {
		const promotes = pos.board.get(from)?.role === 'pawn';
		for (const to of tos) {
			if (promotes && (to >> 3 === 7 || to >> 3 === 0)) {
				out.push({ from, to, promotion: 'queen' });
				out.push({ from, to, promotion: 'knight' });
			} else out.push({ from, to });
		}
	}
	return out;
}

/**
 * What a position is worth when nothing is being taken.
 *
 * Zero, except for one thing material cannot express: a passed pawn nobody can
 * catch is already a queen, and the moment it becomes uncatchable is usually
 * several plies before the promotion the search can see. See race.ts — the term
 * is decided by distances in the move graph, not by looking further ahead.
 */
function standing(pos: Chess, opts: Opts): number {
	let v = 0;
	// Cheap gates first: nearly every position leaves both of these immediately.
	if (!opts.noRace && anyCandidate(pos)) v += raceValue(pos);
	// And material that is not being fought over yet, but will be reached first
	// by one side — the same distance argument as the pawn race, generalised past
	// pawns. See invade.ts.
	if (!opts.noInvade && anyInvasion(pos)) v += invasionValue(pos);
	return v;
}

/**
 * Resolve every outstanding capture, with no depth limit.
 *
 * FORMALISM §4.1: inside a forced phase there are no spare tempi, and a phase
 * cannot be left half-played. A fixed ply limit does exactly that — it stops the
 * clock in the middle of an exchange and scores the leftover as nothing, which
 * is why a depth-6 search scored WORSE than a depth-4 one: the deeper search
 * truncated in a different place, not a better one.
 *
 * So the depth limit governs QUIET moves. The forced phase always plays out.
 * It terminates on its own: every capture removes a piece.
 */
export function quiesce(
	pos: Chess,
	alpha: number,
	beta: number,
	budget: Budget,
	pv?: Move[],
	opts: Opts = {},
): number {
	STATS.quiesce++;
	if (--budget.nodes < 0) {
		budget.exhausted = true;
		return 0;
	}

	const dests = pos.allDests();
	let anyLegal = false;
	for (const tos of dests.values()) {
		if (!tos.isEmpty()) {
			anyLegal = true;
			break;
		}
	}
	if (!anyLegal) return pos.isCheck() ? -Infinity : 0;

	// In check there is no standing pat: the obligation is infinite (§1.4).
	const inCheck = pos.isCheck();
	let considered = inCheck ? 0 : 1; // standing pat counts as a considered option
	let best = inCheck ? -Infinity : standing(pos, opts);
	if (best > alpha) alpha = best;
	if (alpha >= beta) return best;

	const moves = inCheck
		? allMoves(pos, dests)
		: allMoves(pos, dests).filter((m) => pos.board.get(m.to) !== undefined || m.promotion);
	moves.sort((a, b) => immediate(pos, b) - immediate(pos, a));

	for (const m of moves) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		considered++;
		// The forced phase belongs in the line as much as the quiet moves do.
		// Without this the PV stopped wherever quiescence took over, and every
		// such failure read as "my search believes nothing happens" — which was a
		// property of the reporting, not of the search.
		const childPv: Move[] | undefined = pv ? [] : undefined;
		// The window must be shifted by what this move itself takes.
		//
		// The score is `imm - childValue`, so `score > alpha` means
		// `childValue < imm - alpha`, and the child's window of interest is
		// (imm - beta, imm - alpha) — NOT (-beta, -alpha). Omitting the shift was
		// the real defect behind the stand-pat bug: with imm = 900 the child was
		// handed beta = 0 instead of 900, its stand-pat met that immediately, and
		// it returned before ever looking at the recapture. Removing the cutoff
		// hid the symptom at the cost of ten times the nodes; shifting the window
		// fixes the cause, and the cutoff can come back.
		const im = immediate(pos, m);
		const score = im - quiesce(after, im - beta, im - alpha, budget, childPv, opts);
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
	return considered === 0 ? 0 : best;
}

/**
 * Moves that OBLIGE a reply — the only ones that can be part of a forced chain.
 *
 * Will's point, and it is the structural one: a puzzle's line is forced from end
 * to end. The attacker's moves compel because the alternative for the defender is
 * worse; if a move does not compel, the defender gets a free move and the chain
 * dies. So the attacker never needs to consider a non-obliging move, and the tree
 * collapses from "every legal move" to a handful.
 *
 * Obliging means: it gives check (an infinite obligation, §4.4), it takes
 * material (which must be answered or conceded), it promotes, or it creates a
 * threat — the moved piece now attacks something worth more than itself, or
 * something undefended. The threat test is deliberately cheap set arithmetic;
 * an exact one would cost a `see` per move and buy nothing, since this is a
 * superset filter and the search prices what survives.
 */
export function obliging(pos: Chess, dests?: Map<Square, SquareSet>, sc?: Scan): Move[] {
	const c = pos.turn;
	const them = other(c);
	if (pos.isCheck()) return allMoves(pos, dests);
	const scan = sc ?? scanBoard(pos);

	const out: Move[] = [];
	for (const m of allMoves(pos, dests)) {
		const mover = pos.board.get(m.from);
		if (!mover) continue;

		const occupant = pos.board.get(m.to);
		if ((occupant !== undefined && occupant.color !== c) || m.promotion) {
			out.push(m);
			continue;
		}
		if (mover.role === 'pawn' && (m.from & 7) !== (m.to & 7)) {
			out.push(m); // en passant
			continue;
		}

		const role = (m.promotion ?? mover.role) as Role;
		const occ = pos.board.occupied.without(m.from).with(m.to);
		const hits = attacks({ role, color: c }, m.to, occ);

		// Check.
		const king = pos.board.kingOf(them);
		if (king !== undefined && hits.has(king)) {
			out.push(m);
			continue;
		}

		// A new threat: something dearer than the mover, or something loose.
		let threatens = false;
		for (const s of hits.intersect(pos.board[them])) {
			const victim = pos.board.get(s);
			if (!victim || victim.role === 'king') continue;
			if (V[victim.role] > V[role] || !scan.hits[them].has(s)) {
				threatens = true;
				break;
			}
		}
		if (threatens) out.push(m);
	}
	return out;
}

/**
 * The moves worth expanding at any node: obliging ones, plus every answer to
 * whatever is threatened against the mover right now.
 *
 * An earlier version keyed the asymmetry on WHO MOVED AT THE ROOT, and that is
 * wrong the moment the root mover has to defend deeper in the line — their quiet
 * saving move was pruned away, and the search scored a mate against them as
 * nothing. The asymmetry belongs to the ROLE, and the role is decided by whether
 * anything is threatened against you, not by who started.
 *
 * Attacking moves are pruned to the ones that compel (safe: we can only miss a
 * win). Defensive moves are complete (pruning there invents wins).
 */

// ---------------------------------------------------------------------------
// One attack scan per node.
//
// `relevant` cost 100 microseconds a call — thirteen times `allDests` — because
// it asked "is this attacked, by what, and is it defended" with a loop over every
// enemy piece INSIDE a loop over every one of ours, and `obliging` did the same
// again for every quiet move. That is O(pieces^2) `attacks()` calls per node to
// answer three questions that one pass can answer for the whole board.
//
// One sweep: 32 `attacks()` calls, unioned into a set per colour, with the
// cheapest attacker of each square recorded on the way through. Everything the
// pruning needs is then a bit test.
// ---------------------------------------------------------------------------
export type Scan = {
	hits: Record<Color, SquareSet>;
	/** Cheapest attacker of each square, by colour. Infinity when unattacked. */
	cheapest: Float64Array;
};

export function scanBoard(pos: Chess): Scan {
	let white = SquareSet.empty();
	let black = SquareSet.empty();
	const cheapest = new Float64Array(128).fill(Infinity);
	for (const from of pos.board.occupied) {
		const p = pos.board.get(from);
		if (!p) continue;
		const a = attacks(p, from, pos.board.occupied);
		const base = p.color === 'white' ? 0 : 64;
		const v = V[p.role];
		for (const sq of a) if (v < cheapest[base + sq]) cheapest[base + sq] = v;
		if (p.color === 'white') white = white.union(a);
		else black = black.union(a);
	}
	return { hits: { white, black }, cheapest };
}

const CHEAP = (sc: Scan, c: Color, sq: Square): number => sc.cheapest[(c === 'white' ? 0 : 64) + sq];

/**
 * The most valuable thing the side to move has at risk, or 0.
 *
 * FORMALISM §1.5's cheap test, and no `see` call: attacked by something cheaper
 * is losing whatever defends it, and attacked with nothing defending is loose.
 */
export function atRisk(pos: Chess): number {
	const c = pos.turn;
	const them = other(c);
	let worst = 0;
	for (const s of pos.board[c]) {
		const piece = pos.board.get(s);
		if (!piece || piece.role === 'king') continue;
		let cheapest = Infinity;
		let attacked = false;
		for (const from of pos.board[them]) {
			const p = pos.board.get(from);
			if (!p || !attacks(p, from, pos.board.occupied).has(s)) continue;
			attacked = true;
			if (V[p.role] < cheapest) cheapest = V[p.role];
		}
		if (!attacked) continue;
		if (cheapest < V[piece.role]) {
			if (V[piece.role] > worst) worst = V[piece.role];
			continue;
		}
		let defended = false;
		for (const from of pos.board[c]) {
			if (from === s) continue;
			const p = pos.board.get(from);
			if (p && attacks(p, from, pos.board.occupied).has(s)) {
				defended = true;
				break;
			}
		}
		if (!defended && V[piece.role] > worst) worst = V[piece.role];
	}
	return worst;
}

export function relevant(pos: Chess, dests?: Map<Square, SquareSet>, sc?: Scan): Move[] {
	const d = dests ?? pos.allDests();
	if (pos.isCheck()) return allMoves(pos, d);

	const c = pos.turn;
	const them = other(c);
	const scan = sc ?? scanBoard(pos);

	// What is at risk, by FORMALISM §1.5's cheap test — now three bit tests.
	let risky = SquareSet.empty();
	for (const sq of pos.board[c].intersect(scan.hits[them])) {
		const piece = pos.board.get(sq);
		if (!piece || piece.role === 'king') continue;
		if (CHEAP(scan, them, sq) < V[piece.role] || !scan.hits[c].has(sq)) risky = risky.with(sq);
	}

	if (risky.isEmpty()) return obliging(pos, d, scan);

	// Only now, and only for the handful of risky squares, work out WHICH pieces
	// attack them and down which rays.
	let attackers = SquareSet.empty();
	let rays = SquareSet.empty();
	for (const sq of risky) {
		for (const from of pos.board[them]) {
			const p = pos.board.get(from);
			if (!p || !attacks(p, from, pos.board.occupied).has(sq)) continue;
			attackers = attackers.with(from);
			if (SLIDERS.includes(p.role)) rays = rays.union(between(from, sq));
		}
	}

	const seen = new Set<number>();
	const out: Move[] = [];
	const push = (m: Move) => {
		const k = m.from * 4096 + m.to * 8 + (m.promotion ? 1 : 0);
		if (seen.has(k)) return;
		seen.add(k);
		out.push(m);
	};

	for (const m of obliging(pos, d, scan)) push(m);

	for (const m of allMoves(pos, d)) {
		if (risky.has(m.from) || attackers.has(m.to) || rays.has(m.to)) {
			push(m);
			continue;
		}
		const mover = pos.board.get(m.from);
		if (!mover) continue;
		const role = (m.promotion ?? mover.role) as Role;
		const occ = pos.board.occupied.without(m.from).with(m.to);
		if (!attacks({ role, color: c }, m.to, occ).intersect(risky).isEmpty()) push(m); // defend
	}
	return out;
}

export type Budget = { nodes: number; exhausted?: boolean; tt?: Map<string, TTEntry> };

/** Counters, for finding out where the time goes rather than guessing. */
export const STATS = { net: 0, quiesce: 0, ttHit: 0, ttMiss: 0 };

type TTEntry = { depth: number; value: number; flag: 'exact' | 'lower' | 'upper'; move?: Move };

// ---------------------------------------------------------------------------
// A Zobrist key, so the same position reached two ways is searched once.
// Tactical trees transpose constantly — the same recapture sequence in a
// different order — so this is the difference between depth 4 and depth 8 being
// affordable. Two 32-bit accumulators, because one collides at these tree sizes.
// ---------------------------------------------------------------------------
const ZOB = (() => {
	let s = 0x2545f491;
	const rnd = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		s >>>= 0;
		return s;
	};
	const a: number[][] = [];
	const b: number[][] = [];
	for (let i = 0; i < 12; i++) {
		const ra: number[] = [];
		const rb: number[] = [];
		for (let j = 0; j < 64; j++) {
			ra.push(rnd());
			rb.push(rnd());
		}
		a.push(ra);
		b.push(rb);
	}
	return { a, b, turnA: rnd(), turnB: rnd() };
})();

const ROLE_INDEX: Record<Role, number> = {
	pawn: 0,
	knight: 1,
	bishop: 2,
	rook: 3,
	queen: 4,
	king: 5,
};

function keyOf(pos: Chess): string {
	let a = 0;
	let b = 0;
	for (const sq of pos.board.occupied) {
		const p = pos.board.get(sq);
		if (!p) continue;
		const i = ROLE_INDEX[p.role] + (p.color === 'white' ? 0 : 6);
		a = (a ^ ZOB.a[i][sq]) >>> 0;
		b = (b ^ ZOB.b[i][sq]) >>> 0;
	}
	if (pos.turn === 'black') {
		a = (a ^ ZOB.turnA) >>> 0;
		b = (b ^ ZOB.turnB) >>> 0;
	}
	return `${a},${b}`;
}

/**
 * Material the side to move nets from here, with best play, over `depth` plies.
 *
 * Negamax with alpha–beta. The stand-pat branch is a null move rather than a
 * static zero: "I do nothing" has to mean "and then they carry on", or a hanging
 * rook costs nothing. Two nulls in a row are forbidden, which is what makes the
 * quiet line terminate at zero instead of shuffling away the depth.
 */
export function net(
	pos: Chess,
	depth: number,
	alpha = -Infinity,
	beta = Infinity,
	budget: Budget = { nodes: 120_000 },
	/** The side trying to win — the only one whose moves may be pruned. */
	attacker: Color = pos.turn,
	/** Plies of check extension still available. Bounded, so this terminates. */
	extensions = 8,
	/**
	 * Threat extensions still available on this path.
	 *
	 * Separate from, and far smaller than, the check budget. Sharing the two was
	 * unusable: every leaf with something hanging re-searched a ply, its children
	 * did the same, and a depth-4 search cost ninety times the nodes — 4.5 seconds
	 * for a position that took 53ms. One extension per root-to-leaf path buys the
	 * cases that matter (a quiet move whose point resolves just past the horizon)
	 * without the chain reaction.
	 */
	threats = 1,
	/**
	 * Filled with the line the search believes in, when supplied.
	 *
	 * A number cannot be debugged. "This move scores 500" says nothing about why,
	 * and laying the model's line beside the engine's shows the exact ply where
	 * the two beliefs part company — which is the only way to find what the
	 * evaluation is failing to account for.
	 */
	pv?: Move[],
	opts: Opts = {},
): number {
	// Exhaustion is recorded, not swallowed. Returning 0 quietly made a deeper
	// search score WORSE than a shallow one — the budget ran out partway through
	// the root move list and the remaining moves were scored as nothing. A
	// resource limit that silently changes the answer is worse than no limit.
	if (--budget.nodes < 0) {
		budget.exhausted = true;
		return 0;
	}

	const tt = budget.tt;
	const key = tt ? `${keyOf(pos)}|${extensions}` : '';
	// The entry carries its best move, so a cutoff can still say something about
	// the line. Disabling the table entirely whenever a line was wanted — which
	// the earlier fix did — switched it off for the whole of the root's second
	// pass, where nearly all the work happens.
	STATS.net++;
	const hit = tt && !opts.noTT ? tt.get(key) : undefined;
	if (hit && hit.depth >= depth) {
		const usable =
			hit.flag === 'exact' ||
			(hit.flag === 'lower' && hit.value >= beta) ||
			(hit.flag === 'upper' && hit.value <= alpha);
		if (usable) {
			STATS.ttHit++;
			if (pv) {
				pv.length = 0;
				if (hit.move) pv.push(hit.move);
			}
			return hit.value;
		}
	}
	const alpha0 = alpha;

	// One `allDests` per node. Calling it twice — once for the move list and once
	// to ask whether any move exists — was most of the search's cost.
	const dests = pos.allDests();
	let anyLegal = false;
	for (const tos of dests.values()) {
		if (!tos.isEmpty()) {
			anyLegal = true;
			break;
		}
	}
	if (!anyLegal) return pos.isCheck() ? -Infinity : 0;

	// Out of quiet moves, but never out of forced ones.
	//
	// And a THREAT is a forced phase too. `quiesce` resolves captures, so a loss
	// that is one quiet move away evaluates to nothing — which makes delaying a
	// loss look better than taking it, since the delayed loss falls past the
	// horizon. That is the whole content of the seven real misses the per-move
	// analysis turned up: every one was a losing defensive position where the
	// model preferred -400 (postpone) to -570 (concede now), and the engine had
	// the postponing move at -834.
	//
	// So the leaf extends by a ply whenever the mover has material at risk, on
	// exactly the same footing as the check extension: an outstanding obligation
	// is a forced phase (§4.1), and the depth budget governs quiet moves.
	//
	// That paragraph described an extension that was NOT IN THE CODE. `atRisk`
	// sat exported and uncalled while the comment above it claimed the leaf used
	// it, which is worse than not having the idea at all — two of Will's three
	// reported misses (tO9fD, xfcMB) are exactly the case it describes, a quiet
	// move whose point is an obligation that resolves one ply past the horizon.
	// Wired up here, and bounded by the same extension budget as the check
	// extension so the recursion still terminates.
	if (depth <= 0) {
		// A piece, not a pawn: extending on every loose pawn fires in most
		// positions and buys nothing, since quiescence already prices a pawn
		// trade. The threshold is what makes this affordable.
		// Two obligations at distance one, and both must be spent a ply on rather
		// than evaluated past: a piece of mine hanging, and a mate I have one move
		// to prevent. The second is Will's point on PsyHA — the threat of mate is
		// an obligation that requires a resolution, and pricing the position
		// without asking whether one exists is what made a quiet move that
		// threatens mate score as a quiet move.
		// A mate on the board is not a quiet position. Quiescence resolves captures
		// and prices what is left at zero, so a position where the mover can simply
		// mate was scored as "nothing happens" — the same error as scoring a mated
		// side at zero, one ply earlier.
		//
		// Asked HERE and not inside quiescence, which was the first attempt: the
		// scan then ran at every one of four million quiescence nodes and added 72%
		// to the whole search while changing the answer on two plies out of 278.
		// This leaf is where the horizon actually is, and it is a few thousand
		// nodes rather than a few million.
		if (!opts.noMate && mateIn1(pos)) return Infinity;
		if (threats > 0) {
			const obliged =
				(!opts.noThreat && atRisk(pos) >= V.knight) || (!opts.noMate && mateThreatened(pos));
			if (obliged) return net(pos, 1, alpha, beta, budget, attacker, extensions, threats - 1, pv, opts);
		}
		return quiesce(pos, alpha, beta, budget, pv, opts);
	}

	// ------------------------------------------------------------------
	// Asymmetric expansion, and the asymmetry is the whole point.
	//
	// Pruning the ATTACKER can only lose a win we might have found — an error in
	// the safe direction. Pruning the DEFENDER invents wins that are not there,
	// because the move that saves them is often a block or a quiet defence and
	// never appears in a captures-and-checks list. The previous version pruned
	// both sides, which is why deeper search kept getting worse.
	// ------------------------------------------------------------------
	// Measured, not assumed. Three expansions were tried against the puzzle set:
	//
	//   both sides pruned          72%   invents wins — the defender's saving
	//                                    block or quiet defence is never generated
	//   both sides pruned to the
	//     covering set (relevant)  78%   same fault, smaller
	//   attacker pruned, defender
	//     complete                 84%   <- this
	//
	// Which is the asymmetry stated plainly: pruning the attacker can only lose a
	// win we might have found; pruning the defender manufactures one.
	const attacking = pos.turn === attacker;
	const moves =
		opts.noPrune || !attacking ? allMoves(pos, dests) : relevant(pos, dests, scanBoard(pos));
	// Most valuable victim first, and the table's own move ahead of everything:
	// it was best here before, so it is the likeliest to cut now.
	const hintKey = hit?.move ? `${hit.move.from}-${hit.move.to}-${hit.move.promotion ?? ''}` : null;
	moves.sort((a, b) => {
		if (hintKey) {
			const ka = `${a.from}-${a.to}-${a.promotion ?? ''}` === hintKey ? 1 : 0;
			const kb = `${b.from}-${b.to}-${b.promotion ?? ''}` === hintKey ? 1 : 0;
			if (ka !== kb) return kb - ka;
		}
		return immediate(pos, b) - immediate(pos, a);
	});

	let best = -Infinity;
	let considered = 0;
	let bestMove: Move | undefined;

	if (attacking && !pos.isCheck()) {
		// Stopping is always an option: bank what the forced phase already won.
		// This replaces the null move, and it is better founded — "I stop forcing"
		// is exactly "the forced phase resolves here" (§4.1).
		considered++;
		best = quiesce(pos, alpha, beta, budget, pv, opts);
		if (best > alpha) alpha = best;
		if (alpha >= beta) return best;
	}

	for (const m of moves) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			continue;
		}
		considered++;
		const childPv: Move[] | undefined = pv ? [] : undefined;
		// Check extension, and it is not a chess-engine trick borrowed for speed:
		// FORMALISM §4.4 makes a check an obligation of infinite cost, and §4.1
		// says a forced phase plays out rather than being cut off. Answering a
		// check is therefore part of the forced phase, and charging it against a
		// budget that governs QUIET moves truncates exactly the lines that matter.
		// Bounded so the recursion still terminates.
		const forced = after.isCheck() && extensions > 0;
		const im = immediate(pos, m);
		const score =
			im -
			net(
				after,
				forced ? depth : depth - 1,
				im - beta,
				im - alpha,
				budget,
				attacker,
				forced ? extensions - 1 : extensions,
				threats,
				childPv,
				opts,
			);
		if (score > best) {
			best = score;
			bestMove = m;
			if (pv) {
				pv.length = 0;
				pv.push(m, ...(childPv ?? []));
			}
		}
		if (best > alpha) alpha = best;
		if (alpha >= beta) break;
	}

	// `considered === 0` means nothing was even looked at — not that everything
	// lost. Collapsing the two was the bug that made deeper search worse: a node
	// where EVERY move loses is a mate one ply further out, and rewriting its
	// -Infinity as 0 deleted the mate. At depth 2 mate was a leaf and survived;
	// from depth 4 it was always thrown away.
	const value = considered === 0 ? 0 : best;
	if (tt && Number.isFinite(value)) {
		tt.set(key, {
			depth,
			value,
			flag: value <= alpha0 ? 'upper' : value >= beta ? 'lower' : 'exact',
			...(bestMove ? { move: bestMove } : {}),
		});
	}
	return value;
}

/**
 * The depth a root move's child should be searched at.
 *
 * A check is a forced phase (§4.4), and the search treats it as one everywhere
 * except at the root, where the move being scored was charged a ply for it. The
 * effect is worst on precisely the moves this app exists to find: a forcing move
 * whose point is three plies further on.
 */
function forcedFrom(_pos: Chess, after: Chess, depth: number): number {
	return after.isCheck() ? depth : depth - 1;
}

export type Scored = { move: Move; score: number; line?: Move[] };

/**
 * Every legal move, scored by what it nets over `depth` plies.
 *
 * The root uses the FULL legal move list rather than the tactical subset: a
 * defensive or quiet move can be the answer, and pruning the root would decide
 * the question before asking it.
 */
/**
 * Score every legal move at the root.
 *
 * Two passes, because the answer wanted is the argmax SET and not one move
 * (DETECTOR §9.3). Pass one shares alpha across root moves, so most are cut off
 * cheaply and return an upper bound; a move whose bound is below the best score
 * is definitively worse and needs no more work. Pass two re-searches only the
 * survivors with a full window, which is what makes ties exact.
 */
export function scoreMoves(
	pos: Chess,
	depth: number,
	perMove = 400_000,
	/**
	 * Which side may be pruned to obliging moves. Defaults to the mover, which is
	 * right when they are trying to WIN — and wrong when they are trying not to
	 * lose, since a defender's best resource is often a quiet move that compels
	 * nothing.
	 */
	attacker?: Color,
	opts: Opts = {},
): { scored: Scored[]; exhausted: number } {
	const side = attacker ?? pos.turn;
	const roots = allMoves(pos);
	const tt = opts.noTT ? undefined : new Map<string, TTEntry>();
	let exhausted = 0;

	// Captures first: the sooner alpha rises, the more the rest are pruned.
	roots.sort((a, b) => immediate(pos, b) - immediate(pos, a));

	const bound: number[] = [];
	let alpha = -Infinity;
	for (const m of roots) {
		const after = pos.clone();
		try {
			after.play(m);
		} catch {
			bound.push(-Infinity);
			continue;
		}
		const b: Budget = { nodes: perMove, tt };
		// The root gets the same check extension as every other node.
		//
		// It did not, and that is an inconsistency rather than a decision: a check
		// played at ply 3 of a line costs no depth, and the identical check played
		// as the move being scored cost a whole ply. zhAbL turns on exactly this —
		// ...Qe1+ forces a single legal reply, and the root was paying for it.
		const v = immediate(pos, m) - net(after, forcedFrom(pos, after, depth), -Infinity, -alpha, b, side, 8, 1, undefined, opts);
		if (b.exhausted) exhausted++;
		bound.push(v);
		if (v > alpha) alpha = v;
	}

	// ------------------------------------------------------------------
	// Pass two, in descending order of the pass-one bound.
	//
	// A narrow-window search returns a BOUND, not a score. Pass one calls each
	// child with beta = -alpha, so what comes back is an UPPER bound on that
	// move's true value. The first version compared each bound against pass one's
	// best BOUND and pushed the bound itself as the score for anything it skipped
	// — and then the moves it did re-search came back lower, so a stale bound
	// floated to the top. That is how a move scoring +1110 turned out to be mate
	// against us: its true value was -Infinity and it was never searched.
	//
	// The comparison has to be against the running EXACT maximum. An upper bound
	// below a score we have already proved cannot be the best move, so it can be
	// skipped safely; anything at or above it must be searched properly.
	// ------------------------------------------------------------------
	const order = roots.map((_, i) => i).sort((a, b) => bound[b] - bound[a]);
	const scoreOf: number[] = new Array(roots.length).fill(-Infinity);
	const lines: Move[][] = new Array(roots.length);
	let bestExact = -Infinity;

	for (const i of order) {
		if (bound[i] < bestExact) {
			// Provably not the best: an upper bound under a proven score.
			scoreOf[i] = bound[i];
			lines[i] = [roots[i]];
			continue;
		}
		const after = pos.clone();
		try {
			after.play(roots[i]);
		} catch {
			continue;
		}
		const b: Budget = { nodes: perMove, tt };
		const line: Move[] = [];
		const v =
			immediate(pos, roots[i]) -
			net(after, forcedFrom(pos, after, depth), -Infinity, Infinity, b, side, 8, 1, line, opts);
		if (b.exhausted) exhausted++;
		scoreOf[i] = v;
		lines[i] = [roots[i], ...line];
		if (v > bestExact) bestExact = v;
	}

	const out: Scored[] = roots.map((m, i) => ({
		move: m,
		score: scoreOf[i],
		line: lines[i] ?? [m],
	}));

	// ------------------------------------------------------------------
	// Ties, broken by COERCION rather than left as a shrug.
	//
	// On zhAbL the material search returns a seven-way tie at zero containing
	// moves Stockfish scores at +307, -4 and -99. Material genuinely cannot tell
	// them apart — but the formalism can say something the material cannot: how
	// much choice the move leaves the opponent. ...b3 forks queen and knight and
	// leaves exactly one reply that does not lose material; ...Qa4 leaves thirty.
	//
	// This is a strict tie-break. It never reorders moves that differ in
	// material, so it cannot overturn a verdict — it can only decide between
	// moves the evaluation has already declared equal, which is the one place a
	// non-material criterion belongs.
	// ------------------------------------------------------------------
	if (!opts.noCoerce && out.length > 1) {
		const top = Math.max(...out.map((o) => o.score));
		const tied = out.filter((o) => o.score === top);
		if (tied.length > 1 && tied.length <= 12) {
			const coercion = new Map<Scored, number>();
			for (const t of tied) coercion.set(t, repliesThatHold(pos, t.move));
			out.sort((x, y) => {
				if (y.score !== x.score) return y.score - x.score;
				const cx = coercion.get(x);
				const cy = coercion.get(y);
				if (cx === undefined || cy === undefined) return 0;
				return cx - cy;
			});
			return { scored: out, exhausted };
		}
	}

	return { scored: out.sort((x, y) => y.score - x.score), exhausted };
}

/**
 * How many replies leave the opponent no worse off — the size of their choice.
 *
 * A move that leaves one reply is coercing; a move that leaves thirty is a
 * suggestion. "No worse off" is measured with quiescence at the reply, which is
 * the cheapest honest reading of "does not simply lose material": a reply that
 * hangs something is not a reply the opponent has.
 */
function repliesThatHold(pos: Chess, m: Move): number {
	const after = pos.clone();
	try {
		after.play(m);
	} catch {
		return 99;
	}
	const budget: Budget = { nodes: 6_000 };
	let best = -Infinity;
	const values: number[] = [];
	for (const r of allMoves(after)) {
		const next = after.clone();
		try {
			next.play(r);
		} catch {
			continue;
		}
		const im = immediate(after, r);
		const v = im - quiesce(next, -Infinity, Infinity, budget, undefined, {});
		values.push(v);
		if (v > best) best = v;
	}
	if (!values.length) return 0;
	// Replies within a pawn of their best are the ones they really have.
	return values.filter((v) => v >= best - 100).length;
}

/** The moves attaining the best score — the argmin SET, per DETECTOR §9.3. */
export function bestMoves(pos: Chess, depth: number, perMove?: number): Scored[] {
	const { scored } = scoreMoves(pos, depth, perMove);
	if (!scored.length) return [];
	const top = scored[0].score;
	return scored.filter((s) => s.score === top);
}

/** Same, but says whether any branch hit its ceiling. */
export function bestMovesChecked(
	pos: Chess,
	depth: number,
	perMove?: number,
): { moves: Scored[]; exhausted: number } {
	const { scored, exhausted } = scoreMoves(pos, depth, perMove);
	const top = scored.length ? scored[0].score : 0;
	return { moves: scored.filter((s) => s.score === top), exhausted };
}

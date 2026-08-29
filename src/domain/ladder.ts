// The ladder's goals, as problems the proof engine can work on.
//
// ---------------------------------------------------------------------------
// `pns.ts` knows no chess. This is where chess enters: what a goal is, when it
// is reached, and — the part that makes it affordable — which moves can possibly
// serve it.
//
// The measured claim behind the generator, from CASES-KING-RUNG-VALIDATED.md:
// restricting our moves to those bearing on the king's zone reproduces the
// specification EXACTLY on 60/60 mateIn2 positions while considering 31% of
// them, and the answer survives the filter in 334/334 across depths 1-3.
// ---------------------------------------------------------------------------

import { attacks, kingAttacks } from 'chessops/attacks';
import { makeFen } from 'chessops/fen';
import type { Chess } from 'chessops/chess';
// NORMAL MOVES ONLY. chessops' `Move` is `NormalMove | DropMove`, and a drop
// is a crazyhouse move with no `from` square. Nothing here can be a drop, and
// naming that in the type means `move.from` is not a runtime hope.
import type { Color, NormalMove, Role, Square } from 'chessops/types';
import { SquareSet } from 'chessops/squareSet';
import { solve, type Problem } from './pns';

const PROMOTIONS: Role[] = ['queen', 'rook', 'bishop', 'knight'];

/** Every legal move, promotions written out. The unrestricted generator. */
export function allMoves(pos: Chess): NormalMove[] {
	const out: NormalMove[] = [];
	for (const [from, dests] of pos.allDests()) {
		const piece = pos.board.get(from);
		if (!piece) continue;
		const last = piece.color === 'white' ? 7 : 0;
		for (const to of dests) {
			if (piece.role === 'pawn' && to >> 3 === last) for (const promotion of PROMOTIONS) out.push({ from, to, promotion });
			else out.push({ from, to });
		}
	}
	return out;
}

/**
 * The king's zone: his square and everything adjacent to it.
 *
 * The mating configuration has to attack the king and cover his flights, so
 * every man that participates bears on one of these squares. A move that
 * touches none of them cannot be part of a mate delivered on THIS ply.
 */
export function zoneOf(king: Square): SquareSet {
	return kingAttacks(king).with(king);
}

/**
 * Does this move put its man where it bears on the zone — or into the zone?
 *
 * THE PIECE THAT ARRIVES, NOT THE ONE THAT LEFT. A promotion is a different man,
 * and asking about the pawn gives the wrong answer: `rRPBO`'s mate is g7g8=N, a
 * knight on g8, and a pawn on g8 bears on nothing that matters. Promotion has
 * now broken three separate things in this theory (see
 * CASES-KING-RUNG-VALIDATED.md section 4) and this is the fourth place it would
 * have.
 */
export function bearsOnZone(pos: Chess, move: NormalMove, zone: SquareSet): boolean {
	if (zone.has(move.to)) return true;
	const was = pos.board.get(move.from);
	if (!was) return false;
	const arriving = move.promotion ? { color: was.color, role: move.promotion } : was;
	const occupied = pos.board.occupied.without(move.from).with(move.to);
	return attacks(arriving, move.to, occupied).intersects(zone);
}

/**
 * The moves worth trying for a mate against `defender`.
 *
 * ONLY EVER APPLIED AT AN OR NODE, and that restriction is not an optimisation
 * detail — it is soundness. At an OR node we need ONE move to work, so narrowing
 * the candidates can only lose a proof we would have found, and the measurement
 * says it does not. At an AND node the DEFENDER picks, and every reply must be
 * refuted; filtering their moves would let us prove mates against a defender who
 * politely declines to play the saving move. The generator below is never called
 * for them.
 */
export function relevantMoves(pos: Chess, defender: Color): NormalMove[] {
	const king = pos.board.kingOf(defender);
	const every = allMoves(pos);
	if (king === undefined) return every;
	const zone = zoneOf(king);
	return every.filter((m) => bearsOnZone(pos, m, zone));
}

const after = (pos: Chess, move: NormalMove): Chess => {
	const next = pos.clone();
	next.play(move);
	return next;
};

/** Board, turn, castling and en passant — the four fields that make a position. */
const positionKey = (pos: Chess): string => makeFen(pos.toSetup()).split(' ').slice(0, 4).join(' ');

export type MateOpts = {
	/** Restrict our moves to the king's zone. Off reproduces the M1 baseline. */
	narrow?: boolean;
	/** Seed leaf numbers from mobility rather than (1, 1). */
	seed?: boolean;
};

/**
 * "Can `attacker` force mate within the depth?" as a `Problem`.
 *
 * Every verdict is expressed from the point of view of whoever is to move at the
 * node, which is what lets the engine stay side-agnostic — and is the trap that
 * made three of its unit tests wrong. Depth exhaustion is the asymmetric one: it
 * is a failure for the attacker and a success for the defender.
 */
export function mateGoal(attacker: Color, opts: MateOpts = {}): Problem<Chess> {
	const defender: Color = attacker === 'white' ? 'black' : 'white';
	return {
		key: positionKey,
		children: (pos) => {
			// The narrowing is ours alone. See `relevantMoves`.
			const moves = opts.narrow && pos.turn === attacker ? relevantMoves(pos, defender) : allMoves(pos);
			return moves.map((m) => after(pos, m));
		},
		terminal: (pos, depthLeft) => {
			// Checkmate first, so a mate delivered exactly as the depth runs out counts.
			if (pos.isCheckmate()) return 'moverLoses';
			if (pos.isStalemate() || pos.isInsufficientMaterial())
				return pos.turn === attacker ? 'moverLoses' : 'moverWins';
			if (depthLeft <= 0) return pos.turn === attacker ? 'moverLoses' : 'moverWins';
			return null;
		},
		init: opts.seed
			? (pos) => {
					// MOBILITY, AS INITIALISATION — never as a cut.
					//
					// A mover needs ONE of their moves to work and an opponent must answer
					// ALL of them, so `phi = 1, delta = moves` is the honest first guess at
					// an unexpanded leaf. It is mover-relative like everything else here,
					// so one expression serves both node types.
					//
					// Wrong seeds cost time and cannot change the answer: every number is
					// recomputed from children the moment a node is expanded. That is the
					// whole difference between seeding and pruning, and it is the line this
					// project has crossed by accident three times.
					let n = 0;
					for (const dests of pos.allDests().values()) n += dests.size();
					return [1, Math.max(1, n)];
				}
			: undefined,
	};
}

// ---------------------------------------------------------------------------
// MATERIAL RUNGS
//
// Mate has a one-call terminal test. "Wins a rook in three" does not, and that
// is the whole difficulty of this milestone: what counts as WON has to be
// defined, and defined in a way that cannot be gamed by a line that stops
// mid-exchange with a piece hanging.
// ---------------------------------------------------------------------------

import { V, other, seeValue } from './exchange';
import type { Board } from 'chessops/board';

/**
 * Material from one side's point of view, kings excluded.
 *
 * Written here rather than imported from `complex.ts`, which is scheduled for
 * the attic. Five lines is cheaper than a dependency on a module we are
 * replacing.
 */
export function materialFor(board: Board, side: Color): number {
	let n = 0;
	for (const square of board.occupied) {
		const piece = board.get(square);
		if (!piece || piece.role === 'king') continue;
		n += piece.color === side ? V[piece.role] : -V[piece.role];
	}
	return n;
}

/**
 * What the position is worth once the exchange in progress settles.
 *
 * A raw material count at the horizon is not an evaluation, it is a snapshot of
 * a trade halfway through: a line that ends with our queen taken but our
 * recapture unplayed reads as a disaster, and one that ends with a piece
 * hanging reads as a triumph. So the side to move is credited with the best
 * exchange available to them, which is a single ply of quiescence.
 *
 * SEE IS EXACT FOR THAT, and that is not a hopeful assumption: the opt-out
 * bound (offbook/AMEND-RUNG-ORDER.md) says the gain at a square never exceeds
 * the value of the man standing there, because nobody recaptures into a loss.
 * What this does NOT capture is interaction BETWEEN squares — two hanging men,
 * only one of which can be saved. That is a real limit of the horizon and it is
 * why the search has a depth rather than relying on this.
 */
/**
 * Every capture, until neither side wants another — the leaf evaluation that
 * `settled` approximates with one exchange.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ONE-EXCHANGE VERSION IS NOT ENOUGH, MEASURED.
 *
 * `settled`'s own comment names the limit exactly: "what this does NOT capture is
 * interaction BETWEEN squares — two hanging men, only one of which can be saved."
 * It credits the side to move with their single best exchange and stops, so the
 * opponent's answer to that exchange is over the horizon.
 *
 * `scripts/guarantee-depth.mjs` puts a number on it. Comparing the ladder's
 * claim against the same question asked two plies deeper — same leaf evaluation,
 * same parity, so the only variable is depth — 18.3% of forced material claims
 * came in lower, median 100cp. One pawn, handed straight back. That is the
 * horizon effect, and quiescence is its standard and non-negotiable answer: a
 * search whose leaves are unstable measures the horizon rather than the position.
 *
 * ---------------------------------------------------------------------------
 * STAND-PAT IS WHY THIS IS NOT A HEURISTIC.
 *
 * At every node the side to move may DECLINE to capture and take the position as
 * it stands. That is not an approximation, it is the rule of chess — nobody is
 * obliged to capture — so the value returned is a real lower bound for the
 * maximiser and a real upper bound for the minimiser. Without stand-pat the
 * search would force both sides into losing captures and invent losses that
 * neither player would accept.
 *
 * Termination needs no cap and gets none: every move considered removes a man
 * from the board or promotes a pawn, so the recursion is bounded by the material
 * on it. A depth limit here would be a guess, and this project has spent three
 * corrections on guesses that looked like limits.
 * ---------------------------------------------------------------------------
 */
export function quiesce(pos: Chess, attacker: Color, alpha = -Infinity, beta = Infinity): number {
	const maximising = pos.turn === attacker;
	// The score if nothing further is taken. Also the bound that lets a side
	// refuse a capture that loses material.
	const stand = materialFor(pos.board, attacker);
	if (maximising) {
		if (stand >= beta) return stand;
		if (stand > alpha) alpha = stand;
	} else {
		if (stand <= alpha) return stand;
		if (stand < beta) beta = stand;
	}

	// ORDERED, WHICH CHANGES THE COST AND NOT THE ANSWER.
	//
	// Unordered this is 1.7ms on average and 52ms at the worst, which is unusable
	// at every leaf of a search. The cutoffs were all there; they were being
	// reached last instead of first.
	//
	// Most valuable victim, least valuable attacker. Taking the queen with a pawn
	// is the move most likely to blow past `beta`, and a cutoff on the first child
	// costs one node instead of thirty. This is alpha-beta move ordering: every
	// capture is still searched when the bounds do not cut, so the value returned
	// is identical. It is emphatically NOT a filter — the distinction between
	// reordering work and skipping it is the one this project has had to restate
	// three times.
	const takers: { move: NormalMove; score: number }[] = [];
	for (const move of allMoves(pos)) {
		// Captures and promotions only: the moves that CHANGE MATERIAL, which is
		// the only quantity this evaluation reports. A quiet move cannot alter the
		// number, so searching it would only cost time.
		//
		// En passant takes a man while landing on an EMPTY square, so occupancy
		// alone misses it. Rare, and worth a line: a quiescence that overlooks a
		// capture reports a position as quiet when it is not, which is the exact
		// failure this function exists to remove.
		const victim = pos.board.get(move.to);
		const takes = !!victim || (move.to === pos.epSquare && pos.board.get(move.from)?.role === 'pawn');
		if (!takes && !move.promotion) continue;
		const gain = victim ? V[victim.role] : takes ? V.pawn : 0;
		const cost = V[pos.board.get(move.from)?.role ?? 'pawn'];
		takers.push({ move, score: gain * 16 - cost + (move.promotion ? V[move.promotion] : 0) });
	}
	takers.sort((a, b) => b.score - a.score);

	for (const { move } of takers) {
		const v = quiesce(after(pos, move), attacker, alpha, beta);
		if (maximising) {
			if (v >= beta) return v;
			if (v > alpha) alpha = v;
		} else {
			if (v <= alpha) return v;
			if (v < beta) beta = v;
		}
	}
	return maximising ? alpha : beta;
}

export function settled(board: Board, mover: Color, attacker: Color): number {
	// SEE ONLY WHAT IS ACTUALLY ATTACKED, and this is not a micro-optimisation.
	//
	// The first version ran a full exchange on every enemy man: sixteen SEEs at
	// every terminal node, 160 microseconds a call, and since a material goal
	// terminates on an EVALUATION rather than on `isCheckmate()` this is the
	// single hottest thing in the search. It made M3 unmeasurable — a 3-ply
	// puzzle solved in 5 nodes and 7ms, a 9-ply one did not finish.
	//
	// Almost none of those men are attacked. Building the mover's attack set once
	// costs one pass over their pieces and turns the SEEs from sixteen into the
	// handful that could actually change hands.
	let reach = SquareSet.empty();
	for (const from of board[mover]) {
		const piece = board.get(from);
		if (piece) reach = reach.union(attacks(piece, from, board.occupied));
	}
	let best = 0;
	for (const square of board[other(mover)].intersect(reach)) {
		const v = seeValue(board, square, mover);
		if (Number.isFinite(v) && v > best) best = v;
	}
	return materialFor(board, attacker) + (mover === attacker ? best : -best);
}

export type MaterialOpts = {
	seed?: boolean;
};

// ---------------------------------------------------------------------------
// THE ZONE FILTER DOES NOT TRANSFER TO MATERIAL, and it was measured rather
// than assumed. There is no `target` option here, and that absence is the
// finding.
//
// PLAN-PNS-LADDER.md assumed the mate generator would carry over: narrow our
// moves to the target's zone the way the king rung narrows to his. Over twelve
// material puzzles at three plies, the full generator proved nine and the
// narrowed one proved six. `eCTH5`, `FkBOW` and `PxKx3` were all lost.
//
// The reason is structural, not a tuning failure. A KING cannot be traded and
// cannot be replaced, so every configuration that mates him bears on his zone —
// which is why 334/334 answers survived that filter. A MATERIAL goal is a
// SWING, not a square: the winning line may deflect a defender on the far side
// of the board, clear a line, or simply win a different man than the one being
// pursued. None of those touch the nominated target's zone, and all of them are
// answers.
//
// The shape of the right generator is known and is not this. A configuration's
// requirements include its DEFENDERS and its LINES, so the moves that serve it
// are those that bear on the target's zone PLUS those that capture or deflect
// what defends it PLUS those that clear the way — which is the `clears` /
// `fills` / `kills` triple from CHECKPOINT-GRAPH-EDITS-2.md, asked of a
// configuration instead of a move. That is the next thing to build, and it has
// to pass the same no-answer-lost gate M2 passed before it goes anywhere near
// a price.
// ---------------------------------------------------------------------------

/**
 * "Can `attacker` force a material gain of at least `want`, within the depth?"
 *
 * `want` is measured against `base`, the settled value at the root, so the
 * question is about the SWING rather than about the absolute count.
 *
 * The generator narrows to a target's zone exactly as the king rung narrows to
 * his — and for the same reason. A move that neither touches the target square
 * nor bears on anywhere the target could run cannot be part of winning it on
 * this ply. As with mate, the narrowing is applied to US and never to them.
 */
export function materialGoal(attacker: Color, want: number, base: number, opts: MaterialOpts = {}): Problem<Chess> {
	return {
		key: positionKey,
		children: (pos) => allMoves(pos).map((m) => after(pos, m)),
		terminal: (pos, depthLeft) => {
			// Mate settles any material question — it is worth more than the board.
			if (pos.isCheckmate()) return 'moverLoses';
			if (pos.isStalemate() || pos.isInsufficientMaterial()) {
				// A draw banks nothing, so the attacker succeeds only if they wanted
				// nothing. Stated rather than assumed, because `want <= 0` is a real
				// question the rung ladder asks at its bottom.
				const ok = want <= 0;
				return pos.turn === attacker ? (ok ? 'moverWins' : 'moverLoses') : ok ? 'moverLoses' : 'moverWins';
			}
			if (depthLeft <= 0) {
				const ok = settled(pos.board, pos.turn, attacker) - base >= want;
				return pos.turn === attacker ? (ok ? 'moverWins' : 'moverLoses') : ok ? 'moverLoses' : 'moverWins';
			}
			return null;
		},
		init: opts.seed
			? (pos) => {
					let n = 0;
					for (const dests of pos.allDests().values()) n += dests.size();
					return [1, Math.max(1, n)];
				}
			: undefined,
	};
}

// ---------------------------------------------------------------------------
// THE LADDER ITSELF
//
// Rungs in descending order of what they could win, each asked as a proof, and
// the first one that answers YES is the position's value. A rung that answers NO
// has been REFUTED — the enumeration under it is exhausted — which is what makes
// the sequence a proof by exclusion rather than a search that stopped.
// ---------------------------------------------------------------------------

/**
 * What each enemy man is worth to take, at most.
 *
 * `V(T)`, plus the promotion allowance when the target stands on our last rank
 * and a pawn of ours could be the one to capture there. The opt-out SEE bound
 * makes that TIGHT rather than conservative — the gain at a square never exceeds
 * the man standing there, except by promotion, verified over 29,516 exchanges
 * (offbook/AMEND-RUNG-ORDER.md). A tight bound is what lets the ladder stop at
 * the first yes instead of continuing to check that nothing below is worth more.
 */
export function rungs(pos: Chess, attacker: Color): number[] {
	const last = attacker === 'white' ? 7 : 0;
	const hasPawn = [...pos.board[attacker]].some((s) => pos.board.get(s)?.role === 'pawn');
	const values = new Set<number>();
	for (const square of pos.board[other(attacker)]) {
		const piece = pos.board.get(square);
		if (!piece || piece.role === 'king') continue;
		values.add(V[piece.role] + (hasPawn && square >> 3 === last ? V.queen - V.pawn : 0));
	}
	return [...values].sort((a, b) => b - a);
}

export type Verdict = {
	/** 'mate', or the material swing proved. Null when nothing is forced. */
	value: number | 'mate' | null;
	/** Every move that achieves it. One means found; several is a genuine tie. */
	moves: NormalMove[];
	nodes: number;
	/**
	 * Was this PROVED, or is it the bottom rung's static pick?
	 *
	 * The distinction is the product. A forced answer comes with a certificate —
	 * "these are all the ways, and here is why the rest fail". The bottom rung
	 * comes with an opinion. Reporting them as the same number is what an engine
	 * does and what this is meant not to do.
	 */
	forced?: boolean;
};

/**
 * The ladder, run on one position.
 *
 * For each rung, the answer set is every root move after which the defender
 * cannot prevent the goal — read off `refuted` at the child, where the defender
 * is the one to move. The first non-empty set is the answer.
 *
 * A SET, not a best move. One move means the position has a single answer;
 * several means it genuinely has several, which is what a dual is and what it
 * should look like. That distinction is the corpus's `found` against `tied`, and
 * collapsing it would be inventing a preference the position does not have.
 */
export function ladderChoose(pos: Chess, depth = 5, solveFn = solve): Verdict {
	const attacker = pos.turn;
	const moves = allMoves(pos);
	let nodes = 0;

	const answersFor = (goal: Problem<Chess>): NormalMove[] => {
		const out: NormalMove[] = [];
		for (const m of moves) {
			const r = solveFn(goal, after(pos, m), depth - 1);
			nodes += r.nodes;
			if (r.refuted) out.push(m);
		}
		return out;
	};

	// Rung 1: the king. Nothing below matters if this answers.
	const mate = answersFor(mateGoal(attacker, { narrow: true, seed: true }));
	if (mate.length) return { value: 'mate', moves: mate, nodes, forced: true };

	// Then material. One pass rather than a search per rung — see `materialChoose`.
	const base = materialFor(pos.board, attacker);
	const mat = materialChoose(pos);
	if (mat.value > 0.5 && mat.moves.length) return { value: mat.value, moves: mat.moves, nodes, forced: true };

	// THE BOTTOM RUNG: the best immediate exchange, and it is not a proof.
	//
	// Will's array ends "[…] Pawn, highest value exchange". Every rung above this
	// asks whether something can be FORCED and answers with a certificate. This
	// one asks what is simply best on the board right now, which is SEE, and it is
	// the base case the ladder falls through to.
	//
	// Without it the ladder is silent in a quiet position — measured at 38% of
	// solver plies at depth 3, and still 28% at depth 5, which is not a depth
	// problem but the honest answer "nothing is forced here". That is a true
	// statement and a useless move recommendation, and the difference between the
	// two is exactly what this rung is for.
	let best = -Infinity;
	let bestMoves: NormalMove[] = [];
	for (const m of moves) {
		const child = after(pos, m);
		const v = quiesce(child, attacker);
		if (v > best + 0.5) {
			best = v;
			bestMoves = [m];
		} else if (v > best - 0.5) bestMoves.push(m);
	}
	return { value: best - base, moves: bestMoves, nodes, forced: false };
}

// ---------------------------------------------------------------------------
// THE MATERIAL RUNGS, WITHOUT A SEARCH
//
// Will: "a piece is only capturable (with positive delta) in two possible
// scenarios: i) it can be attacked by a lower value piece (if defended) and has
// no escape options ii) escape options are strictly worse … It's not a full
// search on all trades."
//
// Measured over the whole corpus (offbook/FINDING-MATERIAL-IS-NOT-A-SEARCH.md),
// every forced material win is one of three things:
//
//   BLUNDER  27.9%  already there by SEE — the opponent erred
//   TRAPPED  36.8%  attackable at a profit with nowhere safe to go
//   COERCED  35.2%  the cheap branch of a forced choice
//
// All three are the same sentence read once: **the defender chooses, and every
// choice costs them.** So what a move guarantees is the MINIMUM over the
// defender's replies of what the position is then worth — one ply of their
// choice, with SEE settling the exchange at the leaf.
//
// That is not an approximation of a search, it is the trichotomy stated
// directly. A blunder shows up because no reply repairs it; a trapped man
// because no reply saves it; a coercion because every reply that saves the
// bigger thing gives up the smaller. One expression, three mechanisms, no tree.
// ---------------------------------------------------------------------------

/**
 * The same question, asked further out: what does this move hold at `plies`?
 *
 * ---------------------------------------------------------------------------
 * WHY THE TRICHOTOMY NEEDED A HORIZON AFTER ALL.
 *
 * The comment above is still right about the MECHANISMS — every forced material
 * win is a blunder, a trapped man or a coercion, and all three are "the defender
 * chooses and every choice costs them". What it got wrong is that one ply of
 * their choice is enough to see it.
 *
 * `scripts/ladder-misses.mjs` over the whole corpus: 98 wrong answers where a
 * rung was proved and the puzzle's move was not in its set, and the sample is
 * almost entirely moves whose immediate swing is ZERO. `sacrifice` 15% missed,
 * `clearance` 13%, `attraction` 13% — every one of them "give something up now,
 * collect later". A two-ply search cannot see later. Quiescence fixed the leaf;
 * this is the same horizon one level above it.
 *
 * So the trichotomy keeps its shape and gains a depth. `plies = 2` is exactly the
 * old expression — min over their replies, quiesce at the leaf — which is why it
 * is the default and why every existing caller is unaffected.
 *
 * ---------------------------------------------------------------------------
 * ALPHA-BETA, AND WHY IT IS NOT A CUT IN THE FORBIDDEN SENSE.
 *
 * The window prunes only branches that PROVABLY cannot change the value at the
 * root: a maximiser abandons a line once the minimiser above it already has a
 * cheaper option. Nothing is discarded that could have been the answer, which is
 * the same argument the one-ply `floor` always made, generalised. That is a
 * different act from narrowing the move list, which is what this project has
 * (correctly) refused three times.
 * ---------------------------------------------------------------------------
 */
export function holds(
	pos: Chess,
	move: NormalMove,
	attacker: Color,
	plies = 2,
	alpha = -Infinity,
	beta = Infinity,
): number {
	return holdsAt(after(pos, move), attacker, plies - 1, alpha, beta);
}

function holdsAt(pos: Chess, attacker: Color, left: number, alpha: number, beta: number): number {
	// Mate is decisive and mover-relative: whoever is to move and cannot move is
	// the one who is lost. Read at every node, not only at the leaf — a line that
	// wins a rook and gets mated on the way is not a line that wins a rook.
	if (pos.isCheckmate()) return pos.turn === attacker ? -Infinity : Infinity;
	const moves = allMoves(pos);
	if (!moves.length) return quiesce(pos, attacker); // stalemate: bank the board
	if (left <= 0) return quiesce(pos, attacker);

	if (pos.turn === attacker) {
		let best = -Infinity;
		for (const m of moves) {
			const v = holdsAt(after(pos, m), attacker, left - 1, alpha, beta);
			if (v > best) best = v;
			if (best > alpha) alpha = best;
			if (alpha >= beta) break;
		}
		return best;
	}
	let best = Infinity;
	for (const m of moves) {
		const v = holdsAt(after(pos, m), attacker, left - 1, alpha, beta);
		if (v < best) best = v;
		if (best < beta) beta = best;
		if (alpha >= beta) break;
	}
	return best;
}

/**
 * Split an answer set that the shallow pass could not — by searching DEEPER, and
 * only the moves that tied.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE 23.5% WENT.
 *
 * The ladder answered 624 of 2656 solver plies with several moves and no way to
 * choose. For a proof engine that is honest; for a trainer it reads as "no
 * opinion", and it was the largest single thing wrong with the solver — bigger
 * than the 7.2% it got wrong.
 *
 * `scripts/ties.mjs` put every tie to a referee two plies deeper than the value
 * that produced it, and the answer was not what the shape of the problem
 * suggested:
 *
 *   DUAL       30.0%   still equal at depth 4 — the ladder is RIGHT, and the
 *                      corpus lists one solution for a position with several
 *   SEPARABLE  66.7%   depth splits them AND prefers the puzzle's move
 *   WRONG-TOP   3.3%   depth splits them and prefers something else
 *
 * Two thirds of the ties are a horizon problem with a known fix, and a third are
 * not a problem at all. Counting the duals as failures would have been measuring
 * the corpus rather than the solver — the standing warning in WHERE-NEXT.md §5.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AFFORDABLE WHEN A DEEP SEARCH IS NOT.
 *
 * Running the material rungs at four plies over every root move costs 4-5x and
 * buys 3-4% (`FINDING-DEPTH-IS-AFFORDABLE-ONCE.md`) — a bad trade, and Will
 * declined it. But a tie is a SMALL SET: median 4 moves, against about 30 legal
 * ones. Deepening only the moves that tied is the same search over a seventh of
 * the work, and it runs on the 23.5% of positions that need it rather than on all
 * of them.
 *
 * The cheap pass decides WHICH question to ask expensively. That is the whole
 * trick, and it is why the answer to "should the rungs be deeper" was no while
 * the answer to "should ties be broken deeper" is yes.
 *
 * ---------------------------------------------------------------------------
 * IT CANNOT LOSE AN ANSWER, ONLY FAIL TO KEEP ONE.
 *
 * `refine` filters an existing set; it never adds a move. So the answer can only
 * be dropped if the deeper search actively prefers something else, which is the
 * 3.3% above and is the honest price. Full window on every candidate — no alpha
 * carried between them, because a running alpha would prune exactly the
 * comparison being made.
 */
export function refine(pos: Chess, moves: NormalMove[], attacker: Color, plies: number): NormalMove[] {
	if (moves.length < 2) return moves;
	// THE RUNNING MAXIMUM IS AN EXACT ALPHA, AND THE TIE SET SURVIVES IT.
	//
	// The obvious way to write this is a full window on every candidate, and that
	// is what the first version did — 740ms a ply. But we are taking a MAXIMUM,
	// so the best value found so far is a legitimate lower bound to hand the next
	// search, exactly as `materialChoose`'s `floor` always has.
	//
	// The subtlety is that we need the tie SET, not just the maximum, and a
	// fail-low result is only a bound. It still works, and here is why it does:
	// with `beta = Infinity` no search can fail high, so a result above the window
	// is exact; a result at or below `alpha` is an UPPER bound, so a move
	// returning `<= best - 0.5` genuinely cannot reach `best` and is genuinely not
	// tied. Both directions are safe, which is asserted against the full-window
	// computation in `test/ladder.test.ts` rather than argued here alone.
	let best = -Infinity;
	const scored: { m: NormalMove; v: number }[] = [];
	for (const m of moves) {
		const v = holds(pos, m, attacker, plies, best - 0.5, Infinity);
		scored.push({ m, v });
		if (v > best) best = v;
	}
	// A tie that survives IS a dual, and is reported as one rather than broken
	// arbitrarily. Naming one of two equal moves would be inventing a preference
	// the position does not have — 30% of ties are still level two plies deeper.
	return scored.filter((s) => s.v > best - 0.5).map((s) => s.m);
}

// ---------------------------------------------------------------------------
// A THRESHOLD TEST WAS TRIED HERE, AND IT WAS SLOWER. THE REASON IS THE POINT.
//
// `holds` computes a value — the exact best swing over every move. The ladder
// never asks for a value; it asks a descending sequence of THRESHOLDS and stops
// at the first yes. So a `canForce(want)` built on a null window looked obviously
// right: a yes/no question needs only a bound, and a one-step window gives every
// node an immediate cutoff.
//
// Measured at depth 4 over 40 positions, agreeing with the maximum on 40/40:
//
//     exact maximum over all moves   792ms a position
//     descending threshold tests    1713ms a position     2.2x WORSE
//
// Because the rungs SHARE THEIR WORK and a sequence of separate tests throws that
// away. Positions carry 3.7 rungs on average, so the threshold form makes 3.7
// passes over the root moves, each starting from a fresh window, and every rung
// above the answer is a pass that fails. The single maximum makes one pass whose
// alpha TIGHTENS as it goes, and answers every rung at once — the best swing is
// compared against each bound for free.
//
// Which is what `materialChoose` already said, in a comment written before any of
// this: "a maximum over moves IS that ladder, evaluated in one pass". The ladder's
// descending-threshold framing is the right THEORY — it is what makes the
// exclusion legible, and it is what the panel prints — and one maximum is the
// right IMPLEMENTATION of it. Those are allowed to differ.
//
// Rule 9: measured worse, so deleted, reasoning kept.
// ---------------------------------------------------------------------------

/**
 * The worst the defender can hold this move to, in material.
 *
 * `floor` is an alpha cut and it is EXACT rather than a heuristic: we are taking
 * a minimum, so once a reply drags the value to or below the best move found so
 * far, this move cannot win the comparison and the remaining replies cannot
 * change that. Nothing is discarded that could have been the answer.
 */
export function guarantees(pos: Chess, move: NormalMove, attacker: Color, floor = -Infinity): number {
	const child = after(pos, move);
	const replies = allMoves(child);
	// No reply at all: mate settles it, stalemate banks whatever is on the board.
	if (!replies.length) return child.isCheckmate() ? Infinity : quiesce(child, attacker);
	let worst = Infinity;
	for (const r of replies) {
		const next = after(child, r);
		// MINUS INFINITY. `next` is the position after THEIR reply, so it is OUR
		// turn — and checkmate there means WE are mated, which is the worst
		// outcome available, not the best.
		//
		// It read `Infinity`, and the two branches look identical at a glance: the
		// one above is `child`, after OUR move, where mate means we delivered it.
		// One ply apart, opposite sign, same spelling. So a move that walked into
		// mate in one scored `+Infinity`, beat every other move, cleared every
		// material rung — `Infinity >= want` for all want — and was reported as a
		// FORCED win of the largest piece on the board.
		//
		// Found by a control, not by a test: the referee in
		// `scripts/guarantee-depth.mjs` had to reproduce `guarantees` exactly at
		// depth 2 before it could be trusted to judge depth 4, and the 33 pairs
		// where it refused were all this.
		const v = next.isCheckmate() ? -Infinity : quiesce(next, attacker);
		if (v < worst) worst = v;
		if (worst <= floor) return worst; // cannot beat what we already have
	}
	return worst;
}

/**
 * The material rungs, run together.
 *
 * The rungs are ordered by value and the ladder stops at the first that answers
 * — but a maximum over moves IS that ladder, evaluated in one pass: the best
 * guaranteed swing is the highest rung with a non-empty answer set, and the
 * moves achieving it are that set. Written as a scan rather than as a loop over
 * thresholds because the two are the same computation and one of them costs a
 * pass per rung.
 */
export function materialChoose(pos: Chess): { value: number; moves: NormalMove[] } {
	const attacker = pos.turn;
	// THE BASELINE IS WHAT WE HAVE, NOT WHAT WE COULD GET.
	//
	// `settled()` credits the mover with their best available exchange, which is
	// right at a LEAF and wrong as a baseline: it prices the hanging queen into
	// the starting position, so taking her reads as a swing of zero. The move is
	// still chosen — it still guarantees more than any other — but it is reported
	// as unforced, which is exactly backwards for the most forced thing on the
	// board. A blunder is invisible to a baseline that has already spent it.
	const base = materialFor(pos.board, attacker);
	let best = -Infinity;
	let moves: NormalMove[] = [];
	for (const m of allMoves(pos)) {
		const v = guarantees(pos, m, attacker, best - 0.5);
		if (v > best + 0.5) {
			best = v;
			moves = [m];
		} else if (v > best - 0.5) moves.push(m);
	}
	return { value: best - base, moves };
}

// ---------------------------------------------------------------------------
// THE REPORT — the rungs with their reasons, which is the product.
//
// `ladderChoose` answers "what is the best move". An engine does that. What no
// engine prints, and what this exists for, is the other half: WHY NOT MORE.
// Every rung above the answer was REFUTED, and a refutation has structure — the
// closest attempt, and the reply that held it down.
// ---------------------------------------------------------------------------

/**
 * One of our moves, and what the defender did about it.
 *
 * `witness` and `survivors` are NOT the same claim and must never be printed as
 * if they were. A witness is one reply the search exhibited — free, and a lower
 * bound. `survivors` is the complete enumeration, which costs a solve per legal
 * reply and is only ever filled in by `survivingReplies` when something actually
 * asks. A panel that says "1 reply survives" on the strength of a witness is
 * stating a falsehood; on `ohoTK` the witness count is 1 and the truth is 29.
 */
export type Attempt = {
	move: NormalMove;
	/** Mate rung: ONE reply the search showed survives. Absent when this move mates. */
	witness?: NormalMove;
	/** Mate rung: every surviving reply, when someone paid for the enumeration. */
	survivors?: NormalMove[];
	/** Material rungs: the swing this move GUARANTEES, against `base`. */
	value?: number;
	/** Material rungs: the reply that enforces it. */
	held?: NormalMove | null;
	/** True when the move was proved — the defender has nothing. */
	proved?: boolean;
};

/**
 * EVERY reply that survives our move, by solving each one.
 *
 * The honest form of the question the ladder's mate rung asks, and the expensive
 * one: a solve per legal reply rather than one solve that stops at the first
 * answer. It is not called during `ladderReport` — thirty moves times thirty
 * replies is a thousand searches for a table nobody has opened yet — and is
 * instead what the proof view calls for the one move a reader points at.
 *
 * This is also what Hall's condition needs. "Every escape costs them a man worth
 * V" is a statement about ALL survivors, and a witness cannot support it.
 */
export function survivingReplies(pos: Chess, move: NormalMove, attacker: Color, depth: number): NormalMove[] {
	const child = after(pos, move);
	const goal = mateGoal(attacker, { narrow: true, seed: true });
	const out: NormalMove[] = [];
	for (const reply of allMoves(child)) {
		// At the grandchild WE move, so our goal being PROVED there is the defender
		// having failed. Anything else — proved false, or unresolved — leaves them
		// alive as far as this depth can tell, and is reported as surviving.
		if (!solve(goal, after(child, reply), depth - 2).proved) out.push(reply);
	}
	return out;
}

export type RungReport = {
	/** What was asked: mate, or a material swing in centipawns. */
	rung: 'mate' | number;
	proved: boolean;
	/** The answer set when proved. Several members is a genuine dual. */
	moves: NormalMove[];
	/**
	 * When refuted: the nearest miss, and what answered it.
	 *
	 * `move` is our best attempt at this rung, `held` is the defender's reply that
	 * kept it below the bar, and `value` is what it was held to. That sentence —
	 * "you cannot win the rook, because after ♗c5+ they play ♚a2" — is the thing
	 * a trainer needs and a centipawn score cannot say.
	 */
	miss?: { move: NormalMove; held: NormalMove | null; value: number };
	/**
	 * Every move tried at this rung, nearest first.
	 *
	 * The `miss` above is `attempts[0]` said as a sentence. The array is here
	 * because a panel that shows only the nearest miss is asking the reader to
	 * trust that the other thirty were checked, and this whole stack exists so that
	 * nothing has to be trusted.
	 */
	attempts: Attempt[];
	nodes: number;
};

export type LadderReport = {
	rungs: RungReport[];
	value: number | 'mate' | null;
	moves: NormalMove[];
	forced: boolean;
	nodes: number;
	/** Material as it stands, attacker's side. Every rung's swing is against this. */
	base: number;
};

/** `guarantees`, but reporting WHICH reply held the move down. */
function guaranteeWithHeld(
	pos: Chess,
	move: NormalMove,
	attacker: Color,
	plies = 2,
): { value: number; held: NormalMove | null } {
	const child = after(pos, move);
	const replies = allMoves(child);
	if (!replies.length)
		return { value: child.isCheckmate() ? Infinity : quiesce(child, attacker), held: null };
	let worst = Infinity;
	let held: NormalMove | null = null;
	for (const r of replies) {
		const next = after(child, r);
		// MINUS INFINITY. `next` is the position after THEIR reply, so it is OUR
		// turn — and checkmate there means WE are mated, which is the worst
		// outcome available, not the best.
		//
		// It read `Infinity`, and the two branches look identical at a glance: the
		// one above is `child`, after OUR move, where mate means we delivered it.
		// One ply apart, opposite sign, same spelling. So a move that walked into
		// mate in one scored `+Infinity`, beat every other move, cleared every
		// material rung — `Infinity >= want` for all want — and was reported as a
		// FORCED win of the largest piece on the board.
		//
		// Found by a control, not by a test: the referee in
		// `scripts/guarantee-depth.mjs` had to reproduce `guarantees` exactly at
		// depth 2 before it could be trusted to judge depth 4, and the 33 pairs
		// where it refused were all this.
		// `holdsAt(..., 0)` IS `quiesce`, so `plies = 2` is exactly the expression
		// this function has always been. Depth is available and costs nothing until
		// it is asked for — see the note above `holds` for what it buys and what it
		// costs, both measured.
		const v = next.isCheckmate() ? -Infinity : holdsAt(next, attacker, plies - 2, -Infinity, Infinity);
		if (v < worst) {
			worst = v;
			held = r;
		}
	}
	return { value: worst, held };
}

/**
 * Name every legal move of `pos` by the position it produces.
 *
 * `pns` speaks in STATES because it knows no chess — `via` and `line` are
 * positions, and a position is not something a reader can be shown. One pass over
 * the legal moves turns them back into moves, which is cheaper than threading a
 * move through the engine and keeps the engine domain-free.
 */
function byResult(pos: Chess): Map<string, NormalMove> {
	const m = new Map<string, NormalMove>();
	for (const move of allMoves(pos)) m.set(positionKey(after(pos, move)), move);
	return m;
}

/** A move, and what the defender may answer with. */
export type ProofNode = { move: NormalMove; mate: boolean; kids: ProofNode[] };

/**
 * The mate, drawn out: our move, every reply, our answer to each.
 *
 * THIS IS THE CERTIFICATE, not an illustration of it. A principal variation shows
 * one line and asks the reader to assume the rest; a mate is only proved if EVERY
 * reply is answered, so every reply is here. The recursion stops when the position
 * is mate — never on a depth guess — and `depth` is only the bound the proof was
 * found under.
 *
 * Built after the fact rather than during the search because `solve` reports the
 * line only for the side that PROVES its goal, and a proved mate is a REFUTED
 * defence: the defender's node has no line to give.
 */
/**
 * How many plies the proof runs below a node — the longest resistance in it.
 *
 * The defender's own measure of how well a reply does. It is the number that
 * picks the main line: a defence that holds out four plies is more instructive
 * than one that walks into mate immediately, and both are in the certificate.
 */
function height(n: ProofNode): number {
	let deepest = 0;
	for (const k of n.kids) {
		const h = height(k);
		if (h > deepest) deepest = h;
	}
	return 1 + deepest;
}

/**
 * ONE line through the certificate: ours, their most stubborn reply, ours, ...
 *
 * ---------------------------------------------------------------------------
 * `mateTree`'s own comment is emphatic that the tree is the proof and a
 * principal variation is not: "a principal variation shows one line and asks the
 * reader to assume the rest; a mate is only proved if EVERY reply is answered."
 * That is still true and this does not weaken it.
 *
 * What this is for is DRAWING. Eight arrows on a board is a picture; a whole
 * proof tree on a board is a scribble, and the overlay that tried would teach
 * nothing. So the division is: the board shows one line and the proof tab shows
 * the tree, and neither pretends to be the other. The caller is responsible for
 * saying which it is showing — `wheels.ts` labels it "one line of the mate".
 *
 * The defender's reply is chosen by `height`, the longest resistance, because
 * that is the line a reader learns most from and the one they would have played.
 * ---------------------------------------------------------------------------
 */
export function principalLine(node: ProofNode): NormalMove[] {
	const out: NormalMove[] = [node.move];
	let n = node;
	while (n.kids.length) {
		// Their turn: the reply that holds out longest.
		let best = n.kids[0];
		for (const k of n.kids) if (height(k) > height(best)) best = k;
		out.push(best.move);
		if (!best.kids.length) break;
		// Ours: a proved mate has exactly one answer worth showing per reply, and
		// the tree already contains only answers that work.
		n = best.kids[0];
		out.push(n.move);
		if (n.mate) break;
	}
	return out;
}

export function mateTree(pos: Chess, move: NormalMove, attacker: Color, depth: number): ProofNode {
	const child = after(pos, move);
	if (child.isCheckmate()) return { move, mate: true, kids: [] };
	if (depth <= 1) return { move, mate: false, kids: [] };
	const goal = mateGoal(attacker, { narrow: true, seed: true });
	const kids: ProofNode[] = [];
	for (const reply of allMoves(child)) {
		const next = after(child, reply);
		// Our answer to this reply: the first of our moves after which they are
		// again lost. There may be several; the tree shows one, and the rung's
		// answer set above it is where duals are counted.
		let answer: ProofNode | null = null;
		for (const m2 of relevantMoves(next, other(attacker))) {
			// Mate on the board first: it is one call, and at the depth boundary it is
			// the only test that can still answer — `solve` with nothing left to spend
			// reports the defender surviving, which is true of the search and false of
			// the position.
			if (after(next, m2).isCheckmate()) {
				answer = { move: m2, mate: true, kids: [] };
				break;
			}
			if (depth >= 4 && solve(goal, after(next, m2), depth - 3).refuted) {
				answer = mateTree(next, m2, attacker, depth - 2);
				break;
			}
		}
		kids.push({ move: reply, mate: false, kids: answer ? [answer] : [] });
	}
	return { move, mate: false, kids };
}

/**
 * The ladder, with its working shown.
 *
 * Rungs descend by bound and stop at the first that answers — and each one that
 * did NOT answer carries its nearest miss AND the full attempt list, so the
 * exclusion is legible rather than merely asserted.
 */
export function ladderReport(
	pos: Chess,
	depth = 5,
	materialPlies = 2,
	/**
	 * Plies to spend splitting an answer set the shallow pass could not.
	 *
	 * Zero turns it off and reproduces the pre-tiebreak behaviour exactly. Four is
	 * the measured setting: it converts two thirds of ties into a single named
	 * move, leaves the genuine duals alone, and costs only on the positions that
	 * tie — see `refine`.
	 */
	tiebreakPlies = 4,
): LadderReport {
	const attacker = pos.turn;
	const base = materialFor(pos.board, attacker);
	const rungReports: RungReport[] = [];
	let nodes = 0;

	// Rung 1 — the king.
	const mateMoves: NormalMove[] = [];
	const mateTries: Attempt[] = [];
	const goal = mateGoal(attacker, { narrow: true, seed: true });
	for (const m of allMoves(pos)) {
		const child = after(pos, m);
		const r = solve(goal, child, depth - 1);
		nodes += r.nodes;
		if (r.refuted) {
			mateMoves.push(m);
			mateTries.push({ move: m, proved: true });
			continue;
		}
		// ONE WITNESS, AND IT IS LABELLED AS ONE.
		//
		// `via` is whatever df-pn resolved before it stopped, which is one child —
		// the search's whole point is to stop there. An earlier version of this code
		// called the list `survivors` and the panel printed its LENGTH as "n replies
		// survive", a number that was 1 everywhere because the search stops at 1,
		// against a true count of 29 on `ohoTK` after ♕f5–b1. The complete
		// enumeration exists, costs a solve per reply, lives in `survivingReplies`,
		// and nothing calls it until a reader asks for that one move.
		const names = r.via.length ? byResult(child) : null;
		const witness = r.via.length ? names!.get(positionKey(r.via[0])) : undefined;
		mateTries.push({ move: m, witness });
	}
	// Proved first, then the moves with a witness, then the ones the search never
	// resolved. NOT sorted by nearness — there is no cheap measure of it, and the
	// version that sorted on witness count was sorting on a constant.
	const rank = (t: Attempt) => (t.proved ? 0 : t.witness ? 1 : 2);
	mateTries.sort((a, b) => rank(a) - rank(b));
	const nearMate = mateTries.find((t) => t.witness);
	rungReports.push({
		rung: 'mate',
		proved: mateMoves.length > 0,
		moves: mateMoves,
		miss: nearMate ? { move: nearMate.move, held: nearMate.witness ?? null, value: 0 } : undefined,
		attempts: mateTries,
		nodes,
	});
	if (mateMoves.length) return { rungs: rungReports, value: 'mate', moves: mateMoves, forced: true, nodes, base };

	// The material rungs, in one pass. Every move's guaranteed swing, and what
	// held it — then the rungs are read off that by threshold.
	const scored = allMoves(pos).map((m) => ({ m, ...guaranteeWithHeld(pos, m, attacker, materialPlies) }));
	let best = -Infinity;
	for (const s of scored) if (s.value > best) best = s.value;
	const swing = best - base;
	// One attempt list, shared by every material rung: the pass is the same
	// computation for all of them, and the rungs differ only in where the bar sits.
	const tries: Attempt[] = [...scored]
		.sort((a, b) => b.value - a.value)
		.map((s) => ({ move: s.m, value: s.value - base, held: s.held }));

	for (const want of rungs(pos, attacker)) {
		const got = scored.filter((s) => s.value - base >= want - 0.5);
		if (got.length) {
			// Several moves reaching the same rung is where the shallow pass runs
			// out of resolution, not where the position does.
			const answer =
				tiebreakPlies > materialPlies
					? refine(pos, got.map((s) => s.m), attacker, tiebreakPlies)
					: got.map((s) => s.m);
			rungReports.push({ rung: want, proved: true, moves: answer, attempts: tries, nodes: 0 });
			return { rungs: rungReports, value: want, moves: answer, forced: true, nodes, base };
		}
		// Refuted. The nearest miss is the move that came closest, and the reply
		// that held it.
		const near = tries[0];
		rungReports.push({
			rung: want,
			proved: false,
			moves: [],
			miss: near ? { move: near.move, held: near.held ?? null, value: near.value! } : undefined,
			attempts: tries,
			nodes: 0,
		});
	}

	// THE BOTTOM RUNG, WHICH IS WHERE MOST OF THE TIES ACTUALLY LIVE.
	//
	// 68% of tied plies come from here rather than from a proved rung: nothing is
	// forced, so every move that loses nothing scores the same and the answer set
	// is enormous — median 4, and a third of ties held six or more. "Here are
	// thirty moves that lose nothing" is a true statement and not an answer, which
	// this rung's own comment already conceded.
	//
	// Deepening splits them. It does not make anything forced — the rung is still
	// an opinion, and `forced` stays false — but it is a better-founded one.
	const bottom = scored.filter((s) => s.value > best - 0.5).map((s) => s.m);
	const picked = tiebreakPlies > materialPlies ? refine(pos, bottom, attacker, tiebreakPlies) : bottom;
	return { rungs: rungReports, value: swing, moves: picked, forced: false, nodes, base };
}

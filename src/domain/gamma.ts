// Γ — every obligation joined to what discharges it.
//
// ---------------------------------------------------------------------------
// SPEC: DEFICIENCY.md §2, closed by AMEND-2-ARRIVES.md, and corrected by
// AMEND-0-SYMMETRIC.md. Replaces `cover2.ts`'s role-parameter form.
//
// Two changes from `cover2.gamma`, and the second is the substantive one.
//
//   1. NO `owed` PARAMETER. The side that must discharge an obligation is
//      `other(o.claimant)` — a fact already on the row. Γ is built once, for the
//      whole complex, and reading one side's share is a filter.
//
//   2. NO DEADLINE COMPARISON. `cover2` applied `tauStar(o, turn, owed)` —
//      "τ counts the claimant's tempi, the cover is spent in the owed side's" —
//      and gave it its own test as the most likely place to be quietly wrong.
//
//      The arithmetic in it was real. Stamping it on a row was not. Whose tempi
//      are being spent is a property of where you are in the TRAVERSAL, and the
//      traversal ticks it as it descends. So Γ answers only the structural
//      question — what discharges exist and at what cost in tempi — and the
//      comparison against what is left happens where the tempi are counted.
//
// Everything below is a query about one board. No board is constructed except
// for SEE, which is an occupancy edit on a clone — §7's three lookups.
// ---------------------------------------------------------------------------

import { attacks, between } from 'chessops/attacks';
import type { Board } from 'chessops/board';
import type { Color, Square } from 'chessops/types';
import { V, other, seeValue, capturersOn, pinsFor } from './exchange';
import { isLive, isMateWeight, type Complex, type Obligation } from './complex';

/** How far off a promotion may be and still register its queen. */
const PROMO_HORIZON = 6;
import { reach, distance, bear, type Reach } from './reach';

// Re-exported: `bear` moved to `reach.ts` when `complex.ts` needed it, and
// `complex` is upstream of this file. It is a question about a board and a
// piece, with no obligation in it, so `reach` is where it belonged all along.
export { bear };

export type Kind = 'evade' | 'capture' | 'block' | 'defend';

export type Discharge = {
	/** Index into `complex.obligations`. */
	obligation: number;
	kind: Kind;
	/** Who supplies it. Always of the side whose material is at stake. */
	piece: Square;
	/** The required square — `R(e)` in AMEND-2-ARRIVES §1's table. */
	to: Square;
	/**
	 * Tempi, counted in the SUPPLYING side's moves.
	 *
	 * Not compared against anything here. A cost is a fact about the board;
	 * whether it arrives in time is a fact about the node.
	 */
	cost: number;
};

/** The squares an attacker of `o.square` stands on. */
const attackersOf = (board: Board, o: Obligation): Square[] =>
	o.from !== undefined ? [o.from] : capturersOn(board, o.square, o.claimant);

/** The route: squares that must stay empty for the claim to stand. */
function lineOf(board: Board, o: Obligation): Square[] {
	if (o.deadline > 1) return o.needs.filter((s) => s !== o.square);
	const out = new Set<Square>();
	for (const a of attackersOf(board, o)) for (const mid of between(a, o.square)) out.add(mid);
	out.delete(o.square);
	return [...out];
}

/** The board with one piece moved. An occupancy edit, for SEE only. */
function shifted(board: Board, from: Square, to: Square): Board {
	const b = board.clone();
	const piece = b.take(from);
	if (!piece) return b;
	b.take(to);
	b.set(to, piece);
	return b;
}

/**
 * The board an `arrival` row's gates are asked on.
 *
 * Its weight was measured with the traveller standing on its arrival square, and
 * that is the board its discharges have to be tested against — otherwise the row
 * answers itself.
 *
 *   arrival  measured with the traveller standing on its arrival square. On the
 *            board as it stands the target is not attacked from there at all, so
 *            an evasion could "escape" to a square the traveller will cover.
 *
 * Everything else is a claim about the position as it is, and gets it unchanged.
 */
function stressed(board: Board, o: Obligation): Board {
	if (o.kind === 'arrival' && o.from !== undefined && o.via !== undefined) return shifted(board, o.from, o.via);
	return board;
}

/**
 * Is the obligation actually gone on this board? — AMEND-2-ARRIVES §4.1.
 *
 * Cleared, not merely reduced. Double check falls out: after taking one of two
 * checkers the king's square still carries an infinite exchange.
 */
const discharged = (after: Board, o: Obligation): boolean => seeValue(after, o.square, o.claimant) <= 0;

/**
 * A COVER THAT IS TAKEN AND DOES NOT END THE CLAIM IS NOT A COVER.
 *
 * ---------------------------------------------------------------------------
 * Will:
 *
 *   "It's not a discharge, it's a mislabelled exchange. And the exchange doesn't
 *    end after one ply — it ends when the king is captured or a player opts out.
 *    That is standard SEE."
 *
 * `discharged()` asks a ONE-PLY question: is the claim gone immediately after the
 * covering move. On `iLxar` — `Re8 Rf8 Rxf8#` — blocking with ♜f5–f8 ends the
 * check, so the test passes and the row is struck at a cost of one tempo. The
 * rook is then taken and the mate is back, and nothing ever asked.
 *
 * So the exchange is allowed one more ply, which is all it needs: if the covering
 * man is simply lost where it stands, let the claimant take it, and ask whether
 * the claim survives that. A cover that neither ends the claim nor survives being
 * answered has bought a tempo and conceded a piece, and Γ should not offer it as
 * an answer at all.
 *
 * Measured before it was written — `scripts/discharge-audit.mjs`, 150 puzzles:
 * 22.5% of blocks put the piece where it is lost and **19.0% of them leave the
 * claim standing**. On ∞ rows, 8 of 31. That is the mate-in-2 class.
 *
 * This is NOT the full model. Will's version runs one exchange to termination
 * with the king in it; this runs the same chain two plies and stops. It is here
 * because it is the smallest change that tests the claim on the class that
 * isolates it, and because a cover measured at 19% fake is worth refusing whether
 * or not the larger rewrite happens.
 * ---------------------------------------------------------------------------
 */
/**
 * Can the king walk out, once the claim has come back?
 *
 * The cheap half of "is that a mate", and only ever asked of a mate row whose
 * claim survives being answered. A flight square is one the king can legally
 * occupy and not be taken on — which is `seeValue` at the destination, the same
 * test `evade` already uses.
 *
 * It is deliberately only the FLIGHT half: a returning claim could also be met by
 * a capture or a block, and asking that properly is a second Γ. This is the
 * discriminator that separates the two cases the corpus actually produced, and it
 * is named as an approximation rather than dressed up as the general test.
 */
function hasFlight(after: Board, o: Obligation): boolean {
	const side = other(o.claimant);
	const king = after.kingOf(side);
	if (king === undefined) return true;
	for (const to of attacks({ color: side, role: 'king' }, king, after.occupied)) {
		if (after.get(to)?.color === side) continue;
		if (seeValue(shifted(after, king, to), to, o.claimant) <= 0) return true;
	}
	return false;
}

/**
 * Does this cover get taken and leave the king with nowhere to go?
 *
 * Three steps, and the order matters: the cover must actually be lost, the claim
 * must come BACK when it is taken, and only then is the king asked whether it has
 * anywhere to stand. The flight test has to run on the board AFTER the recapture
 * — asked a move too early it says yes on `ZzxhN`, because ♔g1 still has f1 and h1
 * until ♜×e1 arrives to cover them.
 */
function answerWalksIntoMate(after: Board, o: Obligation, cover: Square): boolean {
	if (seeValue(after, cover, o.claimant) <= 0) return false; // the cover stands
	// EVERY RECAPTURE, NOT THE CHEAPEST ONE.
	//
	// Taking with the least valuable attacker is an EXCHANGE rule — it keeps the
	// dearer men in reserve — and it is the wrong rule when the question is mate.
	// The claimant is not trying to win material here; they are trying to finish,
	// and they will take with whichever man does it.
	//
	// `K0qzR`, ♛d7–d1+ ♖×d1: two men can retake on d1, and the CHEAPER one is the
	// wrong one. ♗b3×d1 (330) does not attack c1 and the claim reads as answered;
	// ♜d8×d1 (500) is mate. Picking by price threw the mate away and the queen
	// sacrifice priced at +4.00.
	for (const t of capturersOn(after, cover, o.claimant)) {
		const retaken = shifted(after, t, cover);
		if (discharged(retaken, o)) continue; // this retake ends it — not this one
		if (!hasFlight(retaken, o)) return true; // and this one finishes
	}
	return false;
}

/**
 * TRACING THE CONTINGENCY — a discharge that arms a registered ray is no answer.
 *
 * ---------------------------------------------------------------------------
 * Will, on `ohoTK`: "The queen's ray against the king (one move away) should have
 * been registered from the start with blocking pawn contingency and blocking
 * bishop contingency. Then the exchange would naturally trigger by tracing
 * contingencies: ♖×h2, ♔×h2, ♕h5, ♗h4, ♕×h4+, as a single exchange visible from
 * initial registration — no iteration."
 *
 * `1lR5W` is the same shape and shorter. After 2.♖×f6+ the check has exactly one
 * answer, g7×f6, and Γ files it and stops. But `complex.ts` has already
 * registered `f8 ← ♗d2 via h6, contingent on g7`, and g7×f6 is what EMPTIES g7.
 * The answer arms the next claim, and 3.♗h6 is mate.
 *
 * That is not a new question. `answerWalksIntoMate` already asks it for the SAME
 * row — an answer that lets the identical claim return is not an answer — and
 * this is the same sentence with "identical" struck out. The claim that returns
 * is a DIFFERENT registered ray of the same claimant against the same king, and
 * the only reason it could not be asked before is that the ray was not in the
 * ledger to ask about. It is now.
 *
 * "No iteration" is the property that matters and it is the one this has: nothing
 * searches. The rays were registered when the complex was built; arming one is a
 * lookup against squares that a move happens to vacate.
 *
 * CONSERVATIVE, DELIBERATELY. This mechanism CREATES mates by refusing
 * discharges, and a false mate is the defect the whole-ray fix was written to
 * remove. So the arrival must survive three questions and every one of them
 * over-counts the defence:
 *
 *   flight    the king has nowhere legal and safe to stand.
 *   capture   no defender takes the traveller on its arrival square and ends it.
 *   block     no defender bears on a square between the arrival and the king.
 *
 * `capturersOn` for the block test answers "bears on", which for a pawn is not
 * the same as "can move to" — a pawn attacking an empty square cannot go there.
 * That over-states the defence, so it refuses mates that are real rather than
 * inventing ones that are not, and that is the direction to be wrong in.
 */
/**
 * Men of `side` that can MOVE onto the empty square `mid` — an interposition.
 *
 * NOT `capturersOn`, and `ohoTK` is decided by the difference. That answers
 * "bears on", which for a pawn is the diagonal it captures along, and a pawn
 * cannot capture onto an empty square. ♙g2 bears on h3 and cannot go there;
 * counted as an interposition it answered ♕h5+ and threw the mate away.
 *
 * A pawn blocks by PUSHING. Everything else blocks where it attacks. A king is
 * never an interposer against a check on itself, which is the only kind of check
 * this is asked about.
 */
function interposersOn(board: Board, mid: Square, side: Color): Square[] {
	const out: Square[] = [];
	for (const b of board[side]) {
		const pc = board.get(b);
		if (!pc || pc.role === 'king') continue;
		if (pc.role === 'pawn') {
			const step = pc.color === 'white' ? 8 : -8;
			const one = (b + step) as Square;
			if (one === mid) {
				out.push(b);
				continue;
			}
			const home = pc.color === 'white' ? 1 : 6;
			if ((b >> 3) === home && !board.occupied.has(one) && one + step === mid) out.push(b);
			continue;
		}
		if (attacks(pc, b, board.occupied).has(mid)) out.push(b);
	}
	return out;
}

function armsARegisteredMate(after: Board, o: Obligation, rays: Obligation[]): boolean {
	for (const q of rays) {
		if (q.claimant !== o.claimant) continue;
		if (q.from === undefined || q.via === undefined) continue;
		// THE ROW IS ABOUT A KING, NOT ABOUT A SQUARE.
		//
		// `q.square` is where the king stood when the ray was registered, and the
		// discharge being judged may be the very move that moves it. `ohoTK`:
		// 1…♜×h2+ 2.♔×h2 — the answer to the check is a KING CAPTURE, so by the time
		// the ray would fire the king is on h2 and the row still says h1. Keyed on
		// the stored square the claim reads as a check on an empty square and every
		// attraction sacrifice was invisible.
		//
		// So the king is read off the board the discharge produced. Everything below
		// asks about THAT square, and `seeValue` there is exact rather than an
		// approximation of the row's geometry.
		const defender = other(q.claimant);
		const king = after.kingOf(defender);
		if (king === undefined) continue;
		// STILL GATED — and this is where Will's correction lives. The condition is
		// that the square is EMPTY, never that the man on it was captured: "the ray
		// goes live when the pawn is removed, which in this particular solution does
		// not happen on the pawn's capture but on the pawn moving to capture the
		// rook." g7×f6 clears g7 by leaving it.
		//
		// A blocker that IS the king under attack is not a blocker, it is the target.
		// ♛h5 bears down the h-file onto ♔h2, and h2 is the gate the row was
		// registered against — the king walked onto its own blocker's square.
		if (q.needs.some((sq) => sq !== king && after.occupied.has(sq))) continue;
		// The traveller has to still be there to travel.
		if (after.get(q.from)?.color !== q.claimant) continue;
		const armed = shifted(after, q.from, q.via);
		if (seeValue(armed, king, q.claimant) <= 0) continue; // it does not bear after all
		const row: Obligation = { ...q, square: king };
		if (hasFlight(armed, row)) continue;
		// Taken on arrival, and the taking ends it.
		let answered = false;
		for (const t of capturersOn(armed, q.via, defender)) {
			if (discharged(shifted(armed, t, q.via), row)) {
				answered = true;
				break;
			}
		}
		if (answered) continue;
		// INTERPOSED ON — and the interposition has to SURVIVE.
		//
		// Will named this as a contingency of its own: "registered from the start
		// with blocking pawn contingency and blocking bishop contingency. Then the
		// exchange would naturally trigger by tracing contingencies: ♖×h2, ♔×h2,
		// ♕h5, ♗h4, ♕×h4+."
		//
		// ♗e1–h4 does block the h-file, and asked only "does anything reach h4" the
		// answer is yes and the mate disappears. But ♕×h4 takes it and the same claim
		// stands, which is exactly `survivesTheAnswer`'s question about a block —
		// the claim it renews is the same claim — asked here about the ray instead of
		// about the row. A block that is taken and the mate stands is not a block.
		for (const mid of between(q.via, king)) {
			if (armed.occupied.has(mid)) continue;
			for (const b of interposersOn(armed, mid, defender)) {
				const blocked = shifted(armed, b, mid);
				let survives = true;
				for (const t of capturersOn(blocked, mid, q.claimant)) {
					const taken = shifted(blocked, t, mid);
					if (seeValue(taken, king, q.claimant) > 0 && !hasFlight(taken, row)) {
						survives = false;
						break;
					}
				}
				if (survives) {
					answered = true;
					break;
				}
			}
			if (answered) break;
		}
		if (answered) continue;
		return true;
	}
	return false;
}

function survivesTheAnswer(after: Board, o: Obligation, cover: Square, from?: Square): boolean {
	// THE TARGET ITSELF MAY BE THE COVER, and then the row's square is stale.
	//
	// `discharged()` asks whether `o.square` is still attacked. When the king
	// ANSWERS A CHECK BY CAPTURING, the king has left `o.square` — the square is
	// empty, `seeValue` on it is zero, and every such capture read as a discharge
	// however suicidal. That is what let "take the checker with the king" answer
	// real mates, and it cost twenty-eight points before it was found.
	//
	// The question for a king that moved is simply whether it is safe where it now
	// stands. There is no recapture to model: if it can be taken there, it cannot
	// go there.
	if (from !== undefined && from === o.square) return seeValue(after, cover, o.claimant) <= 0;
	// Not lost where it landed: the cover stands, and one ply was enough.
	if (seeValue(after, cover, o.claimant) <= 0) return true;
	// Lost. Let the claimant take it with the cheapest man that can, and ask again.
	const takers = capturersOn(after, cover, o.claimant);
	if (!takers.length) return true;
	let cheapest = takers[0];
	for (const t of takers) if (V[after.get(t)?.role ?? 'pawn'] < V[after.get(cheapest)?.role ?? 'pawn']) cheapest = t;
	return discharged(shifted(after, cheapest, cover), o);
}

/**
 * Γ for the whole complex.
 *
 * The cost bound is `deadline` — a structural bound, not a deadline test.
 *
 * The side at stake has `deadline` tempi at most, and that only when they move
 * first; `tempiLeft` is `deadline` or `deadline - 1` and never more. So a
 * discharge costing more can never arrive under ANY turn, and excluding it is a
 * fact about the board rather than about the node.
 *
 * The first version bounded at `deadline + 1` "to leave the traversal slack".
 * There is no slack to leave — the extra tempo cannot exist — and it made Γ read
 * as offering answers to a checkmate, which is exactly the confusion moving the
 * comparison was meant to end.
 */
export function gamma(c: Complex): Discharge[] {
	const board = c.board;
	const edges: Discharge[] = [];

	// One walk per (piece, limit), reused across every obligation and both sides.
	// Keyed on both, because a walk to depth 2 is not a walk to depth 5 and
	// stashing the limit on the returned object would make the cache lie the
	// first time two obligations with different deadlines asked about one piece.
	// ---------------------------------------------------------------------------
	// THE QUEEN THAT WILL BE STANDING THERE.
	//
	// Will:
	//
	//   "When we do the first scan and register the promotion ray, we should also
	//    register a potential queen already standing on that square contingent upon
	//    the promotion. We build graph with this queen there, so notably the a1
	//    promotion would be interceptable in the race … That makes the whole thing
	//    seeable at time 1, no iterations."
	//
	// The first attempt at this registered EDGES from the pawn's square — every
	// square a queen on the promotion square would bear on, at cost `pushes + 1`.
	// It fired on 11.8% of plies and changed nothing, and the reason is the
	// difference between an edge and a piece: ♕d8 does not bear on a1, so no edge
	// existed. ♕d8–d1 does, and only a PIECE can travel.
	//
	// So the contingent queen is a piece on a board. `after` is when she exists —
	// the pushes it takes — and everything Γ already knows how to ask of a piece,
	// it can ask of her: `bear` walks her moves, `reach` measures her journeys, and
	// the answer is offset by the time she takes to arrive.
	//
	// The discharge is attributed to the PAWN, because the pawn is what actually
	// moves, and because every consumer checks that a man still stands there — so a
	// pawn that is captured takes its future queen with it for free.
	// ---------------------------------------------------------------------------
	type Contingent = { side: Color; pawn: Square; at: Square; after: number; board: Board; walk: Reach | null };
	const contingent: Contingent[] = [];
	for (const sq of board.occupied) {
		const pc = board.get(sq);
		if (pc?.role !== 'pawn') continue;
		const last = pc.color === 'white' ? 7 : 0;
		const step = pc.color === 'white' ? 8 : -8;
		const pushes = Math.abs(last - (sq >> 3));
		if (pushes < 1 || pushes > PROMO_HORIZON) continue;
		// She only exists if the pawn can get there. A blocked road is no promise.
		let clear = true;
		for (let n = 1; n <= pushes; n++)
			if (board.occupied.has((sq + step * n) as Square)) { clear = false; break; }
		if (!clear) continue;
		const at = (sq + step * pushes) as Square;
		const b = board.clone();
		b.take(sq);
		b.set(at, { color: pc.color, role: 'queen' });
		contingent.push({ side: pc.color, pawn: sq, at, after: pushes, board: b, walk: null });
	}

	const walks = new Map<number, Reach>();
	const walk = (p: Square, limit: number) => {
		const k = p * 16 + Math.min(limit, 15);
		let r = walks.get(k);
		if (!r) walks.set(k, (r = reach(board, p, { limit })));
		return r;
	};

	// Absolute pins delete edges rather than being checked per move — §2.1.
	const pinned: Record<Color, Map<Square, ReturnType<typeof pinsFor> extends Map<Square, infer S> ? S : never>> = {
		white: pinsFor(board, 'white'),
		black: pinsFor(board, 'black'),
	};
	const mayGo = (side: Color, p: Square, to: Square): boolean => {
		const ray = pinned[side].get(p);
		return ray === undefined || ray.has(to);
	};

	// The registered rays, once. `contingent` rows are never live — `isLive` is
	// false for them by construction — so this is the only place anything reads
	// them, and they are read as a lookup table rather than walked per edge.
	const rays = c.obligations.filter((o) => o.contingent && isMateWeight(o.weight));

	for (let i = 0; i < c.obligations.length; i++) {
		const o = c.obligations[i];
		// A latent row is a square to watch, not a debt. Asking who discharges
		// something nobody has claimed fills Γ with covers for claims not made.
		if (!isLive(o, board)) continue;

		// The side whose material is at stake. Read off the row, never passed in.
		const side = other(o.claimant);
		const limit = o.deadline;
		const target = board.get(o.square);

		// TWO BOARDS, because a discharge either PREVENTS the claim or SURVIVES it.
		//
		//   now   the position as it stands. Capturing the traveller and blocking
		//         its route happen here, before anything has arrived — asking them
		//         on a board where the piece has already moved is nonsense.
		//   then  the position the row's weight was measured on: the traveller
		//         standing where it bears. Evading and defending have to answer
		//         THAT, or a piece "escapes" to a square the claim already covers.
		//
		// One board for both was the first version and it was wrong in one
		// direction whichever board it picked.
		const now = board;
		const then = stressed(board, o);
		const mateRow = isMateWeight(o.weight) || !Number.isFinite(o.weight);

		// YOU MAY ALWAYS PAY MATERIAL TO AVOID BEING MATED, and `eeBaG` is what
		// happens when that is not said.
		//
		// Γ refuses a capture that loses material — `V[prize] - seeValue(after) < 0`
		// — and `survivesTheAnswer` refuses a block whose piece is taken. Both are
		// right for a row worth a rook and WRONG for a row worth the game: after
		// ♞d7–f8+, ♖f6×f8 answers the check and costs White two points because the
		// king recaptures, so the gate threw it away and the complex reported a mate
		// that is not one.
		//
		// Will: "d7f8 is actually an error because it is discharged by white's
		// response f6xf8 — an exchange of total value +2 after king captures rook on
		// f8, but not a mate."
		//
		// A mate is not a quantity to be traded against; it is the end of the game.
		//
		// NARROW, AND MEASURED THAT WAY. Waiving the gate for every capture of a mate
		// row cost thirty points on mate-in-one — 89.7% to 58.6%, with a quarter of
		// the plies choosing a move that is not mate. Γ's `limit` is the row's
		// DEADLINE, so a mate row admits cost-2 answers, and letting those ignore
		// material as well hands the defender two free moves and any price. Real
		// mates started looking answerable.
		//
		// FOUR VERSIONS OF THIS WERE MEASURED. Recording them because each failure
		// said something the next one needed:
		//
		//   waive the price entirely            58.6% — "capture with anything"
		//                                       answers nearly every check.
		//   waive it only at cost 1             60.9% — same thing, one ply cheaper.
		//   + `survivesTheAnswer` on captures   89.7% — better, and still refuses
		//                                       ♕g6×h6 in `vJZmr` because g5×h6 is
		//                                       check AGAIN. Check is not mate: the
		//                                       king walks to h7 and the game goes on.
		//   + only "the king may not capture     100% of plies play a mate.
		//     into check"
		//
		// What the price gate was really doing for a mate row was stopping the king
		// from taking a defended checker — and `discharged()` cannot see that,
		// because the king has left the row's square. Said directly below, it is the
		// only condition a mate-answering capture needs.
		//
		// The recapture test belongs to a BLOCK, where what the recapture renews is
		// the same claim, and it stays there.
		// ---- 1. evade. Only the piece standing there, and only somewhere safe.
		if (target && target.color === side) {
			for (const [to, d] of walk(o.square, 1).dist) {
				if (d !== 1) continue;
				if (!mayGo(side, o.square, to)) continue;
				const walked = shifted(then, o.square, to);
				if (seeValue(walked, to, o.claimant) > 0) continue;
				// AN ESCAPE THAT ARMS A REGISTERED RAY IS NOT AN ESCAPE.
				//
				// The same test the capture branch makes, and it has to be here or the
				// whole mechanism has a hole the shape of a king capture. `ohoTK`:
				// 1…♜×h2+ and White's only answer is ♔×h2 — which Γ files as an EVADE,
				// because the man on the row's square is the one that moves. Wired into
				// captures alone the check never ran, ♛f5–h5 was never consulted, and a
				// mate in three priced as winning a pawn.
				if (mateRow && armsARegisteredMate(walked, o, rays)) continue;
				edges.push({ obligation: i, kind: 'evade', piece: o.square, to, cost: 1 });
			}
		}

		// ---- 2. capture the attacker, at no net loss, and it must discharge.
		//
		// ON THE SQUARE IT ARRIVES AT, NOT ONLY THE ONE IT STANDS ON.
		//
		// `attackersOf` answers `[o.from]` for an arrival row — where the traveller
		// is NOW. So the defender's most ordinary reply to "the knight comes to g5
		// and mates" — take it on g5 — was not in Γ at all, and rows like that came
		// out with no discharge whatever. `XH0pd`: `white wins K on h7 by e4->g5 in
		// 2, discharges(0)`, when h6×g5 is right there. Twenty of thirty-five White
		// moves then scored ∞, because a claim nobody can answer is collected
		// whatever the claimant actually plays.
		//
		// Will: "it's an exchange." The arrival square is WHERE THE EXCHANGE
		// HAPPENS, and a defender bearing on it is a participant in it. That the
		// weight deliberately ignores what the arrival square costs (measured, twice,
		// both repairs worse) is a statement about PRICE; whether the claim can be
		// answered at all is a different question and this is its answer.
		//
		// Tested on `then` — the board with the traveller standing on `via` — because
		// that is the board the row is a claim about, and it is the same board
		// `evade` is already gated on.
		const spots: { at: Square; on: Board; bound: number }[] = [];
		for (const a of attackersOf(board, o))
			// A pawn on its way to promoting stands on its own square for one move.
			spots.push({ at: a, on: now, bound: o.kind === 'promotion' && o.from !== undefined ? 1 : limit });
		if (o.kind === 'arrival' && o.via !== undefined && o.via !== o.from)
			spots.push({ at: o.via, on: then, bound: limit });
		// A CAPTURE MUST CATCH IT WHERE IT WILL BE.
		//
		// The mirror of the block bound below, and the same position found it. After
		// `d4–d5` in `JHGmH`, Black's ♚b3 was credited with capturing the pawn on d5
		// at cost 2 — but the pawn stands on d5 for exactly one of Black's moves and
		// is on d6 by the time the king arrives. Γ measured the journey against a
		// board where the target never moves.
		//
		// To BLOCK you must be there before it arrives; to CAPTURE you must be there
		// while it is there. So a promotion's pawn can be taken on its own square
		// within one move and not after, and everything else keeps `limit`.
		// EVERY SQUARE THE PAWN WILL STAND ON is a place to take it, each with its own
		// deadline, because it is standing there only on the move it arrives.
		//
		// Bounding the capture to the pawn's CURRENT square deleted the entire ending:
		// 1.♔e4 a5 2.♔d3 a4 3.♔c2 a3 4.♔b1 a2 5.♔×a2 is five moves for five moves and
		// is how a king catches a runner. The pawn is on a2 after four of its own
		// moves, so the king has five to be there — `when + 1`, since to BLOCK you
		// must arrive before it and to CAPTURE you must arrive while it is there.
		if (o.kind === 'promotion' && o.from !== undefined) {
			for (const r of [...o.needs, o.square]) {
				const when = Math.abs((r >> 3) - (o.from >> 3));
				if (when < 1) continue;
				spots.push({ at: r, on: shifted(board, o.from, r), bound: when + 1 });
			}
		}
		for (const { at: a, on, bound } of spots) {
			const prize = on.get(a);
			if (!prize) continue;
			for (const p of on[side]) {
				if (p === a) continue;
				const cost = distance(walk(p, limit), a);
				if (!Number.isFinite(cost) || cost < 1 || cost > Math.min(limit, bound)) continue;
				if (cost === 1) {
					if (!mayGo(side, p, a)) continue;
					const after = shifted(on, p, a);
					if (mateRow) {
						// ANY PRICE — but the king may not capture into check.
						//
						// `survivesTheAnswer` was tried here and is too strict for a capture:
						// it treats "in check again after the recapture" as "still mated".
						// `vJZmr`, ♕h5–h6+: Black answers ♕g6×h6, White retakes g5×h6+, and
						// Black is in check and NOT mated — the king walks to h7. Refusing
						// that made three checks read as mate.
						//
						// The recapture test belongs to a BLOCK, where the claim it renews is
						// the same claim. For a capture the only thing the price gate was
						// really doing is stopping the king from taking a defended checker,
						// and `discharged()` cannot see that because the king has left the
						// row's square. So that is said directly.
						if (p === o.square && seeValue(after, a, o.claimant) > 0) continue;
						// AN ANSWER THAT WALKS INTO MATE IS NOT AN ANSWER.
						//
						// `ZzxhN`: ♛e6–e1+ and White has exactly ONE legal reply, ♖a1×e1 —
						// after which ♜e8×e1 is mate. Γ saw the check answered at a cost of
						// one tempo and priced the queen sacrifice at +4.10.
						//
						// This is the general shape of the sacrifice class: a discharge is
						// judged against the row it discharges and never against what it
						// creates. Here the created thing is the SAME row, so
						// `survivesTheAnswer` reaches it — the covering rook is taken and
						// the king is attacked again.
						//
						// But "the claim returns" is not enough on its own: in `vJZmr`,
						// ♕g6×h6 is answered by g5×h6 WITH CHECK and the king simply walks
						// to h7. That is a check, not a mate, and refusing it cost ten
						// points when it was tried. The discriminator is whether the king
						// has anywhere to go once the claim returns — no flight square is
						// what makes `ZzxhN` mate and `vJZmr` not.
						if (answerWalksIntoMate(after, o, a)) continue;
						// …AND AN ANSWER THAT ARMS A REGISTERED RAY IS NOT ONE EITHER.
						// The same test, asked of the claimant's other rays rather than of
						// this one. See `armsARegisteredMate`.
						if (armsARegisteredMate(after, o, rays)) continue;
					} else if (V[prize.role] - seeValue(after, a, o.claimant) < 0) continue;
					if (!discharged(after, o)) continue;
				}
				edges.push({ obligation: i, kind: 'capture', piece: p, to: a, cost });
			}
		}

		// ---- 3. block the line. No valuation gate; a costly block is priced.
		//
		// A BLOCK MUST ARRIVE BEFORE THE THING IT BLOCKS.
		//
		// The route squares of a promotion are the squares the PAWN WALKS THROUGH,
		// and it reaches the j-th of them on its j-th move. A blocker that needs
		// three moves to stand on the first of them is not blocking anything — the
		// pawn was there two moves earlier and has gone.
		//
		// `JHGmH` after `d4–d5`: Black's ♚b3 was credited with blocking on d6 at cost
		// 3, so White's promotion read as answered while Black's read as unstoppable,
		// and the move that wins the race priced at −8.00. The pawn is on d6 after
		// White's FIRST push; b3–c4–d5–d6 arrives two moves after that, onto a square
		// that is occupied.
		//
		// So the bound for a route square is when the pawn gets there, not when the
		// row falls due. `limit` still bounds everything else.
		const pawnAt = (r: Square): number =>
			o.kind === 'promotion' && o.from !== undefined ? Math.abs((r >> 3) - (o.from >> 3)) : limit;
		for (const r of lineOf(board, o)) {
			const bound = Math.min(limit, pawnAt(r));
			for (const p of board[side]) {
				if (p === o.square) continue;
				const cost = distance(walk(p, limit), r);
				if (!Number.isFinite(cost) || cost < 1 || cost > bound) continue;
				if (cost === 1) {
					if (!mayGo(side, p, r)) continue;
					const after = shifted(now, p, r);
					if (!discharged(after, o)) continue;
					// A block that is taken and renews the claim is still no answer to a
					// mate — but a block that is taken and ENDS it is, whatever it costs.
					if (!survivesTheAnswer(after, o, r)) continue;
					// …nor is a block that opens a different registered line. Same test
					// again; see `armsARegisteredMate`.
					if (mateRow && armsARegisteredMate(after, o, rays)) continue;
				}
				edges.push({ obligation: i, kind: 'block', piece: p, to: r, cost });
			}
		}

		// ---- 4. defend. BEARING, gated by §1.5's cheap-attacker lemma.
		//
		// Not gated on a piece standing on S: a promotion square is empty, and
		// the lemma is about the piece being defended. With no piece the worth is
		// zero and every attacker clears the bar.
		const cheapest = Math.min(...attackersOf(board, o).map((a) => V[board.get(a)?.role ?? 'pawn']));
		const worth = target ? V[target.role] : 0;
		if (Number.isFinite(cheapest) && cheapest >= worth) {
			for (const p of board[side]) {
				if (p === o.square) continue;
				const cost = bear(board, p, o.square, walk(p, limit));
				if (cost < 1 || cost > limit) continue;
				edges.push({ obligation: i, kind: 'defend', piece: p, to: o.square, cost });
			}

			// …and the queen who is not there yet. See the register above.
			//
			// `after` is when she exists and `bear` is how long she then takes, so the
			// price is the sum — and it is the price of a PIECE travelling, which is
			// the whole difference from the version that registered edges. ♕d8 does
			// not bear on a1; ♕d8–d1 does, and only a piece can make that move.
			for (const q of contingent) {
				if (q.side !== side) continue;
				if (!board.get(q.pawn)) continue; // pawn gone, queen with it
				if (q.after >= limit) continue; // she arrives after the row is due
				if (q.walk === null) q.walk = reach(q.board, q.at, { limit });
				const travel = bear(q.board, q.at, o.square, q.walk);
				if (travel < 1) continue;
				const cost = q.after + travel;
				if (cost > limit) continue;
				edges.push({ obligation: i, kind: 'defend', piece: q.pawn, to: o.square, cost });
			}
		}
	}
	return edges;
}

/** The cheapest discharge of each obligation, or Infinity. */
export function arrives(c: Complex, edges: Discharge[] = gamma(c)): number[] {
	const best = c.obligations.map(() => Infinity);
	for (const e of edges) best[e.obligation] = Math.min(best[e.obligation], e.cost);
	return best;
}

/**
 * How many tempi the side at stake actually has before `o` is collected.
 *
 * The arithmetic `tauStar` did, stated where it belongs: as a function of the
 * NODE's turn rather than as a field on the row. The claimant needs `deadline`
 * of their own moves; moves alternate; so the other side gets one fewer when the
 * claimant moves first.
 *
 * Exported so the traversal can tick it, and so nothing else has to know it.
 */
export const tempiLeft = (o: Obligation, turn: Color): number =>
	turn === o.claimant ? o.deadline - 1 : o.deadline;

/** Whether each obligation has a discharge that arrives, given whose turn it is. */
export function coverable(c: Complex, edges: Discharge[] = gamma(c)): boolean[] {
	const best = arrives(c, edges);
	return c.obligations.map((o, i) => best[i] <= tempiLeft(o, c.turn));
}

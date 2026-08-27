// A pawn that cannot be caught is already a queen.
//
// ---------------------------------------------------------------------------
// Will, on puzzle gbaJ7: "detector is missing the race to promotion. Black takes
// the pawn, white cannot answer in a way that prevents black from promoting
// because both black knight and black king are further away in move graph than
// the number of moves for the pawn to promote."
//
// That is not a depth problem. I measured it at depths 4, 6 and 8: the key move
// scores -130 at every one of them, because the promotion sits four plies past
// where the search stops and the search has no static evaluation to notice it.
// Deepening moves the horizon; it does not remove it.
//
// The formalism already says what is happening. A passed pawn on a clear path is
// an OBLIGATION on the defender, and the covering condition (§3) asks whether any
// move resolves it. Here the answer is decidable without search: a defender can
// only resolve the obligation by occupying or attacking a square on the pawn's
// path, so the question is a distance in the move graph (§5, mobilisation) —
// how many moves does the nearest defender need, against how many pushes the
// pawn needs. If every defender is further away than the pawn is from the eighth
// rank, no move covers, the obligation is uncoverable, and the pawn's value is
// what it becomes rather than what it is.
//
// Two rules keep this from inventing wins, which is the failure mode that
// matters:
//
//   * The test is one-sided in the defender's favour at every step. Interception
//     distances ignore pins, checks and legality; the king's distance ignores
//     enemy control. Every one of those makes the defender look FASTER than it
//     is, so a pawn only counts as unstoppable when it is unstoppable with room
//     to spare.
//   * Blocking the pawn and taking the queen when it lands are separate
//     deadlines, and the second one is a whole move later. A defender that only
//     covers the promotion square does not have to hurry.
//
// The result is a term that fires rarely and is nearly always right when it does,
// which is the correct trade for a leaf evaluation: a missed race costs one
// puzzle, an invented one corrupts every position that contains a pawn.
// ---------------------------------------------------------------------------

import { attacks } from 'chessops/attacks';
import { SquareSet } from 'chessops/squareSet';
import type { Chess } from 'chessops/chess';
import type { Board } from 'chessops/board';
import type { Color, Square } from 'chessops/types';
import { V, other, capturersOn } from './exchange';

/** What the pawn turns into, net of what it already counts for. */
export const PROMOTION_GAIN = V.queen - V.pawn;

/**
 * Only pawns this close to promotion are considered.
 *
 * Not a performance dodge — though it is also that. Beyond three pushes the
 * defender has enough moves that "nobody is within reach" stops being a
 * statement about a race and starts being a statement about the position being
 * quiet, and the interception model (static occupancy, no legality) is too crude
 * to carry that weight.
 */
const MAX_PUSHES = 3;

/**
 * The defender gets one move AFTER the pawn arrives.
 *
 * Blocking the pawn and capturing the new queen are different questions with
 * different deadlines: a blocker has to be on a path square before the pawn
 * gets there, but a piece that merely attacks the promotion square can wait and
 * take the queen when it appears. Treating both as "interception in `tempi`"
 * would claim a clean queen in every position where the promotion square is
 * covered — the most common way this term could invent a win.
 */
const ARRIVAL_SLACK = 1;

/**
 * What each remaining push costs.
 *
 * A queen three moves from now is not a queen now: while the pawn walks, the
 * defender has that many free moves to do something else with, and this term
 * cannot see what. Charging for the walk is the difference between "this pawn
 * decides the game" and "this pawn decides the game unless something faster is
 * happening" — and the second is the true statement. Set by measurement, not by
 * taste: at 0 the term was right about 24 of the plies it changed and wrong
 * about 7; the cases it broke were all positions where a tactic won sooner.
 */
export const PER_PUSH = 100;

const rankOf = (sq: Square) => sq >> 3;
const fileOf = (sq: Square) => sq & 7;

/**
 * Every way this pawn can reach the eighth rank in at most `max` moves.
 *
 * Will: "correctness would include paths where pawn for example makes a diagonal
 * move by capturing." Quite right — a pawn's move graph is not its file. A
 * blocked file is not a blocked pawn if it can take its way past, and a pawn with
 * two routes is harder to stop than one with a single route, not easier.
 *
 * Each path is the list of squares the pawn will stand on, promotion square
 * last. Enumerating them all matters for soundness in the other direction too:
 * a path counts as unstoppable only if the defender cannot cover THAT path, and
 * having several routes means the defender has to cover several.
 */
function pathsFrom(pos: Chess, from: Square, c: Color, max: number): Square[][] {
	const step = c === 'white' ? 8 : -8;
	const last = c === 'white' ? 7 : 0;
	const home = c === 'white' ? 1 : 6;
	const them = other(c);
	const out: Square[][] = [];

	const walk = (sq: Square, sofar: Square[]) => {
		if (sofar.length >= max) return;
		const file = fileOf(sq);
		// A push, to an empty square.
		const ahead = sq + step;
		if (ahead >= 0 && ahead < 64 && pos.board.get(ahead) === undefined) {
			const next = [...sofar, ahead];
			if (rankOf(ahead) === last) out.push(next);
			else {
				walk(ahead, next);
				// The double step, which is a single move.
				const jump = ahead + step;
				if (
					rankOf(sq) === home &&
					sofar.length === 0 &&
					pos.board.get(jump) === undefined &&
					rankOf(jump) !== last
				) {
					walk(jump, [...sofar, jump]);
				}
			}
		}
		// A capture, on either diagonal.
		for (const df of [-1, 1]) {
			const nf = file + df;
			if (nf < 0 || nf > 7) continue;
			const to = sq + step + df;
			if (to < 0 || to > 63) continue;
			const victim = pos.board.get(to);
			if (!victim || victim.color !== them || victim.role === 'king') continue;
			const next = [...sofar, to];
			if (rankOf(to) === last) out.push(next);
			else walk(to, next);
		}
	};

	walk(from, []);
	return out;
}

/**
 * Fewest moves for the piece on `from` to land on any square in `targets`.
 *
 * A breadth-first walk of the piece's own move graph, over the CURRENT
 * occupancy: sliders are blocked by whatever is in the way, the king walks one
 * square at a time, the knight hops. Legality is ignored — a pinned piece is
 * treated as free to move, and the king as free to walk into check — because
 * every such simplification makes the defender arrive sooner, and arriving
 * sooner is the answer that keeps this function from claiming a win.
 */
export function movesToReach(board: Board, from: Square, targets: SquareSet, limit: number): number {
	const piece = board.get(from);
	if (!piece) return Infinity;
	if (targets.has(from)) return 0;
	const own = board[piece.color];
	let frontier = SquareSet.empty().with(from);
	let seen = frontier;
	for (let d = 1; d <= limit; d++) {
		let next = SquareSet.empty();
		for (const sq of frontier) {
			// `attacks` from a square the piece is not standing on is exactly the
			// right question for a slider — the ray is blocked by the real board,
			// which is what makes this a distance in the move graph and not a
			// distance on an empty one.
			const to = attacks({ role: piece.role, color: piece.color }, sq, board.occupied).diff(own);
			if (!to.intersect(targets).isEmpty()) return d;
			next = next.union(to.diff(seen));
		}
		if (next.isEmpty()) return Infinity;
		seen = seen.union(next);
		frontier = next;
	}
	return Infinity;
}

/**
 * The board as it will be when the pawn arrives, if nobody interferes.
 *
 * Not a prediction — the interception test has already established that nobody
 * CAN interfere along this path. This is what that walk leaves behind: the
 * captured pieces gone, a queen on the last square. It exists so the question
 * "and is the queen safe when it gets there" can be asked of a real board rather
 * than guessed at.
 */
/**
 * The board with the pawn gone from where it stands, and nothing else changed.
 *
 * This is the board every distance in the race has to be measured on, and using
 * the CURRENT one was a real bug: on `rF0aS` a white pawn on a7 stood between a
 * black rook on a2 and the promotion square, so the rook's path to a8 measured
 * as impossible and the term awarded a free queen. The pawn is the last thing
 * that will be in the way — it is the piece that moves.
 *
 * It cuts the other way too, which is why it is the right board rather than a
 * patch: a defender whose only route ran through the pawn's square gets that
 * route back, and a defender is exactly who this term must not underestimate.
 */
function vacated(pos: Chess, from: Square, path: Square[]) {
	const board = pos.board.clone();
	board.take(from);
	// Anything the pawn captures on the way is gone too — it cannot both be
	// taken and still be blocking a line.
	for (const sq of path) board.take(sq);
	return board;
}

function afterWalk(pos: Chess, from: Square, c: Color, path: Square[]) {
	const board = pos.board.clone();
	board.take(from);
	for (const sq of path) board.take(sq);
	board.set(path[path.length - 1], { role: 'queen', color: c });
	return board;
}

/**
 * What the pawn is worth when it arrives — 0 if it never gets there.
 *
 * Two separate questions, and conflating them is what made the first version of
 * this both too strict and too crude:
 *
 *   * Can the walk be interrupted? A defender that can LAND on a square of the
 *     path in time stops it, and so does one that can capture the pawn where it
 *     stands.
 *   * Is the queen safe on arrival? A defender that merely covers the promotion
 *     square does not have to hurry — it can wait and take. But if we cover that
 *     square too, the capture is an exchange rather than a windfall, and if the
 *     only piece that can reach it is the KING then a defended queen cannot be
 *     taken at all. That last case is exactly Will's FJV4Y: ...Rc1 both shuts the
 *     rook out of the first rank and defends the promotion square, which is why
 *     it is the move, and it is decidable here without any search.
 *
 * `toMove` is who is on move, which decides how many moves the defender gets.
 */
export function raceGain(pos: Chess, from: Square, c: Color, toMove: Color): number {
	const them = other(c);
	let best = 0;

	for (const path of pathsFrom(pos, from, c, MAX_PUSHES)) {
		const pushes = path.length;
		// Moves the defender gets before the pawn lands. If the defender is on move
		// they get one more; the pusher's own last move ends the race.
		const tempi = pushes - 1 + (toMove === c ? 0 : 1);

		let onTheWay = SquareSet.empty().with(from);
		for (const sq of path) onTheWay = onTheWay.with(sq);
		const promo = path[path.length - 1];
		const arrival = SquareSet.empty().with(promo);

		// Distances are measured on the board the pawn will have left behind.
		const open = vacated(pos, from, path);
		let interrupted = false;
		let kingReaches = false;
		let cheapestReacher = Infinity;
		for (const sq of pos.board[them]) {
			if (movesToReach(open, sq, onTheWay, tempi) <= tempi) {
				interrupted = true;
				break;
			}
			if (movesToReach(open, sq, arrival, tempi + ARRIVAL_SLACK) > tempi + ARRIVAL_SLACK) continue;
			const piece = pos.board.get(sq);
			if (!piece) continue;
			if (piece.role === 'king') kingReaches = true;
			else if (V[piece.role] < cheapestReacher) cheapestReacher = V[piece.role];
		}
		if (interrupted) continue;

		// Is the square ours when the queen lands on it?
		const guarded = capturersOn(afterWalk(pos, from, c, path), promo, c).length > 0;

		const walk = PER_PUSH * (pushes - 1);
		let gain: number;
		if (cheapestReacher === Infinity) {
			// At worst the king is coming, and a king cannot take a defended piece.
			gain = !kingReaches || guarded ? PROMOTION_GAIN - walk : 0;
		} else if (guarded) {
			// They can take the queen, we take back: we are ahead by what we
			// recapture, less the pawn we no longer have. A rook for a queen leaves
			// 400; a pawn for a queen leaves nothing worth claiming.
			gain = Math.max(0, cheapestReacher - V.pawn - walk);
		} else {
			// The queen appears and is taken for free. That is not a race.
			gain = 0;
		}
		best = Math.max(best, gain);
	}
	return best;
}

/** The boolean form: is this pawn worth more than the pawn it is? */
export function unstoppable(pos: Chess, from: Square, c: Color, toMove: Color): boolean {
	return raceGain(pos, from, c, toMove) > 0;
}

/**
 * Does this side have a passer nobody can catch, and is it worth checking at all?
 *
 * The cheap gate first: a pawn far enough advanced, on an empty file ahead. Most
 * positions leave this function after the gate.
 */
function bestRace(pos: Chess, c: Color, toMove: Color): number {
	let best = 0;
	const pawns = pos.board.pieces(c, 'pawn');
	for (const sq of pawns) {
		const dist = c === 'white' ? 7 - rankOf(sq) : rankOf(sq);
		if (dist === 0 || dist > MAX_PUSHES) continue;
		const gain = raceGain(pos, sq, c, toMove);
		if (gain > best) best = gain;
	}
	return best;
}

/**
 * The race, priced from the side to move's point of view.
 *
 * One pawn at most per side: two unstoppable passers do not win two queens, they
 * win the game once. Both sides having one is a wash at this resolution, which is
 * the honest answer — which pawn arrives first is a tempo question this term
 * deliberately does not try to settle.
 */
export function raceValue(pos: Chess): number {
	const c = pos.turn;
	const mine = bestRace(pos, c, c);
	const theirs = bestRace(pos, other(c), c);
	return mine - theirs;
}

/** Cheap precondition: is there any pawn advanced enough for the term to fire? */
export function anyCandidate(pos: Chess): boolean {
	for (const sq of pos.board.pieces('white', 'pawn')) if (rankOf(sq) >= 4) return true;
	for (const sq of pos.board.pieces('black', 'pawn')) if (rankOf(sq) <= 3) return true;
	return false;
}

/** Exported for tests and for the Lab's commentary. */
export const RACE_INTERNALS = { pathsFrom, fileOf };

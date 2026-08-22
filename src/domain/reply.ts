// What the defender does with their move.
//
// ---------------------------------------------------------------------------
// The first version of the build-up race in domain/contest.ts gave the defender
// k tempi and then let them spend those tempi on exactly one thing: bringing
// another defender to the contested square. That is not a model of a defence,
// it is a model of a defence that has agreed to co-operate.
//
// Will found it immediately. In the "pin, no defending pawn" position the
// answer to 1.e4 is not "add a defender" or "lose the knight" — it is Qg5+,
// which repairs the pin and hands the tempo straight back. The table said
// winnable; the position is nothing of the sort.
//
// So the defender's tempo buys any legal move, and the attacker's claim has to
// survive all of them:
//
//     a threat is real iff it survives the defender's best single reply
//
// Everything the escape/exposure machinery used to compute by hand — moving the
// prize, breaking the pin, blocking, counter-attacking, checking — is now one
// case of "a legal reply", which is both more correct and considerably less
// code. That the previous version needed a special column for each of those is
// what a missing generalisation looks like from the inside.
// ---------------------------------------------------------------------------

import type { Square } from 'chessops/types';
import type { Chess } from 'chessops/chess';
import { makeSquare } from './chess';
import { foldAt, VALUE } from './contest';

export type Capture = {
	/** The move, as a pair of squares. */
	from: string;
	to: string;
	/** Material won, after the exchange at the destination is resolved. */
	gain: number;
};

/**
 * The best material a side to move can win right now, by a LEGAL move.
 *
 * Legality is the point. A fold is arithmetic on a square and does not know
 * about check; if the defender's reply gives check, most of the attacker's
 * captures stop existing, and a procedure that keeps counting them is
 * describing a different game.
 */
export function bestCapture(pos: Chess, exclude?: string): Capture | null {
	let best: Capture | null = null;

	for (const [from, tos] of pos.allDests()) {
		for (const to of tos) {
			const taken = pos.board.get(to);
			if (!taken) continue;
			// The square the previous capture happened on is already settled —
			// `gain` prices the recapture there. Counting it again as a
			// "counter-threat" subtracts the same rook twice, which turned a
			// winning pin into "needs calculation".
			if (exclude !== undefined && makeSquare(to) === exclude) continue;

			const after = pos.clone();
			try {
				after.play({ from, to });
			} catch {
				continue;
			}

			// What we take, less whatever they get back on that square.
			const recapture = foldAt(after.board, to, after.turn);
			const gain = VALUE[taken.role] - recapture.value;
			if (!best || gain > best.gain) {
				best = { from: makeSquare(from), to: makeSquare(to), gain };
			}
		}
	}

	return best && best.gain > 0 ? best : null;
}

export type Reply = {
	from: string;
	to: string;
	/** What the attacker wins after this reply. */
	concedes: number;
	/**
	 * concedes − counter: what the reply costs on balance.
	 *
	 * Ranking defences by what they concede ALONE is how the model picked
	 * `f7–f5` over `Nc3` in a position where Nc3 concedes a queen and wins a
	 * rook straight back. A defence that hands something over and takes more in
	 * return is not a bad defence; it is the move.
	 */
	net: number;
	/** The attacker's best capture after it, for display. */
	best: Capture | null;
	/** True when the reply gives check, so the attacker must answer it. */
	check: boolean;
	/** What the DEFENDER threatens in return — the reason to refuse an answer. */
	counter: number;
};

/**
 * Every legal defence, and what each one concedes.
 *
 * The whole list is returned rather than the minimum, because the point of this
 * project is to show the working: "their best defence is X and it still loses
 * a piece" is a claim a learner can check, and "not winnable" is not.
 */
export function replies(pos: Chess, limit = 240): Reply[] {
	const out: Reply[] = [];
	let seen = 0;

	for (const [from, tos] of pos.allDests()) {
		for (const to of tos) {
			if (++seen > limit) return out.sort((a, b) => a.net - b.net);

			const after = pos.clone();
			try {
				after.play({ from, to });
			} catch {
				continue;
			}

			const best = bestCapture(after);
			// After the attacker collects, what does the defender have? A reply
			// that gives material back with interest is the "it is a trade, not
			// a pin" case, and it is the reason this cannot always be a number.
			let counter = 0;
			if (best) {
				const collected = after.clone();
				try {
					collected.play({
						from: parse(best.from),
						to: parse(best.to),
					});
					counter = bestCapture(collected, best.to)?.gain ?? 0;
				} catch {
					/* leave it at zero rather than guess */
				}
			}

			out.push({
				from: makeSquare(from),
				to: makeSquare(to),
				concedes: best?.gain ?? 0,
				net: (best?.gain ?? 0) - counter,
				best,
				check: after.isCheck(),
				counter,
			});
		}
	}

	return out.sort((a, b) => a.net - b.net);
}

function parse(square: string): Square {
	const file = square.charCodeAt(0) - 97;
	const rank = square.charCodeAt(1) - 49;
	return (rank * 8 + file) as Square;
}

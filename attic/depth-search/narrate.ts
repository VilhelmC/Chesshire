// The reasoning, in sentences.
//
// ---------------------------------------------------------------------------
// Will: "It's opaque and unintuitive … The generated text should be showing the
// actual logic — the thinking procedure. So it should generate text more like:
// '♙a7–a8=♕ puts white up 9 in material. Black's best response is to exchange
// rook for queen (RxQ), with white returning (RxR), putting white ahead net 4
// after the exchange. Alternative moves are worth less.'"
//
// The tree was already there — `explain` in chain.ts returns what each reply is
// worth and how many of them hold. What was missing is the step it is FOR: an
// indented list of moves and numbers is the working, not the reasoning, and
// asking someone to read the reasoning out of it is asking them to do the part
// the app is supposed to do.
//
// So this walks the principal line of that tree and says what happens, in the
// order it happens: what the move takes, what the answer is, how it settles, and
// how that compares with the alternatives. Nothing here computes anything — if a
// sentence is wrong, the search was wrong, and that is the point of it being
// legible.
// ---------------------------------------------------------------------------

import type { Chess } from 'chessops/chess';
import type { Color, NormalMove } from 'chessops/types';
import type { Branch } from './chain';

export type Narration = {
	/** What the move does on its own terms. */
	opening: string;
	/** One per ply of the forced line, in order. */
	line: string[];
	/** Where it settles, and against what else. */
	closing: string;
};

export type NarrateDeps = {
	/** The move as a person reads it, from the position it is played in. */
	name: (pos: Chess, move: NormalMove) => string;
	/** Material as words: "a rook", "4.0 pawns". */
	amount: (cp: number) => string;
	/** Play a move, for walking the line. */
	play: (pos: Chess, move: NormalMove) => Chess;
	/** Material the move takes on the spot, before any reply. */
	takes: (pos: Chess, move: NormalMove) => number;
};

const who = (c: Color) => (c === 'white' ? 'White' : 'Black');

/**
 * The number as a claim about who is ahead.
 *
 * Values in the search are from the mover's point of view, which is the right
 * convention for a negamax and the wrong one for a sentence: "-4.0" reads as a
 * loss to whoever is looking at it rather than to whoever is moving.
 */
function standing(cp: number, mover: Color, amount: (n: number) => string): string {
	if (cp === 0) return 'material level';
	const leader = cp > 0 ? mover : mover === 'white' ? 'black' : 'white';
	return `${who(leader)} ahead by ${amount(Math.abs(cp))}`;
}

export function narrate(
	pos: Chess,
	branch: Branch,
	alternatives: { move: NormalMove; score: number }[],
	d: NarrateDeps,
): Narration {
	const mover = pos.turn;
	const name = d.name(pos, branch.move);
	const takes = d.takes(pos, branch.move);

	const opening =
		takes > 0
			? `${name} wins ${d.amount(takes)} on the spot.`
			: `${name} takes nothing immediately — its value is in what follows.`;

	// Walk the principal line: the reply the opponent actually has, then ours.
	const line: string[] = [];
	let here = pos;
	let node: Branch | undefined = branch;
	let depth = 0;
	while (node && depth < 4) {
		let next: Chess;
		try {
			next = d.play(here, node.move);
		} catch {
			break;
		}
		const best: Branch | undefined = node.replies[0];
		if (!best) break;
		// Stop where the material stops moving. Walking on past the exchange added
		// a sentence like "Black has 13 replies that hold, and the best is Bb1" —
		// true, and nothing to do with why the move is good.
		if (depth >= 1 && d.takes(next, best.move) === 0) break;
		const replier = next.turn;
		// Our own continuation is a CHOICE; theirs is an answer. Describing both
		// as "replies that hold" made the line read as though we were the ones
		// being constrained — "White has 29 replies that hold" is not a fact about
		// a forced sequence, it is a fact about having a free move.
		const constraint =
			replier === mover
				? 'then plays'
				: best.forced === true
					? 'has only one legal move,'
					: node.options === 1
						? 'has one reply that holds — everything else concedes more —'
						: node.options > 1
							? `has ${node.options} replies that hold, and the best is`
							: 'answers with';
		line.push(
			`${who(replier)} ${constraint} ${d.name(next, best.move)}` +
				`${d.takes(next, best.move) > 0 ? `, taking ${d.amount(d.takes(next, best.move))}` : ''}.`,
		);
		here = next;
		node = best;
		depth++;
	}

	const settles = `That settles at ${standing(branch.value, mover, d.amount)}.`;
	const others = alternatives.filter((a) => a.score < branch.value);
	const runnerUp = alternatives.find((a) => a.score < branch.value);
	const closing =
		others.length === 0
			? `${settles} Nothing else here does better.`
			: runnerUp
				? `${settles} The best alternative, ${d.name(pos, runnerUp.move)}, is worth ` +
					`${d.amount(Math.abs(runnerUp.score))} ${runnerUp.score < 0 ? 'against' : 'to'} ${who(mover)} — ` +
					`${d.amount(branch.value - runnerUp.score)} less.`
				: settles;

	return { opening, line, closing };
}

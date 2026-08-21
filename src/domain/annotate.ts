// What happened on every move, on both sides of the board.
//
// ---------------------------------------------------------------------------
// Review scored our moves and said nothing about theirs. That is half a game.
// Worse, in a trainer built on punishment it is the wrong half to drop: the
// moment that matters most is the one where THEY went wrong and we did or did
// not take it. A review that only grades our own moves cannot show the thing
// the app exists to teach.
//
// Everything here is derived from one array — the evaluation after each ply,
// from OUR point of view — because two sources of truth is how the previous
// version ended up printing one move's score against a different move.
//
// INDEXING, ONCE AND FOR ALL. `evals[i]` is the position after i plies, so
// `evals[0]` is the starting position and the move at ply n sits between
// `evals[n - 1]` and `evals[n]`. Plies are 1-based everywhere a ply is named.
// Both storage formats are converted to this at the boundary — see
// domain/reviewable.ts — and nothing downstream is allowed a second opinion.
// ---------------------------------------------------------------------------

import { classifyQuality, type Quality } from './review';
import { classifyMove, WIN_THRESHOLD } from './classify';
import { CP_INITIAL } from './accuracy';

export type Side = 'us' | 'them';

export type Annotation = {
	/** 1-based: the move played to reach `evals[ply]`. */
	ply: number;
	side: Side;
	/** Our-POV evaluation before and after the move. */
	before: number | null;
	after: number | null;
	/**
	 * Centipawns the MOVER gave up, from the mover's own point of view.
	 *
	 * Null when either end was never evaluated. Null is not zero: a zero here
	 * would read as a perfect move, which is a claim, where null is the absence
	 * of one.
	 */
	loss: number | null;
	quality: Quality | null;
	/**
	 * Their move left us clearly better, and their move is what did it.
	 *
	 * The same test the trainer uses to decide a position is worth drilling, so
	 * "chance to punish" means the same thing in Review as it does in Train.
	 */
	opportunity: boolean;
	/** We had that chance on the move before and gave most of it back. */
	missedPunish: boolean;
	text: string;
};

/**
 * How much of a gift has to be returned before it counts as missing the chance.
 *
 * A share rather than a fixed number of centipawns: handing back 80cp of a 700cp
 * gift is an inaccuracy, and handing back 80cp of a 120cp gift is the whole
 * point of the position.
 */
export const GIVEBACK_SHARE = 0.5;

/** The smallest give-back worth calling a miss, whatever the share says. */
export const GIVEBACK_MIN_CP = 60;

/**
 * Did we squander what they just gave us?
 *
 * Two conditions, and the second is the one that keeps this honest. Handing back
 * half a gift while remaining clearly winning is not a squandered chance — it is
 * imprecision in a position that is already decided, and a card made from it
 * would teach accuracy where the game was never in doubt. WIN_THRESHOLD is the
 * trainer's own line for "this is won"; a punishment drill ends there, so a
 * missed punishment cannot begin above it either.
 *
 * Shared with the game importer, which asks the same question one ply at a time
 * while it walks a game. Two implementations would drift, and then Review and
 * the Mistakes deck would disagree about which positions counted.
 */
export function missedTheChance(gift: number, giveBack: number, after: number): boolean {
	if (after >= WIN_THRESHOLD) return false;
	return giveBack >= Math.max(GIVEBACK_MIN_CP, gift * GIVEBACK_SHARE);
}

export function annotate(evals: (number | null)[], ourColour: 'w' | 'b'): Annotation[] {
	const out: Annotation[] = [];

	for (let ply = 1; ply < evals.length; ply++) {
		// White moves on odd plies. We are the mover when the side to move before
		// this ply was ours.
		const whiteMoved = ply % 2 === 1;
		const side: Side = whiteMoved === (ourColour === 'w') ? 'us' : 'them';

		// The starting position is a known constant rather than a measurement, so
		// a missing evals[0] is filled with it rather than treated as a gap.
		const before = ply === 1 ? (evals[0] ?? CP_INITIAL) : (evals[ply - 1] ?? null);
		const after = evals[ply] ?? null;

		const measurable = before !== null && after !== null;
		// Our-POV throughout, so the mover's loss is a fall for us and a rise for
		// them. One subtraction, sign flipped by who moved.
		const loss = measurable
			? Math.max(0, side === 'us' ? before - after : after - before)
			: null;

		const opportunity =
			side === 'them' && measurable && classifyMove(before, after) === 'blunder';

		const prev = out[out.length - 1];
		const gift = prev?.opportunity ? (prev.loss ?? 0) : 0;
		const missedPunish =
			side === 'us' &&
			!!prev?.opportunity &&
			loss !== null &&
			after !== null &&
			missedTheChance(gift, loss, after);

		out.push({
			ply,
			side,
			before,
			after,
			loss,
			quality: loss === null ? null : classifyQuality(loss),
			opportunity,
			missedPunish,
			text: describe({ side, loss, after, opportunity, missedPunish }),
		});
	}

	return out;
}

/**
 * One line about the move, in the trainer's vocabulary rather than a second one.
 *
 * Their moves get a mirrored version of ours instead of silence, and the two
 * cases the app is actually about — a chance offered and a chance dropped — say
 * so plainly instead of leaving the reader to notice a number moved.
 */
export function describe(a: {
	side: Side;
	loss: number | null;
	after: number | null;
	opportunity: boolean;
	missedPunish: boolean;
}): string {
	if (a.loss === null) return 'Not evaluated.';

	const at = a.after === null ? '' : ` Position now ${signed(a.after)}.`;

	if (a.opportunity) {
		return `They went wrong — ${a.loss}cp. This is the chance to punish it.${at}`;
	}
	if (a.missedPunish) {
		return `They had just blundered and this gives ${a.loss}cp of it straight back.${at}`;
	}

	const q = classifyQuality(a.loss);
	if (a.side === 'them') {
		switch (q) {
			case 'best':
			case 'excellent':
				return `Their best try — nothing given away.${at}`;
			case 'good':
				return `Slightly loose, ${a.loss}cp, but not enough to work with.${at}`;
			case 'inaccuracy':
				return `Their inaccuracy — ${a.loss}cp.${at}`;
			case 'mistake':
				return `Their mistake — ${a.loss}cp.${at}`;
			case 'blunder':
				return `Their blunder — ${a.loss}cp.${at}`;
		}
	}

	switch (q) {
		case 'best':
			return `Best move.${at}`;
		case 'excellent':
			return `Fine — ${a.loss}cp behind the engine.${at}`;
		case 'good':
			return `Playable, ${a.loss}cp behind.${at}`;
		case 'inaccuracy':
			return `Inaccuracy — ${a.loss}cp.${at}`;
		case 'mistake':
			return `Mistake — ${a.loss}cp.${at}`;
		case 'blunder':
			return `Blunder — ${a.loss}cp.${at}`;
	}
}

/**
 * Centipawns as a chess player reads them: +1.4, −0.3.
 *
 * Rounded before formatting rather than by `toFixed`, which reads 0.85 as 0.8 —
 * binary floating point, and not something to explain in a chess app.
 */
export function signed(cp: number): string {
	const pawns = (Math.round(Math.abs(cp) / 10) / 10).toFixed(1);
	return cp >= 0 ? `+${pawns}` : `−${pawns}`;
}

/** Just one side's measured losses, for accuracy and the distribution. */
export function lossesOf(annotations: Annotation[], side: Side): number[] {
	return annotations
		.filter((a) => a.side === side && a.loss !== null)
		.map((a) => a.loss as number);
}

/** Chances they offered, and the ones we did not take. */
export function punishTally(annotations: Annotation[]): { offered: number; missed: number } {
	return {
		offered: annotations.filter((a) => a.opportunity).length,
		missed: annotations.filter((a) => a.missedPunish).length,
	};
}

// When a punishment is finished, and which way.
//
// ---------------------------------------------------------------------------
// Will: "they already did blunder — the premise of the punishment feature is
// that the opponent just blundered in their last move. You're measuring when
// the punishment is complete wrong. A better measure would probably be
// something like the punishment is complete when user moves are past giving
// back the advantage created by opponent."
//
// Two corrections in one sentence, and the second is the deeper.
//
// WHAT THE GIFT IS. It was being read off the absolute evaluation, so "what
// they gave you" and "how good your position is" were the same number. They are
// not. A blunder that takes you from −2.0 to −0.5 is a gift of 1.5 in a
// position you are still losing, and the old reading called that gift zero —
// which meant the one drill where punishing matters most had nothing to
// measure. The gift is what THEIR move cost, which the classifier already
// knows, and is passed in rather than inferred.
//
// WHAT COMPLETE MEANS. It was `ev >= WIN_CP`, an absolute bar — unreachable in
// that same −0.5 position however perfectly you play. The question is not "are
// you winning" but "is what they gave you still yours, and is it yours for
// good".
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE.
//
// It was eight lines inside `submitMove`, reachable only by driving a whole run
// against a live engine — which is to say untestable, which is how it came to
// be measuring the wrong thing for as long as it did. The same reason
// `domain/walk` and `domain/cursor` exist: the part worth pinning is the
// arithmetic, and the arithmetic has nothing to do with sessions or engines.
// ---------------------------------------------------------------------------

import { EQUAL_CP } from './book';
import { GIVEBACK_MIN_CP, GIVEBACK_SHARE } from './annotate';
import { WIN_THRESHOLD } from './classify';

/** What the opponent handed over, recorded when they did. */
export type Punishment = {
	/** Evaluation right after their mistake — where the punishment starts. */
	base: number;
	/** Centipawns their mistake cost them. What there is to take. */
	gift: number;
	/** Material balance when the phase began, so banking it is detectable. */
	material: number;
};

export type PunishOutcome = 'running' | 'realized' | 'squandered';

/** Past this the position is won outright, whatever the gift was worth. */
export const DECISIVE_CP = 250;

/**
 * Where the punishment stands.
 *
 * @param ev        evaluation now, our point of view
 * @param material  material balance now, our point of view
 */
export function punishOutcome(p: Punishment, ev: number, material: number): PunishOutcome {
	/*
	 * HELD — the evaluation has not fallen since the blunder. A tolerance,
	 * because two searches of the same position at different depths differ by a
	 * few centipawns and a drill that ended on measurement noise would be
	 * indistinguishable from one that ended on a mistake. `EQUAL_CP` is the
	 * number the rest of the app already means by "the same".
	 */
	const held = ev >= p.base - EQUAL_CP;

	/*
	 * BANKED — material has changed in your favour AND the evaluation held.
	 *
	 * This is "past giving it back" in the ordinary case: they hung something,
	 * you took it, and a piece on the board is the one form of advantage that
	 * cannot evaporate. Both halves are needed — winning a pawn while walking
	 * into a mating net is not a punishment taken.
	 */
	const banked = material > p.material && held;

	/*
	 * DOUBLED — the evaluation has risen by as much again as the gift.
	 *
	 * For the punishment that wins nothing material: a shattered king, a bind, a
	 * piece trapped rather than captured. There is no capture to bank and the
	 * conversion is real all the same, and without this such a phase could only
	 * end by being squandered.
	 */
	const doubled = p.gift > 0 && ev >= p.base + p.gift;

	if (banked || doubled || ev >= DECISIVE_CP) return 'realized';

	/*
	 * SQUANDERED — enough of the gift has gone back that there is nothing left
	 * to punish with.
	 *
	 * The same rule `domain/annotate` uses to decide a chance went by in a
	 * reviewed game, inlined here rather than imported as a function because
	 * this needs the verdict and that one needs a boolean about a different
	 * question. The constants are shared, which is the part that must not drift:
	 * the trainer and the review may not disagree about the same moment.
	 */
	if (ev >= WIN_THRESHOLD) return 'running';
	const gaveBack = p.base - ev;
	if (gaveBack >= Math.max(GIVEBACK_MIN_CP, p.gift * GIVEBACK_SHARE)) return 'squandered';

	return 'running';
}

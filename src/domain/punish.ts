// When a punishment is finished, and which way.
//
// ---------------------------------------------------------------------------
// Will: "we need to reconsider the punishment stop condition because currently
// the punishments never stop and the arbitrary slip in standing should be
// cumulative (not a maximum relative loss on a single move). … Since opponent
// can't actually give pieces to player that means the blunder consists of
// offering an exploitable gift (that can be realized one or multiple ways).
// Punishment means realizing that gift instead of squandering it. But how to
// detect when it has been realized? That would seem to be when material has
// been won corresponding to the opponents loss in position — so the potential
// gift has been backed by actual acquisition. … Is remaining exchange played
// out?"
//
// That reframing is the whole of this module, and it fixes three things at once.
//
// WHY IT NEVER STOPPED. The exits were: material moved, the evaluation rose by
// the gift AGAIN, or the score passed +2.5 outright. But every punish move has
// to be within `ACCEPT_MARGIN` of the engine's best, so what is being played IS
// the engine's line and the evaluation barely moves — which is the condition
// under which none of those three can fire. A gift with no capture in it had no
// exit at all. Removing the ply cap was right; it exposed that the realization
// test could not fire.
//
// WHY MATERIAL, AND WHY SETTLED. A gift is denominated in centipawns and paid in
// material: the one form of advantage that cannot evaporate. But the count has
// to be one you get to KEEP, and the old test read the board the instant after
// the move — so taking a defended knight read as "+3, punished" with the
// recapture still to come. Hence Will's question, and the answer is yes: the
// exchange must be played out. Not by playing the engine's line out and counting
// there — that credits you with a capture you have not made yet — but as a
// property of the position: if the side to move cannot win material, the balance
// on the board is a balance you keep. `domain/tactics.harvest` answers exactly
// that, from the position alone, with no engine call.
//
// WHY CUMULATIVE. Giving the gift back cannot happen in one move, because a move
// that loses more than `ACCEPT_MARGIN` is refused and has to be replayed. So a
// per-move test for squandering can never fire by construction: the only way to
// hand back 300cp in 60cp slices is to add the slices up.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN MODULE.
//
// It was eight lines inside `submitMove`, reachable only by driving a whole run
// against a live engine — which is to say untestable, which is how it came to be
// measuring the wrong thing for as long as it did. The same reason `domain/walk`
// and `domain/cursor` exist: the part worth pinning is the arithmetic, and the
// arithmetic has nothing to do with sessions or engines.
// ---------------------------------------------------------------------------

import { EQUAL_CP } from './book';
import { GIVEBACK_MIN_CP, GIVEBACK_SHARE } from './annotate';
import { MATE_SCORE } from './playedGames';

/** One pawn, in the engine's units. The bridge between a gift and a capture. */
export const PAWN_CP = 100;

/**
 * How much of the gift has to arrive as material before it is realized.
 *
 * Will chose two thirds with a floor of a pawn, and both halves earn their
 * place. A SHARE, because the two numbers are measured on different scales: a
 * bishop is 330 to the engine and 300 on the board, and a fork that wins a
 * knight at the cost of a pawn collects 200 of a 250 gift while leaving nothing
 * further to collect — demanding the whole gift would leave that phase running
 * forever. A FLOOR, because a share of a queen blunder is still a queen: winning
 * a pawn must not be allowed to close a drill that offered 900.
 */
export const COLLECT_SHARE = 2 / 3;
export const COLLECT_MIN_CP = PAWN_CP;

/**
 * Below this a move's loss is measurement noise, not a slip.
 *
 * Two searches of the same position at the same budget differ by a few
 * centipawns, and the slips are now ADDED UP — so without a floor a ten-move
 * conversion accumulates fifty centipawns of jitter and reports itself as
 * squandered. The same threshold the move list uses to decide something is worth
 * another look.
 */
export const SLIP_NOISE_CP = 10;

/** Quiet moves with nothing left to take, before a held gift counts as kept. */
export const QUIET_MOVES = 2;

/** What the opponent handed over, and what has become of it. */
export type Punishment = {
	/** Evaluation right after their mistake — where the punishment starts. */
	base: number;
	/** Centipawns their mistake cost them. What there is to take. */
	gift: number;
	/**
	 * Material balance when the phase began, our point of view, in pawns.
	 *
	 * The board as it stood, NOT the engine's line played out. Settling the line
	 * here would already include the capture the line is about to make, so the
	 * baseline would count the gift as collected before a move had been played
	 * and `won` would be zero for the rest of the phase.
	 */
	material: number;
	/** Centipawns handed back so far, added up across our moves. */
	given: number;
	/** Consecutive moves of ours with nothing left to take — see `QUIET_MOVES`. */
	quiet: number;
};

/** A fresh record of a gift, before anything has been done with it. */
export function offered(args: { base: number; gift: number; material: number }): Punishment {
	return { base: args.base, gift: Math.max(0, Math.round(args.gift)), material: args.material, given: 0, quiet: 0 };
}

/** Where things stand after one of our moves. */
export type Standing = {
	/** Evaluation now, our point of view. */
	ev: number;
	/** Material balance now, our point of view, in pawns. */
	material: number;
	/**
	 * Nothing is pending: the side to move cannot win material.
	 *
	 * `tactics.harvest(position).value <= 0` — and because `harvest` is net of the
	 * recapture chain, this is the guarantee the stop condition needs. They cannot
	 * IMPROVE the balance, so the balance on the board is a balance we keep.
	 */
	quiet: boolean;
	/** No material changes hands in the next several plies of the engine's line. */
	nothingLeft: boolean;
};

export type PunishOutcome = 'running' | 'realized' | 'kept' | 'squandered';

/** Material that has to arrive for the gift to count as collected. */
export function collectNeeded(gift: number): number {
	return Math.max(COLLECT_MIN_CP, Math.round(gift * COLLECT_SHARE));
}

/** Give-back that means there is nothing left to punish with. */
export function giveBackLimit(gift: number): number {
	// `domain/annotate`'s rule, which Review already uses to decide a chance went
	// by. One definition of "you gave it back", so the trainer and the review
	// cannot disagree about the same moment.
	return Math.max(GIVEBACK_MIN_CP, Math.round(gift * GIVEBACK_SHARE));
}

/** What one move's loss adds to the running total. Noise adds nothing. */
export function slip(loss: number): number {
	return loss > SLIP_NOISE_CP ? Math.round(loss) : 0;
}

/** The record, updated for a move that cost `loss` and landed in `now`. */
export function afterMove(p: Punishment, loss: number, now: Standing): Punishment {
	return {
		...p,
		given: p.given + slip(loss),
		// Reset rather than decay: two quiet moves IN A ROW is the claim, and one
		// tactical flurry in the middle means the position was not done.
		quiet: now.quiet && now.nothingLeft ? p.quiet + 1 : 0,
	};
}

/**
 * Where the punishment stands.
 *
 * Nothing here reads the absolute evaluation as an achievement. "Are you
 * winning" is a question about the whole position, most of which the blunder did
 * not create and some of which no punishment can reach; the question is whether
 * what they handed over is now yours for good.
 */
export function punishOutcome(p: Punishment, now: Standing): PunishOutcome {
	/*
	 * HELD — the evaluation has not fallen since the blunder, within the
	 * tolerance the rest of the app already means by "the same". A gift you have
	 * banked while walking into a mating net is not a punishment taken.
	 */
	const held = now.ev >= p.base - EQUAL_CP;

	// Mate is the one realization that owes nothing to material: there is no
	// capture to bank and the gift could not be more completely collected.
	if (now.ev >= MATE_SCORE) return 'realized';

	/*
	 * REALIZED — the gift has been collected, and the collection is settled.
	 *
	 * Both halves matter. `quiet` without the material is a position you have
	 * simply not converted; the material without `quiet` is a number that is
	 * about to change.
	 */
	const won = (now.material - p.material) * PAWN_CP;
	if (now.quiet && held && won >= collectNeeded(p.gift)) return 'realized';

	/*
	 * SQUANDERED — enough of it has gone back, added up, that there is nothing
	 * left to punish with. See the header on why this cannot be a per-move test.
	 */
	if (p.given >= giveBackLimit(p.gift)) return 'squandered';

	/*
	 * KEPT — you still have what they gave you, and there is nothing further to
	 * take.
	 *
	 * Will: end the no-material gifts "when it goes quiet". They wreck their own
	 * king, lock a bishop in, accept doubled pawns: the gift is real, there may
	 * never be a capture, and converting it is a whole game rather than a drill.
	 * So the phase ends when the position has gone quiet with nothing coming and
	 * the gift has held — recorded as finished, and NOT as realized, because
	 * nothing was collected and a number that counted this as a success would be
	 * measuring patience.
	 *
	 * This is also what makes the phase well-founded: every punishment now ends,
	 * by collecting, by giving back, or by running out of things to convert.
	 */
	if (held && p.quiet >= QUIET_MOVES) return 'kept';

	return 'running';
}

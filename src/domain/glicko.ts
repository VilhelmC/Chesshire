// A rating that knows how sure it is.
//
// ---------------------------------------------------------------------------
// Will: "puzzle difficulty tracking using something like elo on puzzle
// difficulty."
//
// Elo would do it, and it would be worse in the one place it matters most: the
// first fifty puzzles. Elo moves by a fixed K whatever it knows, so a beginner
// rated 1500 by default climbs to 900 twenty points at a time while being fed
// puzzles far too hard, and a settled player's rating jitters by the same
// twenty points on a coin flip. Both failures are the same failure — the
// formula has no idea how much evidence it has.
//
// This is Glicko's idea without Glicko-2's machinery: carry a DEVIATION beside
// the rating. It starts wide, narrows with every result, and widens again while
// you are away. A wide deviation makes the rating move fast, which is what
// finding your level means; a narrow one makes it steady, which is what having
// a level means. The same number then answers "how wide a band of puzzles
// should you be served" without anything else being invented for it.
//
// ---------------------------------------------------------------------------
// WHAT IS LEFT OUT, AND WHY THAT IS HONEST.
//
// Glicko-2 adds a VOLATILITY term and an iterative solve for it. It exists to
// track players whose true strength changes erratically, over rating periods
// containing many games at once. Here every result is scored the moment it
// arrives, against an opponent whose rating is fixed and known exactly — a
// puzzle does not have a bad day — so the volatility term would be estimating a
// quantity this setting does not produce. Implementing it would be arithmetic
// that looks more rigorous and measures nothing extra.
//
// The original Glicko (1995), which is what this is, was designed for exactly
// this shape: one result at a time, opponent rating known.
// ---------------------------------------------------------------------------

export type Rating = {
	/** Rating points, on the same scale as the puzzles' own. */
	r: number;
	/** How unsure. One standard deviation, in rating points. */
	rd: number;
	/** When this was last updated, so time away can widen it. */
	at: number;
};

/**
 * Where a rating with no evidence starts.
 *
 * 1500 is the scale's conventional middle and NOT a guess about the reader —
 * the deviation beside it is what says so. The corpus runs 399 to 3097 with a
 * median of 1397, so this is very nearly the middle of what can be served.
 */
export const START: Rating = { r: 1500, rd: 350, at: 0 };

/** Below this the rating is not learning anything new from each result. */
export const MIN_RD = 45;
/** A rating knows nothing more than a brand-new one, however long you are away. */
export const MAX_RD = 350;

/**
 * How fast uncertainty returns while you are not solving.
 *
 * VARIANCE per day, which is the unit the formula below adds — not rating
 * points. Written as 0.45 first, as though it were the daily widening, and the
 * result was a deviation that could not reach its own ceiling in a century: the
 * cap was unreachable and a rating from last year would have been presented as
 * nearly as trustworthy as one from yesterday.
 *
 * Twelve, chosen from the behaviour wanted at both ends and checked against it:
 * a settled rating (rd 45) widens to about 64 after a fortnight — enough to
 * keep what you established — and to about 122 after three months, which is
 * back to openly unsure.
 */
export const RD_PER_DAY = 12;

const Q = Math.log(10) / 400;

/** Glicko's g(RD): how much an opponent's own uncertainty damps a result. */
function g(rd: number): number {
	return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

/** Expected score against an opponent, 0 to 1. */
export function expected(r: number, opponent: number, opponentRd = 0): number {
	return 1 / (1 + Math.pow(10, (-g(opponentRd) * (r - opponent)) / 400));
}

/**
 * Widen a rating for the time since it was last touched.
 *
 * Applied before scoring a result rather than on a timer, because nothing
 * should be recomputing ratings while the app sits idle — and the answer is the
 * same either way.
 */
export function decayed(rating: Rating, now: number): Rating {
	if (!rating.at || now <= rating.at) return rating;
	const days = (now - rating.at) / 86_400_000;
	const rd = Math.min(MAX_RD, Math.sqrt(rating.rd * rating.rd + RD_PER_DAY * RD_PER_DAY * days));
	return { ...rating, rd };
}

/**
 * One result against a puzzle of known rating.
 *
 * @param score 1 for solved, 0 for failed. Nothing in between — a puzzle is
 *   not half solved, and a partial credit would need a claim about how much of
 *   the line counts that no one can defend.
 */
export function rate(rating: Rating, puzzle: number, score: 0 | 1, now: number): Rating {
	const cur = decayed(rating, now);
	const e = expected(cur.r, puzzle);
	// A PUZZLE HAS NO DEVIATION OF ITS OWN. Lichess's rating for it is built
	// from tens of thousands of attempts, so treating it as exact is closer to
	// the truth than any deviation this app could invent for it.
	const gRd = g(0);
	const dSquared = 1 / (Q * Q * gRd * gRd * e * (1 - e));
	const denom = 1 / (cur.rd * cur.rd) + 1 / dSquared;
	const rd = Math.sqrt(1 / denom);
	/*
	 * STORED UNROUNDED, and rounded only where it is shown.
	 *
	 * Rounding here looked tidy and silently ate the signal: solving a 600 from
	 * 1500 is worth a fraction of a point, `Math.round` turned that into zero,
	 * and a hundred easy solves in a row moved the rating not at all. A rating
	 * that cannot record small evidence is a rating that ignores most of it.
	 */
	return {
		r: cur.r + Q * rd * rd * gRd * (score - e),
		rd: Math.max(MIN_RD, rd),
		at: now,
	};
}

/**
 * The band of puzzle ratings worth serving.
 *
 * Centred on the rating and as wide as the uncertainty, with a floor so that a
 * settled rating is still offered something other than exactly its own number —
 * a diet of coin flips is correct for measuring and dull for practising.
 *
 * `hard` shifts the centre up: a puzzle you are expected to fail teaches more
 * than one you are expected to solve, and the reader can ask for that.
 */
export function band(rating: Rating, hard = 0): { low: number; high: number } {
	const width = Math.max(120, Math.round(rating.rd * 1.2));
	const centre = rating.r + hard;
	return { low: centre - width, high: centre + width };
}

/**
 * The rating and what it admits about itself, as two values.
 *
 * Two rather than one sentence because they are drawn at two sizes: a headline
 * that reads "1500 — still finding your level (±350)" in one 30px run is 400
 * points of text, and in a column narrower than that it breaks mid-phrase.
 * `describeRating` still assembles the sentence for anywhere that wants one.
 */
export function ratingParts(rating: Rating): { value: number; qualifier: string | null } {
	// The one place the rounding belongs — see `rate`.
	const value = Math.round(rating.r);
	const rd = Math.round(rating.rd);
	if (rd >= 150) return { value, qualifier: `still finding your level (±${rd})` };
	if (rd >= 80) return { value, qualifier: `± ${rd}` };
	return { value, qualifier: null };
}

/** "1450 ± 180", or just "1450" once it has settled enough to stop saying. */
export function describeRating(rating: Rating): string {
	const { value, qualifier } = ratingParts(rating);
	if (!qualifier) return `${value}`;
	// A bare tolerance follows the number; a phrase needs a dash before it.
	return qualifier.startsWith('±') ? `${value} ${qualifier}` : `${value} — ${qualifier}`;
}

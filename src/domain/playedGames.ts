// Which games are evidence of how well you play.
//
// ---------------------------------------------------------------------------
// Will, on being shown an estimate of 1640: "are you sure my estimated rating
// is 1640 - seems too high to me."
//
// He was right, and the arithmetic was not the problem. Measured on his deck:
//
//   everything, as shipped        433 moves, 51cp -> 1640
//   excluding correspondence      124 moves, 96cp -> 1321
//
// Nine of his seventeen games were chess.com DAILY games, and they were 650 of
// the 996 plies. On chess.com daily you may open an analysis board and a
// database and think for two days about one move. The centipawn loss of a
// correspondence game measures what somebody's tools can do; it is not a
// reading of them, and pooling it with live play produced a number 300 points
// above the live one and called it "your rating".
//
// So correspondence is excluded. Not down-weighted — excluded, for the same
// reason repertoire answers are: it is not the same activity.
//
// ---------------------------------------------------------------------------
// WHAT ABOUT ROWS THAT DO NOT KNOW THEIR OWN TIME CONTROL?
//
// `speed` was fetched from both sites and thrown away until now, so every game
// imported before this exists without it. Two rules, and the second matters:
//
//   * A chess.com daily game says so IN ITS URL, so those are recoverable
//     without a re-import.
//   * Anything else with no `speed` is UNKNOWN, and unknown is counted. Dropping
//     it would silently shrink the sample to whatever happened to be re-imported,
//     and the caller is told the count so the number can be read with it.
//
// This is the same treatment `transfer.ts` gives rows written before `moves`
// was kept: excluded from what they cannot support, named rather than assumed.
// ---------------------------------------------------------------------------

/** Time controls where the player is choosing moves unaided, in one sitting. */
const LIVE = new Set(['bullet', 'blitz', 'rapid', 'classical', 'ultraBullet', 'ultrabullet']);

/** …and the ones where they are not. Both sites' spellings. */
const SLOW = new Set(['correspondence', 'daily', 'unlimited']);

export type Speed = { speed?: string; url?: string };

export type SpeedVerdict = 'live' | 'correspondence' | 'unknown';

/**
 * Is this game somebody playing, or somebody analysing?
 *
 * The URL is consulted only as a fallback, and only for the one case it can
 * actually settle: chess.com puts `/game/daily/` in the address. A lichess URL
 * carries nothing about the time control, so a lichess row with no `speed` is
 * unknown and says so.
 */
export function speedOf(g: Speed): SpeedVerdict {
	const named = g.speed?.toLowerCase();
	if (named && SLOW.has(named)) return 'correspondence';
	if (named && LIVE.has(named)) return 'live';
	if (g.url && /\/game\/daily\//.test(g.url)) return 'correspondence';
	return 'unknown';
}

export type Population = {
	/** Games whose moves count towards the estimate. */
	counted: number;
	/** Games set aside because they were played with a board and a database. */
	correspondence: number;
	/**
	 * Counted, but imported before the time control was kept.
	 *
	 * Named so the number can be read with it: a sample that is mostly unknown
	 * is a sample that might quietly be correspondence.
	 */
	unknown: number;
};

/** Split a set of games into what counts and what does not. */
export function splitBySpeed<T extends Speed>(games: readonly T[]): {
	counted: T[];
	population: Population;
} {
	const counted: T[] = [];
	let correspondence = 0;
	let unknown = 0;
	for (const g of games) {
		const verdict = speedOf(g);
		if (verdict === 'correspondence') {
			correspondence++;
			continue;
		}
		if (verdict === 'unknown') unknown++;
		counted.push(g);
	}
	return { counted, population: { counted: counted.length, correspondence, unknown } };
}

/**
 * An evaluation that is a mate score rather than a quantity of centipawns.
 *
 * Sites report mate as ±9990-ish. Subtracting one of those from a centipawn
 * evaluation produces a number like 9,083 — and the largest single "loss" in
 * the deck was 19,850, which is one mate score differenced against another.
 *
 * This project has caught the same error twice already, once in `m3-gate.mjs`
 * and once in the move table's loss column, and wrote the rule down both times:
 * mate folded into ±10000 is right for ordering and meaningless as a difference.
 * It had quietly reappeared in the rating.
 */
export const MATE_SCORE = 9000;

export const isMateScore = (cp: number): boolean => Math.abs(cp) >= MATE_SCORE;

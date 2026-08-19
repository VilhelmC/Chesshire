// Bot strength, and estimating yours.
//
// ---------------------------------------------------------------------------
// How the estimate works, and what it is NOT measured on.
//
// The approach is the standard one: average centipawn loss regressed against
// known rating bands. Chess.com's per-game "estimated Elo" works this way
// (CAPS2), as does Regan's Intrinsic Performance Rating in the literature.
//
// The critical restriction is WHICH moves count. Repertoire answers must not:
// recalling a memorised move measures memory, not strength, and a trainer that
// scored it as strength would report you climbing whenever you revised. Only
// FREE PLAY moves — positions where you are genuinely choosing — are counted.
// ---------------------------------------------------------------------------

/** Average centipawn loss → Elo, interpolated between anchor points. */
const ANCHORS: [acpl: number, elo: number][] = [
	[10, 2400],
	[20, 2100],
	[35, 1850],
	[50, 1650],
	[75, 1450],
	[100, 1300],
	[150, 1100],
	[250, 900],
	[400, 700],
];

/** Below this many scored moves the estimate is not worth showing. */
export const MIN_SAMPLE = 15;

export function eloFromAcpl(acpl: number): number {
	if (acpl <= ANCHORS[0][0]) return ANCHORS[0][1];
	const last = ANCHORS[ANCHORS.length - 1];
	if (acpl >= last[0]) return last[1];

	for (let i = 1; i < ANCHORS.length; i++) {
		const [x1, y1] = ANCHORS[i - 1];
		const [x2, y2] = ANCHORS[i];
		if (acpl <= x2) {
			const t = (acpl - x1) / (x2 - x1);
			return Math.round(y1 + t * (y2 - y1));
		}
	}
	return last[1];
}

export type Estimate = {
	elo: number | null;
	acpl: number | null;
	sample: number;
	/** True once there is enough data to take the number seriously. */
	confident: boolean;
};

export function estimate(cpLosses: number[]): Estimate {
	if (!cpLosses.length) return { elo: null, acpl: null, sample: 0, confident: false };
	// Cap individual losses: one catastrophe should not dominate the mean, which
	// is the usual complaint about raw ACPL.
	const capped = cpLosses.map((x) => Math.min(Math.max(x, 0), 600));
	const acpl = capped.reduce((a, b) => a + b, 0) / capped.length;
	return {
		elo: eloFromAcpl(acpl),
		acpl: Math.round(acpl),
		sample: cpLosses.length,
		confident: cpLosses.length >= MIN_SAMPLE,
	};
}

// --- bot strength -----------------------------------------------------------

export type BotLevel = {
	level: number;
	label: string;
	/** Approximate playing strength, for the picker. */
	elo: number;
	/** Moves within this many centipawns of best are candidates. */
	window: number;
	/** Search budget in milliseconds. */
	movetimeMs: number;
};

/**
 * Eight rungs. Weakness comes mostly from widening the candidate window rather
 * than crippling the search: a shallow engine plays incoherently, while an
 * engine choosing among its own near-best moves plays like a weaker human.
 */
export const BOT_LEVELS: BotLevel[] = [
	{ level: 1, label: 'Beginner', elo: 800, window: 500, movetimeMs: 60 },
	{ level: 2, label: 'Casual', elo: 1000, window: 380, movetimeMs: 80 },
	{ level: 3, label: 'Club novice', elo: 1200, window: 280, movetimeMs: 100 },
	{ level: 4, label: 'Club', elo: 1400, window: 200, movetimeMs: 150 },
	{ level: 5, label: 'Strong club', elo: 1600, window: 140, movetimeMs: 200 },
	{ level: 6, label: 'Expert', elo: 1800, window: 90, movetimeMs: 300 },
	{ level: 7, label: 'Candidate master', elo: 2000, window: 45, movetimeMs: 500 },
	{ level: 8, label: 'Full strength', elo: 2200, window: 0, movetimeMs: 800 },
];

export function levelFor(elo: number | null): BotLevel {
	if (elo === null) return BOT_LEVELS[2];
	// Nearest rung at or below the estimate, so the bot is beatable.
	let pick = BOT_LEVELS[0];
	for (const l of BOT_LEVELS) if (l.elo <= elo + 100) pick = l;
	return pick;
}

/**
 * Rating over time, one point per run that contained free play.
 *
 * A single lifetime average hides the only thing worth knowing — whether it is
 * moving. Per-run points are noisy, so a running estimate over everything up to
 * that run is carried alongside them; the noisy series shows form, the smooth
 * one shows level.
 */
export type RatingPoint = {
	runId: string;
	ts: number;
	moves: number;
	/** Estimate from this run alone. */
	elo: number;
	/** Estimate from every scored move up to and including this run. */
	cumulative: number;
};

export function ratingSeries(
	rows: { runId: string; ts: number; cpLoss: number }[],
	minPerRun = 4,
): RatingPoint[] {
	const byRun = new Map<string, { ts: number; losses: number[] }>();
	for (const r of rows) {
		const e = byRun.get(r.runId) ?? { ts: r.ts, losses: [] };
		e.ts = Math.min(e.ts, r.ts);
		e.losses.push(r.cpLoss);
		byRun.set(r.runId, e);
	}

	const ordered = [...byRun.entries()].sort((a, b) => a[1].ts - b[1].ts);
	const running: number[] = [];
	const out: RatingPoint[] = [];

	for (const [runId, e] of ordered) {
		running.push(...e.losses);
		// A run of two moves says nothing; keep it in the cumulative figure but
		// do not plot it as a point of its own.
		if (e.losses.length < minPerRun) continue;
		out.push({
			runId,
			ts: e.ts,
			moves: e.losses.length,
			elo: estimate(e.losses).elo ?? 0,
			cumulative: estimate(running).elo ?? 0,
		});
	}

	return out;
}

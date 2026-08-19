// What you are currently practising.
//
// Replaces the five hardcoded lines and the checkbox list beside them. There is
// no list of lines any more: there is a colour, a strictness, and optionally a
// pinned position to train from and stay within.
//
// A pinned root does two jobs, and they turned out to be separable after all:
// it is the subtree a run is confined to, and — optionally — the moves that are
// played for you to get there. Wanting the second is not implied by wanting the
// first. Practising the Scotch Mieses includes practising the eleven moves that
// reach it, and having them played for you every time is the opposite of that.
// So `playFromStart` is its own toggle.
//
// Roots are a LIST. "Practise the Two Knights or the Scotch" is one intention,
// not two sessions, and interleaving unrelated openings is exactly what makes
// you notice which one you are in — the same argument that made variations
// interleave within a single opening.

import type { Strictness } from './book';
import { DEFAULT_MIN_FREQ } from './book';

export type PinnedRoot = {
	/** SAN moves from the initial position. */
	path: string[];
	/** Whatever the explorer calls it, or what the user typed. */
	name: string;
};

export type PracticeConfig = {
	colour: 'w' | 'b';
	strictness: Strictness;
	/** Share of games a move needs to count as theory. */
	minFreq: number;
	/**
	 * Openings the run is confined to. Empty means the whole opening tree.
	 * With several, each run picks one, so they interleave.
	 */
	roots: PinnedRoot[];
	/**
	 * Play the moves that reach the pinned opening yourself, from move 1, rather
	 * than having them played for you. They are part of the opening too.
	 */
	playFromStart: boolean;
	/** How often the opponent plays a real mistake instead of book. */
	deviationChance: number;
};

export const DEFAULT_PRACTICE: PracticeConfig = {
	colour: 'w',
	// 'book' rather than 'repertoire' is the honest default for someone who does
	// not yet have a repertoire: you cannot memorise a line you have not met.
	strictness: 'book',
	minFreq: DEFAULT_MIN_FREQ,
	roots: [],
	playFromStart: false,
	deviationChance: 0.35,
};

const KEY = 'offbook.practice';

export function loadPractice(): PracticeConfig {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULT_PRACTICE };
		const parsed = JSON.parse(raw) as Partial<PracticeConfig>;
		const cfg = normalise(parsed);
		// Write the migrated shape back once, so what is stored matches what is
		// used. Leaving the old single `root` key in place works — normalise runs
		// on every load — but a stored blob that no longer resembles the type is
		// exactly the kind of thing that misleads the next person to read it.
		if (!Array.isArray(parsed.roots)) savePractice(cfg);
		return cfg;
	} catch {
		return { ...DEFAULT_PRACTICE };
	}
}

/** Back to the defaults, including clearing every pinned opening. */
export function resetPractice(): PracticeConfig {
	const fresh = { ...DEFAULT_PRACTICE, roots: [] };
	savePractice(fresh);
	return fresh;
}

export function savePractice(cfg: PracticeConfig): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(cfg));
	} catch {
		/* private mode — the setting just will not persist */
	}
}

/**
 * Fill in anything missing or out of range.
 *
 * Settings are read from storage written by an older build, so every field has
 * to survive being absent or nonsense.
 */
export function normalise(raw: Partial<PracticeConfig>): PracticeConfig {
	const strictness: Strictness =
		raw.strictness === 'repertoire' || raw.strictness === 'free' || raw.strictness === 'book'
			? raw.strictness
			: DEFAULT_PRACTICE.strictness;

	const minFreq =
		typeof raw.minFreq === 'number' && raw.minFreq > 0 && raw.minFreq < 1
			? raw.minFreq
			: DEFAULT_PRACTICE.minFreq;

	const deviationChance =
		typeof raw.deviationChance === 'number' &&
		raw.deviationChance >= 0 &&
		raw.deviationChance <= 1
			? raw.deviationChance
			: DEFAULT_PRACTICE.deviationChance;

	// `root` was a single pin before; carry it forward rather than dropping
	// whatever the user had chosen.
	const legacy = (raw as { root?: PinnedRoot | null }).root;
	const candidates = Array.isArray(raw.roots) ? raw.roots : legacy ? [legacy] : [];
	const roots = candidates
		.filter((r): r is PinnedRoot => !!r && Array.isArray(r.path) && r.path.length > 0)
		.map((r) => ({
			path: r.path.filter((x) => typeof x === 'string'),
			name: r.name || 'Pinned position',
		}))
		.filter((r) => r.path.length > 0);

	return {
		colour: raw.colour === 'b' ? 'b' : 'w',
		strictness,
		minFreq,
		roots,
		playFromStart: raw.playFromStart === true,
		deviationChance,
	};
}

/** A short description of the current setting, for the run header. */
export function describePractice(cfg: PracticeConfig): string {
	const where =
		cfg.roots.length === 0
			? 'the whole opening'
			: cfg.roots.length === 1
				? cfg.roots[0].name
				: `${cfg.roots.length} openings`;
	const how =
		cfg.strictness === 'repertoire'
			? 'one answer per position'
			: cfg.strictness === 'free'
				? 'anything sound'
				: `any move played over ${(cfg.minFreq * 100).toFixed(0)}%`;
	const from = cfg.roots.length && cfg.playFromStart ? ' · from move 1' : '';
	return `${cfg.colour === 'w' ? 'White' : 'Black'} · ${where}${from} · ${how}`;
}

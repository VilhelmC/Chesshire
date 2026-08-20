// Importing games without being asked.
//
// ---------------------------------------------------------------------------
// WHY THIS IS THE URGENT PIECE
//
// The transfer measurement (domain/transfer.ts) is the only number in the app
// that is not circular — everything else measures how well you do inside the
// app, which drilling a position until you can answer it will always improve.
// It compares mistakes per game through a position before and after you first
// drilled it, and it needs four games on each side before it will say anything.
//
// Which makes game history the one thing here that cannot be caught up on. A
// scheduling improvement written next month is exactly as good as one written
// today. A month of games that were never imported is a month of evidence that
// no amount of later work recovers. Until now importing happened only when
// someone remembered to press a button.
//
// WHAT IT COSTS, AND WHO IT YIELDS TO
//
// Analysing a game runs Stockfish over every one of your positions in it, so
// this is not free and must never compete with the person actually using the
// app. `markTraining(true)` makes the import stand down, and because both
// findMistakes and importGames check `shouldCancel` between positions, it stops
// within about one search — not at the end of the game it was working on.
//
// It is capped, throttled to once a day, and it never runs without a token, a
// username, or a network.
// ---------------------------------------------------------------------------

import { importGames, getUsernames, type ImportProgress } from './importGames';
import { getToken } from './explorer';

/** Once a day. A second pass the same evening would find nothing and cost a lot. */
export const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Games per background pass.
 *
 * Small on purpose. This runs while someone is looking at a chess board on a
 * phone; the goal is that history keeps arriving, not that it arrives at once.
 */
export const BACKGROUND_MAX = 8;

/** Wait before starting, so the app is interactive first. */
export const START_DELAY_MS = 8000;

const ATTEMPT_KEY = 'offbook.lastImportAttempt';
const SUCCESS_KEY = 'offbook.lastImportSuccess';

export type SyncState = {
	running: boolean;
	/** Last time a pass finished without error. */
	lastSuccessAt: number | null;
	/** Cards added by the most recent pass. */
	added: number;
	/** Why the last pass did not work, when it did not. */
	error: string | null;
	note: string;
};

let state: SyncState = {
	running: false,
	lastSuccessAt: readTime(SUCCESS_KEY),
	added: 0,
	error: null,
	note: '',
};

const listeners = new Set<(s: SyncState) => void>();

export function syncState(): SyncState {
	return state;
}

export function subscribeSync(fn: (s: SyncState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function set(patch: Partial<SyncState>) {
	state = { ...state, ...patch };
	for (const fn of listeners) fn(state);
}

// ---------------------------------------------------------------------------
// Yielding to the person using the app
// ---------------------------------------------------------------------------

let training = false;
let cancelled = false;

/**
 * Called by the trainer while a run is live.
 *
 * The engine is single and serialised, so a background analysis queued ahead of
 * a drill move would make the app feel broken in exactly the way it did before
 * per-move cost was cut. The rule is simple enough to state: **the engine
 * belongs to whoever is looking at the screen.**
 */
export function markTraining(on: boolean): void {
	training = on;
	if (on) {
		cancelled = true;
		return;
	}
	// Retry on release, and this is not a nicety — Train is the tab the app
	// OPENS on, so without it the conditions are "training" at every startup
	// check and the import would never run at all for someone who trains and
	// closes the app. Blocked-forever and quiet look identical from outside,
	// which is exactly the failure this whole file exists to prevent.
	clearTimeout(releaseTimer);
	releaseTimer = setTimeout(() => void runBackgroundImport(), RELEASE_DELAY_MS);
}

/** Long enough that flicking through tabs does not start a search each time. */
const RELEASE_DELAY_MS = 5000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

export function cancelBackgroundImport(): void {
	cancelled = true;
}

// ---------------------------------------------------------------------------
// Whether to run at all
// ---------------------------------------------------------------------------

export type SyncConditions = {
	now: number;
	lastAttempt: number | null;
	hasUsername: boolean;
	hasToken: boolean;
	online: boolean;
	training: boolean;
};

/**
 * Pure so it can be tested, and so the reason is a value rather than a comment.
 * Returns null to run, or the reason not to.
 */
export function reasonNotToSync(c: SyncConditions): string | null {
	if (!c.online) return 'offline';
	if (!c.hasToken) return 'not signed in';
	if (!c.hasUsername) return 'no username set';
	if (c.training) return 'training';
	if (c.lastAttempt !== null && c.now - c.lastAttempt < MIN_INTERVAL_MS) return 'synced recently';
	return null;
}

// ---------------------------------------------------------------------------
// The pass itself
// ---------------------------------------------------------------------------

export async function runBackgroundImport(
	opts: { force?: boolean; now?: number } = {},
): Promise<SyncState> {
	const now = opts.now ?? Date.now();
	const users = getUsernames();

	if (!opts.force) {
		const why = reasonNotToSync({
			now,
			lastAttempt: readTime(ATTEMPT_KEY),
			hasUsername: !!(users.lichess || users.chesscom),
			hasToken: !!getToken(),
			online: navigator.onLine !== false,
			training,
		});
		if (why) {
			set({ note: why });
			return state;
		}
	}

	cancelled = false;
	writeTime(ATTEMPT_KEY, now);
	set({ running: true, error: null, note: 'looking for new games…' });

	try {
		const r = await importGames({
			lichess: users.lichess,
			chesscom: users.chesscom,
			max: BACKGROUND_MAX,
			shouldCancel: () => cancelled || training,
			onProgress: (p: ImportProgress) => set({ note: p.note }),
		});

		if (r.engineError) {
			// Not a silent zero. See §M9: a measurement failure must never be
			// reported in the vocabulary of a measurement.
			set({ running: false, error: r.engineError, note: 'engine unavailable' });
			return state;
		}

		writeTime(SUCCESS_KEY, now);
		set({
			running: false,
			lastSuccessAt: now,
			added: r.cards,
			error: null,
			note: r.analysed
				? `${r.analysed} new game${r.analysed === 1 ? '' : 's'}, ${r.cards} card${r.cards === 1 ? '' : 's'}`
				: 'no new games',
		});
	} catch (e) {
		set({ running: false, error: (e as Error).message, note: 'import failed' });
	}
	return state;
}

/** Kick off a pass shortly after load, if the conditions allow one. */
export function startBackgroundImport(delayMs = START_DELAY_MS): () => void {
	const timer = setTimeout(() => void runBackgroundImport(), delayMs);
	return () => clearTimeout(timer);
}

// ---------------------------------------------------------------------------

function readTime(key: string): number | null {
	try {
		const v = localStorage.getItem(key);
		return v ? Number(v) || null : null;
	} catch {
		return null;
	}
}

function writeTime(key: string, at: number): void {
	try {
		localStorage.setItem(key, String(at));
	} catch {
		/* private mode — it will just sync again next time */
	}
}

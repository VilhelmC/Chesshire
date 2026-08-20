// One import at a time, owned by nobody in particular.
//
// ---------------------------------------------------------------------------
// THE BUG THIS EXISTS TO FIX
//
// Import state — running, progress, result — lived in React state inside the
// ImportGames component. Switching tab unmounted it, and three things followed:
//
//   1. The work carried on and kept writing to the database, but every progress
//      update went to a component that no longer existed.
//   2. Coming back showed an idle screen, because a freshly mounted component
//      starts idle. The import looked like it had been cancelled. It had not.
//   3. Pressing Import again then started a SECOND run on top of the first.
//
// Analysing games takes minutes. Any design that requires someone to sit and
// watch a tab for minutes is going to be wrong the first time they do anything
// else, which is immediately.
//
// So the run lives here, at module scope, and views subscribe. Unmounting a
// view is now unrelated to whether the work continues, which is the correct
// relationship between the two.
//
// EXPLICIT BEATS IMPLICIT
//
// A background import stands down when training starts, because the engine is
// single and serialised and a drill move must not queue behind a game analysis.
// A run YOU pressed a button for does not: you asked for it by name, and having
// it silently abandon itself because you looked at another screen is the same
// failure in a different costume. It carries on, and the trainer may feel a
// little slower while it does.
// ---------------------------------------------------------------------------

import { importGames, type ImportProgress, type ImportResult } from './importGames';

export type RunKind = 'manual' | 'background';

export type RunState = {
	running: boolean;
	kind: RunKind | null;
	/** Live progress from the importer, while a run is going. */
	progress: ImportProgress | null;
	/** The last finished run, which survives leaving and returning to the tab. */
	result: ImportResult | null;
	error: string | null;
	/** When the last run finished, successfully or not. */
	finishedAt: number | null;
};

let state: RunState = {
	running: false,
	kind: null,
	progress: null,
	result: null,
	error: null,
	finishedAt: null,
};

const listeners = new Set<(s: RunState) => void>();

export function runState(): RunState {
	return state;
}

export function subscribeRun(fn: (s: RunState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function set(patch: Partial<RunState>) {
	state = { ...state, ...patch };
	for (const fn of listeners) fn(state);
}

// ---------------------------------------------------------------------------

let cancelled = false;
/** Set while the trainer is on screen; only background runs care. */
let training = false;

export function setTraining(on: boolean): void {
	training = on;
}

export function isTraining(): boolean {
	return training;
}

/** Stop the current run. Only ever called because someone asked. */
export function cancelRun(): void {
	cancelled = true;
}

export type StartOptions = {
	kind: RunKind;
	lichess?: string;
	chesscom?: string;
	max?: number;
	minLoss?: number;
	force?: boolean;
};

/**
 * Start a run, unless one is already going.
 *
 * Returns the state rather than throwing on a refusal: "already running" is an
 * answer, not an error, and the caller's job is to show it rather than handle
 * it.
 */
export async function startRun(opts: StartOptions): Promise<RunState> {
	if (state.running) return state;

	cancelled = false;
	set({ running: true, kind: opts.kind, progress: null, result: null, error: null });

	try {
		const result = await importGames({
			lichess: opts.lichess,
			chesscom: opts.chesscom,
			max: opts.max,
			minLoss: opts.minLoss,
			force: opts.force,
			onProgress: (p) => set({ progress: p }),
			// A background run yields to the trainer. A manual one does not — see
			// the note at the top of this file.
			shouldCancel: () => cancelled || (opts.kind === 'background' && training),
		});
		set({
			running: false,
			result,
			error: result.engineError ?? null,
			finishedAt: Date.now(),
		});
	} catch (e) {
		set({ running: false, error: (e as Error).message, finishedAt: Date.now() });
	}
	return state;
}

/** A one-line description of what is happening, for anywhere too small for more. */
export function describeRun(s: RunState = state): string {
	if (s.running) {
		const p = s.progress;
		if (!p) return 'Starting…';
		if (p.stage === 'analysing' && p.total) {
			return `Analysing game ${p.done + 1} of ${p.total} — ${p.cards} card${p.cards === 1 ? '' : 's'} so far`;
		}
		return p.note || 'Working…';
	}
	if (s.error) return s.error;
	if (s.result) {
		const r = s.result;
		return `${r.cards} card${r.cards === 1 ? '' : 's'} from ${r.analysed} game${r.analysed === 1 ? '' : 's'}`;
	}
	return '';
}

/** 0–1, or null when the total is not known yet. */
export function runFraction(s: RunState = state): number | null {
	const p = s.progress;
	if (!s.running || !p || !p.total) return null;
	return Math.min(1, p.done / p.total);
}

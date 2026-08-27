// Where you were looking, so a reload does not start you over.
//
// ---------------------------------------------------------------------------
// Will: "persist app state in localstorage so when app reloads we return to the
// same tab and problem (if in lab tab) and currently displayed move."
//
// The read and the write are the easy half. The half that goes wrong is what
// happens when a stored value has stopped being meaningful — a puzzle filtered
// out of the set, a ply past the end of a shorter chain, a tab that no longer
// exists, a payload written by an older build. Restored blindly, each of those
// puts the app in a state its own UI cannot produce, and the report that comes
// back is "the Lab is blank" rather than "the thing it remembered is gone".
//
// So everything is validated on the way OUT by a predicate the caller supplies,
// and a value that does not pass is simply absent. Restoring is a convenience;
// being wrong about where someone was is worse than a click.
//
// Not `data/session.ts`, which holds the RUN — that is real work in progress and
// belongs in IndexedDB. This is view state: cheap to lose, and needed
// synchronously inside a `useState` initialiser, which cannot await.
// ---------------------------------------------------------------------------

const KEY = 'chesshire.view';

/** Everything restored. Every field optional: an older build wrote fewer. */
export type ViewState = {
	tab?: string;
	labId?: string;
	labPly?: number;
	labTheme?: string;
	labOnly?: string;
};

/**
 * `localStorage` throws rather than returning null in some private modes and
 * under some cookie policies, and a crash inside a `useState` initialiser takes
 * the whole app down on first paint — a worse outcome than forgetting a tab.
 */
function read(): ViewState {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as ViewState) : {};
	} catch {
		return {};
	}
}

function write(next: ViewState): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		/* full, or refused — nothing here is worth reporting */
	}
}

/**
 * One field, restored only if it still means something.
 *
 * `ok` is the caller's business because only the caller knows: whether that
 * puzzle is in the current set, whether that theme is still a theme, whether
 * that tab is still a tab.
 */
export function recall<K extends keyof ViewState>(
	key: K,
	ok: (v: NonNullable<ViewState[K]>) => boolean,
): ViewState[K] | undefined {
	const v = read()[key];
	if (v === undefined || v === null) return undefined;
	return ok(v as NonNullable<ViewState[K]>) ? v : undefined;
}

/** Merge, so two components writing different fields do not erase each other. */
export function remember(patch: ViewState): void {
	write({ ...read(), ...patch });
}

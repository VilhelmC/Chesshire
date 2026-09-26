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
	/**
	 * Mistake categories selected in the Quiz tab. Empty means ALL of them.
	 *
	 * `string[]` rather than the narrowed union: this module is the boundary with
	 * storage, and storage holds whatever an older build wrote. The caller narrows
	 * on the way out through its `ok` predicate, which is the point of `recall`.
	 */
	quizCategories?: string[];
	/**
	 * Training wheels left switched on.
	 *
	 * `string[]` for the same reason as `quizCategories`: an older build may have
	 * written the name of an overlay that has since been ablated away, and this
	 * module is the boundary with storage rather than the place that knows which
	 * wheels exist.
	 */
	wheels?: string[];
	/**
	 * The wheels are selected but suppressed.
	 *
	 * Stored as OFF rather than on, so its absence — every ViewState written
	 * before this existed — reads as "showing", which is what those readers
	 * currently have.
	 */
	wheelsOff?: boolean;
	/**
	 * The move table: whether it is up, and which sources it admits.
	 *
	 * Two fields because they are two facts. `tableOn.size > 0` used to mean both
	 * "the table is showing" and "these filters are active", so turning the last
	 * chip off made the whole table vanish — which reads as a broken filter
	 * rather than as an empty one.
	 */
	tableShown?: boolean;
	/**
	 * …and whether it was asked to STAY up between moves.
	 *
	 * Will: "let's make 'show moves' untoggle when move is made by default.
	 * Persistent toggled state can be gated behind double click?" So `tableShown`
	 * is now "is it up right now" and this is "was that asked for deliberately".
	 * Both are stored because the answer to the second should survive a reload
	 * and the first should not — see `hooks/useMoveTableToggle`.
	 */
	tablePinned?: boolean;
	tableOn?: string[];
	/**
	 * The strictness the Mistakes deck judges by.
	 *
	 * Its own, not the trainer's — see `views/Quiz`. Absent means "whatever the
	 * trainer is set to", which is where the cards came from.
	 */
	quizStrictness?: string;
	/** The puzzle theme being drilled, or '' for the whole corpus. */
	puzzleTheme?: string;
	/**
	 * WHERE YOU WERE IN THE DECK.
	 *
	 * ------------------------------------------------------------------------
	 * Will: "I also think the other tabs should persist state — for example
	 * mistakes because currently it starts over same sequence every time user
	 * leaves tab."
	 *
	 * `App` unmounts a tab the moment you leave it, so Mistakes rebuilt its queue
	 * from `due()` on every visit — which is deterministic, so you met the same
	 * card first every time and the three you had just answered came back in the
	 * same order behind it.
	 *
	 * ONE ID, not the queue. The deck changes underneath this — cards are
	 * answered, rescheduled and retired — so a stored queue would be a snapshot
	 * of a list that no longer exists. The queue is rebuilt from the live deck
	 * and this card brought to the front of it, which cannot go stale.
	 *
	 * And deliberately NOT a record of what has been answered: `answer()` already
	 * pushes a correct card's `dueAt` into the future, so `due()` drops it
	 * without help, while a list of answered ids would grow with nothing to clear
	 * it until the deck read as empty on a day it was full.
	 *
	 * In `viewState` rather than `db.session`, because that store holds a whole
	 * `RunState` and this is one string. A screen's PLACE is a view preference;
	 * a game in progress is not.
	 * ------------------------------------------------------------------------
	 */
	quizCurrentId?: string;
	/** Review: the game being looked at, and the ply within it. */
	reviewSelected?: string;
	reviewPly?: number;
	/**
	 * The signed-out "training from the bundled book" notice has been dismissed.
	 *
	 * A notice you cannot silence becomes furniture, and furniture is not read —
	 * which would make the one time it matters the time it is ignored.
	 */
	bookNoticeHushed?: boolean;
	/**
	 * Whether the scoring panel is on screen.
	 *
	 * Shared between Play and Review for the same reason `tableShown` is shared
	 * between Train and Mistakes: "do I want to see how this was played" is one
	 * preference about how you want to be shown a game, not one per tab.
	 */
	statsShown?: boolean;
	/**
	 * Free play's engine strength, and whether anybody is answering.
	 *
	 * -------------------------------------------------------------------------
	 * `botLevel` was `useState('auto')` in the trainer and persisted nowhere, so
	 * choosing an opponent lasted exactly until the next reload — a setting that
	 * silently resets is worse than one that is not offered, because you stop
	 * trusting the ones that do stick.
	 *
	 * `number | 'auto'` as `string | number` for the same reason as the arrays
	 * above: this module is the boundary with storage, and storage holds
	 * whatever an older build wrote. The caller narrows on the way out.
	 */
	botLevel?: number | string;
	/** 'engine' or 'none' — see `SessionConfig.opponent`. */
	playOpponent?: string;
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

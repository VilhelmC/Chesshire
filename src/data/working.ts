// Is the app thinking? Asked from anywhere, answered in one place.
//
// ---------------------------------------------------------------------------
// Will: "we now show loading animation in two places right next to each other:
// above the 'Your move' text and in the 'your move text'. Let's keep only in
// 'Your move' text since that is what's being calculated. Let's also make the
// app icon in the page header rotate while loading."
//
// Two indicators next to each other is one too many, and which one to keep
// follows from what each of them could honestly mean. An indicator inside the
// verdict block says WHAT is being worked out — the judgement on the move you
// just played — and is placed where the answer will appear. One in the control
// strip said only that something, somewhere, was happening.
//
// So the second is not moved, it is PROMOTED: "something is happening" is a
// fact about the whole app, and the place for it is the app's own chrome. The
// mark in the header turns.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT REACT STATE.
//
// The thing being reported is the engine and the evaluation cache, which are
// reached from hooks, views and the session module alike — and none of them is
// an ancestor of the header. A context would mean a provider above everything
// and a re-render of the tree on each search; passing a prop would mean every
// caller of `analysePosition` knowing about a header.
//
// A counter with subscribers is the smaller thing. It is incremented where the
// work actually starts, which is the one place that cannot be wrong about it —
// `data/cloudEval`, around the search it owns — so no screen has to remember to
// report anything, and a view that forgets cannot make the header lie.
// ---------------------------------------------------------------------------

let depth = 0;
const listeners = new Set<() => void>();

function announce(): void {
	for (const fn of listeners) fn();
}

/**
 * Mark the start of a piece of work, and return how to end it.
 *
 * A DEPTH COUNTER rather than a boolean: several searches overlap constantly —
 * the classifier scores a dozen candidates at once — and a boolean would be
 * cleared by whichever finished first while the rest were still running.
 */
export function startWorking(): () => void {
	depth++;
	if (depth === 1) announce();
	let ended = false;
	return () => {
		// Guarded, because a `finally` that runs twice would take the counter
		// negative and leave the app permanently "idle" while it worked.
		if (ended) return;
		ended = true;
		depth--;
		if (depth === 0) announce();
	};
}

export function isWorking(): boolean {
	return depth > 0;
}

/** For `useSyncExternalStore`. */
export function subscribeWorking(fn: () => void): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** Tests and the debug snapshot; nothing in the app should need this. */
export function resetWorking(): void {
	depth = 0;
	announce();
}

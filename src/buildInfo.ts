// Which build is running, and when it was made.
//
// ---------------------------------------------------------------------------
// Will: "how do I know if the saved page / app updated?" — asked of a phone
// with the app installed to the home screen, where a service worker serves a
// cached shell and a stale install looks exactly like a fresh one.
//
// And then: "where can I see the version stamp? Maybe there should be version
// and last updated info somewhere? Like the bottom of the settings tab."
//
// The honest answer to the first was that there was nowhere to see it. The
// deploy script prints the commit it publishes and puts it in the gh-pages
// commit message; the running app never learned it. So the only way to tell
// which build you had was to look for a feature and not find it, which is a
// diagnosis by absence — the slowest kind, and the kind that makes you doubt
// the feature rather than the cache.
//
// ---------------------------------------------------------------------------
// THREE DATES, BECAUSE THEY ANSWER THREE DIFFERENT QUESTIONS.
//
//   committed  — when the source was written. What you compare against a
//                repository, and the one that matches "did my change land".
//   built      — when this bundle was produced. Differs from `committed`
//                whenever a build is rerun, and is the only one that moves
//                when a build is made from a dirty tree.
//   loaded     — when the page you are looking at started. Against the other
//                two this is what exposes a cached shell: a build stamped
//                last week, loaded a minute ago, is a stale install.
//
// Only the third is knowable at runtime; the first two are baked in by
// `vite.config.ts`, which is the last moment they exist to be read.
// ---------------------------------------------------------------------------

/** Injected by vite's `define`. Declared here so the app compiles against them. */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_DIRTY__: boolean;
declare const __BUILD_AT__: string;
declare const __COMMIT_AT__: string;

export type BuildInfo = {
	/** package.json's version. Hand-set, so it moves rarely and means little. */
	version: string;
	/** Short SHA, or empty where git could not be asked. */
	commit: string;
	/** The build included changes that were never committed. */
	dirty: boolean;
	/** ISO, or empty. When the bundle was produced. */
	builtAt: string;
	/** ISO, or empty. When `commit` was committed. */
	committedAt: string;
	/** ISO. When this page started — not baked in, read at module load. */
	loadedAt: string;
};

/**
 * `typeof x === 'undefined'` rather than a try/catch.
 *
 * These are substituted textually at build time, so in any context vite did
 * NOT build — a vitest run that imports this module, a consumer bundling the
 * source directly — the identifier is genuinely not defined and referencing it
 * is a ReferenceError rather than `undefined`. The guard has to be the typeof
 * form for that reason; `__BUILD_COMMIT__ ?? ''` would throw.
 */
function injected<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

const LOADED_AT = new Date().toISOString();

export function buildInfo(version = '0.1.0'): BuildInfo {
	return {
		version,
		commit: injected(() => (typeof __BUILD_COMMIT__ === 'undefined' ? '' : __BUILD_COMMIT__), ''),
		dirty: injected(() => (typeof __BUILD_DIRTY__ === 'undefined' ? false : __BUILD_DIRTY__), false),
		builtAt: injected(() => (typeof __BUILD_AT__ === 'undefined' ? '' : __BUILD_AT__), ''),
		committedAt: injected(() => (typeof __COMMIT_AT__ === 'undefined' ? '' : __COMMIT_AT__), ''),
		loadedAt: LOADED_AT,
	};
}

/**
 * The build as one line, for a bug report or a console dump.
 *
 * Deliberately not the same text the panel shows. A person reading a screen
 * wants "2 days ago"; a person reading a bug report wants the timestamp, because
 * "2 days ago" is meaningless once the report is a week old.
 */
export function describeBuild(b: BuildInfo = buildInfo()): string {
	const parts = [`v${b.version}`];
	if (b.commit) parts.push(`${b.commit}${b.dirty ? '+dirty' : ''}`);
	else parts.push('commit unknown');
	if (b.builtAt) parts.push(`built ${b.builtAt}`);
	parts.push(`loaded ${b.loadedAt}`);
	return parts.join(' · ');
}

/**
 * How long ago, in words, with no dependency and no false precision.
 *
 * Rounded DOWN at every step, because the question this answers is "is what I
 * am looking at current?" and rounding up reads as older than it is. Returns
 * null for anything unparseable, so the caller shows nothing rather than
 * "NaN days ago" — a stamp is supposed to settle a doubt, not add one.
 */
export function ago(iso: string, now = Date.now()): string | null {
	if (!iso) return null;
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return null;
	const secs = Math.floor((now - then) / 1000);
	// A clock skew between the build machine and this one can put a build in the
	// future by a few seconds. "in 3 seconds" is noise; "just now" is true enough.
	if (secs < 60) return 'just now';
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
	const years = Math.floor(months / 12);
	return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * A date a person can read, in their own locale, or the raw string if not.
 *
 * `undefined` as the locale means "whatever this device is set to", which is
 * the right answer and is also the one that makes this untestable against a
 * fixed expectation — hence `ago` carrying the part the tests pin.
 */
export function on(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
}

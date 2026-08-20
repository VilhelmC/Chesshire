// One place the app's appearance is decided.
//
// ---------------------------------------------------------------------------
// Before this, the same six colours were re-declared at the top of nine
// different files and 450 inline style objects each made their own decisions
// about padding, radius and type size. Nothing was WRONG — the values mostly
// agreed — but "mostly agreed" is the problem: a panel on Progress and a panel
// on Mistakes were the same by coincidence rather than by construction, so they
// drifted apart every time either was touched.
//
// This is deliberately not a CSS framework. It is a vocabulary: named values
// that carry an intention, so a component asks for `space.card` rather than 12,
// and changing what a card's padding means changes it everywhere at once.
// ---------------------------------------------------------------------------

/**
 * Colour.
 *
 * The palette is near-monochrome on purpose. This is an app for looking at a
 * chessboard, and the board is the only thing that should be competing for
 * attention; every colour here that is not grey earns its place by carrying
 * meaning — right, wrong, needs-attention, act-on-this.
 */
export const color = {
	/** Text, and the darkest surfaces in light mode. */
	ink: 'var(--ink)',
	/** Secondary text: labels, notes, anything explaining rather than stating. */
	ink2: 'var(--ink2)',
	/** Disabled, and text that must recede further still. */
	ink3: 'var(--ink3)',

	page: 'var(--page)',
	/** Panels, so a group of controls reads as one object. */
	surface: 'var(--surface)',
	/** Hairlines. Light enough to divide without drawing the eye. */
	line: 'var(--line)',

	/** The single accent. Interactive, current, selected — nothing else. */
	accent: 'var(--accent)',
	accentSoft: 'var(--accent-soft)',

	// Judgement. These three only ever describe a result, never a surface.
	good: 'var(--good)',
	warn: 'var(--warn)',
	bad: 'var(--bad)',
	goodSoft: 'var(--good-soft)',
	warnSoft: 'var(--warn-soft)',
	badSoft: 'var(--bad-soft)',
} as const;

/**
 * These are `var(...)` references, not colours.
 *
 * That is what makes dark mode free: an inline style saying `color: var(--ink)`
 * is resolved by the browser against whichever palette is in force, so no
 * component needs to know a theme exists. The cost is one real constraint —
 * **a var() string cannot be concatenated into a new colour.** `${color.bad}10`
 * used to produce a 6% tint and now produces nothing at all. Use the matching
 * `*Soft` token instead; that is what they are for.
 *
 * The actual values live in src/index.css.
 */

/**
 * Spacing, on a 4px grid.
 *
 * Named by role rather than size so the intent survives a change of mind: if
 * cards should breathe more, `card` changes and every card follows.
 */
export const space = {
	hair: 2,
	tight: 4,
	snug: 8,
	card: 12,
	section: 16,
	page: 24,
	gap: 10,
} as const;

export const radius = {
	small: 4,
	panel: 8,
	pill: 999,
} as const;

/**
 * Type scale.
 *
 * Four sizes, because a fifth always turns out to be one of the other four with
 * a different opinion. `note` is the smallest thing allowed to carry meaning;
 * anything below it is decoration and should not exist.
 */
export const text = {
	title: 22,
	heading: 16,
	body: 14,
	note: 12,
} as const;

/**
 * Smallest comfortable touch target.
 *
 * Below about 40px a finger misses often enough that the app reads as
 * unresponsive rather than the tap as inaccurate.
 */
export const TOUCH = 40;

export const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The system stack stays as the fallback, and it matters more than it looks:
 * `font-display: swap` means the first paint of a cold load uses it, so the
 * fallback is what a new visitor reads for a few hundred milliseconds.
 */
export const sans = "'Source Sans 3 Variable', system-ui, -apple-system, sans-serif";

/** Colour for a judgement, so the mapping lives in one place. */
export function verdictColor(kind: 'good' | 'warn' | 'bad' | 'neutral'): string {
	if (kind === 'good') return color.good;
	if (kind === 'warn') return color.warn;
	if (kind === 'bad') return color.bad;
	return color.ink2;
}

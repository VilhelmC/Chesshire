// The stamp that says which build you are looking at.
//
// ---------------------------------------------------------------------------
// Will: "how do I know if the saved page / app updated?" — from a phone with
// the app installed, where a service worker serves a cached shell and a stale
// install is indistinguishable from a fresh one.
//
// What is pinned here is the arithmetic and the refusals, not the layout. A
// stamp exists to settle a doubt; one that says "NaN days ago" or rounds a
// three-week-old build up to "1 month" adds a doubt instead.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ago, buildInfo, describeBuild, on } from '../src/buildInfo';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const minsAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe('how long ago', () => {
	it('rounds down at every step', () => {
		// "1 hour ago" for something 119 minutes old would be wrong in the
		// direction that matters: it reads as fresher than it is.
		expect(ago(minsAgo(119), NOW)).toBe('1 hour ago');
		expect(ago(minsAgo(60 * 24 * 29), NOW)).toBe('29 days ago');
		expect(ago(minsAgo(60 * 24 * 30), NOW)).toBe('1 month ago');
	});

	it('says "just now" inside a minute', () => {
		expect(ago(minsAgo(0), NOW)).toBe('just now');
		expect(ago(minsAgo(0.9), NOW)).toBe('just now');
	});

	it('says "just now" for a build a little in the future', () => {
		// The build machine's clock and this one's disagree by seconds routinely.
		// "in 3 seconds" is noise; the negative branch must not fall through to
		// "-1 minutes ago" either.
		expect(ago(new Date(NOW + 3000).toISOString(), NOW)).toBe('just now');
	});

	it('singularises exactly one', () => {
		expect(ago(minsAgo(60), NOW)).toBe('1 hour ago');
		expect(ago(minsAgo(120), NOW)).toBe('2 hours ago');
		expect(ago(minsAgo(1), NOW)).toBe('1 minute ago');
	});

	it('returns null rather than NaN for anything unreadable', () => {
		// The caller renders nothing on null. A stamp reading "NaN days ago" is
		// worse than no stamp: it makes the reader doubt the app, correctly.
		expect(ago('', NOW)).toBeNull();
		expect(ago('not a date', NOW)).toBeNull();
	});
});

describe('the build, as one line', () => {
	it('survives git being absent, and says so', () => {
		// A source tarball or a shallow CI checkout has no repository to ask. The
		// build must still run, and the stamp must not claim a commit it does not
		// have.
		const line = describeBuild({
			version: '0.1.0',
			commit: '',
			dirty: false,
			builtAt: '',
			committedAt: '',
			loadedAt: '2026-09-21T12:00:00.000Z',
		});
		expect(line).toContain('commit unknown');
		expect(line).toContain('v0.1.0');
	});

	it('marks a build that corresponds to no commit', () => {
		// Naming a commit for a build made from a dirty tree is the most
		// misleading kind of accurate.
		const line = describeBuild({
			version: '0.1.0',
			commit: 'abc1234',
			dirty: true,
			builtAt: '2026-09-21T11:00:00.000Z',
			committedAt: '2026-09-21T10:00:00.000Z',
			loadedAt: '2026-09-21T12:00:00.000Z',
		});
		expect(line).toContain('abc1234+dirty');
	});

	it('always carries when the page loaded, whatever else is missing', () => {
		// The gap between built and loaded is what exposes a cached shell, so the
		// runtime half can never be the part that goes missing.
		expect(describeBuild(buildInfo())).toMatch(/loaded \d{4}-\d{2}-\d{2}T/);
	});
});

describe('reading the constants outside a vite build', () => {
	it('falls back instead of throwing', () => {
		// These are substituted textually, so in a plain vitest run the
		// identifiers are genuinely undefined and referencing one is a
		// ReferenceError — not `undefined`. The guard has to survive that.
		const b = buildInfo();
		expect(b.version).toBe('0.1.0');
		expect(typeof b.commit).toBe('string');
		expect(typeof b.dirty).toBe('boolean');
	});
});

describe('a date a person reads', () => {
	it('passes an unparseable string through rather than inventing one', () => {
		expect(on('whenever')).toBe('whenever');
		expect(on('')).toBe('');
	});
});

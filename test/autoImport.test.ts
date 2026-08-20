// When the background import is allowed to run.
//
// The interesting cases are all refusals. An import that runs when it should
// not is either a battery complaint, a rate limit, or — worst — Stockfish
// queued ahead of the move someone is waiting on.

import { describe, it, expect } from 'vitest';
import { reasonNotToSync, MIN_INTERVAL_MS } from '../src/data/autoImport';

const ok = {
	now: 1_000_000_000,
	lastAttempt: null,
	hasUsername: true,
	hasToken: true,
	online: true,
	training: false,
};

describe('reasonNotToSync', () => {
	it('runs when everything is in place', () => {
		expect(reasonNotToSync(ok)).toBeNull();
	});

	it('stands down while someone is training', () => {
		// The engine is single and serialised. This is the one that would make
		// the app feel broken rather than merely wasteful.
		expect(reasonNotToSync({ ...ok, training: true })).toBe('training');
	});

	it('does not run offline', () => {
		expect(reasonNotToSync({ ...ok, online: false })).toBe('offline');
	});

	it('does not run without a token', () => {
		expect(reasonNotToSync({ ...ok, hasToken: false })).toBe('not signed in');
	});

	it('does not run without a username to import for', () => {
		expect(reasonNotToSync({ ...ok, hasUsername: false })).toBe('no username set');
	});

	it('waits a day between passes', () => {
		const justNow = { ...ok, lastAttempt: ok.now - 60_000 };
		expect(reasonNotToSync(justNow)).toBe('synced recently');

		const yesterday = { ...ok, lastAttempt: ok.now - MIN_INTERVAL_MS - 1 };
		expect(reasonNotToSync(yesterday)).toBeNull();
	});

	it('counts the ATTEMPT, not the success', () => {
		// Otherwise a failing import retries on every page load, which against a
		// rate limit makes the rate limit worse.
		const failedRecently = { ...ok, lastAttempt: ok.now - 1000 };
		expect(reasonNotToSync(failedRecently)).toBe('synced recently');
	});

	it('is only blocked while training, not after it', () => {
		// Train is the tab the app opens on. If "training" were sticky the import
		// would never run for anyone who trains and closes the app — and blocked
		// forever looks exactly like nothing new to import.
		expect(reasonNotToSync({ ...ok, training: true })).toBe('training');
		expect(reasonNotToSync({ ...ok, training: false })).toBeNull();
	});

	it('reports the first reason, so the message is stable', () => {
		// Offline and untrained and unsigned-in at once still names one thing.
		const bad = { ...ok, online: false, hasToken: false, training: true };
		expect(reasonNotToSync(bad)).toBe('offline');
	});
});

// PKCE, and the parts of the sign-in that can be checked without a network.
//
// The exchange itself needs Lichess and cannot run here, so what is tested is
// everything around it: the challenge derivation against RFC 7636's own test
// vector, and the checks that decide whether a reply is ours at all.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// A hand-rolled browser surface rather than jsdom.
//
// The sign-in touches exactly four browser things — two storages, `location`
// and `history.replaceState` — and writing them out is cheaper than a DOM
// implementation, keeps the test suite dependency-free, and doubles as a list
// of what this module is allowed to depend on. If that list grows, this stub
// is where it becomes visible.
class MemoryStorage {
	private m = new Map<string, string>();
	getItem(k: string) {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, String(v));
	}
	removeItem(k: string) {
		this.m.delete(k);
	}
	clear() {
		this.m.clear();
	}
	get length() {
		return this.m.size;
	}
	key(i: number) {
		return [...this.m.keys()][i] ?? null;
	}
}

const g = globalThis as unknown as Record<string, unknown>;
g.sessionStorage = new MemoryStorage();
g.localStorage = new MemoryStorage();
g.location = { origin: 'https://example.test', pathname: '/Schackal/', hash: '', search: '' };
g.history = { replaceState: () => undefined };
import {
	base64url,
	challengeFor,
	makeVerifier,
	parseCallback,
	completeSignIn,
} from '../src/data/lichessAuth';

describe('base64url', () => {
	it('uses the URL-safe alphabet and drops the padding', () => {
		// 0xFB 0xFF produces '+' and '/' in standard base64.
		const out = base64url(new Uint8Array([0xfb, 0xff, 0xfe]));
		expect(out).not.toMatch(/[+/=]/);
	});

	it('round-trips a known value', () => {
		expect(base64url(new TextEncoder().encode('hello'))).toBe('aGVsbG8');
	});
});

describe('challengeFor', () => {
	it('matches the test vector in RFC 7636 appendix B', async () => {
		// The RFC's own verifier and its expected S256 challenge. If this passes,
		// the derivation is right; nothing else about PKCE is subtle.
		const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
		const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
		expect(await challengeFor(verifier)).toBe(expected);
	});

	it('is deterministic and differs between verifiers', async () => {
		const a = await challengeFor('one-verifier-value-that-is-long-enough-here');
		const b = await challengeFor('another-verifier-value-that-is-long-enough');
		expect(a).toBe(await challengeFor('one-verifier-value-that-is-long-enough-here'));
		expect(a).not.toBe(b);
	});
});

describe('makeVerifier', () => {
	it('stays inside the length RFC 7636 allows', () => {
		const v = makeVerifier();
		expect(v.length).toBeGreaterThanOrEqual(43);
		expect(v.length).toBeLessThanOrEqual(128);
	});

	it('uses only unreserved characters', () => {
		expect(makeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
	});

	it('does not repeat itself', () => {
		const seen = new Set(Array.from({ length: 50 }, () => makeVerifier()));
		expect(seen.size).toBe(50);
	});
});

describe('parseCallback', () => {
	it('reads a successful reply', () => {
		const p = parseCallback('?code=abc&state=xyz');
		expect(p.code).toBe('abc');
		expect(p.state).toBe('xyz');
		expect(p.error).toBeNull();
	});

	it('reads a refusal', () => {
		const p = parseCallback('?error=access_denied&error_description=User+said+no');
		expect(p.error).toBe('access_denied');
		expect(p.errorDescription).toBe('User said no');
	});

	it('reports nothing for an ordinary page load', () => {
		expect(parseCallback('')).toEqual({
			code: null,
			state: null,
			error: null,
			errorDescription: null,
		});
	});
});

describe('completeSignIn', () => {
	beforeEach(() => {
		sessionStorage.clear();
		localStorage.clear();
	});

	it('does nothing on an ordinary page load', async () => {
		const fetchImpl = vi.fn();
		expect(await completeSignIn('', fetchImpl as unknown as typeof fetch)).toEqual({
			status: 'none',
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses a code whose state does not match the request', async () => {
		sessionStorage.setItem('offbook.pkceState', 'the-one-we-sent');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const fetchImpl = vi.fn();
		const r = await completeSignIn('?code=abc&state=someone-elses', fetchImpl as never);
		expect(r.status).toBe('failed');
		// The exchange must not even be attempted.
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('refuses a code with no stored request at all', async () => {
		const fetchImpl = vi.fn();
		const r = await completeSignIn('?code=abc&state=xyz', fetchImpl as never);
		expect(r.status).toBe('failed');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('consumes the verifier so a code cannot be replayed', async () => {
		sessionStorage.setItem('offbook.pkceState', 'st');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const fetchImpl = vi.fn(async () => new Response('{}', { status: 400 }));
		await completeSignIn('?code=abc&state=st', fetchImpl as never);
		expect(sessionStorage.getItem('offbook.pkceVerifier')).toBeNull();
		expect(sessionStorage.getItem('offbook.pkceState')).toBeNull();
	});

	it('reports a refusal from Lichess rather than a token', async () => {
		sessionStorage.setItem('offbook.pkceState', 'st');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const r = await completeSignIn(
			'?error=access_denied&error_description=No+thanks&state=st',
			vi.fn() as never,
		);
		expect(r).toEqual({ status: 'failed', reason: 'No thanks' });
	});

	it('keeps a working token even when the username lookup fails', async () => {
		sessionStorage.setItem('offbook.pkceState', 'st');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const fetchImpl = vi.fn(async (url: string) => {
			if (String(url).includes('/api/token')) {
				return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
			}
			return new Response('nope', { status: 500 });
		});
		const r = await completeSignIn('?code=abc&state=st', fetchImpl as never);
		expect(r).toEqual({ status: 'ok', username: null });
		expect(localStorage.getItem('offbook.lichessToken')).toBe('tok');
	});

	it('records the username when Lichess gives one', async () => {
		sessionStorage.setItem('offbook.pkceState', 'st');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const fetchImpl = vi.fn(async (url: string) =>
			String(url).includes('/api/token')
				? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
				: new Response(JSON.stringify({ username: 'SomePlayer' }), { status: 200 }),
		);
		const r = await completeSignIn('?code=abc&state=st', fetchImpl as never);
		expect(r).toEqual({ status: 'ok', username: 'SomePlayer' });
		// And it fills the import field, which is the other place it is needed.
		expect(localStorage.getItem('offbook.lichessUser')).toBe('SomePlayer');
	});

	it('does not overwrite a username that was typed by hand', async () => {
		localStorage.setItem('offbook.lichessUser', 'TypedByHand');
		sessionStorage.setItem('offbook.pkceState', 'st');
		sessionStorage.setItem('offbook.pkceVerifier', 'v'.repeat(43));
		const fetchImpl = vi.fn(async (url: string) =>
			String(url).includes('/api/token')
				? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
				: new Response(JSON.stringify({ username: 'SomePlayer' }), { status: 200 }),
		);
		await completeSignIn('?code=abc&state=st', fetchImpl as never);
		expect(localStorage.getItem('offbook.lichessUser')).toBe('TypedByHand');
	});
});

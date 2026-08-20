// "Sign in with Lichess", with no server anywhere.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Every explorer endpoint returns 401 anonymously, so without a token the Train
// tab simply does not work. Getting one used to mean: leave the app, find
// lichess.org/account/oauth/token, understand what a scope is, decide to tick
// none of them, create a token, copy it, come back, paste it. That is a wall
// for anyone who is not the person who built the app.
//
// OAuth 2.0 Authorization Code with PKCE replaces all of it with one button,
// and — this is the part that makes it possible — Lichess supports UNREGISTERED
// PUBLIC CLIENTS. No client secret, so no server is needed to hold one; any
// unique string may be used as the client id. The only accepted challenge
// method is S256.
//
// So this is not a step towards accounts. It is the opposite: it gets the app
// an identity and a credential while staying entirely local-first.
//
// WHAT IT DOES NOT DO
//
// It does not sync anything. Signing in on your phone and on your laptop gives
// you two independent decks, exactly as before — Lichess is the identity
// provider, not our storage. Carrying a deck across devices is still the backup
// file. Saying so plainly matters, because "sign in" invites people to assume
// otherwise.
// ---------------------------------------------------------------------------

import { setToken, getToken } from './explorer';
import { setUsernames, getUsernames } from './importGames';
import { assetUrl } from '../base';

const AUTHORIZE_URL = 'https://lichess.org/oauth';
const TOKEN_URL = 'https://lichess.org/api/token';
const ACCOUNT_URL = 'https://lichess.org/api/account';

/** Where the verifier waits while the browser is away at lichess.org. */
const VERIFIER_KEY = 'offbook.pkceVerifier';
const STATE_KEY = 'offbook.pkceState';
/**
 * Who signed in — deliberately NOT `offbook.lichessUser`, which importGames
 * uses for the name typed into the import field. They usually hold the same
 * string and they mean different things: one is an identity Lichess vouched
 * for, the other is whatever someone typed. Sharing the key would let a typed
 * name plus a pasted token display as "signed in as", which is a small lie the
 * UI would have no way to detect.
 */
const USER_KEY = 'offbook.lichessSignedInAs';

/**
 * No scopes.
 *
 * The explorer needs a token to EXIST, not a token that can do anything, and
 * `/api/account` is readable without one. Asking for nothing is both the
 * smallest possible request and the most honest consent screen: whoever signs
 * in is told the app cannot play, message, or change a thing.
 */
const SCOPES = '';

/**
 * The client id, which for an unregistered client is just a stable unique
 * string. The app's own URL is the conventional choice and doubles as
 * documentation on the Lichess consent screen — the person approving can see
 * where the request came from.
 */
export function clientId(): string {
	return redirectUri();
}

/** Must match exactly between the authorize call and the token exchange. */
export function redirectUri(): string {
	return new URL(assetUrl(''), location.origin).href;
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

/** RFC 7636 base64url: standard base64, minus padding, with a URL-safe alphabet. */
export function base64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A high-entropy random string, 43–128 chars per RFC 7636. */
export function makeVerifier(random: (n: number) => Uint8Array = randomBytes): string {
	return base64url(random(64));
}

/** S256: the challenge is the base64url SHA-256 of the verifier. */
export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

function randomBytes(n: number): Uint8Array {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

// ---------------------------------------------------------------------------
// Step 1 — leave for Lichess
// ---------------------------------------------------------------------------

export async function beginSignIn(): Promise<void> {
	const verifier = makeVerifier();
	const state = makeVerifier();
	// sessionStorage, not localStorage: this is single-use and must not outlive
	// the tab. A verifier left lying about is a credential left lying about.
	sessionStorage.setItem(VERIFIER_KEY, verifier);
	sessionStorage.setItem(STATE_KEY, state);

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', clientId());
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('code_challenge', await challengeFor(verifier));
	url.searchParams.set('state', state);
	if (SCOPES) url.searchParams.set('scope', SCOPES);

	location.assign(url.href);
}

// ---------------------------------------------------------------------------
// Step 2 — come back
// ---------------------------------------------------------------------------

export type CallbackParams = {
	code: string | null;
	state: string | null;
	error: string | null;
	errorDescription: string | null;
};

/** What Lichess put in the URL when it sent the browser back. */
export function parseCallback(search: string): CallbackParams {
	const p = new URLSearchParams(search);
	return {
		code: p.get('code'),
		state: p.get('state'),
		error: p.get('error'),
		errorDescription: p.get('error_description'),
	};
}

export type SignInResult =
	| { status: 'none' }
	| { status: 'ok'; username: string | null }
	| { status: 'failed'; reason: string };

/**
 * Finish a sign-in, if this page load is the return leg of one.
 *
 * Returns `none` for an ordinary page load, so it is safe to call on every
 * boot. Always clears the query string afterwards: a one-time code left in the
 * address bar gets copied, bookmarked and shared by accident.
 */
export async function completeSignIn(
	search: string = location.search,
	fetchImpl: typeof fetch = fetch,
): Promise<SignInResult> {
	const { code, state, error, errorDescription } = parseCallback(search);
	if (!code && !error) return { status: 'none' };

	const expected = sessionStorage.getItem(STATE_KEY);
	const verifier = sessionStorage.getItem(VERIFIER_KEY);
	sessionStorage.removeItem(STATE_KEY);
	sessionStorage.removeItem(VERIFIER_KEY);
	clearQuery();

	if (error) return { status: 'failed', reason: errorDescription || error };
	// The whole job of `state`: a code arriving without the request that asked
	// for it is someone else's code, not ours.
	if (!expected || state !== expected) {
		return { status: 'failed', reason: 'The reply did not match the request. Try again.' };
	}
	if (!verifier) {
		return { status: 'failed', reason: 'The sign-in was started in a different tab or session.' };
	}

	let token: string;
	try {
		const res = await fetchImpl(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				code,
				code_verifier: verifier,
				redirect_uri: redirectUri(),
				client_id: clientId(),
			}),
		});
		if (!res.ok) {
			return { status: 'failed', reason: `Lichess refused the exchange (HTTP ${res.status}).` };
		}
		const body = (await res.json()) as { access_token?: string };
		if (!body.access_token) return { status: 'failed', reason: 'No token in the reply.' };
		token = body.access_token;
	} catch (e) {
		return { status: 'failed', reason: `Could not reach Lichess: ${(e as Error).message}` };
	}

	setToken(token);

	// The username is a convenience, not the sign-in. Failing to read it must
	// not undo a token that works — that would trade a working credential for a
	// cosmetic field.
	let username: string | null = null;
	try {
		const me = await fetchImpl(ACCOUNT_URL, { headers: { Authorization: `Bearer ${token}` } });
		if (me.ok) {
			const acc = (await me.json()) as { username?: string };
			username = acc.username ?? null;
		}
	} catch {
		/* keep the token */
	}

	if (username) {
		localStorage.setItem(USER_KEY, username);
		// Pre-fill the import field, which is the other place the name is needed.
		// Only when it is empty: a name typed by hand was a decision.
		const current = getUsernames();
		if (!current.lichess) setUsernames({ ...current, lichess: username });
	}

	return { status: 'ok', username };
}

/** Who is signed in, as far as this browser knows. */
export function signedInAs(): string | null {
	if (!getToken()) return null;
	try {
		return localStorage.getItem(USER_KEY);
	} catch {
		return null;
	}
}

/** True when there is a token, however it was obtained. */
export function hasToken(): boolean {
	return !!getToken();
}

/**
 * Forget the token locally.
 *
 * Deliberately NOT a revocation. Lichess offers `DELETE /api/token`, but a
 * button labelled "sign out" that silently destroys a credential the user may
 * also have pasted in by hand would be doing more than it says. Revoking is
 * done on Lichess, where the full list of tokens is visible.
 */
export function signOut(): void {
	setToken(null);
	try {
		localStorage.removeItem(USER_KEY);
	} catch {
		/* nothing to remove */
	}
}

function clearQuery(): void {
	try {
		history.replaceState(null, '', location.pathname + location.hash);
	} catch {
		/* older browser — the code stays visible, which is untidy, not unsafe */
	}
}

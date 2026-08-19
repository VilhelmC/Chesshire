// Lichess opening explorer client.
//
// Free community infrastructure — throttled to 1 req/s, backs off on 429, and
// caches every response in IndexedDB forever. See SPEC.md §8 ("API politeness").
//
// NOTE: the parameter names below are from the public API docs; they could not
// be verified from the build sandbox (no network route to lichess.org).
// `smokeTest()` exists so this is verified in the browser on first run.

import { CONFIG, type Speed } from '../config';
import { db } from './db';
import type { ExplorerResponse } from '../domain/types';

const ENDPOINT = 'https://explorer.lichess.ovh/lichess';
// 1/sec still earned 429s under sustained load — the explorer tolerates bursts
// but not a hundred sequential calls. The real fix is asking for far less (the
// trainer needs ~1 call per drill, not a whole tree), but be polite anyway.
const MIN_INTERVAL_MS = 1500;
const TOKEN_STORAGE_KEY = 'offbook.lichessToken';

let lastRequest = 0;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Personal API token. REQUIRED as of 2026-08 — verified by probe: every
 * explorer.lichess.ovh endpoint returns nginx 401 anonymously and 200 with a
 * Bearer token. (lichess.org/api/cloud-eval is still anonymous-friendly.)
 * Stored in localStorage, never committed. Create one at
 * https://lichess.org/account/oauth/token with no scopes ticked.
 */
export function getToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string | null): void {
	try {
		if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
		else localStorage.removeItem(TOKEN_STORAGE_KEY);
	} catch {
		/* private mode — ignore */
	}
}

function authHeaders(): Record<string, string> {
	const t = getToken();
	return t ? { Authorization: `Bearer ${t}` } : {};
}

function cacheKey(fen: string, ratings: readonly number[], speeds: readonly Speed[]): string {
	return `${fen}|${[...ratings].join(',')}|${[...speeds].join(',')}`;
}

async function throttle(): Promise<void> {
	const wait = Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now());
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastRequest = Date.now();
}

export type ExplorerOptions = {
	ratings?: readonly number[];
	speeds?: readonly Speed[];
	/** Bypass the cache (used by the smoke test). */
	force?: boolean;
};

/**
 * Fetch the explorer stats for a position. Serialised and rate-limited across
 * all callers, so a full repertoire build is a polite drip rather than a burst.
 */
export function fetchExplorer(fen: string, opts: ExplorerOptions = {}): Promise<ExplorerResponse> {
	const ratings = opts.ratings ?? CONFIG.explorer.ratings;
	const speeds = opts.speeds ?? CONFIG.explorer.speeds;
	const key = cacheKey(fen, ratings, speeds);

	const run = async (): Promise<ExplorerResponse> => {
		if (!opts.force) {
			const hit = await db.explorerCache.get(key);
			if (hit) return hit.data;
		}

		const url = new URL(ENDPOINT);
		url.searchParams.set('variant', 'standard');
		url.searchParams.set('fen', fen);
		url.searchParams.set('ratings', [...ratings].join(','));
		url.searchParams.set('speeds', [...speeds].join(','));
		url.searchParams.set('topGames', '0');
		url.searchParams.set('recentGames', '0');
		// 20 was clipping the tail at ply 3 (Black has ~29 legal replies after
		// 1.e4 e5 2.Nf3). Frequencies are normalised over the returned set, so a
		// clipped tail silently inflates every other move.
		url.searchParams.set('moves', '40');

		const data = await requestWithBackoff(url);
		await db.explorerCache.put({ key, fetchedAt: Date.now(), data });
		return data;
	};

	const result = chain.then(run, run);
	chain = result.catch(() => undefined);
	return result;
}

async function requestWithBackoff(url: URL, attempt = 0): Promise<ExplorerResponse> {
	await throttle();
	const res = await fetch(url.toString(), {
		headers: { Accept: 'application/json', ...authHeaders() },
	});

	if (res.status === 429) {
		if (attempt >= 4) throw new Error('Explorer rate limited — giving up after 5 attempts');
		const retryAfter = Number(res.headers.get('Retry-After') ?? 0);
		const delay = retryAfter > 0 ? retryAfter * 1000 : 4000 * 2 ** attempt;
		// Push the global clock forward too, so every other queued request backs
		// off as well instead of marching straight into the same wall.
		lastRequest = Date.now() + delay;
		await new Promise((r) => setTimeout(r, delay));
		return requestWithBackoff(url, attempt + 1);
	}

	if (res.status === 401) {
		throw new Error(
			getToken()
				? 'Explorer returned 401 despite a token — the token may be revoked or malformed.'
				: 'Explorer requires a Lichess API token. Paste one into the token field ' +
					'(lichess.org/account/oauth/token, no scopes needed).',
		);
	}

	if (!res.ok) throw new Error(`Explorer HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return (await res.json()) as ExplorerResponse;
}

// ---------------------------------------------------------------------------
// Endpoint probe
//
// We hit a 401 from nginx on explorer.lichess.ovh. That is a proxy-level
// rejection, so it is one of: (a) the endpoint now requires a token, (b) the
// endpoint moved, (c) a specific query parameter is tripping a filter.
// This probe distinguishes those three in one click, from the only machine
// that can actually reach lichess.org — yours.
// ---------------------------------------------------------------------------

export type ProbeResult = {
	label: string;
	url: string;
	withToken: boolean;
	status: number | string;
	ok: boolean;
	body: string;
};

const ITALIAN_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';

function probeCandidates(): { label: string; url: string }[] {
	const fen = encodeURIComponent(ITALIAN_FEN);
	return [
		{
			label: 'ovh /lichess — full params (what the app sends)',
			url: `https://explorer.lichess.ovh/lichess?variant=standard&fen=${fen}&ratings=1000,1200,1400&speeds=blitz,rapid&topGames=0&recentGames=0&moves=20`,
		},
		{
			label: 'ovh /lichess — fen only (is a param tripping a filter?)',
			url: `https://explorer.lichess.ovh/lichess?fen=${fen}`,
		},
		{
			label: 'ovh /lichess — play= instead of fen=',
			url: 'https://explorer.lichess.ovh/lichess?play=e2e4,e7e5,g1f3,b8c6,f1c4',
		},
		{
			label: 'ovh /masters (different dataset, same host)',
			url: `https://explorer.lichess.ovh/masters?fen=${fen}`,
		},
		{
			label: 'lichess.org/api/opening-explorer/lichess (moved?)',
			url: `https://lichess.org/api/opening-explorer/lichess?fen=${fen}`,
		},
		{
			label: 'lichess.org/api/cloud-eval (is lichess.org reachable at all?)',
			url: `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(ITALIAN_FEN)}`,
		},
	];
}

/**
 * Try every candidate endpoint, with and without the stored token.
 * Runs sequentially with the normal 1 req/s throttle — it is a dozen requests,
 * not a scrape.
 */
export async function probeEndpoints(): Promise<ProbeResult[]> {
	const results: ProbeResult[] = [];
	const token = getToken();
	const variants: boolean[] = token ? [false, true] : [false];

	for (const c of probeCandidates()) {
		for (const withToken of variants) {
			await throttle();
			try {
				const res = await fetch(c.url, {
					headers: {
						Accept: 'application/json',
						...(withToken ? { Authorization: `Bearer ${token}` } : {}),
					},
				});
				const body = (await res.text()).slice(0, 300);
				results.push({
					label: c.label,
					url: c.url,
					withToken,
					status: res.status,
					ok: res.ok,
					body,
				});
			} catch (err) {
				// A thrown TypeError here (rather than an HTTP status) means the
				// request never completed — almost always CORS or DNS.
				results.push({
					label: c.label,
					url: c.url,
					withToken,
					status: 'network/CORS',
					ok: false,
					body: (err as Error).message,
				});
			}
		}
	}

	return results;
}

/**
 * One-shot verification that the API contract is what we think it is.
 * Rendered by the Build view — check the raw JSON keys against
 * src/domain/types.ts:ExplorerResponse on first run.
 */
export async function smokeTest(): Promise<{ ok: boolean; raw: unknown; note: string }> {
	// Position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 — the Italian root.
	const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
	try {
		const data = await fetchExplorer(fen, { force: true });
		const hasMoves = Array.isArray(data.moves) && data.moves.length > 0;
		const first = data.moves?.[0];
		const shapeOk =
			hasMoves &&
			typeof first?.uci === 'string' &&
			typeof first?.san === 'string' &&
			typeof first?.white === 'number' &&
			typeof first?.draws === 'number' &&
			typeof first?.black === 'number';

		return {
			ok: shapeOk,
			raw: data,
			note: shapeOk
				? `OK — ${data.moves.length} replies, top is ${first!.san}`
				: 'Response shape does not match ExplorerResponse — update src/domain/types.ts',
		};
	} catch (err) {
		return { ok: false, raw: null, note: `Request failed: ${(err as Error).message}` };
	}
}

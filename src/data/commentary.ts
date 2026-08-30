// Fetching the book, and remembering it.
//
// ---------------------------------------------------------------------------
// WHY THE REGISTER IS BUILT AT RUNTIME AND NOT COMMITTED AS AN ASSET.
//
// The obvious shape is a generated `commentary.json` in `src/data`, the way
// `openings.json` is generated. I wrote that script first. It is the wrong
// answer here, for three reasons that only became clear once it existed:
//
//   * IT WOULD BE 200KB IN THE BUNDLE, precached by the service worker, paid
//     for by every install including the ones that never open the panel.
//   * IT GOES STALE SILENTLY. People edit Wikibooks. A committed register keeps
//     pointing at what the book said the day somebody last remembered to run a
//     script, and nothing on screen would say so.
//   * OFFLINE IS NOT ACTUALLY THE PRIZE. A register you can consult offline
//     tells you a page exists that you then cannot read, because the prose is
//     fetched. The register is worth exactly as much as the network it needs,
//     so making it independent of the network buys nothing.
//
// So it is built once — seven requests and about a second and a half of
// replaying — and kept in IndexedDB, next to the explorer and eval caches that
// work the same way and for the same reasons. The build is chunked so it never
// holds the main thread for more than a frame or two.
//
// ---------------------------------------------------------------------------
// API POLITENESS. Wikimedia asks for a descriptive User-Agent; a browser will
// not let us set one, so we do the other thing they ask, which is to not be a
// nuisance: seven requests to build, one per page read, everything cached
// permanently, and nothing fetched until a reader asks for it.
// ---------------------------------------------------------------------------

import { db } from './db';
import { buildRegister, isSubstantial, BOOK, type Register } from '../domain/commentary';

const API = 'https://en.wikibooks.org/w/api.php';

/**
 * How long a register is trusted before it is built again.
 *
 * The book gains a few hundred pages a year. Ninety days is far inside the rate
 * at which that matters and far outside the rate at which anybody would notice
 * the rebuild.
 */
const REGISTER_TTL = 90 * 24 * 60 * 60 * 1000;

const REGISTER_ID = 'wikibooks-cot';

function url(params: Record<string, string>): string {
	// `origin=*` is what makes this work from a browser at all: it asks for an
	// anonymous cross-origin response, which Wikimedia grants.
	return `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`;
}

async function api(params: Record<string, string>): Promise<any> {
	const r = await fetch(url(params));
	if (!r.ok) throw new Error(`Wikibooks ${r.status} ${r.statusText}`);
	return r.json();
}

/** Every page under the book's prefix. About 3,000, in pages of 500. */
async function allTitles(): Promise<string[]> {
	const out: string[] = [];
	let cont: string | undefined;
	do {
		const j = await api({
			action: 'query',
			list: 'allpages',
			apprefix: BOOK,
			apnamespace: '0',
			aplimit: '500',
			...(cont ? { apcontinue: cont } : {}),
		});
		for (const p of j.query.allpages) out.push(p.title);
		cont = j.continue?.apcontinue;
	} while (cont);
	return out;
}

let inFlight: Promise<Register> | null = null;
let memo: Register | null = null;

/**
 * The register, built if it has to be.
 *
 * Concurrent callers share one build: three panels mounting at once should cost
 * one pass over the book, not three.
 */
export function ensureRegister(): Promise<Register> {
	if (memo) return Promise.resolve(memo);
	if (inFlight) return inFlight;

	inFlight = (async () => {
		const stored = await db.commentaryRegister.get(REGISTER_ID);
		if (stored && Date.now() - stored.builtAt < REGISTER_TTL) {
			memo = new Map(stored.entries);
			return memo;
		}

		let titles: string[];
		try {
			titles = await allTitles();
		} catch (e) {
			// A stale register beats no register: the pages it names still exist.
			if (stored) {
				memo = new Map(stored.entries);
				return memo;
			}
			throw e;
		}

		// Chunked so the replay never blocks a frame. The whole pass is about a
		// second and a half; done this way nobody sees it.
		const register: Register = new Map();
		const unplayable: string[] = [];
		let transpositions = 0;
		for (let i = 0; i < titles.length; i += 250) {
			const part = buildRegister(titles.slice(i, i + 250));
			for (const [k, v] of part.register) {
				const had = register.get(k);
				// Same shortest-path rule, applied across chunk boundaries.
				if (!had || v.split('/').length < had.split('/').length) register.set(k, v);
				else transpositions++;
			}
			transpositions += part.transpositions;
			unplayable.push(...part.unplayable);
			await new Promise((r) => setTimeout(r, 0));
		}

		await db.commentaryRegister.put({
			id: REGISTER_ID,
			builtAt: Date.now(),
			entries: [...register],
			pages: titles.length,
			unplayable,
		});
		memo = register;
		return memo;
	})();

	inFlight.finally(() => {
		inFlight = null;
	});
	return inFlight;
}

/** The page for a position, or null. Cheap once the register is up. */
export async function pageFor(positionKey: string): Promise<string | null> {
	const register = await ensureRegister();
	return register.get(positionKey) ?? null;
}

export type Commentary = {
	/** The page's path under the book, e.g. `1. e4/1...c5/2. Nf3`. */
	page: string;
	/** Plain-text extract, apparatus still attached — `proseOf` trims it. */
	extract: string;
	/** Where a reader goes to read it properly, or to fix it. */
	url: string;
};

export const pageUrl = (page: string): string =>
	`https://en.wikibooks.org/wiki/${encodeURI(BOOK + page).replace(/ /g, '_')}`;

/**
 * The prose for one page.
 *
 * Cached forever, like the explorer: the text of a wiki page at a moment is a
 * fact about that moment, and re-fetching it on every glance would be rude for
 * no benefit. `null` means the page exists but says nothing worth opening — see
 * `isSubstantial`, and the half of the deep pages that are stubs.
 */
export async function fetchCommentary(page: string): Promise<Commentary | null> {
	const hit = await db.commentaryPages.get(page);
	if (hit) return hit.extract === null ? null : { page, extract: hit.extract, url: pageUrl(page) };

	const j = await api({
		action: 'query',
		prop: 'extracts',
		explaintext: '1',
		exsectionformat: 'plain',
		titles: BOOK + page,
	});
	const p = j.query?.pages?.[0];
	const extract: string = p && !p.missing ? (p.extract ?? '') : '';
	const keep = isSubstantial(extract) ? extract : null;

	await db.commentaryPages.put({ page, fetchedAt: Date.now(), extract: keep });
	return keep === null ? null : { page, extract: keep, url: pageUrl(page) };
}

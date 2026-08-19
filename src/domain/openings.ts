// Finding an opening by name.
//
// ---------------------------------------------------------------------------
// Pinning a position to train from only helps if you can say which position you
// mean, and nobody thinks "the node after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6". They
// think "the Two Knights". So: 1821 named openings with the moves that reach
// them, bundled (27 KB gzipped) so search is instant and works offline.
//
// Source: chess-eco-codes (MIT), from pgn-extract's eco.pgn. Regenerate with
// scripts/build-openings.mjs. Every entry was validated by replaying it when
// the file was built — a name pointing at moves that will not play would pin the
// trainer to a position that does not exist.
//
// Matching is token-AND with prefix support, because that is how people type:
// "scotch schmidt" should find "Scotch: Schmidt variation" without knowing that
// the separator is a colon, and "two kn" should find it before you finish the
// word. Tokens may match in any order — "najdorf sicilian" is the same request
// as "sicilian najdorf".
//
// Three things people type that are not words in a name, and all three work:
//
//   * an ECO code — "C45" lists the Scotch's variations, "C4" the whole band;
//   * a move sequence — "e4 e5 Nf3 Nc6 d4" finds what that line is called;
//   * a partial name that matches far more than fits on screen — the count of
//     matches is reported, because a truncated list that does not say it is
//     truncated is how "it isn't in there" gets concluded about something that
//     is. That is exactly what happened with the Scotch: 43 variations, 8 shown.
// ---------------------------------------------------------------------------

import raw from '../data/openings.json';

export type Opening = {
	eco: string;
	name: string;
	/** SAN moves from the initial position. */
	path: string[];
};

/** [eco, name, space-separated SAN] — the on-disk shape, kept compact. */
type Row = [string, string, string];

let cache: Opening[] | null = null;

export function allOpenings(): Opening[] {
	if (!cache) {
		cache = (raw as Row[]).map(([eco, name, moves]) => ({
			eco,
			name,
			path: moves.split(' '),
		}));
	}
	return cache;
}

/** Lowercase, strip punctuation, collapse spaces. */
function normalise(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export type Hit = Opening & { score: number };

export type SearchResult = {
	hits: Hit[];
	/** Matches before the limit was applied. */
	total: number;
};

/** "c45", "c4", "c" — an ECO code or the start of one. */
const ECO_RE = /^[a-e]\d{0,2}$/;

/** Looks like a SAN move: "e4", "Nf3", "exd4", "O-O", "Qh4+". */
const SAN_RE = /^(o-o(-o)?|[kqrbn]?[a-h]?[1-8]?x?[a-h][1-8](=[qrbn])?[+#]?)$/i;

/**
 * Openings matching a query, best first.
 *
 * Every token must appear somewhere in the name. Ranking then prefers, in
 * order: an exact name, a name that starts with what was typed, tokens sitting
 * at word starts rather than buried mid-word, and shorter names — because a
 * short name is the general opening and a long one is a specific sub-variation,
 * and someone typing "scotch" means the Scotch rather than the Scotch Gambit
 * Göring Attack.
 */
export function searchOpenings(query: string, limit = 25): SearchResult {
	const q = normalise(query);
	if (q.length < 1) return { hits: [], total: 0 };
	const tokens = q.split(' ');

	// A run of SAN tokens is a line, not a name. Match it as a prefix of the
	// moves, so pasting part of a game answers "what is this called?".
	const asMoves = query.trim().replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
	if (asMoves.length >= 2 && asMoves.every((t) => SAN_RE.test(t))) {
		const hits = allOpenings()
			.filter((o) => o.path.length >= asMoves.length && startsWith(o.path, asMoves))
			.map((o) => ({ ...o, score: 1000 - o.path.length }))
			.sort((a, b) => b.score - a.score);
		return { hits: hits.slice(0, limit), total: hits.length };
	}

	if (q.length < 2 && !ECO_RE.test(q)) return { hits: [], total: 0 };

	const hits: Hit[] = [];

	for (const o of allOpenings()) {
		const name = normalise(o.name);
		const words = name.split(' ');
		const eco = o.eco.toLowerCase();

		let score = 0;
		let matchedAll = true;

		for (const t of tokens) {
			// An ECO token is matched against the code, never against the name —
			// otherwise "c4" would also match every opening with a c4 in its line.
			if (ECO_RE.test(t)) {
				if (eco === t) score += 60;
				else if (eco.startsWith(t)) score += 25;
				else {
					matchedAll = false;
					break;
				}
				continue;
			}

			const atWordStart = words.some((w) => w.startsWith(t));
			if (!name.includes(t)) {
				matchedAll = false;
				break;
			}
			score += atWordStart ? 10 : 3;
			// A whole word matched exactly is stronger evidence than a prefix.
			if (words.includes(t)) score += 4;
		}
		if (!matchedAll) continue;

		if (name === q) score += 100;
		else if (name.startsWith(q)) score += 40;

		// Shorter name and shallower line both mean "more canonical".
		score -= words.length * 0.6;
		score -= o.path.length * 0.15;

		hits.push({ ...o, score });
	}

	hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	return { hits: hits.slice(0, limit), total: hits.length };
}

function startsWith(path: string[], prefix: string[]): boolean {
	return prefix.every((s, i) => path[i] === s);
}

/** The opening whose moves are exactly this path, if one is named. */
export function openingForPath(path: string[]): Opening | null {
	const key = path.join(' ');
	return allOpenings().find((o) => o.path.join(' ') === key) ?? null;
}

/**
 * The most specific named opening on the way to this path.
 *
 * Used to label a position the explorer did not name: an opening name is
 * inherited until something more specific replaces it.
 */
export function nameForPath(path: string[]): Opening | null {
	const key = path.join(' ');
	let best: Opening | null = null;
	for (const o of allOpenings()) {
		const p = o.path.join(' ');
		if (p.length > key.length) continue;
		if (key === p || key.startsWith(p + ' ')) {
			if (!best || o.path.length > best.path.length) best = o;
		}
	}
	return best;
}

/** Whose move it is at the end of a line. */
export function sideToMoveAfter(path: string[]): 'w' | 'b' {
	return path.length % 2 === 0 ? 'w' : 'b';
}

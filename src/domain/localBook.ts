// A book that needs no network, no token and nobody's permission.
//
// ---------------------------------------------------------------------------
// Will: "when user navigates to site they can't access anything without logging
// in to lichess. But most of our functionality does not require lichess so I
// think that gating is really unnecessary."
//
// He is right about the gating and half right about the cause. Exactly ONE
// thing needs the token: the opening explorer, which has refused anonymous
// requests since August 2026. Play, Mistakes, Review, Progress, the engine,
// cloud evaluation, and game import from BOTH sites all work signed out — but
// Train is the landing tab and it returned a full-page sign-in wall, so the app
// presented as locked when almost none of it was.
//
// The wall could have come down on its own, and the result would have been a
// trainer that says "the explorer has no games from this position" on move one.
// So the book had to come from somewhere, and it was already in the repository:
// `openings.json`, 1821 named lines averaging 10.6 plies and reaching 36, ships
// for the opening search and for naming positions. It is a book. It was just
// never asked to be one.
//
// ---------------------------------------------------------------------------
// KEYED BY POSITION, NOT BY PATH, AND THAT IS NOT AN OPTIMISATION.
//
// Matching the move list against each opening's prefix is simpler and it gets
// transpositions wrong — the Italian reached through 2...Nf6 is the same
// position and a path match calls it unknown. Replaying all 1821 lines once
// gives 2866 distinct positions with every transposition between them already
// merged. Measured at 371ms, built on first use and kept, which puts it in the
// same cost bracket as a single explorer request and makes it once per session
// rather than once per move.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS NOT, SAID PLAINLY.
//
// `freq` here is the share of NAMED VARIATIONS that branch a given way, not the
// share of games. Those are different claims and this app has been careful
// about that distinction everywhere else — "main" was renamed from "best"
// precisely because popularity and strength were sharing one word. The Evans
// Gambit tops the Giuoco Piano in this table and no modern game database would
// agree; ECO coverage reflects what has been written about, which correlates
// with what is played and is not it.
//
// So every row carries `source: 'variations'` and the screens that quote a
// percentage check it before saying "played". What the table IS good for is the
// only thing the drill needs from it: the SET of moves that are theory here.
// Which of them is sound is the engine's job in both modes, and the engine does
// not need a token either.
// ---------------------------------------------------------------------------

import raw from '../data/openings.json';
import { INITIAL_FEN, applySan, positionKey } from './chess';
import { DEFAULT_MIN_FREQ, type BookMove } from './book';

/** [eco, name, space-separated SAN] — the on-disk shape, shared with `openings.ts`. */
type Row = [string, string, string];

type Edge = {
	san: string;
	uci: string;
	/** Named variations passing through this move. */
	variations: number;
	/** The opening this move COMPLETES, when one ends here. */
	name: string | null;
};

type Node = {
	edges: Map<string, Edge>;
	/** What this position itself is called, when a line ends on it. */
	name: string | null;
	eco: string | null;
};

let index: Map<string, Node> | null = null;

/**
 * Every position any named opening passes through, with its continuations.
 *
 * Built once, lazily — on the first move of the first run, not at import, so a
 * signed-in session that never touches this never pays for it.
 */
export function bookIndex(): Map<string, Node> {
	if (index) return index;
	const built = new Map<string, Node>();

	for (const [eco, name, moves] of raw as Row[]) {
		const sans = moves.split(' ');
		let fen = INITIAL_FEN;
		for (let i = 0; i < sans.length; i++) {
			const san = sans[i];
			let played;
			try {
				played = applySan(fen, san);
			} catch {
				// A line that will not replay is a bad row, not a bad book. The
				// generator validates these, so this should be unreachable — and
				// silently dropping the rest of one line is the right failure.
				break;
			}
			const key = positionKey(fen);
			let node = built.get(key);
			if (!node) built.set(key, (node = { edges: new Map(), name: null, eco: null }));
			const edge = node.edges.get(san);
			const last = i === sans.length - 1;
			if (edge) {
				edge.variations++;
				// FIRST NAME WINS on an edge that several lines share, and the file
				// is in ECO order — so the first is the lower code, which is the
				// more general name. A caption wants "Ruy Lopez", not whichever
				// sub-variation happened to be indexed last.
				if (last && !edge.name) edge.name = name;
			} else {
				node.edges.set(san, {
					san,
					uci: played.uci,
					variations: 1,
					name: last ? name : null,
				});
			}

			fen = played.fen;
			if (last) {
				const endKey = positionKey(fen);
				let end = built.get(endKey);
				if (!end) built.set(endKey, (end = { edges: new Map(), name: null, eco: null }));
				if (!end.name) {
					end.name = name;
					end.eco = eco;
				}
			}
		}
	}

	index = built;
	return index;
}

/**
 * The book's moves in a position, in the shape the rest of the app reads.
 *
 * `cpLoss` is left null — soundness is the engine's question, asked by the
 * caller, exactly as it is for the explorer's rows. `verdict` therefore comes
 * from frequency alone here, which is all that can honestly be said before
 * anything has been measured.
 */
export function localBook(
	fen: string,
	minFreq = DEFAULT_MIN_FREQ,
): { moves: BookMove[]; name: string | null; eco: string | null } {
	const node = bookIndex().get(positionKey(fen));
	if (!node) return { moves: [], name: null, eco: null };

	const edges = [...node.edges.values()];
	const total = edges.reduce((n, e) => n + e.variations, 0);
	if (!total) return { moves: [], name: node.name, eco: node.eco };

	const rows = edges
		.map((e) => ({ e, freq: e.variations / total }))
		.sort((a, b) => b.freq - a.freq);

	return {
		moves: rows.map(({ e, freq }, i) => ({
			uci: e.uci,
			san: e.san,
			freq,
			/*
			 * ZERO, NOT A FABRICATION.
			 *
			 * `games` is a count of real games and there are none here. Inventing
			 * one so the move table has something to print would put a made-up
			 * number on screen beside real ones from the same column, which is the
			 * one thing a trainer built on measurement must never do. The table
			 * shows no "played" column offline, which is the truth.
			 */
			games: 0,
			cpLoss: null,
			name: e.name,
			// The commonest continuation is the main line; the rest are book while
			// they clear the bar, and rarer ones are still theory — the same three
			// readings the explorer's rows get, from the one axis available.
			verdict: i === 0 ? 'main' : freq >= minFreq ? 'book' : 'sound',
			source: 'variations',
		})),
		name: node.name,
		eco: node.eco,
	};
}

/** True once the bundled book has anything to say about a position. */
export function inLocalBook(fen: string): boolean {
	return (bookIndex().get(positionKey(fen))?.edges.size ?? 0) > 0;
}

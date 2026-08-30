// Somebody else's prose about this position.
//
// ---------------------------------------------------------------------------
// Will: "a training app should offer commentary where it exists."
//
// Quite. The measurement that prompted this was about where it DOESN'T —
// Wikibooks' "Chess Opening Theory" reaches ply 3–6 on real games and not one
// of the mistake cards in the deck is covered — and I let that stand as an
// argument against building it, which was the wrong conclusion from a true
// number. Coverage decides where the doorway appears, not whether it is worth
// having.
//
// So: the register says whether there is anything behind the door, and the door
// is only drawn when there is. That is the whole design.
//
// ---------------------------------------------------------------------------
// THE SOURCE, AND WHY THERE IS ONLY ONE.
//
// Wikibooks, "Chess Opening Theory", CC BY-SA 4.0. This is the same corpus
// Lichess puts on its opening pages — `lila` pulls it through the MediaWiki
// API with `prop=extracts` (lichess-org/lila#17957) — so "the Lichess
// commentary" and "the Wikibooks commentary" are one text with two front ends.
// The other open corpus, `lichess-org/chess-openings`, is CC0 and is names
// only; this repo already bundles it as `openings.json` and there is no prose
// in it anywhere.
//
// ---------------------------------------------------------------------------
// KEYED BY POSITION, NOT BY THE PAGE'S OWN NAME.
//
// The book names a page by a move path — `1. e4/1...c5/2. Nf3`. Looking one up
// by the path you actually played is the obvious thing, it is what Lichess
// does, and it is why Lichess misses transpositions: reach the position by
// another order and the page is not found although it exists.
//
// So every path is replayed once and the register is keyed by `positionKey`,
// which is what the rest of this app already calls the same node. About 2,950
// playable paths collapse to about 2,550 distinct positions, and any move order
// into one of them finds the page.
//
// ---------------------------------------------------------------------------
// THE LOOKUP FOR A MOVE IS THE POSITION IT WAS PLAYED FROM.
//
// The prose is written as "here are your options from here":
//
//   "3...cxd4 is the main move. Black captures towards the centre with a flank
//    pawn, breaking up White's two pawn centre. … 3...Nf6 is a minor sideline."
//
// So `explain(fen, uci)` asks this about `fen`, not about the child position.
// `paragraphFor` will point at the paragraph that names the move — but the page
// is shown whole, because a paragraph picked by a string match and presented
// ALONE is a claim that this text is about that move, and when the match is
// wrong there is nothing on screen to notice it with.
// ---------------------------------------------------------------------------

import { INITIAL_FEN, positionKey, applySan } from './chess';

/** Every page in the book lives under this prefix. */
export const BOOK = 'Chess Opening Theory/';

/** positionKey -> the page's path, without the `BOOK` prefix. */
export type Register = Map<string, string>;

/**
 * Is this a page about a move, as opposed to the ECO index or the style guide?
 *
 * The book has fifteen or so pages that are not positions at all. They have no
 * key, so they have no place in a register keyed by one.
 */
export function isMoveTitle(title: string): boolean {
	if (!title.startsWith(BOOK)) return false;
	return /^\s*\d+\.+\s*\S/.test(title.slice(BOOK.length).split('/')[0]);
}

/**
 * A title's SAN tokens, or null if there is nothing to replay.
 *
 * ABOUT FIFTY PAGES ARE SPELLED WRONG and each way is worth naming, because
 * each one is a page that silently disappears if it is not handled:
 *
 *   `1…c5`        a typographic ellipsis instead of three dots
 *   `4.e3`        no space after the move number
 *   `4...0-0`     zeroes for castling
 *   `5.Nxb5?`     an annotation glued to the move
 *   `4. Nf3 Nc6`  two moves in one segment
 *
 * The move NUMBER is stripped rather than checked. It carries nothing a replay
 * does not already have, and a page whose numbering disagrees with its own
 * moves is still a page about the position its moves reach.
 *
 * `+` and `#` are left alone: they are part of the move, not a verdict on it.
 */
export function sansOfTitle(title: string): string[] | null {
	if (!title.startsWith(BOOK)) return null;
	const out: string[] = [];
	for (const segment of title.slice(BOOK.length).split('/')) {
		const cleaned = segment.replace(/…/g, '...').replace(/^\s*\d+\.+\s*/, '');
		for (const raw of cleaned.split(/\s+/).filter(Boolean)) {
			const san = raw
				.replace(/^0-0-0$/, 'O-O-O')
				.replace(/^0-0$/, 'O-O')
				.replace(/[?!]+$/, '');
			if (san) out.push(san);
		}
	}
	return out.length ? out : null;
}

/** Replay to a position key, or null at the move that would not play. */
export function keyOfTitle(title: string): string | null {
	const sans = sansOfTitle(title);
	if (!sans) return null;
	let fen = INITIAL_FEN;
	for (const san of sans) {
		try {
			fen = applySan(fen, san).fen;
		} catch {
			return null;
		}
	}
	return positionKey(fen);
}

export type BuildResult = {
	register: Register;
	/** Pages that would not replay, so a lost page can be seen rather than guessed at. */
	unplayable: string[];
	/** Pages that reached a position another page had already named. */
	transpositions: number;
};

/**
 * Fold a list of page titles into the register.
 *
 * SHORTEST PATH WINS when two pages name the same position. The one a reader
 * means by it is the one that gets there most directly; the others are
 * transpositions into it. Same rule as `build-openings.mjs` uses for names.
 */
export function buildRegister(titles: readonly string[]): BuildResult {
	const depth = new Map<string, number>();
	const register: Register = new Map();
	const unplayable: string[] = [];
	let transpositions = 0;

	for (const title of titles) {
		if (!isMoveTitle(title)) continue;
		const sans = sansOfTitle(title);
		const key = sans ? keyOfTitle(title) : null;
		if (!key || !sans) {
			unplayable.push(title);
			continue;
		}
		const page = title.slice(BOOK.length);
		const was = depth.get(key);
		if (was === undefined) {
			register.set(key, page);
			depth.set(key, sans.length);
		} else {
			transpositions++;
			if (sans.length < was) {
				register.set(key, page);
				depth.set(key, sans.length);
			}
		}
	}

	return { register, unplayable, transpositions };
}

/**
 * The page's prose, with the apparatus taken off the end.
 *
 * An extract carries the theory table and the reference list after the writing,
 * and neither survives being flattened to plain text — the table becomes a
 * column of loose tokens. They are cut rather than rendered badly.
 */
export function proseOf(extract: string): string {
	return extract
		.split(/\n(?:Theory table|References|External links|See also|Further reading)\s*\n/)[0]
		.trim();
}

/**
 * A page with a heading and nothing under it is not commentary.
 *
 * Half the pages at ply 6 are stubs. Opening a panel onto one of them spends a
 * click to show the reader that there was nothing there, which is worse than
 * not having offered — so the register's promise is kept by refusing here.
 */
export const MIN_PROSE = 200;

export function isSubstantial(extract: string): boolean {
	return proseOf(extract).length >= MIN_PROSE;
}

/**
 * The paragraph that names this move, if one does.
 *
 * Used to HIGHLIGHT inside the page, never to replace it. The pages name moves
 * in running prose ("3...cxd4 is the main move"), so a match is good evidence
 * and not proof, and the reader can see the rest either way.
 */
export function paragraphFor(extract: string, san: string): string | null {
	// Word-ish boundaries: `Nf3` must not match inside `Nf3+`... it should, in
	// fact — the same move with a check marker is the same move — but `d4` must
	// not match inside `d45` or `cxd4`. So: not preceded by a move character.
	const escaped = san.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`(^|[^A-Za-z0-9x=+#-])${escaped}(?![A-Za-z0-9=])`);
	for (const para of proseOf(extract).split(/\n+/)) {
		if (re.test(para)) return para.trim();
	}
	return null;
}

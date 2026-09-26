// The puzzle corpus, and choosing one worth being given.
//
// ---------------------------------------------------------------------------
// 1031 Lichess puzzles ship with this app already — `data/labPuzzles.json`,
// bundled for the Lab, carrying Lichess's own rating and themes for each one.
// Nothing here invents a difficulty: the rating is tens of thousands of real
// attempts, which is a better measurement than this project could make and a
// better one than an engine could, because difficulty is a fact about people.
//
// Measured, so the shape is on the record: ratings 399 to 3097, median 1397,
// and a usable spread across the range (202 in the 800s, 136 in the 1200s, 96
// in the 1800s, 44 in the 2200s). 22 themes. One to thirteen solver moves.
//
// ---------------------------------------------------------------------------
// THE MOVE CONVENTION IS LICHESS'S, AND IT CATCHES EVERYONE ONCE.
//
// `moves[0]` is played BY THE SIDE TO MOVE IN `fen` — it is the opponent's
// move, the blunder that makes the puzzle — and the solver plays `moves[1]`,
// `moves[3]`, and so on. So the side you are solving as is NOT the side to
// move in the stored FEN; it is the other one. Verified across the whole
// corpus: every puzzle alternates from there and every move replays legally.
// ---------------------------------------------------------------------------

import RAW from '../data/labPuzzles.json';
import { applyUci } from './chess';
import { band, type Rating } from './glicko';

export type Puzzle = {
	id: string;
	/** Before the opponent's move. See the header. */
	fen: string;
	/** UCI, opponent first, alternating. */
	moves: string[];
	/** Lichess's rating: what it took real players to solve it. */
	rating: number;
	themes: string[];
};

/** The corpus, narrowed to the fields a solver needs. */
export function allPuzzles(): Puzzle[] {
	return RAW as Puzzle[];
}

/** The position the solver actually faces, after the opponent's move. */
export function openingPosition(p: Puzzle): { fen: string; lastMove: [string, string] } {
	const fen = applyUci(p.fen, p.moves[0]).fen;
	return { fen, lastMove: [p.moves[0].slice(0, 2), p.moves[0].slice(2, 4)] };
}

/** Which side the solver plays — the one NOT to move in the stored FEN. */
export function solverColour(p: Puzzle): 'w' | 'b' {
	return p.fen.split(' ')[1] === 'w' ? 'b' : 'w';
}

/** How many moves the solver has to find. */
export function solverMoves(p: Puzzle): number {
	return Math.floor(p.moves.length / 2);
}

/** Every theme in the corpus, commonest first, with counts. */
export function themes(): { id: string; count: number }[] {
	const n = new Map<string, number>();
	for (const p of allPuzzles()) for (const t of p.themes ?? []) n.set(t, (n.get(t) ?? 0) + 1);
	return [...n].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

/**
 * Themes as words rather than as camelCase identifiers.
 *
 * Lichess's own names, which people recognise from their puzzle pages. Anything
 * unmapped falls back to the identifier split at its capitals rather than to a
 * blank, because a theme this does not know about is still better named badly
 * than not at all.
 */
const THEME_NAMES: Record<string, string> = {
	advancedPawn: 'Advanced pawn',
	attraction: 'Attraction',
	backRankMate: 'Back-rank mate',
	clearance: 'Clearance',
	defensiveMove: 'Defensive move',
	deflection: 'Deflection',
	discoveredAttack: 'Discovered attack',
	doubleCheck: 'Double check',
	fork: 'Fork',
	hangingPiece: 'Hanging piece',
	intermezzo: 'In-between move',
	mateIn1: 'Mate in 1',
	mateIn2: 'Mate in 2',
	mateIn3: 'Mate in 3',
	pin: 'Pin',
	promotion: 'Promotion',
	quietMove: 'Quiet move',
	sacrifice: 'Sacrifice',
	skewer: 'Skewer',
	trappedPiece: 'Trapped piece',
	xRayAttack: 'X-ray attack',
	zugzwang: 'Zugzwang',
};

export function themeName(id: string): string {
	return THEME_NAMES[id] ?? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Puzzles carrying ANY of these themes — the union, not the intersection.
 *
 * ---------------------------------------------------------------------------
 * Will: "puzzle set options should be toggles that signal union (like the
 * repertoire but for puzzle categories)."
 *
 * Union is also the only reading that makes a multi-select worth having here: a
 * Lichess puzzle carries two or three themes, so an intersection of "fork" and
 * "back-rank mate" is a handful of puzzles in the whole corpus and most pairs
 * are empty. Union means "drill these kinds of thing", which is what picking
 * several is for.
 *
 * Empty means the whole corpus — the same rule the Mistakes deck uses for its
 * categories, so that clearing every chip never presents as an empty set.
 * ---------------------------------------------------------------------------
 */
export function inThemes(p: Puzzle, themes: readonly string[]): boolean {
	if (!themes.length) return true;
	const own = p.themes ?? [];
	return themes.some((t) => own.includes(t));
}

export type PickOptions = {
	/** Only puzzles carrying one of these themes. Empty means the whole corpus. */
	themes?: readonly string[];
	/** Puzzle ids to avoid — what you have already been served. */
	seen?: ReadonlySet<string>;
	/** Shift the band upwards, for asking to be stretched. */
	harder?: number;
	rng?: () => number;
};

/**
 * A puzzle worth being given next.
 *
 * ---------------------------------------------------------------------------
 * THE BAND WIDENS UNTIL SOMETHING IS IN IT, and that fallback is the whole of
 * the difficulty here. A theme filter can leave eleven puzzles in the corpus,
 * a rating can sit at 2900 where there are four, and a reader who has solved
 * everything nearby must still be handed something. Each of those returns an
 * empty band, and an empty band with no fallback is a screen that says "no
 * puzzles" while holding a thousand.
 *
 * So: the band from the rating, then twice that, then the whole pool. What is
 * NOT done is quietly dropping the theme filter — that was asked for
 * explicitly, and serving a fork to someone drilling back-rank mates because
 * the arithmetic ran out would be the app overruling a setting rather than
 * admitting it is short.
 * ---------------------------------------------------------------------------
 */
export function pickPuzzle(rating: Rating, opts: PickOptions = {}): Puzzle | null {
	const rng = opts.rng ?? Math.random;
	const seen = opts.seen ?? new Set<string>();
	const themes = opts.themes ?? [];

	const pool = allPuzzles().filter((p) => inThemes(p, themes) && !seen.has(p.id));
	// Everything in the theme has been seen: start it over rather than stop.
	// Repeating a puzzle you solved months ago is a weaker exercise than a fresh
	// one and a much stronger one than an empty screen.
	const usable = pool.length ? pool : allPuzzles().filter((p) => inThemes(p, themes));
	if (!usable.length) return null;

	const { low, high } = band(rating, opts.harder ?? 0);
	const width = high - low;
	for (const w of [width / 2, width, width * 2]) {
		const mid = (low + high) / 2;
		const hit = usable.filter((p) => Math.abs(p.rating - mid) <= w);
		if (hit.length) return hit[Math.floor(rng() * hit.length)];
	}
	// Nothing near the rating at all — take the closest rather than a random one,
	// so a rating far outside the corpus still gets the nearest thing to it.
	const mid = (low + high) / 2;
	return [...usable].sort((a, b) => Math.abs(a.rating - mid) - Math.abs(b.rating - mid))[0];
}

/**
 * How much the chosen filter actually leaves near the reader's level.
 *
 * ---------------------------------------------------------------------------
 * THE FALLBACK IN `pickPuzzle` IS SILENT, AND THIS IS WHAT MAKES IT AUDIBLE.
 *
 * Widening the band until something is in it is the right behaviour and it
 * hides a real cost: ask for zugzwang at 2200 and you are served puzzles
 * hundreds of points off, with nothing on screen saying so. Every failure then
 * looks like your failure. The note this feeds says whose arithmetic ran out.
 * ---------------------------------------------------------------------------
 */
export type Pool = {
	/** Puzzles carrying the theme at all — the whole corpus with no theme. */
	inTheme: number;
	/** Of those, how many sit inside the band the rating asks for. */
	near: number;
	/** How far the closest one is from the middle of that band, in points. */
	gap: number;
	/** What the closest one is rated, so a warning can say what to expect. */
	nearest: number | null;
};

export function poolNear(rating: Rating, themes: readonly string[] = [], hard = 0): Pool {
	// Deliberately NOT narrowed by `seen`: having solved everything nearby does
	// not make the theme thin, and `pickPuzzle` recycles rather than stopping.
	//
	// Filtered ONCE, which is what makes the union count honest: a puzzle carrying
	// two of the chosen themes is one puzzle, and counting per theme and adding
	// would have told you the set was twice the size it is.
	const list = allPuzzles().filter((p) => inThemes(p, themes));
	const { low, high } = band(rating, hard);
	const mid = (low + high) / 2;
	// The first band `pickPuzzle` tries, which is `band` itself — see the loop
	// there, whose `width / 2` is this half-width.
	const w = (high - low) / 2;
	let near = 0;
	let gap = Infinity;
	let nearest: number | null = null;
	for (const p of list) {
		const d = Math.abs(p.rating - mid);
		if (d <= w) near++;
		if (d < gap) {
			gap = d;
			nearest = p.rating;
		}
	}
	return { inTheme: list.length, near, gap: nearest === null ? Infinity : Math.round(gap), nearest };
}

/**
 * Below this, the band is being served by its fallback more than by itself.
 *
 * Measured rather than picked: at a settled deviation the band is ±120 points,
 * and across the 22 themes that leaves between 3 and 32 puzzles depending on
 * where the reader sits. Eight is under the low end of the ordinary range, so a
 * theme that trips this really is short — both `mateIn1` and `intermezzo` hold
 * nothing at all above 2100, which is exactly the case worth a warning.
 */
export const THIN_POOL = 8;

/**
 * Every theme with how much of it sits at the reader's level.
 *
 * For the chips: a theme's own size says how much of it exists, and `near` says
 * how much of it is worth being served today. One pass over the corpus rather
 * than `poolNear` twenty-two times, and the same band as everything else here.
 */
export function themePools(rating: Rating, hard = 0): { id: string; count: number; near: number }[] {
	const { low, high } = band(rating, hard);
	const mid = (low + high) / 2;
	const w = (high - low) / 2;
	const out = new Map<string, { id: string; count: number; near: number }>();
	for (const p of allPuzzles()) {
		const isNear = Math.abs(p.rating - mid) <= w;
		for (const t of p.themes ?? []) {
			const e = out.get(t) ?? { id: t, count: 0, near: 0 };
			e.count++;
			if (isNear) e.near++;
			out.set(t, e);
		}
	}
	return [...out.values()].sort((a, b) => b.count - a.count);
}

/** "fork", "fork and pin", "fork, pin and skewer", then "4 themes". */
export function listThemes(themes: readonly string[]): string {
	const names = themes.map((t) => themeName(t).toLowerCase());
	if (names.length === 0) return 'every puzzle';
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
	return `${names.length} themes`;
}

export type PoolNote = { tone: 'quiet' | 'warn'; text: string };

/**
 * What to say under the theme picker, or nothing.
 *
 * Nothing is the common case with no theme chosen: the whole corpus covers 399
 * to 3097 and a note saying so every time would be noise.
 */
export function poolNote(rating: Rating, themes: readonly string[]): PoolNote | null {
	const p = poolNear(rating, themes);
	const name = themes.length ? listThemes(themes) : null;
	const thin = p.near < THIN_POOL;

	if (!themes.length) {
		if (!thin) return null;
		// No filter and still short: the rating has walked off the end of the
		// corpus, which is the app's limit and not the reader's.
		return {
			tone: 'warn',
			text:
				p.nearest === null
					? 'No puzzles are bundled with this build.'
					: `Your rating is past what the bundled puzzles cover, so you will be served the closest there is — currently rated ${p.nearest}, about ${p.gap} points ${p.nearest > rating.r ? 'above' : 'below'} you.`,
		};
	}

	// Phrased so that it survives `listThemes` collapsing to "4 themes": every
	// branch puts the name behind a preposition rather than in front of a noun,
	// because "the 300 4 themes puzzles" is what the obvious wording produces.
	if (!thin)
		return {
			tone: 'quiet',
			text: `${capital(name!)}: ${p.near} of ${p.inTheme} sit near your rating.`,
		};

	if (p.near === 0)
		return {
			tone: 'warn',
			text: `Nothing in ${name} sits near your rating${p.nearest === null ? '.' : ` — the nearest of the ${p.inTheme} is rated ${p.nearest}, about ${p.gap} points ${p.nearest > rating.r ? 'above' : 'below'} you. Expect difficulty you did not choose.`}`,
		};

	return {
		tone: 'warn',
		text: `Only ${p.near} of the ${p.inTheme} in ${name} sit near your rating, so some will land well off it. Worth knowing before you read a miss as your own.`,
	};
}

function capital(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}


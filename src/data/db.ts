// Local-first storage. No backend, no accounts. See SPEC.md §8.

import Dexie, { type Table } from 'dexie';
import type { Attempt, Drill, RepertoireNode, ExplorerResponse } from '../domain/types';
import type { MemoryItem } from '../domain/scheduler';
import type { AnswerRow, RunRow } from '../domain/progress';
import type { MistakeCard } from '../domain/mistakes';

export type ExplorerCacheRow = {
	key: string; // fen|ratings|speeds
	fetchedAt: number;
	data: ExplorerResponse;
};

export type EvalCacheRow = {
	/** version|fen|depth|multipv — versioned so a convention change invalidates. */
	key: string;
	fetchedAt: number;
	source: 'cloud' | 'local';
	/** Depth actually reached, which for cloud hits far exceeds what we asked. */
	depth?: number;
	/** Centipawns from WHITE's point of view. See data/cloudEval.ts. */
	cp: number;
	pvs: { cpWhite: number; pv: string[] }[];
};

/**
 * The run in progress.
 *
 * A single row, replaced on every move. Leaving the tab used to discard the
 * game entirely — including free play, which is the part most worth keeping.
 */
/**
 * Which screen's game in progress this row is.
 *
 * ---------------------------------------------------------------------------
 * Will: "we've had an issue with play not persisting board state when switching
 * between tabs or reloading app."
 *
 * There was, and the cause is that `App` renders each tab as `{tab === 'x' &&
 * <X/>}` — so every view is UNMOUNTED when you leave it and its `useState` goes
 * with it. Train survives that because it writes here on every move and reads
 * back on mount; Play wrote nothing, so leaving the tab silently abandoned the
 * game and coming back started a fresh one.
 *
 * It was `'current'` — a name from when there was only one — and it is `'train'`
 * now. Will: "just use the 'train' identifier, no one is using the app yet."
 * Right: the only cost of renaming is that a run already in progress is not
 * found on the next load, and weighing one stale row against a key that says
 * which screen it belongs to is not a close call while nobody is holding one.
 */
export type SessionKey = 'train' | 'play';

export type SavedSession = {
	id: SessionKey;
	ts: number;
	runId: string;
	/** RunState, stored opaquely: the shape belongs to engine/session.ts. */
	state: unknown;
	/*
	 * ------------------------------------------------------------------------
	 * THE TAB-SPECIFIC FIELDS ARE OPTIONAL, and which ones are filled follows
	 * from `id`.
	 *
	 * A discriminated union would say that better, and it would also mean a
	 * migration: rows already on disk have no discriminator narrow enough to
	 * satisfy one. Optional fields with a reader that defaults them — which is
	 * what Train's loader already did for `evals` and `lossByPly`, having been
	 * bitten once — costs nothing and breaks nobody.
	 * ------------------------------------------------------------------------
	 */
	/** Train: centipawns given up, by ply. */
	lossByPly?: Record<number, number>;
	/**
	 * Train: opponent mistakes, keyed `ply|san`. Older rows hold bare ply numbers
	 * and are discarded on load — a ply number cannot be checked against the move
	 * actually played there, and marking the wrong move is worse than none.
	 */
	mistakePlies?: (string | number)[];
	/** Train: evaluation after each ply, for the review page. */
	evals?: (number | null)[];
	/** Train: whether the opponent went wrong at any point in this run. */
	sawMistake?: boolean;
	/**
	 * Play: what each of OUR moves gave up, in order.
	 *
	 * The scoring panel's only input — see `components/GameStats`. Kept with the
	 * game rather than recomputed, because recomputing means re-searching every
	 * position of a game that has already been measured once.
	 */
	losses?: number[];
};

/**
 * How much the app was helping when a puzzle was attempted.
 *
 * ---------------------------------------------------------------------------
 * Will: "needs to be able to use our existing assistance machinery (like show
 * moves and training wheels overlay), but of course doesn't count puzzle as
 * solved if assistance were used (alternatively we reserve a separate rating
 * for different assistance classes so user can track how they perform with
 * help)."
 *
 * The RATING only moves on `'none'` — a solve you were shown is not evidence of
 * sight, and a rating that counted it would drift upwards exactly as the
 * cp-loss estimate once did. But the class is RECORDED on every attempt, not
 * just thrown away, so "how do I do with the arrows on" is an answerable
 * question rather than one that needs a schema change to ask.
 * ---------------------------------------------------------------------------
 */
export type AssistLevel = 'none' | 'wheels' | 'moves';

export type PuzzleAttempt = {
	/** `${puzzleId}:${at}` — the same puzzle can be met more than once. */
	id: string;
	at: number;
	puzzleId: string;
	/** Lichess's rating for it, copied so history survives a corpus change. */
	puzzleRating: number;
	themes: string[];
	solved: 0 | 1;
	assist: AssistLevel;
	/** The rating after this attempt, so the graph needs no replay. */
	ratingAfter: number;
	ratingDeviationAfter: number;
	/** Solver moves made before it ended, for "how far did I get". */
	movesMade: number;
};

export type PuzzleRatingRow = {
	id: 'current';
	r: number;
	rd: number;
	at: number;
};

export type GameRow = {
	id: string; // platform:gameId
	platform: 'lichess' | 'chesscom' | 'pgn';
	playedAt: number;
	speed: string;
	ourColour: 'w' | 'b';
	result: '1-0' | '0-1' | '1/2-1/2' | '*';
	moves: string[]; // uci
	/** Ply at which play first left our repertoire, and by whom. */
	firstDeviationPly: number | null;
	deviatingSide: 'us' | 'them' | null;
	deviationWasDrilled: boolean;
	ourResponseCorrect: boolean | null;
};

/**
 * A game already mined for mistakes.
 *
 * Kept so re-running an import does not count the same blunder as a fresh
 * lapse every time — a card's lapse count is meant to say how often you make
 * that mistake, not how often you pressed Import.
 */
export type ImportedGameRow = {
	id: string; // platform:gameId
	platform: 'lichess' | 'chesscom';
	playedAt: number;
	analysedAt: number;
	url: string;
	opponent: string;
	result: 'win' | 'loss' | 'draw';
	/** Cards produced from this game. */
	mistakes: number;
	/**
	 * The time control, as the site names it: bullet/blitz/rapid/classical, and
	 * `daily` or `correspondence` for the slow ones.
	 *
	 * Kept because it decides whether a game is evidence of PLAYING STRENGTH. On
	 * chess.com daily you may consult an opening book and an analysis board and
	 * think for days, so its centipawn loss says what your tools can do, not what
	 * you can. Rows written before this field are `undefined` and are reported as
	 * unknown rather than assumed to be either.
	 */
	speed?: string;
	/**
	 * The game's SAN moves.
	 *
	 * Needed as the denominator of the transfer measurement: "two mistakes in the
	 * Italian last month, none this month" says nothing unless you also know how
	 * many Italians were played. Rows written before this was kept have no moves
	 * and are excluded from that measurement rather than assumed.
	 */
	moves?: string[];
	/**
	 * Evaluation after each ply, centipawns from WHITE's point of view.
	 *
	 * Kept because it is nearly free and unlocks everything measurable about a
	 * game — accuracy, ACPL, per-phase breakdown, win-percentage judgements —
	 * none of which can be reconstructed later without analysing the game again.
	 * Lichess sends these with any game analysed on the site; for everything else
	 * findMistakes computes them during import and used to discard them.
	 *
	 * Index i is the position AFTER ply i, matching ImportedGame.evals. Null
	 * entries mean that ply was never evaluated, and a game with any gap is not
	 * measurable — reported as such rather than interpolated.
	 */
	evals?: (number | null)[];
	ourColour?: 'w' | 'b';
};

/**
 * A note written in the Lab, against one ply of one puzzle.
 *
 * Kept in the browser because that is where it is written, and exported to a
 * file because that is where it is useful: a document in the repo is something
 * both of us can read.
 */
export type LabNote = {
	/** `${puzzleId}:${ply}` — the position the note is about. */
	id: string;
	puzzleId: string;
	ply: number;
	text: string;
	updatedAt: number;
};

/**
 * The Wikibooks register: which positions have a page written about them.
 *
 * Stored as entries rather than as an object so the position keys stay keys —
 * a FEN field contains slashes and spaces, which survive a Map and an array of
 * pairs and are a nuisance in anything that treats them as property names.
 */
export type CommentaryRegisterRow = {
	id: string;
	builtAt: number;
	/** [positionKey, page path under "Chess Opening Theory/"] */
	entries: [string, string][];
	/** How many pages the book had when this was built. */
	pages: number;
	/** Titles that would not replay, kept so a lost page can be looked at. */
	unplayable: string[];
};

/** One page's prose. `extract: null` means "exists, but is a stub". */
export type CommentaryPageRow = {
	page: string;
	fetchedAt: number;
	extract: string | null;
};

/** A file the app keeps up to date on disk. See data/fileLink.ts. */
export type LinkedHandle = {
	id: string;
	/** FileSystemFileHandle — typed as unknown so this file stays DOM-agnostic. */
	handle: unknown;
};

export class OffbookDb extends Dexie {
	nodes!: Table<RepertoireNode, string>;
	drills!: Table<Drill, string>;
	attempts!: Table<Attempt, string>;
	explorerCache!: Table<ExplorerCacheRow, string>;
	evalCache!: Table<EvalCacheRow, string>;
	games!: Table<GameRow, string>;
	memory!: Table<MemoryItem, string>;
	answers!: Table<AnswerRow, string>;
	runs!: Table<RunRow, string>;
	session!: Table<SavedSession, string>;
	mistakes!: Table<MistakeCard, string>;
	imported!: Table<ImportedGameRow, string>;
	labNotes!: Table<LabNote, string>;
	handles!: Table<LinkedHandle, string>;
	puzzleAttempts!: Table<PuzzleAttempt, string>;
	puzzleRating!: Table<PuzzleRatingRow, string>;
	commentaryRegister!: Table<CommentaryRegisterRow, string>;
	commentaryPages!: Table<CommentaryPageRow, string>;

	constructor() {
		super('offbook');
		this.version(1).stores({
			nodes: 'id, repertoireId, depth, parentId, reachProbability',
			drills: 'id, repertoireId, kind, sourceNodeId, frequencyWeight',
			attempts: 'id, ts, mode, drillId, sourceNodeId, sessionId',
			explorerCache: 'key, fetchedAt',
			evalCache: 'key, fetchedAt',
			games: 'id, platform, playedAt, speed',
		});
		this.version(2).stores({
			memory: 'key, dueAt, streak',
		});
		this.version(3).stores({
			answers: 'id, ts, runId, phase, ply',
			runs: 'id, ts',
		});
		this.version(4).stores({
			session: 'id',
		});
		this.version(5).stores({
			mistakes: 'id, dueAt, retired, phase',
		});
		this.version(6).stores({
			imported: 'id, platform, playedAt',
		});
		this.version(7).stores({
			// Keyed by puzzle AND ply: a note belongs to a position, not to a
			// puzzle, and the whole point is knowing which move it was written
			// about.
			labNotes: 'id, puzzleId, updatedAt',
		});
		this.version(8).stores({
			// A FileSystemFileHandle is structured-cloneable, so IndexedDB can keep
			// it and the file picker becomes a once-ever event rather than a
			// once-per-session one. localStorage cannot: it stringifies, and a
			// handle stringifies to "[object Object]".
			handles: 'id',
		});
		this.version(9).stores({
			// Two tables and not one: the register is a single row rebuilt whole
			// every ninety days, the pages are thousands of rows written once and
			// kept. Putting them together would mean rewriting every page cached
			// so far each time the register is refreshed.
			commentaryRegister: 'id, builtAt',
			commentaryPages: 'page, fetchedAt',
		});
		this.version(10).stores({
			/*
			 * PUZZLES: one row per attempt, plus one row holding the rating.
			 *
			 * Attempts rather than a per-puzzle record, because the same puzzle can
			 * be met again and the interesting questions — how your rating moved,
			 * how you do with help against without — are about the sequence, not
			 * about the latest state of each puzzle. Indexed on `at` because every
			 * read of it is "recently, in order".
			 *
			 * The rating lives in `puzzleRating` as a single row rather than being
			 * recomputed from the attempts on every load: `decayed` depends on the
			 * clock, so replaying history would give a different answer each time
			 * it ran, which is not what a stored rating should do.
			 */
			puzzleAttempts: 'id, at, puzzleId, solved',
			puzzleRating: 'id',
		});
		// AnswerRow gained `path` (the move sequence, replacing `lineIds`) without
		// a version bump: it is not an index, and Dexie stores undeclared fields
		// as they are. Bumping would have rebuilt the answers index for nothing.
		// Rows written before it are reported separately rather than misplaced —
		// see domain/tree.ts.
	}
}

export const db = new OffbookDb();

// `exportAll` lived here and exported nodes, drills, attempts and games — four
// tables that have been empty for the life of the app. It looked exactly like a
// backup and contained none of the history. Replaced by data/backup.ts, which
// exports what is actually irreplaceable.

// Games analysed for mistakes carry their moves, so the transfer measurement
// has a denominator: mistakes per game only means something against how many
// games reached the position at all.

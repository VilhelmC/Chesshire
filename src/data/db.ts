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
export type SavedSession = {
	id: 'current';
	ts: number;
	runId: string;
	/** RunState, stored opaquely: the shape belongs to engine/session.ts. */
	state: unknown;
	lossByPly: Record<number, number>;
	/**
	 * Opponent mistakes, keyed `ply|san`. Older rows hold bare ply numbers and
	 * are discarded on load — a ply number cannot be checked against the move
	 * actually played there, and marking the wrong move is worse than none.
	 */
	mistakePlies: (string | number)[];
	evals: (number | null)[];
	sawMistake: boolean;
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

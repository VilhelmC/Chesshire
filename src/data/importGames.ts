// Turning real games into flashcards.
//
// ---------------------------------------------------------------------------
// The deck used to contain only mistakes made in here, which biases it towards
// whatever the trainer happens to ask. The mistakes worth drilling most are the
// ones made when the game was real. This walks your recent Lichess and
// Chess.com games, finds the moves that cost something, and files them as cards.
//
// Two rules keep the deck honest:
//
//   * A game is analysed once. Re-importing does not bump a card's lapse count
//     — that number is meant to say how often you make the mistake, not how
//     often you pressed the button.
//   * At most MAX_PER_GAME cards from any one game, worst first. One collapse
//     should not drown out twenty other games.
// ---------------------------------------------------------------------------

import { db } from './db';
import { recordMistake } from './mistakes';
import { fetchLichessGames, fetchChesscomGames, type ImportedGame } from './games';
import { findMistakes, type AnalyseOptions, type GameMistake } from '../engine/analyseGame';
import { engine } from '../engine/stockfish';
import { positionKey, applyUci } from '../domain/chess';

/** Cards taken from a single game, worst first. */
export const MAX_PER_GAME = 4;

const LICHESS_USER_KEY = 'offbook.lichessUser';
const CHESSCOM_USER_KEY = 'offbook.chesscomUser';

export function getUsernames(): { lichess: string; chesscom: string } {
	try {
		return {
			lichess: localStorage.getItem(LICHESS_USER_KEY) ?? '',
			chesscom: localStorage.getItem(CHESSCOM_USER_KEY) ?? '',
		};
	} catch {
		return { lichess: '', chesscom: '' };
	}
}

export function setUsernames(u: { lichess: string; chesscom: string }): void {
	try {
		localStorage.setItem(LICHESS_USER_KEY, u.lichess.trim());
		localStorage.setItem(CHESSCOM_USER_KEY, u.chesscom.trim());
	} catch {
		/* private mode — the fields just will not persist */
	}
}

export type SourceStatus = {
	platform: 'lichess' | 'chesscom';
	state: 'idle' | 'fetching' | 'ok' | 'fail' | 'skipped';
	note: string;
	games: number;
};

export type ImportProgress = {
	stage: 'fetching' | 'analysing' | 'done';
	note: string;
	/** Games analysed so far / to analyse. */
	done: number;
	total: number;
	sources: SourceStatus[];
	cards: number;
	skipped: number;
};

export type ImportResult = {
	sources: SourceStatus[];
	analysed: number;
	skipped: number;
	cards: number;
	mistakes: (GameMistake & { game: ImportedGame })[];
	/** Positions evaluated across every game analysed. */
	measured: number;
	/** Positions that could not be evaluated. */
	unmeasured: number;
	/**
	 * Set when the engine could not be started, in which case NOTHING was
	 * analysed and `cards: 0` is not a statement about your games.
	 */
	engineError?: string;
};

export type ImportRequest = {
	lichess?: string;
	chesscom?: string;
	max?: number;
	minLoss?: number;
	/** Re-analyse games already imported. */
	force?: boolean;
	onProgress?: (p: ImportProgress) => void;
	shouldCancel?: () => boolean;
	/** Test seam, forwarded to findMistakes. */
	analyse?: AnalyseOptions['analyse'];
};

export async function importGames(req: ImportRequest): Promise<ImportResult> {
	const max = req.max ?? 20;
	const sources: SourceStatus[] = [];
	const emit = (p: Partial<ImportProgress> & Pick<ImportProgress, 'stage' | 'note'>) =>
		req.onProgress?.({ done: 0, total: 0, cards: 0, skipped: 0, sources: [...sources], ...p });

	// --- fetch --------------------------------------------------------------
	const games: ImportedGame[] = [];

	for (const [platform, name, fetcher] of [
		['lichess', req.lichess, fetchLichessGames],
		['chesscom', req.chesscom, fetchChesscomGames],
	] as const) {
		const status: SourceStatus = { platform, state: 'idle', note: '', games: 0 };
		sources.push(status);

		if (!name?.trim()) {
			status.state = 'skipped';
			status.note = 'no username';
			continue;
		}

		status.state = 'fetching';
		emit({ stage: 'fetching', note: `Fetching ${platform}…` });
		try {
			const got = await fetcher(name.trim(), { max, shouldCancel: req.shouldCancel });
			games.push(...got);
			status.state = 'ok';
			status.games = got.length;
			status.note = `${got.length} games`;
		} catch (e) {
			status.state = 'fail';
			// Both platforms fail the same way in a browser — a network-level
			// rejection with no status — so say what that usually means rather
			// than showing "Failed to fetch" and leaving it there.
			status.note = describeFetchError(e, platform);
		}
	}

	// --- pick what to analyse ------------------------------------------------
	const seen = req.force ? new Set<string>() : new Set((await safeImported()).map((r) => r.id));
	const todo = games.filter((g) => !seen.has(g.id)).sort((a, b) => b.playedAt - a.playedAt);
	const skipped = games.length - todo.length;

	// --- is there an engine at all? -----------------------------------------
	//
	// Checked ONCE, up front, rather than discovered forty positions in. A
	// worker that fails to load fails every position identically, and the old
	// code swallowed each failure and finished with "0 cards from 20 games" —
	// which reads as "you played twenty clean games". Never let a measurement
	// failure be reported as a measurement.
	//
	// Skipped when a test seam supplies its own analyse function.
	let engineError: string | undefined;
	if (!req.analyse && todo.length) {
		try {
			await engine.init();
		} catch (e) {
			engineError = e instanceof Error ? e.message : String(e);
			emit({ stage: 'done', note: engineError, done: 0, total: todo.length, cards: 0, skipped });
			return {
				sources,
				analysed: 0,
				skipped,
				cards: 0,
				mistakes: [],
				measured: 0,
				unmeasured: 0,
				engineError,
			};
		}
	}

	// --- analyse -------------------------------------------------------------
	const found: (GameMistake & { game: ImportedGame })[] = [];
	let cards = 0;
	let measured = 0;
	let unmeasured = 0;

	for (let i = 0; i < todo.length; i++) {
		if (req.shouldCancel?.()) break;
		const g = todo[i];
		emit({
			stage: 'analysing',
			note: `${g.platform} vs ${g.opponent} (${g.moves.length} plies)`,
			done: i,
			total: todo.length,
			cards,
			skipped,
		});

		const analysis = await findMistakes(g, {
			minLoss: req.minLoss,
			shouldCancel: req.shouldCancel,
			analyse: req.analyse,
		});
		measured += analysis.measured;
		unmeasured += analysis.unmeasured;

		const worst = [...analysis.mistakes].sort((a, b) => b.loss - a.loss).slice(0, MAX_PER_GAME);
		for (const m of worst) {
			await cardFor(m, g);
			cards++;
			found.push({ ...m, game: g });
		}

		await safePut({
			id: g.id,
			platform: g.platform,
			playedAt: g.playedAt,
			analysedAt: Date.now(),
			url: g.url,
			opponent: g.opponent,
			result: g.result,
			mistakes: worst.length,
			moves: [...g.moves],
			ourColour: g.ourColour,
			// Site evaluations when the game was analysed on Lichess, otherwise
			// the ones the local walk just produced. Either way they are kept:
			// re-deriving them means re-analysing the game.
			evals: mergeEvals(g.evals, analysis.evals),
		});
	}

	emit({
		stage: 'done',
		note:
			`${cards} cards from ${todo.length} games` +
			(unmeasured ? ` — ${unmeasured} positions could not be evaluated` : ''),
		done: todo.length,
		total: todo.length,
		cards,
		skipped,
	});

	return { sources, analysed: todo.length, skipped, cards, mistakes: found, measured, unmeasured };
}

/**
 * Prefer the site's evaluation, fall back to ours.
 *
 * Lichess's numbers come from a deeper search than a phone can run in 220ms, so
 * where they exist they are simply better. Ours fill the gaps rather than
 * replacing them, which also means a game analysed on the site costs us almost
 * nothing to measure.
 */
export function mergeEvals(
	site: (number | null)[] | undefined,
	local: (number | null)[],
): (number | null)[] {
	const length = Math.max(site?.length ?? 0, local.length);
	const out: (number | null)[] = [];
	for (let i = 0; i < length; i++) {
		const s = site?.[i];
		out.push(s !== undefined && s !== null ? s : (local[i] ?? null));
	}
	return out;
}

async function cardFor(m: GameMistake, g: ImportedGame): Promise<void> {
	let expectedSan = m.bestSan;
	try {
		expectedSan = applyUci(m.fen, m.bestUci).san;
	} catch {
		/* keep whatever findMistakes worked out */
	}

	await recordMistake({
		fen: m.fen,
		positionKey: positionKey(m.fen),
		ourColour: g.ourColour,
		expectedUci: m.bestUci,
		expectedSan,
		playedSan: m.playedSan,
		path: [...g.moves.slice(0, m.ply)],
		ply: m.ply,
		phase: 'game',
		...(m.motif ? { motif: m.motif } : {}),
		origin: {
			platform: g.platform,
			url: g.url,
			opponent: g.opponent,
			playedAt: g.playedAt,
			loss: m.loss,
		},
		now: Date.now(),
	});
}

function describeFetchError(e: unknown, platform: 'lichess' | 'chesscom'): string {
	const msg = e instanceof Error ? e.message : String(e);
	if (/failed to fetch|networkerror|load failed/i.test(msg)) {
		return platform === 'chesscom'
			? `${msg} — Chess.com's API sends no CORS header for some routes; if this keeps failing the games have to come in as PGN.`
			: `${msg} — check the network, or that the username exists.`;
	}
	if (/\b404\b/.test(msg)) return `${msg} — no such username on ${platform}.`;
	if (/\b429\b/.test(msg)) return `${msg} — rate limited, wait a minute.`;
	return msg;
}

async function safeImported() {
	try {
		return await db.imported.toArray();
	} catch {
		return [];
	}
}

async function safePut(row: Parameters<typeof db.imported.put>[0]) {
	try {
		await db.imported.put(row);
	} catch {
		/* bookkeeping only */
	}
}

export async function importedGames() {
	return (await safeImported()).sort((a, b) => b.playedAt - a.playedAt);
}

export async function clearImported(): Promise<void> {
	try {
		await db.imported.clear();
	} catch {
		/* ignore */
	}
}

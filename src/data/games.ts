// Importing your real games from Lichess and Chess.com.
//
// Both are public read-only endpoints. Lichess is the more useful of the two
// here: if a game has been analysed on the site, the response carries the
// per-move evaluations and Lichess's own blunder/mistake judgments, so those
// games cost us nothing to mine. Chess.com's public API returns PGN only, so
// those games have to be analysed locally.

import { getToken } from './explorer';
import { applySan, INITIAL_FEN } from '../domain/chess';

export type ImportedGame = {
	id: string;
	platform: 'lichess' | 'chesscom';
	url: string;
	playedAt: number;
	speed: string;
	ourColour: 'w' | 'b';
	opponent: string;
	result: 'win' | 'loss' | 'draw';
	/** SAN moves. */
	moves: string[];
	/**
	 * Site-provided evaluation per ply, White's point of view, where available.
	 * Index i is the position AFTER ply i. Missing entries fall through to local
	 * analysis.
	 */
	evals?: (number | null)[];
	/** Plies the site itself flagged as a blunder or mistake. */
	flagged?: number[];
};

export type ImportOptions = {
	max?: number;
	onProgress?: (msg: string) => void;
	shouldCancel?: () => boolean;
};

// --- Lichess ----------------------------------------------------------------

type LichessGame = {
	id: string;
	speed: string;
	createdAt: number;
	lastMoveAt: number;
	players: {
		white: { user?: { name?: string; id?: string } };
		black: { user?: { name?: string; id?: string } };
	};
	winner?: 'white' | 'black';
	moves?: string;
	analysis?: {
		eval?: number;
		mate?: number;
		best?: string;
		judgment?: { name: string; comment: string };
	}[];
};

export async function fetchLichessGames(
	username: string,
	opts: ImportOptions = {},
): Promise<ImportedGame[]> {
	const max = opts.max ?? 20;
	const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
	url.searchParams.set('max', String(max));
	url.searchParams.set('moves', 'true');
	url.searchParams.set('evals', 'true');

	const token = getToken();
	const res = await fetch(url.toString(), {
		headers: {
			Accept: 'application/x-ndjson',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
	if (!res.ok) throw new Error(`Lichess returned ${res.status}`);

	const text = await res.text();
	const games: ImportedGame[] = [];

	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		let g: LichessGame;
		try {
			g = JSON.parse(line) as LichessGame;
		} catch {
			continue;
		}
		if (!g.moves) continue;

		const white = g.players.white.user?.name ?? g.players.white.user?.id ?? '';
		const ourColour: 'w' | 'b' = sameUser(white, username) ? 'w' : 'b';
		const opponent =
			(ourColour === 'w' ? g.players.black.user?.name : g.players.white.user?.name) ?? 'anonymous';

		const evals: (number | null)[] = [];
		const flagged: number[] = [];
		if (g.analysis) {
			g.analysis.forEach((a, i) => {
				evals[i] =
					a.mate !== undefined
						? a.mate > 0
							? 10000 - a.mate * 10
							: -10000 - a.mate * 10
						: (a.eval ?? null);
				const name = a.judgment?.name?.toLowerCase();
				if (name === 'blunder' || name === 'mistake') flagged.push(i);
			});
		}

		games.push({
			id: `lichess:${g.id}`,
			platform: 'lichess',
			url: `https://lichess.org/${g.id}`,
			playedAt: g.lastMoveAt ?? g.createdAt,
			speed: g.speed,
			ourColour,
			opponent,
			result: !g.winner
				? 'draw'
				: g.winner === (ourColour === 'w' ? 'white' : 'black')
					? 'win'
					: 'loss',
			moves: g.moves.split(' ').filter(Boolean),
			evals: g.analysis ? evals : undefined,
			flagged: g.analysis ? flagged : undefined,
		});
	}

	opts.onProgress?.(`Lichess: ${games.length} games`);
	return games;
}

// --- Chess.com --------------------------------------------------------------

type ChesscomGame = {
	url: string;
	pgn?: string;
	time_class?: string;
	end_time?: number;
	white: { username: string; result: string };
	black: { username: string; result: string };
};

const DRAW_RESULTS = new Set([
	'agreed',
	'repetition',
	'stalemate',
	'insufficient',
	'50move',
	'timevsinsufficient',
]);

export async function fetchChesscomGames(
	username: string,
	opts: ImportOptions = {},
): Promise<ImportedGame[]> {
	const max = opts.max ?? 20;

	const archRes = await fetch(
		`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`,
	);
	if (!archRes.ok) throw new Error(`Chess.com returned ${archRes.status} for archives`);
	const { archives } = (await archRes.json()) as { archives: string[] };

	const games: ImportedGame[] = [];
	// Newest month first, stopping as soon as we have enough — the archive list
	// goes back to the account's first month and fetching all of it would be
	// rude and pointless.
	for (const monthUrl of [...archives].reverse()) {
		if (games.length >= max || opts.shouldCancel?.()) break;
		opts.onProgress?.(`Chess.com: ${monthUrl.slice(-7)}…`);

		const res = await fetch(monthUrl);
		if (!res.ok) continue;
		const { games: monthGames } = (await res.json()) as { games: ChesscomGame[] };

		for (const g of [...monthGames].reverse()) {
			if (games.length >= max) break;
			if (!g.pgn) continue;

			const ourColour: 'w' | 'b' = sameUser(g.white.username, username) ? 'w' : 'b';
			const moves = movesFromPgn(g.pgn);
			if (!moves.length) continue;

			const mine = ourColour === 'w' ? g.white.result : g.black.result;
			games.push({
				id: `chesscom:${g.url.split('/').pop()}`,
				platform: 'chesscom',
				url: g.url,
				playedAt: (g.end_time ?? 0) * 1000,
				speed: g.time_class ?? 'unknown',
				ourColour,
				opponent: ourColour === 'w' ? g.black.username : g.white.username,
				result: mine === 'win' ? 'win' : DRAW_RESULTS.has(mine) ? 'draw' : 'loss',
				moves,
			});
		}
	}

	opts.onProgress?.(`Chess.com: ${games.length} games`);
	return games;
}

// --- PGN --------------------------------------------------------------------

/**
 * SAN moves from a PGN.
 *
 * Deliberately small: strip what PGN puts between moves — headers, comments,
 * variations, NAGs, move numbers — then validate what is left by actually
 * playing it. A token that will not play ends the game as far as we are
 * concerned, which is safer than guessing at a malformed file.
 */
export function movesFromPgn(pgn: string): string[] {
	let body = pgn
		.replace(/\[[^\]]*\]/g, ' ') // headers
		.replace(/\{[^}]*\}/g, ' ') // comments, including clocks and evals
		.replace(/;[^\n]*/g, ' '); // rest-of-line comments

	// Variations nest, so peel them rather than trying to match with a regex.
	let depth = 0;
	let stripped = '';
	for (const ch of body) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		else if (depth === 0) stripped += ch;
	}
	body = stripped;

	const tokens = body
		.replace(/\$\d+/g, ' ')
		.replace(/\d+\.(\.\.)?/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.filter((t) => !['1-0', '0-1', '1/2-1/2', '*'].includes(t))
		// Suffix annotations (e4!, Nf3?!, Qh5!!) are part of the standard and
		// chessops will not parse a move that carries one. Check and mate marks
		// it does understand, so those stay.
		.map((t) => t.replace(/[!?]+$/, ''))
		.filter(Boolean);

	const moves: string[] = [];
	let fen = INITIAL_FEN;
	for (const t of tokens) {
		try {
			fen = applySan(fen, t).fen;
			moves.push(t);
		} catch {
			break;
		}
	}
	return moves;
}

function sameUser(a: string | undefined, b: string): boolean {
	return (a ?? '').toLowerCase() === b.toLowerCase();
}

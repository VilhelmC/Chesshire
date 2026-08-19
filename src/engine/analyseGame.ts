// Mining a real game for mistakes.
//
// ---------------------------------------------------------------------------
// Cost is the whole design constraint here.
//
// The obvious approach — evaluate the position before each of your moves, then
// evaluate it again after — is two searches per move, eighty searches for a
// forty-move game. One pass is enough: walk the game evaluating each position
// once, and the loss on your move at ply i is simply
//
//     eval(position before ply i) − eval(position after ply i)
//
// both from your point of view. That halves the work, and it also guarantees
// the two numbers being subtracted were measured identically — the mistake that
// broke the rating estimate earlier.
//
// Games already analysed on Lichess are free: the site's own evaluations come
// down with the game and no search is needed at all.
// ---------------------------------------------------------------------------

import { engine, toWhitePov } from './stockfish';
import { applySan, applyUci, sideToMove, INITIAL_FEN } from '../domain/chess';
import type { ImportedGame } from '../data/games';

const DEPTH = 12;
const MOVETIME_MS = 220;

/** Below this the move is not worth a flashcard. */
export const MISTAKE_CP = 150;
/**
 * Positions this lopsided are skipped.
 *
 * A blunder in a position already winning or already lost teaches nothing that
 * transfers — the game was decided before the move. What is worth drilling is a
 * mistake made while the game was still live.
 */
export const DECIDED_CP = 800;

export type GameMistake = {
	/** Position before the move, i.e. where the card starts. */
	fen: string;
	ply: number;
	playedSan: string;
	bestUci: string;
	bestSan: string;
	loss: number;
	evalBefore: number;
	source: 'site' | 'local';
};

/** One position's verdict, White's point of view. */
export type PositionEval = { cpWhite: number; bestUci: string | null };

export type AnalyseOptions = {
	onProgress?: (done: number, total: number) => void;
	shouldCancel?: () => boolean;
	minLoss?: number;
	/** Overridable so this is testable without a Worker. */
	analyse?: (fen: string) => Promise<PositionEval | null>;
};

async function defaultAnalyse(fen: string): Promise<PositionEval | null> {
	try {
		const r = await engine.analyse(fen, DEPTH, 1, MOVETIME_MS);
		const l = r.lines[0];
		if (!l) return null;
		return { cpWhite: toWhitePov(l.cp, sideToMove(fen)), bestUci: l.pv[0] ?? null };
	} catch {
		return null;
	}
}

export async function findMistakes(
	game: ImportedGame,
	opts: AnalyseOptions = {},
): Promise<GameMistake[]> {
	const minLoss = opts.minLoss ?? MISTAKE_CP;
	const ourColour = game.ourColour;

	// Replay once, keeping every position.
	const positions: string[] = [INITIAL_FEN];
	let fen = INITIAL_FEN;
	for (const san of game.moves) {
		try {
			fen = applySan(fen, san).fen;
		} catch {
			break;
		}
		positions.push(fen);
	}

	// Our plies only — the opponent's mistakes are not our flashcards.
	const ourPlies = positions
		.slice(0, -1)
		.map((p, i) => ({ i, stm: sideToMove(p) }))
		.filter((x) => x.stm === ourColour)
		.map((x) => x.i);

	const out: GameMistake[] = [];
	const search = opts.analyse ?? defaultAnalyse;
	type Verdict = { cp: number; best: string | null; source: 'site' | 'local' };
	const evalCache = new Map<number, Verdict>();

	/** Evaluation of positions[idx], our point of view. */
	const evalAt = async (idx: number): Promise<Verdict | null> => {
		const cached = evalCache.get(idx);
		if (cached) return cached;

		// Lichess indexes its analysis by the position AFTER each ply, so
		// positions[idx] corresponds to analysis entry idx-1.
		const site = game.evals?.[idx - 1];
		if (idx > 0 && site !== undefined && site !== null) {
			const v: Verdict = { cp: pov(site, ourColour), best: null, source: 'site' };
			evalCache.set(idx, v);
			return v;
		}

		const r = await search(positions[idx]);
		if (!r) return null;
		const v: Verdict = { cp: pov(r.cpWhite, ourColour), best: r.bestUci, source: 'local' };
		evalCache.set(idx, v);
		return v;
	};

	for (let n = 0; n < ourPlies.length; n++) {
		if (opts.shouldCancel?.()) break;
		const i = ourPlies[n];
		opts.onProgress?.(n + 1, ourPlies.length);

		const before = await evalAt(i);
		const after = await evalAt(i + 1);
		if (!before || !after) continue;

		// Already decided — see DECIDED_CP.
		if (Math.abs(before.cp) > DECIDED_CP) continue;

		const loss = before.cp - after.cp;
		if (loss < minLoss) continue;

		// The card needs a move to ask for. Site evaluations do not carry one, so
		// this is the only place a second search is unavoidable — and it happens
		// only for the handful of plies that already look like mistakes.
		let bestUci = before.best;
		if (!bestUci) {
			bestUci = (await search(positions[i]))?.bestUci ?? null;
		}
		if (!bestUci) continue;

		let bestSan = bestUci;
		try {
			bestSan = sanOfUci(positions[i], bestUci);
		} catch {
			/* keep the uci */
		}

		// If the engine's move IS what was played, the loss came from measurement
		// noise rather than from the move.
		if (bestSan === game.moves[i]) continue;

		out.push({
			fen: positions[i],
			ply: i,
			playedSan: game.moves[i],
			bestUci,
			bestSan,
			loss: Math.round(loss),
			evalBefore: Math.round(before.cp),
			source: before.source,
		});
	}

	return out;
}

function pov(cpWhite: number, colour: 'w' | 'b'): number {
	return colour === 'w' ? cpWhite : -cpWhite;
}

function sanOfUci(fen: string, uci: string): string {
	return applyUci(fen, uci).san;
}

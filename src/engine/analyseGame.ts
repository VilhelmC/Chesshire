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
import { winPercent, JUDGEMENT } from '../domain/accuracy';
import { classifyMove } from '../domain/classify';
import { missedTheChance } from '../domain/annotate';
import { applySan, applyUci, sideToMove, INITIAL_FEN } from '../domain/chess';
import type { ImportedGame } from '../data/games';

const DEPTH = 12;
const MOVETIME_MS = 220;

/**
 * Below this the move is not worth a flashcard — as a drop in WIN PERCENTAGE.
 *
 * ---------------------------------------------------------------------------
 * This used to be 150 centipawns, which is the model Lichess abandoned and for
 * a demonstrable reason: +900 to +600 is 300 centipawns and almost no change in
 * the outcome, while 150 either side of level decides the game. A centipawn
 * threshold therefore mines cards out of positions that were already won and
 * misses the moves that actually mattered.
 *
 * 20 points of win chance is Lichess's own "mistake" threshold. It is a
 * stricter filter than 150cp near equality and a far looser one in a decided
 * position, which is the whole point. See METRICS.md §3.
 * ---------------------------------------------------------------------------
 */
export const MISTAKE_WIN_DROP = JUDGEMENT.mistake;

/**
 * Retained for the settings UI, which still asks in centipawns.
 *
 * Kept as the equivalent near equality rather than deleted, so an existing
 * stored preference keeps roughly its old meaning.
 */
export const MISTAKE_CP = 150;

/**
 * Positions this lopsided are skipped.
 *
 * A blunder in a position already winning or already lost teaches nothing that
 * transfers — the game was decided before the move. Now largely redundant,
 * because a win-percentage threshold already declines to care about swings in
 * decided positions; kept as a hard floor for the extremes where the logistic
 * is flat enough that even a huge centipawn move registers as nothing.
 */
export const DECIDED_CP = 800;

/** A centipawn threshold expressed as the win-percentage drop it means at level. */
export function winDropFor(cp: number): number {
	return winPercent(0) - winPercent(-cp);
}

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
	/**
	 * Why this position is worth a card.
	 *
	 * 'missed-punish' means the move before it was THEIR blunder and we handed
	 * most of it back. It earns its own name because it is the app's whole
	 * thesis, and because it is judged by a different rule — see below.
	 */
	motif?: 'missed-punish';
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
	// Deliberately NOT wrapped in try/catch. It used to be, and that is how an
	// engine which never loaded at all turned into "0 cards from 20 games" — a
	// sentence about your play, produced by a program that had measured nothing.
	// Errors belong to the caller, which counts them and says so.
	const r = await engine.analyse(fen, DEPTH, 1, MOVETIME_MS);
	const l = r.lines[0];
	if (!l) return null;
	return { cpWhite: toWhitePov(l.cp, sideToMove(fen)), bestUci: l.pv[0] ?? null };
}

/**
 * What one game's analysis found, and how much of it was actually measured.
 *
 * `unmeasured` is the point. An empty `mistakes` list means one of two very
 * different things — you played it clean, or nothing could be evaluated — and
 * the deck is worthless if it cannot tell them apart.
 */
export type GameAnalysis = {
	mistakes: GameMistake[];
	/** Positions successfully evaluated. */
	measured: number;
	/** Positions that could not be evaluated, so were skipped. */
	unmeasured: number;
	/**
	 * Evaluation after each ply, WHITE's point of view. Index i is the position
	 * after ply i. Null where nothing evaluated it.
	 *
	 * Returned rather than discarded because it is the whole basis of every
	 * measurable thing about a game — accuracy, ACPL, judgement counts — and it
	 * cannot be recovered later without analysing the game a second time.
	 *
	 * Note this walk covers nearly every ply, not only ours: evaluating the
	 * positions either side of each of our moves visits i and i+1 for every one
	 * of our plies, and those interleave to cover the whole game.
	 */
	evals: (number | null)[];
};

export async function findMistakes(
	game: ImportedGame,
	opts: AnalyseOptions = {},
): Promise<GameAnalysis> {
	// The caller still speaks centipawns; convert once, at the edge.
	const minWinDrop = opts.minLoss === undefined ? MISTAKE_WIN_DROP : winDropFor(opts.minLoss);
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
	let measured = 0;
	let unmeasured = 0;
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

		let r: PositionEval | null;
		try {
			r = await search(positions[idx]);
		} catch {
			// One position failing is survivable and is counted. A dead engine
			// fails EVERY position, which is why importGames checks the engine is
			// alive before it starts rather than inferring it from a tally here.
			unmeasured++;
			return null;
		}
		if (!r) {
			unmeasured++;
			return null;
		}
		measured++;
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

		const loss = before.cp - after.cp;

		// ------------------------------------------------------------------
		// Did they just blunder, and did we give it back?
		//
		// This mattered enough to be worth its own rule. Import mined only our
		// own errors, so the single most important position in this trainer —
		// they hung something and we did not take it — never became a card. It
		// was also invisible to the ordinary test twice over: the position
		// after their blunder is often past DECIDED_CP, and giving back 400cp
		// of a +700 is barely any change in win percentage. Both filters are
		// right for ordinary moves and wrong for exactly this one.
		//
		// The evaluation either side of THEIR move is already cached: our plies
		// alternate with theirs, so positions[i-1] was measured as the "after"
		// of our previous move. No extra search.
		// ------------------------------------------------------------------
		const theirs = i > 0 ? await evalAt(i - 1) : null;
		const gift = theirs ? before.cp - theirs.cp : 0;
		const missed =
			!!theirs &&
			classifyMove(theirs.cp, before.cp) === 'blunder' &&
			missedTheChance(gift, loss, after.cp);

		if (!missed) {
			// Already decided — see DECIDED_CP.
			if (Math.abs(before.cp) > DECIDED_CP) continue;

			// The judgement is on win percentage, not centipawns: how much the
			// move changed the likely OUTCOME, which is the thing worth a
			// flashcard.
			const winDrop = winPercent(before.cp) - winPercent(after.cp);
			if (winDrop < minWinDrop) continue;
		}

		// The card needs a move to ask for. Site evaluations do not carry one, so
		// this is the only place a second search is unavoidable — and it happens
		// only for the handful of plies that already look like mistakes.
		let bestUci = before.best;
		if (!bestUci) {
			try {
				bestUci = (await search(positions[i]))?.bestUci ?? null;
			} catch {
				unmeasured++;
				continue;
			}
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
			...(missed ? { motif: 'missed-punish' as const } : {}),
		});
	}

	// White's point of view, dropping index 0 — the starting position, which is
	// a known constant rather than a measurement.
	const evals: (number | null)[] = positions
		.slice(1)
		.map((_, i) => {
			const v = evalCache.get(i + 1);
			if (!v) return null;
			return ourColour === 'w' ? v.cp : -v.cp;
		});

	return { mistakes: out, measured, unmeasured, evals };
}

function pov(cpWhite: number, colour: 'w' | 'b'): number {
	return colour === 'w' ? cpWhite : -cpWhite;
}

function sanOfUci(fen: string, uci: string): string {
	return applyUci(fen, uci).san;
}

// Drill generation, lazily, one position at a time.
//
// The whole trainer in one idea: take a state on a canonical line; either ask
// for the book move (memorisation), or inject a plausible non-book opponent
// move and ask for the refutation (punishment). Two API calls, both cached:
// one explorer lookup for what opponents actually play there, one evaluation
// for the answer.
//
// The previous design built an exhaustive weighted tree of every reply at every
// node before showing a single position — about a hundred calls, minutes of
// waiting, and rate-limit errors. That machinery answers "which drill matters
// most", which is a question you do not need answered in order to train.

import { fetchExplorer } from '../data/explorer';
import { analysePosition, toColourPov } from '../data/cloudEval';
import { applyUci, playSanLine, sideToMove, INITIAL_FEN } from '../domain/chess';
import { detectMotifs } from './motifs';
import type { Line } from '../domain/lines';
import type { Motif } from '../domain/types';

export type DrillKind = 'book' | 'deviation';

export type Drill = {
	kind: DrillKind;
	line: Line;
	/** Position the user must move in. */
	fen: string;
	/** SAN moves played to reach it. */
	path: string[];
	ourColour: 'w' | 'b';
	/** The opponent move that created this position, for a deviation drill. */
	trigger?: {
		san: string;
		uci: string;
		/** Share of players at your band who play it here. */
		frequency: number;
		/** The book move it replaced. */
		insteadOf: string;
	};
	/** Accepted answer(s). */
	answer: { uci: string; san: string };
	/** Engine continuation after the answer, for feedback. */
	continuation: string[];
	/** Evaluation after the answer, our point of view, centipawns. */
	evalAfter: number;
	/** Evaluation before their move — the baseline the deviation is judged against. */
	evalBefore: number;
	/** How bad their move is. Sound moves are never offered — see below. */
	severity: 'blunder' | 'inaccuracy';
	motifs: Motif[];
};

export type GradeResult = {
	correct: boolean;
	/** The move the user played, so feedback can replay from the right position. */
	uci: string;
	/** Centipawns lost versus the best move. */
	cpLoss: number;
	/** Engine reply to the user's move — the consequence, for feedback. */
	refutation: string[];
	san: string;
	message: string;
};

/** Accept anything within this of the best move — several moves are often fine. */
const ACCEPT_MARGIN = 60;
const EVAL_DEPTH = 20;

/**
 * A deviation is only worth drilling if it is actually a mistake.
 *
 * The first version sampled any move that was not the one in our line and
 * called it a deviation. That is the wrong concept: 2...Nf6 in the Italian move
 * order is the Petroff — we are still in book, just not the book we chose. It
 * was offered with "punish it", which is false and teaches a beginner to hunt
 * for refutations that do not exist.
 *
 * Note that the explorer's ECO name cannot be used as the filter: Damiano's
 * Defence (2...f6) is named theory, ECO C40, and is one of the best punishment
 * targets in the whole opening. Named is not the same as sound. The filter has
 * to be evaluation.
 */
const MISTAKE_CP = 60;
const BLUNDER_CP = 120;
/** Candidate replies evaluated per node before giving up on it. */
const CANDIDATES = 5;

type Rng = () => number;

/**
 * Build one drill from a line.
 *
 * `deviationChance` mixes the two modes: memorising the line, and being tested
 * on what to do when the opponent leaves it. Both matter, and neither works
 * alone — you cannot recognise a departure from a line you do not know.
 */
export async function makeDrill(
	line: Line,
	opts: { deviationChance?: number; rng?: Rng } = {},
): Promise<Drill> {
	const rng = opts.rng ?? Math.random;
	const deviationChance = opts.deviationChance ?? 0.5;

	const { ucis } = playSanLine(line.moves);
	const positions = replayPositions(line.moves);

	const wantDeviation = rng() < deviationChance;

	if (wantDeviation) {
		const drill = await makeDeviationDrill(line, ucis, positions, rng);
		if (drill) return drill;
		// Fall through to a book drill if no plausible deviation was available.
	}

	return makeBookDrill(line, ucis, positions, rng);
}

/** Ask for the line's own move — plain memorisation. */
function makeBookDrill(line: Line, ucis: string[], positions: string[], rng: Rng): Drill {
	const ourPlies = ucis
		.map((_, i) => i)
		.filter((i) => sideToMove(positions[i]) === line.colour);
	const ply = ourPlies[Math.floor(rng() * ourPlies.length)];

	const fen = positions[ply];
	const move = applyUci(fen, ucis[ply]);

	return {
		kind: 'book',
		line,
		fen,
		path: sansUpTo(positions, ucis, ply),
		ourColour: line.colour,
		answer: { uci: ucis[ply], san: move.san },
		continuation: ucis.slice(ply + 1, ply + 5),
		evalAfter: 0,
		evalBefore: 0,
		severity: 'inaccuracy',
		motifs: [],
	};
}

/**
 * Replace an opponent move with something they actually play instead, and ask
 * for the best answer.
 */
async function makeDeviationDrill(
	line: Line,
	ucis: string[],
	positions: string[],
	rng: Rng,
): Promise<Drill | null> {
	const theirPlies = ucis
		.map((_, i) => i)
		.filter((i) => sideToMove(positions[i]) !== line.colour);
	if (!theirPlies.length) return null;

	// Try a few nodes before giving up — some have no usable alternatives.
	const order = shuffle(theirPlies, rng);

	for (const ply of order.slice(0, 3)) {
		const fen = positions[ply];
		const bookUci = ucis[ply];

		let data;
		try {
			data = await fetchExplorer(fen);
		} catch {
			return null;
		}

		const total = data.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0);
		if (!total) continue;

		const alternatives = data.moves
			.map((m) => ({ m, freq: (m.white + m.draws + m.black) / total }))
			.filter((c) => c.m.uci !== bookUci && c.freq >= 0.01)
			.slice(0, CANDIDATES);
		if (!alternatives.length) continue;

		const baseline = await analysePosition(fen, EVAL_DEPTH, 1);
		const evalBefore = toColourPov(baseline.pvs[0]?.cpWhite ?? 0, line.colour);

		// Evaluate the candidates and keep only the genuine mistakes. Everything
		// else is a different opening, not a drill — see MISTAKE_CP above.
		const mistakes: {
			m: (typeof alternatives)[number]['m'];
			freq: number;
			fen: string;
			evalAfter: number;
			delta: number;
			pv: string[];
		}[] = [];

		for (const c of alternatives) {
			let after: { fen: string; san: string };
			try {
				after = applyUci(fen, c.m.uci);
			} catch {
				continue;
			}
			const a = await analysePosition(after.fen, EVAL_DEPTH, 1);
			const pv = a.pvs[0]?.pv ?? [];
			if (!pv.length) continue;

			const evalAfter = toColourPov(a.pvs[0].cpWhite, line.colour);
			const delta = evalAfter - evalBefore;
			if (delta >= MISTAKE_CP) {
				mistakes.push({ m: c.m, freq: c.freq, fen: after.fen, evalAfter, delta, pv });
			}
		}

		if (!mistakes.length) continue;

		// Prefer outright blunders; fall back to inaccuracies at the same node.
		const blunders = mistakes.filter((x) => x.delta >= BLUNDER_CP);
		const pool = blunders.length ? blunders : mistakes;
		const picked = weightedPick(pool, (x) => x.freq, rng);

		let answerSan: string;
		const answerUci = picked.pv[0];
		try {
			answerSan = applyUci(picked.fen, answerUci).san;
		} catch {
			continue;
		}

		return {
			kind: 'deviation',
			line,
			fen: picked.fen,
			path: [...sansUpTo(positions, ucis, ply), picked.m.san],
			ourColour: line.colour,
			trigger: {
				san: picked.m.san,
				uci: picked.m.uci,
				frequency: picked.freq,
				insteadOf: applyUci(fen, bookUci).san,
			},
			answer: { uci: answerUci, san: answerSan },
			continuation: picked.pv.slice(1, 5),
			evalAfter: picked.evalAfter,
			evalBefore,
			severity: picked.delta >= BLUNDER_CP ? 'blunder' : 'inaccuracy',
			motifs: detectMotifs(picked.fen, answerUci),
		};
	}

	return null;
}

/**
 * Grade an attempt.
 *
 * A move that is not the engine's first choice is not automatically wrong —
 * several moves are often equally good, and marking them wrong teaches
 * superstition. Anything within ACCEPT_MARGIN of the best passes.
 */
export async function grade(drill: Drill, uci: string): Promise<GradeResult> {
	let san = uci;
	try {
		san = applyUci(drill.fen, uci).san;
	} catch {
		return {
			correct: false,
			uci,
			cpLoss: 0,
			refutation: [],
			san: uci,
			message: 'That move is not legal here.',
		};
	}

	if (uci === drill.answer.uci) {
		return {
			correct: true,
			uci,
			cpLoss: 0,
			refutation: drill.continuation,
			san,
			message: drill.kind === 'book' ? 'Correct — that is the line.' : 'Correct.',
		};
	}

	// Book drills have exactly one right answer: the line is the point.
	if (drill.kind === 'book') {
		return {
			correct: false,
			uci,
			cpLoss: 0,
			refutation: [],
			san,
			message: `The line goes ${drill.answer.san}.`,
		};
	}

	const after = applyUci(drill.fen, uci).fen;
	const analysis = await analysePosition(after, EVAL_DEPTH, 1);
	const theirs = toColourPov(analysis.pvs[0]?.cpWhite ?? 0, drill.ourColour);
	const cpLoss = drill.evalAfter - theirs;

	if (cpLoss <= ACCEPT_MARGIN) {
		return {
			correct: true,
			uci,
			cpLoss,
			refutation: analysis.pvs[0]?.pv.slice(0, 4) ?? [],
			san,
			message: `Good — ${san} is fine too (${cpLoss}cp behind ${drill.answer.san}).`,
		};
	}

	return {
		correct: false,
		uci,
		cpLoss,
		refutation: analysis.pvs[0]?.pv.slice(0, 4) ?? [],
		san,
		message: `${san} gives up ${cpLoss}cp. ${drill.answer.san} was the move.`,
	};
}

// --- helpers ---------------------------------------------------------------

function replayPositions(moves: string): string[] {
	const { ucis } = playSanLine(moves);
	const out = [INITIAL_FEN];
	let fen = INITIAL_FEN;
	for (const uci of ucis) {
		fen = applyUci(fen, uci).fen;
		out.push(fen);
	}
	return out;
}

function sansUpTo(positions: string[], ucis: string[], ply: number): string[] {
	const sans: string[] = [];
	for (let i = 0; i < ply; i++) sans.push(applyUci(positions[i], ucis[i]).san);
	return sans;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T {
	const total = items.reduce((s, t) => s + weight(t), 0);
	let r = rng() * total;
	for (const t of items) {
		r -= weight(t);
		if (r <= 0) return t;
	}
	return items[items.length - 1];
}

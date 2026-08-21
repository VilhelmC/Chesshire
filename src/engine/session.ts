// A training run: play the opening from move 1.
//
// The previous trainer jumped between isolated positions. That strips the cue
// you actually recall an opening move from — the sequence. It also made every
// drill a recognition test for a position you had never seen in context.
//
// A run starts at move 1 and continues to the end of a line. At each of their
// turns the opponent either plays on into one of the variations you are
// training, or plays a genuine mistake, and you have to notice which. Reset and
// they may choose differently, so the variations interleave naturally instead
// of being blocked one at a time.

import { fetchExplorer } from '../data/explorer';
import { analysePosition, toColourPov } from '../data/cloudEval';
import { applyUci, applySan, positionKey, sideToMove, sameMove, INITIAL_FEN } from '../domain/chess';
import { weightFor, itemKey, type MemoryStore } from '../domain/scheduler';
import { detectMotifs } from './motifs';
import { scoreMove } from './score';
import {
	classifyBook,
	acceptable,
	opponentBook,
	punishable,
	openingName,
	movesTowardRoots,
	liveRoots,
	SOUND_CP,
	type BookMove,
} from '../domain/book';
import type { PracticeConfig } from '../domain/practice';
import { nameForPath } from '../domain/openings';
import type { Motif } from '../domain/types';
import { withGlyph, other } from '../domain/notation';
import { materialBalance as balanceOf, describeBalance } from '../domain/material';

const EVAL_DEPTH = 20;
const ACCEPT_MARGIN = 60;
const MISTAKE_CP = 60;
const BLUNDER_CP = 120;
/** Our moves demanded after a mistake before the run is called won. */
const MAX_PUNISH_PLIES = 3;
/** Evaluation at which the punishment is judged complete. */
const WIN_CP = 250;

export type Phase = 'book' | 'punish' | 'freeplay' | 'done';

export type OpponentMove = {
	uci: string;
	san: string;
	kind: 'book' | 'mistake';
	/** Share of players at your band who play it here. */
	frequency: number;
	severity?: 'blunder' | 'inaccuracy';
	/** Which line this continues, when it is a book move. */
	lineName?: string;
};

/**
 * A position a run can be replayed from.
 *
 * "Again from move 1" is the wrong granularity when the thing you got wrong
 * happened on move 6 — you do not want to replay five moves you already know to
 * retry the one you do not.
 */
export type RestorePoint = {
	fen: string;
	path: string[];
	phase: Phase;
	lastOpponent: OpponentMove | null;
	evalNow: number | null;
	motifs: Motif[];
	label: string;
	/**
	 * Replies already seen from this position, so the opponent picks a new one.
	 *
	 * Replaying the identical reply is rehearsal; replaying the same POSITION
	 * with a different reply is what actually tests whether you can tell a
	 * mistake from a book move.
	 *
	 * A LIST, not a single move. With one, pressing "they try something else"
	 * twice could hand back the reply from two presses ago and bounce between
	 * two of five alternatives forever. The list is reset once every reply has
	 * been seen, so it cycles rather than running dry.
	 */
	avoid?: string[];
};

export type RunState = {
	fen: string;
	/** SAN moves played so far. */
	path: string[];
	ourColour: 'w' | 'b';
	phase: Phase;
	/**
	 * What the explorer calls this position. Discovered by playing, not chosen
	 * in advance — this is the whole point of dropping the hardcoded lines.
	 */
	opening: { name: string; eco: string } | null;
	/** Every reply the explorer knows here, classified. Empty when it is not our move. */
	bookHere: BookMove[];
	/** Moves accepted right now. Empty while it is not our turn. */
	expected: { uci: string; san: string }[];
	lastOpponent: OpponentMove | null;
	motifs: Motif[];
	evalNow: number | null;
	punishPlies: number;
	finished: null | 'line-complete' | 'punished' | 'abandoned' | 'resigned';
	note: string | null;
	/**
	 * The scheduler key for the opponent move being answered right now, so the
	 * caller can record whether it was met correctly.
	 */
	currentItem: string | null;
	/** Where the opponent last had a real choice of variation. */
	branchPoint: RestorePoint | null;
	/** The position right after their last mistake — replays the same mistake. */
	deviationPoint: RestorePoint | null;
	/** The position just BEFORE their last move — replays with a different one. */
	retryPoint: RestorePoint | null;
};

export type BookAt = (
	fen: string,
	mover: 'w' | 'b',
	minFreq: number,
) => Promise<{ moves: BookMove[]; name: string | null; eco: string | null }>;

export type SessionConfig = {
	/** What is being practised: colour, strictness, pinned root. */
	practice: PracticeConfig;
	/**
	 * Where the book comes from. Defaults to the Lichess explorer plus the
	 * engine; overridable so a run can be driven from a fixed book in a test,
	 * which is the only way to exercise this offline now that the lines are gone.
	 */
	classify?: BookAt;
	rng?: () => number;
	/**
	 * Scheduling state. Moves you keep getting right are sampled less often, so
	 * the opponent stops replaying the one mistake you have already learned.
	 */
	memory?: MemoryStore;
	now?: () => number;
	/** Engine strength for free play. See domain/rating.ts. */
	bot?: { window: number; movetimeMs: number };
};

export type MoveOutcome = {
	state: RunState;
	correct: boolean;
	/** Centipawns behind the best move. Zero when the expected move was played. */
	cpLoss: number;
	message: string;
	/** Engine reply to a wrong move — the consequence to show. */
	refutation: string[];
	played: string;
};

// --- the book ---------------------------------------------------------------

/**
 * How many candidates get an evaluation, and how much each one may cost.
 *
 * ---------------------------------------------------------------------------
 * This is the whole latency budget, and the first version got it badly wrong:
 * it evaluated six candidates at both ends of every ply, sequentially, at depth
 * 20. Fourteen searches per move, each one either a throttled round trip or a
 * multi-second local search when the cloud had never seen the position — which
 * it often has not, nine moves into a specific variation. Play became unusable.
 *
 * Three changes, in order of how much they bought:
 *
 *   1. The opponent's node is not evaluated at all unless a mistake is actually
 *      being offered this ply. Choosing a book reply needs frequencies, not
 *      evaluations, so roughly two thirds of plies now cost nothing there.
 *   2. Candidates are evaluated CONCURRENTLY rather than in a loop.
 *   3. A classification search is bounded by movetime, so a cloud miss costs a
 *      fifth of a second rather than however long depth 20 happens to take.
 *
 * The eval bar keeps the old deep call, because it is one search per ply and
 * shares a cache key with everything else that asks the same question.
 * ---------------------------------------------------------------------------
 */
const CLASSIFY_TOP = 4;
const CLASSIFY_DEPTH = 14;
const CLASSIFY_MOVETIME_MS = 200;

export type ClassifyAtOptions = {
	/**
	 * Measure how much each candidate costs. Without this, verdicts come from
	 * frequency alone and `cpLoss` stays null — honest, and enough to choose a
	 * reply, but not enough to tell a popular move from a popular blunder.
	 */
	withEvals?: boolean;
};

/** What is played here, and — when asked — what the engine thinks of it. */
async function classifyAt(
	fen: string,
	mover: 'w' | 'b',
	minFreq: number,
	opts: ClassifyAtOptions = {},
): Promise<{ moves: BookMove[]; name: string | null; eco: string | null }> {
	const data = await fetchExplorer(fen);
	const total = data.moves.reduce((sum, m) => sum + m.white + m.draws + m.black, 0);
	const naming = { name: openingName(data), eco: data.opening?.eco ?? null };
	if (!total) return { moves: [], ...naming };

	const losses = new Map<string, number>();

	if (opts.withEvals) {
		const top = [...data.moves]
			.sort((a, b) => b.white + b.draws + b.black - (a.white + a.draws + a.black))
			.slice(0, CLASSIFY_TOP);

		const base = await evalOf(fen, mover);
		if (base !== null) {
			// Concurrently: these are independent questions, and asking them one
			// after another was most of the wait.
			const scored = await Promise.all(
				top.map(async (m) => {
					const after = safePlay(fen, m.uci);
					if (!after) return null;
					const cp = await evalOf(after, mover);
					return cp === null ? null : ([m.uci, Math.max(0, base - cp)] as const);
				}),
			);
			for (const row of scored) if (row) losses.set(row[0], row[1]);
		}
	}

	return { moves: classifyBook(data, { losses, minFreq }), ...naming };
}

/** A bounded evaluation from the mover's side, or null if it could not be had. */
async function evalOf(fen: string, mover: 'w' | 'b'): Promise<number | null> {
	try {
		const a = await analysePosition(fen, CLASSIFY_DEPTH, 1, CLASSIFY_MOVETIME_MS);
		return toColourPov(a.pvs[0]?.cpWhite ?? 0, mover);
	} catch {
		// Unmeasured stays null rather than zero: an unknown move must not be able
		// to pass as a perfect one.
		return null;
	}
}

function safePlay(fen: string, uci: string): string | null {
	try {
		return applyUci(fen, uci).fen;
	} catch {
		return null;
	}
}

// --- run --------------------------------------------------------------------

export async function startRun(cfg: SessionConfig): Promise<RunState> {
	const ourColour = cfg.practice.colour;
	let state: RunState = {
		fen: INITIAL_FEN,
		path: [],
		ourColour,
		phase: 'book',
		opening: null,
		bookHere: [],
		expected: [],
		lastOpponent: null,
		motifs: [],
		evalNow: null,
		punishPlies: 0,
		finished: null,
		note: null,
		branchPoint: null,
		deviationPoint: null,
		retryPoint: null,
		currentItem: null,
	};

	// One root per run, chosen at random when several are pinned — that is how
	// several openings interleave instead of being blocked one at a time.
	const roots = cfg.practice.roots;
	const chosen = roots.length ? roots[Math.floor((cfg.rng ?? Math.random)() * roots.length)] : null;

	// Played for you only if asked. The moves that reach an opening are part of
	// the opening, and having them handed to you every run is the opposite of
	// practising them — but replaying eleven known moves to get to move 12 is
	// also a waste, so it is a toggle rather than a rule.
	if (chosen && !cfg.practice.playFromStart) {
		for (const san of chosen.path) {
			const applied = trySan(state.fen, san);
			if (!applied) break;
			state = {
				...state,
				fen: applied.fen,
				path: [...state.path, san],
				lastOpponent:
					sideToMove(state.fen) === ourColour
						? state.lastOpponent
						: { uci: applied.uci, san, kind: 'book', frequency: 0 },
			};
		}
	}

	// If they move first from here, get their move in before handing over.
	if (sideToMove(state.fen) !== ourColour) state = await opponentMove(state, cfg);
	return withExpected(state, cfg);
}

function trySan(fen: string, san: string): { fen: string; uci: string } | null {
	try {
		return applySan(fen, san);
	} catch {
		return null;
	}
}

/**
 * Carry on playing from the current position against the engine.
 *
 * A won position is not a won game. Reaching +2 in a drill and being able to
 * convert it are different skills, and the second is the one that decides games
 * at this level — so the drill can hand over rather than just stopping.
 */
export async function playOn(state: RunState, cfg: SessionConfig): Promise<RunState> {
	let next: RunState = { ...state, phase: 'freeplay', finished: null, note: null };
	if (sideToMove(next.fen) !== next.ourColour) next = await freeplayReply(next, cfg);
	return withExpected(next, cfg);
}

/**
 * The engine's reply during free play, deliberately not its best.
 *
 * Full-strength Stockfish converting against a 1200 is not a training exercise,
 * it is a demoralisation exercise. Sampling among moves within 150cp keeps the
 * opposition real without making the win impossible.
 */
async function freeplayReply(state: RunState, cfg?: SessionConfig): Promise<RunState> {
	const bot = cfg?.bot ?? { window: 200, movetimeMs: 200 };
	const a = await analysePosition(state.fen, 12, 4, bot.movetimeMs);
	const theirColour: 'w' | 'b' = state.ourColour === 'w' ? 'b' : 'w';
	const ranked = a.pvs
		.map((p) => ({ uci: p.pv[0], cp: toColourPov(p.cpWhite, theirColour) }))
		.filter((p) => p.uci)
		.sort((x, y) => y.cp - x.cp);
	if (!ranked.length) return { ...state, finished: 'abandoned', note: 'No reply found.' };

	// Weakness is mostly the width of the window it chooses from: an engine
	// picking among its own near-best moves plays like a weaker human, whereas a
	// crippled search plays incoherently, which is not the same opponent.
	const plausible = ranked.filter((p) => ranked[0].cp - p.cp <= bot.window);
	const pool = plausible.length ? plausible : [ranked[0]];
	const pick = pool[Math.floor((cfg?.rng ?? Math.random)() * pool.length)];
	return applyOpponent(state, pick.uci, { kind: 'book', frequency: 0 });
}

/** Work out what we accept from the user in the current position. */
async function withExpected(state: RunState, cfg: SessionConfig): Promise<RunState> {
	if (state.finished) return state;
	if (sideToMove(state.fen) !== state.ourColour) return { ...state, expected: [] };

	if (state.phase === 'freeplay') {
		// Anything legal goes; the engine will answer it.
		const a = await analysePosition(state.fen, 14, 1);
		return {
			...state,
			expected: [],
			evalNow: toColourPov(a.pvs[0]?.cpWhite ?? 0, state.ourColour),
		};
	}

	if (state.phase === 'punish') {
		const a = await analysePosition(state.fen, EVAL_DEPTH, 1);
		const uci = a.pvs[0]?.pv[0];
		if (!uci) return { ...state, expected: [], finished: 'abandoned', note: 'No engine line here.' };
		return {
			...state,
			expected: [{ uci, san: sanOf(state.fen, uci) }],
			evalNow: toColourPov(a.pvs[0].cpWhite, state.ourColour),
		};
	}

	// Book phase still gets an evaluation, so the bar is live throughout rather
	// than appearing only once something has gone wrong.
	//
	// Deliberately the SAME call the classifier makes for this position, so the
	// two share a cache entry. They asked the same question with different
	// parameters before, which meant two searches per ply for one answer.
	const bookEval = (await evalOf(state.fen, state.ourColour)) ?? state.evalNow;

	// The book, read from the explorer rather than from a list of lines. The
	// position names itself; what you may play here is decided by how often each
	// move is actually played and what the engine thinks of it.
	let book: BookMove[] = [];
	let naming: { name: string | null; eco: string | null } = { name: null, eco: null };
	try {
		const c = await (cfg.classify ?? classifyAt)(state.fen, state.ourColour, cfg.practice.minFreq, {
			withEvals: true,
		});
		book = c.moves;
		naming = { name: c.name, eco: c.eco };
	} catch {
		// No explorer: fall through to "anything legal", below.
	}

	// The explorer names a position while it is still common enough to have a
	// name, then stops. The bundled index carries on a little further, and a run
	// that has left the explorer's naming should not silently lose its label.
	const fallback = naming.name ? null : nameForPath(state.path);
	const opening = naming.name
		? { name: naming.name, eco: naming.eco ?? '' }
		: fallback
			? { name: fallback.name, eco: fallback.eco }
			: state.opening;

	// Still on the way to a pinned opening: the accepted moves are the ones that
	// keep heading there. With two roots diverging here, both are accepted —
	// forcing one would quietly drop the other from the session.
	const towards = movesTowardRoots(state.path, cfg.practice.roots);
	if (towards.length) {
		const moves = towards
			.map((san) => {
				const applied = trySan(state.fen, san);
				return applied ? { uci: applied.uci, san } : null;
			})
			.filter((m): m is { uci: string; san: string } => m !== null);
		if (moves.length) {
			return { ...state, opening, bookHere: book, evalNow: bookEval, expected: moves };
		}
	}

	const ok = acceptable(book, cfg.practice.strictness);

	if (!ok.length) {
		// Off the edge of the explorer's knowledge. That is not a failure — it is
		// the point at which the opening ends and a game begins.
		return {
			...state,
			opening,
			bookHere: book,
			expected: [],
			evalNow: bookEval,
			finished: 'line-complete',
			note: book.length
				? 'Nothing sound is played here any more — you are out of book.'
				: 'The explorer has no games from this position. You are on your own.',
		};
	}

	return {
		...state,
		opening,
		bookHere: book,
		evalNow: bookEval,
		expected: ok.map((m) => ({ uci: m.uci, san: m.san })),
	};
}

export async function submitMove(
	state: RunState,
	cfg: SessionConfig,
	uci: string,
): Promise<MoveOutcome> {
	let san: string;
	try {
		san = applyUci(state.fen, uci).san;
	} catch {
		return {
			state,
			correct: false,
			cpLoss: 0,
			message: 'Not a legal move.',
			refutation: [],
			played: uci,
		};
	}

	// Free play: every legal move is allowed, and the engine simply answers.
	if (state.phase === 'freeplay') {
		const after = applyUci(state.fen, uci).fen;

		// Score the move against the engine's best. This is the only phase whose
		// numbers mean anything about playing strength — see domain/rating.ts.
		// Both evaluations come from one place with one budget; see engine/score.ts
		// for why comparing a cached deep eval with a fresh shallow one is wrong.
		const score = await scoreMove(state.fen, uci, state.ourColour);

		let next: RunState = { ...state, fen: after, path: [...state.path, san], note: null };
		next = await freeplayReply(next, cfg);
		next = await withExpected(next, cfg);
		return {
			state: next,
			correct: true,
			// null means "not measured" and must not be recorded as a perfect move.
			cpLoss: score?.loss ?? -1,
			message: '',
			refutation: [],
			played: san,
		};
	}

	// `sameMove`, not string equality: castling has two UCI spellings and cards
	// and lines written before that was canonicalised still hold the other one.
	const accepted = state.expected.some((e) => sameMove(state.fen, e.uci, uci));

	// Off the expected move: in the book phase there is one right answer, since
	// the line is the thing being learned. While punishing, anything close to
	// best is fine — several moves often win, and marking them wrong teaches
	// superstition.
	let altNote: string | null = null;
	let cpLoss = 0;

	if (!accepted) {
		if (state.phase === 'book') {
			// Say what it costs, not just that it is off the line. A move can be
			// off-book and fine, or off-book and losing a piece; "the line goes X"
			// reads identically for both and teaches neither.
			const after = applyUci(state.fen, uci).fen;
			let refutation: string[] = [];
			let loss = 0;
			try {
				const mine = await analysePosition(after, EVAL_DEPTH, 1);
				const theirs = toColourPov(mine.pvs[0]?.cpWhite ?? 0, state.ourColour);
				loss = Math.max(0, Math.round((state.evalNow ?? theirs) - theirs));
				if (loss >= MISTAKE_CP) refutation = mine.pvs[0]?.pv.slice(0, 4) ?? [];
			} catch {
				/* naming still works without an evaluation */
			}

			return {
				state,
				correct: false,
				cpLoss: loss,
				message: await describeBookMistake(state, cfg, uci, san, loss),
				refutation,
				played: san,
			};
		}

		const after = applyUci(state.fen, uci).fen;
		const a = await analysePosition(after, EVAL_DEPTH, 1);
		const got = toColourPov(a.pvs[0]?.cpWhite ?? 0, state.ourColour);
		const loss = (state.evalNow ?? got) - got;

		if (loss > ACCEPT_MARGIN) {
			// Deliberately does NOT name the right move. Handing over the answer on
			// the first miss removes the retrieval attempt, which is the part that
			// builds the memory. The caller reveals it on request.
			return {
				state,
				correct: false,
				cpLoss: Math.round(loss),
				message: `${withGlyph(san, state.ourColour)} gives up ${Math.round(loss)}cp. Try again.`,
				refutation: a.pvs[0]?.pv.slice(0, 4) ?? [],
				played: san,
			};
		}

		cpLoss = Math.max(0, Math.round(loss));
		altNote = describeAlternative(san, state.expected[0]?.san, cpLoss, state.ourColour);
	}

	// Accepted — play it, then let them reply.
	let next: RunState = {
		...state,
		fen: applyUci(state.fen, uci).fen,
		path: [...state.path, san],
		punishPlies: state.phase === 'punish' ? state.punishPlies + 1 : 0,
		note: null,
	};

	if (next.phase === 'punish') {
		const a = await analysePosition(next.fen, EVAL_DEPTH, 1);
		const ev = toColourPov(a.pvs[0]?.cpWhite ?? 0, next.ourColour);
		next.evalNow = ev;
		if (ev >= WIN_CP || next.punishPlies >= MAX_PUNISH_PLIES) {
			const reason = ev >= WIN_CP ? 'threshold' : 'plies';
			return {
				state: {
					...next,
					finished: 'punished',
					expected: [],
					note: describeAdvantage(
						next.fen,
						next.ourColour,
						ev,
						reason,
						a.pvs[0]?.pv ?? [],
					),
				},
				correct: true,
				cpLoss,
				message: altNote ?? 'Punished.',
				refutation: [],
				played: san,
			};
		}
	}

	next = await opponentMove(next, cfg);
	next = await withExpected(next, cfg);

	return {
		state: next,
		correct: true,
		cpLoss,
		message: accepted
			? 'Correct.'
			: (altNote ?? `${withGlyph(san, state.ourColour)} works too.`),
		refutation: [],
		played: san,
	};
}

/**
 * Describe a move that was accepted but is not the best one.
 *
 * "Works too" is the least useful thing to say here: it implies something better
 * exists without saying what, or by how much. A move 5cp behind and a move 55cp
 * behind are different situations and should not read identically.
 */
function describeAlternative(
	played: string,
	best: string | undefined,
	loss: number,
	ourColour: 'w' | 'b',
): string {
	const p = withGlyph(played, ourColour);
	if (!best || best === played) return `${p} works.`;
	const b = withGlyph(best, ourColour);
	if (loss <= 10) return `${p} is just as good as ${b}.`;
	if (loss <= 25) return `${p} works, but ${b} is a shade better (${loss}cp).`;
	if (loss <= 45) return `${p} works, but ${b} is slightly better (${loss}cp).`;
	return `${p} works, but ${b} is clearly better (${loss}cp).`;
}

/**
 * Name what the user played, when it is a real move from somewhere else.
 *
 * "The line goes Bc4" is unhelpful if they have just played the Scotch. A sound
 * move that is merely out of scope is different information from a blunder, and
 * conflating the two teaches a beginner to distrust good moves.
 */
async function describeBookMistake(
	state: RunState,
	cfg: SessionConfig,
	uci: string,
	san: string,
	cpLoss = 0,
): Promise<string> {
	const want = state.expected.map((e) => withGlyph(e.san, state.ourColour)).join(' or ');
	const move = withGlyph(san, state.ourColour);
	const cost =
		cpLoss >= 200
			? ` It also costs ${(cpLoss / 100).toFixed(1)} — this is a real mistake, not just a different move.`
			: cpLoss >= MISTAKE_CP
				? ` It also gives up ${cpLoss}cp.`
				: '';

	// Leaving the pinned filter is a different kind of wrong from a bad move: the
	// move may be fine, it is just not what this session is about.
	const roots = cfg.practice.roots;
	if (roots.length && !liveRoots([...state.path, san], roots).length) {
		const names = roots.map((r) => r.name).join(' or ');
		return `${move} leaves ${names}, which is what you pinned. Play ${want}.`;
	}

	// Already classified this position for the expected set, so the reason a move
	// was refused is known without asking the explorer again.
	const here = state.bookHere.find((m) => m.uci === uci);
	if (here && (here.cpLoss ?? 0) <= SOUND_CP) {
		// A sound move that the current strictness does not accept. Under
		// 'repertoire' that is most of the book, and calling it a mistake would
		// teach a beginner to distrust perfectly good moves.
		const named = here.name ? ` — the ${here.name}` : '';
		const why =
			cfg.practice.strictness === 'repertoire'
				? 'sound, but you are drilling one answer per position'
				: here.verdict === 'sound'
					? `sound, but only played ${(here.freq * 100).toFixed(1)}% here`
					: 'sound, but outside what you are practising';
		return `${move}${named} — ${why}. Play ${want}.`;
	}

	try {
		const data = await fetchExplorer(state.fen);
		const row = data.moves.find((m) => m.uci === uci);
		if (row?.opening?.name && cpLoss < MISTAKE_CP) {
			return `${move} is the ${row.opening.name} — sound, but out of scope here. Play ${want}.`;
		}
		if (row?.opening?.name) {
			return `${move} is the ${row.opening.name}. Play ${want}.${cost}`;
		}
	} catch {
		/* naming is a nicety */
	}

	return `The line goes ${want}.${cost}`;
}

/** Their move: continue a variation, or make a genuine mistake. */
async function opponentMove(
	state: RunState,
	cfg: SessionConfig,
	avoid: string[] = [],
): Promise<RunState> {
	const rng = cfg.rng ?? Math.random;
	// Snapshot before they commit, so the same position can be replayed with a
	// different reply.
	const before = snapshot(state, 'same position, different reply');
	const now = (cfg.now ?? Date.now)();
	const posKey = positionKey(state.fen);
	/**
	 * Sampling weight: real-world frequency, compressed, damped by how well the
	 * move is already known.
	 *
	 * The square root matters. Frequencies at a single node span two orders of
	 * magnitude — a common reply can be eighty times likelier than a rare one —
	 * and at that ratio no amount of scheduling suppression will ever surface the
	 * rare move. Sampling in proportion to reality is the wrong objective anyway:
	 * we want coverage of everything you might meet, weighted towards the likely,
	 * not a faithful simulation of the population.
	 */
	const scheduled = (uci: string, freq: number) =>
		Math.sqrt(Math.max(freq, 0)) * weightFor(cfg.memory?.get(itemKey(posKey, uci)), now);
	// Their book, read from the position. There is no list of variations to be
	// "still in" — whatever is played here IS the book, and which opening that
	// turns out to be is read off the explorer afterwards.
	// Rolled BEFORE the book is fetched, because the answer decides whether the
	// book needs evaluating at all. Picking a book reply is a question about
	// frequencies; only offering a mistake needs to know what a move costs.
	const offeringMistake = rng() < cfg.practice.deviationChance;

	let book: BookMove[] = [];
	try {
		const c = await (cfg.classify ?? classifyAt)(
			state.fen,
			other(state.ourColour),
			cfg.practice.minFreq,
			{ withEvals: offeringMistake },
		);
		book = c.moves;
	} catch {
		// No explorer. Fall through to the engine, below.
	}

	if (state.phase === 'punish') {
		// They are just defending now — play the engine's choice.
		const a = await analysePosition(state.fen, EVAL_DEPTH, 1);
		const uci = a.pvs[0]?.pv[0];
		if (!uci) return { ...state, finished: 'punished', note: 'No reply available.' };
		return applyOpponent(state, uci, { kind: 'book', frequency: 0 });
	}

	// Still on the way to a pinned opening: they play one of the moves that lead
	// there, chosen at random when several roots are still live.
	const towards = movesTowardRoots(state.path, cfg.practice.roots);
	if (towards.length) {
		const san = towards[Math.floor(rng() * towards.length)];
		const applied = trySan(state.fen, san);
		if (applied) return applyOpponent(state, applied.uci, { kind: 'book', frequency: 0 });
	}

	if (!book.length) {
		// Nothing known here. Play a reasonable move rather than stopping — the
		// run has simply left the explorer's coverage.
		const a = await analysePosition(state.fen, 14, 1, 200);
		const uci = a.pvs[0]?.pv[0];
		if (!uci) return { ...state, finished: 'line-complete', note: 'No reply available.' };
		return applyOpponent(state, uci, { kind: 'book', frequency: 0 });
	}

	const mistakes = punishable(book, cfg.practice.minFreq).filter((m) => !avoid.includes(m.uci));
	const continuations = opponentBook(book, cfg.practice.minFreq);
	const fresh = continuations.filter((m) => !avoid.includes(m.uci));
	const exhausted = !fresh.length;
	const pool = exhausted ? continuations : fresh;

	if (offeringMistake && mistakes.length) {
		const picked = weightedPick(mistakes, (m) => scheduled(m.uci, m.freq), rng);
		const detail = await mistakeDetail(state, picked);
		const next = applyOpponent(state, picked.uci, {
			kind: 'mistake',
			frequency: picked.freq,
			severity: (picked.cpLoss ?? 0) >= BLUNDER_CP * 2 ? 'blunder' : 'inaccuracy',
		});
		const punished: RunState = {
			...next,
			phase: 'punish',
			punishPlies: 0,
			motifs: detail.motifs,
			evalNow: detail.evalAfter,
		};
		return {
			...punished,
			deviationPoint: snapshot(
				punished,
				`their ${withGlyph(next.lastOpponent!.san, other(state.ourColour))}`,
			),
			retryPoint: { ...before, avoid: [...avoid, picked.uci] },
			currentItem: itemKey(posKey, picked.uci),
		};
	}

	if (!pool.length) return { ...state, finished: 'line-complete', note: 'End of the line.' };

	// Snapshot BEFORE they choose: replaying from here gives a fresh roll, which
	// is the point — the same branch can send you into a different variation.
	const branch =
		continuations.length > 1
			? snapshot(state, `${continuations.length} replies played here`)
			: state.branchPoint;

	const picked = weightedPick(pool, (m) => scheduled(m.uci, m.freq), rng);
	const seen = exhausted ? [picked.uci] : [...avoid, picked.uci];

	return {
		...applyOpponent(state, picked.uci, {
			kind: 'book',
			frequency: picked.freq,
			lineName: picked.name ?? undefined,
		}),
		branchPoint: branch,
		retryPoint: { ...before, avoid: seen },
		currentItem: itemKey(posKey, picked.uci),
	};
}

/** What a mistake leads to: the evaluation after it, and the motifs it creates. */
async function mistakeDetail(
	state: RunState,
	move: BookMove,
): Promise<{ evalAfter: number; motifs: Motif[] }> {
	const after = safePlay(state.fen, move.uci);
	if (!after) return { evalAfter: state.evalNow ?? 0, motifs: [] };
	let evalAfter = state.evalNow ?? 0;
	try {
		const a = await analysePosition(after, EVAL_DEPTH, 1);
		evalAfter = toColourPov(a.pvs[0]?.cpWhite ?? 0, state.ourColour);
	} catch {
		/* keep what we had */
	}
	return { evalAfter, motifs: detectMotifs(state.fen, move.uci) };
}

function applyOpponent(
	state: RunState,
	uci: string,
	meta: Omit<OpponentMove, 'uci' | 'san'>,
): RunState {
	const r = applyUci(state.fen, uci);
	return {
		...state,
		fen: r.fen,
		path: [...state.path, r.san],
		lastOpponent: { uci, san: r.san, ...meta },
	};
}

/**
 * A mistake worth punishing, or null.
 *
 * Only moves that are genuinely bad qualify. A move that merely transposes into
 * another opening is not a deviation to punish — it is a different book.
 */

// --- helpers ----------------------------------------------------------------

function sanOf(fen: string, uci: string): string {
	try {
		return applyUci(fen, uci).san;
	} catch {
		return uci;
	}
}

/**
 * Say what the advantage actually IS, and why the drill stopped here.
 *
 * "Clearly better" on its own is the least useful thing to report: it names a
 * number without naming the thing the number is made of, and it makes the
 * stopping point look arbitrary. Material is the part a beginner can verify by
 * looking, so lead with it.
 */
/**
 * How many plies of the engine's line to play out before counting material.
 *
 * Enough to see an exchange through, short enough that we are describing the
 * position in front of the user rather than a different game.
 */
const SETTLE_PLIES = 8;

/** The position once the engine's forced sequence has played out. */
export function settle(fen: string, pv: string[], plies = SETTLE_PLIES): string {
	let out = fen;
	for (const uci of pv.slice(0, plies)) {
		try {
			out = applyUci(out, uci).fen;
		} catch {
			break;
		}
	}
	return out;
}

/**
 * Say what the user has won, truthfully.
 *
 * ---------------------------------------------------------------------------
 * Counting material on the position as it stands is wrong whenever a capture
 * is pending, and the drill stops precisely at sharp positions where one
 * usually is. After 10.Qxc6+ the raw count says "you are a queen up"; Black
 * recaptures immediately and you are not.
 *
 * So the count is taken AFTER the engine's own line has played out. If that
 * still disagrees with the evaluation — material says one thing, the engine
 * says another — no material claim is made at all, because a confident wrong
 * sentence is worse for a learner than a vaguer right one.
 * ---------------------------------------------------------------------------
 */
export function describeAdvantage(
	fen: string,
	ourColour: 'w' | 'b',
	cp: number,
	reason: 'threshold' | 'plies',
	pv: string[] = [],
): string {
	const now = balanceOf(fen, ourColour);
	const settled = balanceOf(settle(fen, pv), ourColour);
	const evalText = `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;

	// Material and evaluation pointing opposite ways means something is going on
	// that a material sentence would misdescribe. Say only what is certain.
	const trustMaterial = settled >= 1 && cp > 0;

	let what: string;
	if (trustMaterial && settled === now) {
		what = describeBalance(settled);
	} else if (trustMaterial) {
		// The count on the board is not the count you will keep.
		what = `${describeBalance(settled)} once the exchange finishes`;
	} else {
		what = 'Your position is much better';
	}

	const why =
		reason === 'threshold'
			? `That is enough to call the punishment complete.`
			: `That is as far as the drill goes — the rest is ordinary chess.`;

	return `${what} (${evalText}). ${why}`;
}

// One implementation of "who is up material", shared with the board readout —
// two would drift, and the number under the board would stop matching the
// sentence beside it.
export { materialBalance } from '../domain/material';

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T {
	const total = items.reduce((s, t) => s + weight(t), 0);
	let r = rng() * total;
	for (const t of items) {
		r -= weight(t);
		if (r <= 0) return t;
	}
	return items[items.length - 1];
}

/** Snapshot the current position so the run can be replayed from here. */
function snapshot(state: RunState, label: string): RestorePoint {
	return {
		fen: state.fen,
		path: [...state.path],
		phase: state.phase,
		lastOpponent: state.lastOpponent,
		evalNow: state.evalNow,
		motifs: state.motifs,
		label,
	};
}

/** Restart a run from a saved point rather than from move 1. */
export async function resumeFrom(
	point: RestorePoint,
	cfg: SessionConfig,
	previous: RunState,
): Promise<RunState> {
	let state: RunState = {
		...previous,
		fen: point.fen,
		path: [...point.path],
		phase: point.phase,
		lastOpponent: point.lastOpponent,
		evalNow: point.evalNow,
		motifs: point.motifs,
		punishPlies: 0,
		finished: null,
		note: null,
		expected: [],
	};

	// At a branch or retry point it is their move, and `avoid` pushes them
	// towards a reply this position has not shown yet.
	if (sideToMove(state.fen) !== state.ourColour) {
		state = await opponentMove(state, cfg, point.avoid ?? []);
	}
	return withExpected(state, cfg);
}

/**
 * Explain why a move fails, concretely.
 *
 * "That is wrong" teaches nothing. What the opponent plays next, and what it
 * costs, is the part worth remembering — so the refutation is named and the
 * material loss quantified where there is one.
 */
export function explainMistake(
	fen: string,
	userUci: string,
	refutation: string[],
	ourColour: 'w' | 'b',
): { text: string; arrows: { orig: string; dest: string; brush: 'red' | 'blue' }[] } {
	const arrows: { orig: string; dest: string; brush: 'red' | 'blue' }[] = [
		{ orig: userUci.slice(0, 2), dest: userUci.slice(2, 4), brush: 'red' },
	];

	let after: string;
	try {
		after = applyUci(fen, userUci).fen;
	} catch {
		return { text: '', arrows };
	}

	const reply = refutation[0];
	if (!reply) return { text: '', arrows };

	let replySan = reply;
	try {
		replySan = applyUci(after, reply).san;
	} catch {
		return { text: '', arrows };
	}

	// The refuting move is played in the position AFTER ours, so its origin
	// square only makes sense as an arrow if that piece has not just moved.
	if (reply.slice(0, 2) !== userUci.slice(2, 4)) {
		arrows.push({ orig: reply.slice(0, 2), dest: reply.slice(2, 4), brush: 'blue' });
	}

	const lost = materialSwing(fen, [userUci, ...refutation], ourColour);
	const what =
		lost >= 9 ? 'the queen' : lost >= 5 ? 'a rook' : lost >= 3 ? 'a piece' : lost >= 1 ? 'a pawn' : '';

	return {
		text: what
			? `${withGlyph(replySan, other(ourColour))} — that drops ${what}.`
			: `${withGlyph(replySan, other(ourColour))} is strong for them.`,
		arrows,
	};
}

const VALUE: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

/** Material we lose over a sequence, in pawns. */
function materialSwing(fen: string, ucis: string[], ourColour: 'w' | 'b'): number {
	const count = (f: string) => {
		const board = f.split(' ')[0];
		let ours = 0;
		let theirs = 0;
		for (const ch of board) {
			const v = VALUE[roleOfChar(ch)] ?? 0;
			if (!v) continue;
			const white = ch === ch.toUpperCase();
			const mine = (ourColour === 'w') === white;
			if (mine) ours += v;
			else theirs += v;
		}
		return ours - theirs;
	};

	let cur = fen;
	const before = count(cur);
	for (const uci of ucis) {
		try {
			cur = applyUci(cur, uci).fen;
		} catch {
			break;
		}
	}
	return before - count(cur);
}

function roleOfChar(ch: string): string {
	switch (ch.toLowerCase()) {
		case 'p':
			return 'pawn';
		case 'n':
			return 'knight';
		case 'b':
			return 'bishop';
		case 'r':
			return 'rook';
		case 'q':
			return 'queen';
		default:
			return '';
	}
}

/** PGN for the moves played so far. */
export function toPgn(state: RunState, lineNames: string[]): string {
	const headers = [
		'[Event "Chesshire training run"]',
		'[Site "local"]',
		'[White "?"]',
		'[Black "?"]',
		'[Result "*"]',
		`[Opening "${lineNames.join(', ')}"]`,
	];
	const body: string[] = [];
	for (let i = 0; i < state.path.length; i += 2) {
		body.push(`${i / 2 + 1}. ${state.path[i]}${state.path[i + 1] ? ` ${state.path[i + 1]}` : ''}`);
	}
	return `${headers.join('\n')}\n\n${body.join(' ')} *\n`;
}

/** Give the game up. Ends the run without pretending it was completed. */
export function resign(state: RunState): RunState {
	return {
		...state,
		finished: 'resigned',
		expected: [],
		note:
			state.evalNow === null
				? 'Resigned.'
				: `Resigned at ${state.evalNow > 0 ? '+' : ''}${(state.evalNow / 100).toFixed(1)}.`,
	};
}

/**
 * Start free play from a position reached earlier.
 *
 * Used by the review page: the interesting question about a game is usually
 * "what if I had played something else here", and answering it means picking
 * the position up and playing on, not reading about it.
 */
/**
 * Continue from a position part-way through a game.
 *
 * `phase` decides what "continue" means, and the two are genuinely different:
 *
 *   'freeplay' — the review page's "play this out against the engine". No book,
 *                no expected move, every legal move allowed.
 *   'book'     — the trainer's "play from here". Training resumes: the opponent
 *                answers from the book and there is a move to find.
 *
 * It defaulted to 'freeplay' with no way to say otherwise, so the trainer's own
 * "play from here" silently dropped you out of training — the run continued but
 * `expected` was empty, which is why *Show me* was greyed out with nothing to
 * show.
 */
export async function playFrom(
	moves: string[],
	ply: number,
	ourColour: 'w' | 'b',
	cfg: SessionConfig,
	phase: 'freeplay' | 'book' = 'freeplay',
): Promise<RunState> {
	let fen = INITIAL_FEN;
	const path: string[] = [];
	for (const san of moves.slice(0, ply)) {
		try {
			const r = applySan(fen, san);
			fen = r.fen;
			path.push(san);
		} catch {
			break;
		}
	}

	let state: RunState = {
		fen,
		path,
		ourColour,
		phase,
		opening: null,
		bookHere: [],
		expected: [],
		lastOpponent: null,
		motifs: [],
		evalNow: null,
		punishPlies: 0,
		finished: null,
		note: null,
		branchPoint: null,
		deviationPoint: null,
		retryPoint: null,
		currentItem: null,
	};

	// Whose reply it is depends on what we are resuming into: the engine in free
	// play, the book when training.
	if (sideToMove(state.fen) !== ourColour) {
		state = phase === 'book' ? await opponentMove(state, cfg) : await freeplayReply(state, cfg);
	}
	return withExpected(state, cfg);
}

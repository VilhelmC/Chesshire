// The trainer: play the opening from move 1, over and over.
//
// Each run starts at the initial position. You play your side; the opponent
// either continues into one of the variations you are training, or plays a real
// mistake you have to notice and punish. Reset and they may choose differently.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
	loadPractice,
	savePractice,
	resetPractice,
	describePractice,
	type PracticeConfig,
} from '../domain/practice';
import { STRICTNESS } from '../domain/book';
import { OpeningSearch } from '../components/OpeningSearch';
import { nameForPath } from '../domain/openings';

import {
	startRun,
	submitMove,
	resumeFrom,
	playOn,
	playFrom,
	resign,
	explainMistake,
	toPgn,
	type RunState,
	type RestorePoint,
	type SessionConfig,
} from '../engine/session';
import { applyUci, replayLine } from '../domain/chess';
import { getToken, fetchExplorer } from '../data/explorer';
import { distributionOf, type Distribution } from '../domain/distribution';
import { DistributionList } from '../components/Distribution';
import { ShareMenu, canShareNatively } from '../components/ShareMenu';
import { LinePlayer, type BoardOverride } from '../components/LinePlayer';
import { lineFromUci, type Line } from '../domain/line';
import { color } from '../ui/theme';
import { markTraining } from '../data/autoImport';
import { Empty, Button } from '../ui/primitives';
import type { ToolbarAction } from '../components/Toolbar';
import { BoardPanel } from '../components/BoardPanel';
import { Move, MoveLine } from '../components/Move';
import { other, colourAtPly, colourOfFen } from '../domain/notation';
import { MoveList, MoveListLegend, type MoveChip } from '../components/MoveList';
import {
	candidateMoves,
	brushForGrade,
	colourForGrade,
	type Candidate,
} from '../engine/candidates';
import { BOT_LEVELS, levelFor, estimate, type Estimate } from '../domain/rating';
import { freeplayLosses } from '../domain/progress';
import { loadProgress } from '../data/progress';
import { logAnswer, logRun } from '../data/progress';
import { saveSession, loadSession, clearSession } from '../data/session';
import { recordMistake } from '../data/mistakes';
import { positionKey } from '../domain/chess';
import { loadMemory, persist } from '../data/memory';
import {
	afterAnswer,
	newItem,
	summarise,
	type MemoryItem,
	type MemoryStore,
} from '../domain/scheduler';
import { registerDebug, describePosition } from '../data/debug';
import { evalStats } from '../data/cloudEval';
import { useViewport } from '../components/useViewport';

type Stats = {
	runs: number;
	moves: number;
	correct: number;
	punished: number;
	missed: number;
	shown: number;
};
const EMPTY: Stats = { runs: 0, moves: 0, correct: 0, punished: 0, missed: 0, shown: 0 };

export type TrainHandoff = { moves: string[]; ply: number; ourColour: 'w' | 'b' } | null;

export function Train({
	handoff,
	onHandoffUsed,
	onNeedsToken,
}: {
	handoff?: TrainHandoff;
	onHandoffUsed?: () => void;
	/** Somewhere to send someone who cannot train yet, rather than naming a tab. */
	onNeedsToken?: () => void;
}) {
	const [state, setState] = useState<RunState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<{
		correct: boolean;
		message: string;
		refutation: string[];
		fen: string;
		played: string;
		playedUci: string;
		explanation: string;
		arrows: Arrow[];
	} | null>(null);
	const [stats, setStats] = useState<Stats>(EMPTY);
	const [practice, setPractice] = useState<PracticeConfig>(() => loadPractice());
	const vp = useViewport();
	// `q0`–`q4` are the quality ramp registered in Board.
	type Arrow = { orig: string; dest: string; brush: string; label?: string };
	const [hint, setHint] = useState<Arrow[]>([]);
	const [attempts, setAttempts] = useState(0);
	/** Bumped on a rejected move, to pull the piece back to where it started. */
	const [boardVersion, setBoardVersion] = useState(0);

	// The engine belongs to whoever is looking at the screen.
	//
	// It is single and serialised, so a background game import queued ahead of a
	// drill move would put a whole position's search between the move and its
	// answer. Claiming it for as long as this tab is mounted is blunt and
	// correct: the import resumes the moment you go elsewhere, and it checks
	// this between positions, so it yields within about one search rather than
	// at the end of whatever game it was working through.
	useEffect(() => {
		markTraining(true);
		return () => markTraining(false);
	}, []);

	// schackal.dump() — see data/debug.ts. Registered every render so the
	// snapshot reflects current state, not the first render's.
	useEffect(() =>
		registerDebug('train', () => ({
			// What is ON THE BOARD, which during a preview is not the run's position.
			// Reported from `state.path` rather than from a derived value further
			// down this component, so the snapshot still works when the render
			// stopped early (no token saved yet).
			fen: boardFenOf(state, previewPly),
			livePosition: state?.fen ?? null,
			previewPly,
			position: describePosition(boardFenOf(state, previewPly)),
			phase: state?.phase ?? null,
			ourColour: state?.ourColour ?? null,
			yourTurn,
			busy,
			interactive: yourTurn && !busy,
			boardVersion,
			evalNow: state?.evalNow ?? null,
			path: state?.path ?? null,
			ply: state?.path?.length ?? null,
			expected: state?.expected?.map((e) => `${e.san} (${e.uci})`) ?? null,
			opening: state?.opening ?? null,
			bookHere: state?.bookHere?.map((m) => `${m.san} ${m.verdict} ${(m.freq * 100).toFixed(1)}%`) ?? null,
			finished: state?.finished ?? null,
			feedback,
			hintArrows: hint.length,
			// What the last move cost, so "it feels slow" becomes a number.
			lastMoveCost: { ...lastCost.current },
		})),
	);
	const [memory, setMemory] = useState<MemoryStore>(() => new Map());
	const [memoryReady, setMemoryReady] = useState(false);
	const busyRef = useRef(false);
	/** Engine calls attributable to the most recent move. See data/cloudEval.ts. */
	const lastCost = useRef({ calls: 0, cacheHits: 0, cloudHits: 0, localRuns: 0, ms: 0 });
	/**
	 * Positions to step back to. Pushed before each accepted move, so "Take back"
	 * returns to just before your move — which also unwinds their reply, since
	 * they answer immediately.
	 */
	const [history, setHistory] = useState<RunState[]>([]);
	/** States stepped back out of, so the arrow can go forward again. */
	const [future, setFuture] = useState<RunState[]>([]);
	/**
	 * The ply being previewed from the move list, or null while playing.
	 *
	 * The position is replayed from the move list rather than looked up in a map
	 * of past states. The map was the bug: states were recorded once per
	 * submitted move — which advances the path by two, ours and their reply — so
	 * every odd ply was missing, and a resumed session had exactly one entry, so
	 * nearly every chip did nothing at all.
	 */
	const [previewPly, setPreviewPly] = useState<number | null>(null);
	/** Our move, shown while the engine works out the answer to it. */
	const [preview, setPreview] = useState<{ fen: string; lastMove: [string, string] } | null>(null);
	/**
	 * Plies where the opponent played a mistake, keyed `ply|san`.
	 *
	 * Keyed by the MOVE, not just the ply. A ply number is not stable across a
	 * replay: branch back to move 6, meet a different reply, and the old marker
	 * still sat on ply 6 — so a correct move was underlined red and captioned
	 * "the mistake you were asked to punish" while the feedback said "Correct".
	 */
	const [mistakePlies, setMistakePlies] = useState<Set<string>>(new Set());
	/** Our plies where the move was accepted but something was better. */
	const [lossByPly, setLossByPly] = useState<Record<number, number>>({});
	/** Evaluation after each ply, for the review page. */
	const evalsRef = useRef<(number | null)[]>([]);
	const [candidates, setCandidates] = useState<Candidate[] | null>(null);
	const [botLevel, setBotLevel] = useState<number | 'auto'>('auto');
	const [rating, setRating] = useState<Estimate>({ elo: null, acpl: null, sample: 0, confident: false });
	const [resumed, setResumed] = useState(false);
	const runId = useRef<string>('');
	const sawMistake = useRef(false);
	/** The item currently being answered, captured when the position was set. */
	const pendingItem = useRef<string | null>(null);
	const missedThisItem = useRef(false);
	/** Help was used on the current item — the move shown, or the options drawn. */
	const assistedThisItem = useRef(false);
	/** One row per encounter; guards against logging the same item twice. */
	const loggedThisItem = useRef(false);
	/** One card per encounter, however many retries it takes. */
	const loggedMistake = useRef(false);

	const bot = botLevel === 'auto' ? levelFor(rating.confident ? rating.elo : null) : BOT_LEVELS[botLevel - 1];

	const cfg: SessionConfig = {
		practice,
		memory,
		bot: { window: bot.window, movetimeMs: bot.movetimeMs },
	};

	function updatePractice(patch: Partial<PracticeConfig>) {
		setPractice((p) => {
			const next = { ...p, ...patch };
			savePractice(next);
			return next;
		});
	}

	async function newRun() {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setError(null);
		setFeedback(null);
		setHint([]);
		setAttempts(0);
		// Starting fresh discards the saved game deliberately; persistRun writes a
		// new one on the first move.
		void clearSession();
		setResumed(false);
		try {
			setHistory([]);
			setFuture([]);
			runId.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			sawMistake.current = false;
			setPreviewPly(null);
			setMistakePlies(new Set());
			setLossByPly({});
			evalsRef.current = [];
			setCandidates(null);
			const started = await startRun(cfg);
			setState(started);
			remember(started);
			persistRun(started, {});
			setStats((s) => ({ ...s, runs: s.runs + 1 }));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	async function replayFrom(point: RestorePoint) {
		if (busyRef.current || !state) return;
		busyRef.current = true;
		setBusy(true);
		setFeedback(null);
		setHint([]);
		setAttempts(0);
		try {
			setHistory([]);
			setFuture([]);
			runId.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			sawMistake.current = false;
			setCandidates(null);
			// Replaying reuses ply numbers with different moves, so anything keyed
			// by ply alone is stale from here on.
			setLossByPly({});
			const resumed = await resumeFrom(point, cfg, state);
			setState(resumed);
			remember(resumed);
			setStats((s) => ({ ...s, runs: s.runs + 1 }));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	// Load scheduling state before the first run, so the opening sample is not
	// drawn as if nothing had ever been seen.
	useEffect(() => {
		void (async () => {
			setMemory(await loadMemory());
			const { answers } = await loadProgress();
			setRating(estimate(freeplayLosses(answers)));
			setMemoryReady(true);
		})();
	}, []);

	/**
	 * Write the run to storage, both as the resumable session and as a row in the
	 * run history.
	 *
	 * Both happen on every move, not at the end. Free play never "finishes", so
	 * an end-of-run write meant the most interesting part of a session — the
	 * game played out after the punishment — was never recorded at all.
	 */
	function persistRun(next: RunState, losses: Record<number, number>) {
		void saveSession({
			runId: runId.current,
			state: next,
			lossByPly: losses,
			mistakePlies: [...mistakePlies],
			evals: [...evalsRef.current],
			sawMistake: sawMistake.current,
		});

		logRun({
			id: runId.current,
			ts: Date.now(),
			opening: next.opening?.name ?? null,
			plies: next.path.length,
			finished: next.finished,
			sawMistake: sawMistake.current,
			punished: next.finished === 'punished',
			moves: next.path,
			evals: [...evalsRef.current],
			losses,
			ourColour: next.ourColour,
		});
	}

	/** Note what the move list needs to mark, and the evaluation at this ply. */
	function remember(next: RunState) {
		if (next.lastOpponent?.kind === 'mistake') {
			setMistakePlies((m) => new Set(m).add(`${next.path.length}|${next.path[next.path.length - 1]}`));
		}
		evalsRef.current[next.path.length] = next.evalNow ?? null;
	}

	// A position handed over from the review page wins over the saved session:
	// the user just asked for this specific position.
	useEffect(() => {
		if (!memoryReady || !handoff) return;
		void (async () => {
			busyRef.current = true;
			setBusy(true);
			try {
				runId.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				sawMistake.current = false;
				evalsRef.current = [];
				setLossByPly({});
				setMistakePlies(new Set());
				setHistory([]);
				setFuture([]);
				setResumed(false);
				const s2 = await playFrom(handoff.moves, handoff.ply, handoff.ourColour, cfg);
				setState(s2);
				persistRun(s2, {});
			} finally {
				busyRef.current = false;
				setBusy(false);
				onHandoffUsed?.();
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [memoryReady, handoff]);

	useEffect(() => {
		if (!memoryReady || handoff) return;
		void (async () => {
			// Pick the game back up rather than throwing it away.
			const saved = await loadSession();
			if (saved?.state) {
				const s = saved.state as RunState;
				runId.current = saved.runId;
				sawMistake.current = saved.sawMistake;
				evalsRef.current = saved.evals ?? [];
				setLossByPly(saved.lossByPly ?? {});
				// Sessions saved before markers were keyed by move hold bare ply
				// numbers, which cannot be checked against the moves played. Dropping
				// them loses a few underlines; keeping them risks marking the wrong
				// move, which is what this replaced.
				setMistakePlies(new Set((saved.mistakePlies ?? []).filter((k) => typeof k === 'string')));
				setState(s);
				setResumed(true);
				return;
			}
			await newRun();
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [memoryReady, handoff]);

	/**
	 * Record how an opponent move was met.
	 *
	 * Graded once per encounter, on the first answer — a move you got right only
	 * after two misses and a reveal has not been learned, and scheduling it as if
	 * it had is how a trainer quietly stops showing you the things you cannot do.
	 */
	function recordItem(key: string | null, correct: boolean) {
		if (!key) return;
		const now = Date.now();
		setMemory((prev) => {
			const next = new Map(prev);
			const item: MemoryItem = next.get(key) ?? newItem(key, now);
			const updated = afterAnswer(item, correct, now);
			next.set(key, updated);
			persist(updated);
			return next;
		});
	}

	/**
	 * Show the move by playing it, not by naming it.
	 *
	 * Reading "Nxe5" and watching the knight take on e5 are not the same thing —
	 * the second leaves a visual trace, the first leaves a token. The arrow goes
	 * up first so the eye has somewhere to land before the piece moves.
	 */
	async function showMe() {
		if (!state || busyRef.current || !state.expected.length) return;
		const uci = state.expected[0].uci;
		setHint([arrowFor(uci, 'green')]);
		setStats((s) => ({ ...s, shown: s.shown + 1 }));
		missedThisItem.current = true;
		assistedThisItem.current = true;
		// Long enough to read the arrow, then the move goes on the board — and
		// `onMove` now puts it there before the engine is asked anything, so the
		// order on screen is arrow, our move, their reply, rather than arrow,
		// pause, both moves at once.
		await new Promise((r) => setTimeout(r, 550));
		setHint([]);
		await onMove(uci, { revealed: true });
	}

	/**
	 * Step back to before your last move.
	 *
	 * Their reply comes back off the board with it — they answer immediately, so
	 * there is no state in between. Moving forward again re-rolls their choice,
	 * which is the same behaviour as the replay buttons.
	 */
	function takeBack() {
		if (busyRef.current || !history.length || !state) return;
		const prev = history[history.length - 1];
		setHistory((h) => h.slice(0, -1));
		setFuture((f) => [state, ...f]);
		setState(prev);
		setFeedback(null);
		setHint([]);
		setAttempts(0);
		pendingItem.current = prev.currentItem;
		missedThisItem.current = false;
	}

	/** Step forward again into a position we stepped back out of. */
	function redo() {
		if (busyRef.current || !future.length || !state) return;
		const next = future[0];
		setFuture((f) => f.slice(1));
		setHistory((h) => [...h, state]);
		setState(next);
		setFeedback(null);
		setHint([]);
		setAttempts(0);
	}

	/**
	 * Look at a position from earlier in the run.
	 *
	 * A preview, not a rewind: the game is untouched and one click returns to it.
	 * Clicking the ply already being viewed — or the live position — steps out.
	 */
	function previewAt(ply: number) {
		if (busyRef.current || !state) return;
		setHint([]);
		setCandidates(null);
		setPreviewPly((cur) => (cur === ply || ply === state.path.length ? null : ply));
	}

	/**
	 * Draw every candidate move, weighted by how good it is.
	 *
	 * More useful than revealing the single answer: seeing that three moves are
	 * nearly equal and one loses a piece teaches the shape of the choice, which
	 * is the thing that transfers. It counts as a reveal for scoring.
	 */
	/**
	 * What players at this band actually play here.
	 *
	 * Deliberately NOT scored as help. Seeing the engine's ranked options tells
	 * you the answer, so it retires the item; seeing how often each move gets
	 * played tells you what you will meet, which is the subject rather than the
	 * solution. The explorer response is already cached from the run itself, so
	 * this is usually not even a request.
	 */
	const [distribution, setDistribution] = useState<Distribution | null>(null);
	const [sharing, setSharing] = useState(false);
	/** A claim being demonstrated on the board rather than described in prose. */
	const [explain, setExplain] = useState<{ line: Line; label: string } | null>(null);
	const [explaining, setExplaining] = useState<BoardOverride>(null);
	async function showDistribution() {
		if (!state) return;
		if (distribution) return setDistribution(null);
		try {
			const data = await fetchExplorer(state.fen);
			setDistribution(distributionOf(data, colourOfFen(state.fen)));
		} catch (e) {
			setError((e as Error).message);
		}
	}

	async function showOptions() {
		if (!state || busyRef.current || !yourTurn) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const cands = await candidateMoves(state.fen, state.ourColour, 5);
			setCandidates(cands);
			setHint(
				cands.map((c) => ({
					orig: c.uci.slice(0, 2),
					dest: c.uci.slice(2, 4),
					brush: brushForGrade(c.grade),
					label: `${c.cp > 0 ? '+' : ''}${(c.cp / 100).toFixed(1)}`,
				})),
			);
			missedThisItem.current = true;
			assistedThisItem.current = true;
			setStats((s) => ({ ...s, shown: s.shown + 1 }));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	/** Carry on against the engine from a won position. */
	async function continuePlaying() {
		if (!state || busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setFeedback(null);
		try {
			setState(await playOn(state, cfg));
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	async function onMove(uci: string, opts: { revealed?: boolean } = {}) {
		if (!state || busyRef.current || state.finished) return;
		// Free play has no expected list — every legal move is allowed there.
		if (!state.expected.length && state.phase !== 'freeplay') return;
		busyRef.current = true;
		setBusy(true);

		// Put our move on the board now, before any thinking. It is cleared in
		// `finally`, by which point the real state has replaced it — or, if the
		// move was rejected, the position it was showing is gone and the board
		// snaps back to where it was.
		try {
			const after = applyUci(state.fen, uci);
			setPreview({ fen: after.fen, lastMove: [uci.slice(0, 2), uci.slice(2, 4)] });
		} catch {
			/* an illegal move needs no preview; submitMove will refuse it */
		}
		evalStats.reset();
		const startedAt = performance.now();
		const before = state;
		// The item belongs to the position we are answering, not the one we land
		// in — capture it before the state moves on.
		if (pendingItem.current !== before.currentItem) {
			pendingItem.current = before.currentItem;
			missedThisItem.current = false;
			assistedThisItem.current = false;
			loggedThisItem.current = false;
			loggedMistake.current = false;
		}

		try {
			const out = await submitMove(state, cfg, uci);
			const explained =
				!out.correct && out.refutation.length
					? explainMistake(before.fen, uci, out.refutation, before.ourColour)
					: { text: '', arrows: [] as Arrow[] };

			// Whenever the message NAMES a move, the board should show it. A move
			// spelled out in notation and a move drawn on the board are not the same
			// thing to a beginner — the whole point of the trainer is to attach
			// recall to the position rather than to a string.
			const arrows: Arrow[] = [...explained.arrows];
			if (!out.correct && before.phase === 'book' && before.expected[0]) {
				// The run does not advance on a wrong book move, so the position on
				// screen is still the one the arrow refers to.
				arrows.length = 0;
				arrows.push({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'red' });
				arrows.push(arrowFor(before.expected[0].uci, 'green'));
			}

			setFeedback({
				correct: out.correct,
				message: out.message,
				refutation: out.refutation,
				fen: before.fen,
				played: out.played,
				playedUci: uci,
				explanation: explained.text,
				arrows,
			});
			setAttempts((a) => (out.correct ? 0 : a + 1));
			// A rejected move leaves the piece where it was dropped until the board
			// is told otherwise — the run state has not moved on.
			if (!out.correct) setBoardVersion((v) => v + 1);

			if (out.correct && out.cpLoss > 10) {
				setLossByPly((m) => ({ ...m, [before.path.length + 1]: out.cpLoss }));
			}

			// Accepted, but something was better. The run is about to move on, so
			// hold the position for a beat with the better move drawn — otherwise
			// the arrow would appear over a board two plies further along.
			const wasExact = before.expected.some((e) => e.uci === uci);
			if (out.correct && !wasExact && out.cpLoss > 10 && before.expected[0]) {
				setHint([
					{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'blue' },
					arrowFor(before.expected[0].uci, 'green'),
				]);
				await new Promise((r) => setTimeout(r, 1200));
				setHint([]);
			}

			// One row per encounter.
			//
			// Free play is logged too — it is the ONLY phase whose numbers feed the
			// rating estimate, and an earlier version skipped it entirely, which
			// left the estimator with nothing to work from.
			const assisted = assistedThisItem.current || !!opts.revealed;
			if (before.phase === 'freeplay') {
				// A negative loss is the sentinel for "could not be measured".
				// Logging it as zero would record a perfect move every time the
				// engine hiccupped, which is how the rating estimate drifted up.
				if (out.cpLoss >= 200) {
					// A serious free-play error is as much worth repeating as a missed
					// book move, and we know what should have been played.
					void (async () => {
						const best = await import('../engine/score').then((m) =>
							m.scoreMove(before.fen, uci, before.ourColour),
						);
						if (!best?.bestUci) return;
						void recordMistake({
							fen: before.fen,
							positionKey: positionKey(before.fen),
							ourColour: before.ourColour,
							expectedUci: best.bestUci,
							expectedSan: sanOf(before.fen, best.bestUci),
							playedSan: out.played,
							path: [...before.path],
							ply: before.path.length,
							phase: 'freeplay',
							now: Date.now(),
						});
					})();
				}
				if (out.cpLoss >= 0) {
					logAnswer({
						id: `${runId.current}-fp-${before.path.length}-${Date.now()}`,
						ts: Date.now(),
						runId: runId.current,
						path: [...before.path],
						ply: before.path.length,
						phase: 'freeplay',
						correct: true,
						revealed: false,
						assisted: false,
						cpLoss: out.cpLoss,
					});
				}
			} else if (!loggedThisItem.current) {
				loggedThisItem.current = true;
				logAnswer({
					id: `${runId.current}-${before.path.length}-${Date.now()}`,
					ts: Date.now(),
					runId: runId.current,
					path: [...before.path],
					ply: before.path.length,
					phase: before.phase === 'punish' ? 'punish' : 'book',
					correct: out.correct && !assisted,
					revealed: !!opts.revealed,
					assisted,
					cpLoss: out.cpLoss,
				});
			}
			if (before.phase === 'punish') sawMistake.current = true;

			if (!out.correct) {
				missedThisItem.current = true;
				// Only the FIRST miss on a position becomes a card; retries of the
				// same slip within one encounter are one mistake, not several.
				if (!loggedMistake.current && before.expected[0]) {
					loggedMistake.current = true;
					void recordMistake({
						fen: before.fen,
						positionKey: positionKey(before.fen),
						ourColour: before.ourColour,
						expectedUci: before.expected[0].uci,
						expectedSan: before.expected[0].san,
						playedSan: out.played,
						path: [...before.path],
						ply: before.path.length,
						phase: before.phase === 'punish' ? 'punish' : 'book',
						now: Date.now(),
					});
				}
			} else {
				setHistory((h) => [...h, before]);
				setFuture([]);
				recordItem(pendingItem.current, !missedThisItem.current && !opts.revealed);
				pendingItem.current = null;
				missedThisItem.current = false;
				assistedThisItem.current = false;
				loggedThisItem.current = false;
				loggedMistake.current = false;
			}
			setState(out.state);
			setStats((s) => ({
				...s,
				moves: s.moves + 1,
				// A move you were shown is not a move you recalled.
				correct: s.correct + (out.correct && !opts.revealed ? 1 : 0),
				punished: s.punished + (out.state.finished === 'punished' ? 1 : 0),
				missed:
					s.missed + (!out.correct && before.phase === 'punish' ? 1 : 0),
			}));
			if (out.correct) {
				setHint([]);
				setCandidates(null);
				remember(out.state);
				const nextLosses =
					out.cpLoss > 10 ? { ...lossByPly, [before.path.length + 1]: out.cpLoss } : lossByPly;
				persistRun(out.state, nextLosses);
			}


		} catch (e) {
			setError((e as Error).message);
		} finally {
			setPreview(null);
			lastCost.current = {
				calls: evalStats.calls,
				cacheHits: evalStats.cacheHits,
				cloudHits: evalStats.cloudHits,
				localRuns: evalStats.localRuns,
				ms: Math.round(performance.now() - startedAt),
			};
			busyRef.current = false;
			setBusy(false);
		}
	}

	if (!getToken()) {
		return (
			<Empty>
				<p style={{ margin: '0 0 10px', maxWidth: 460, display: 'inline-block' }}>
					<strong>Sign in with Lichess to train.</strong> The opponent&apos;s moves — and their
					mistakes — come from what players at your rating band actually play, and the opening
					explorer refuses anonymous requests.
				</p>
				<div>{onNeedsToken && <Button kind="primary" onClick={onNeedsToken}>Sign in</Button>}</div>
			</Empty>
		);
	}

	// The whole line's positions, from the moves themselves.
	const line = useMemo(() => replayLine(state?.path ?? []), [state?.path.join(' ')]);
	const previewing = previewPly !== null && previewPly < (state?.path.length ?? 0);
	const shown = previewing ? line[previewPly!] : null;

	// An explanation being walked through takes the board over entirely — it is
	// showing a hypothetical, and mixing it with the real position would be
	// worse than either. It wins over the preview for the same reason: it is
	// the thing most recently asked for.
	// Our own move, on the board, before the engine has been asked anything.
	//
	// `submitMove` plays our move AND computes their reply before it returns, so
	// the state — and therefore the board — only changed once, at the end. A
	// dragged move looked fine because chessground moves the piece optimistically
	// on drop; a move played FOR the user ("show me") showed an arrow, then
	// nothing, then both moves animating together. The move was made before the
	// thinking started; the picture should say so.
	const shownFen = explaining?.fen ?? shown?.fen ?? preview?.fen ?? state?.fen ?? '';
	const shownLastMove: [string, string] | undefined = explaining
		? explaining.lastMove
		: previewing
			? shown?.uci
				? [shown.uci.slice(0, 2), shown.uci.slice(2, 4)]
				: undefined
			: (preview?.lastMove ?? lastMove(state));

	const yourTurn =
		!!state && !state.finished && (state.expected.length > 0 || state.phase === 'freeplay');

	/** Resume training from a position earlier in this run. */
	async function playFromPly(ply: number) {
		if (!state || busyRef.current || ply < 0 || ply > state.path.length) return;
		const moves = state.path.slice(0, ply);
		setPreviewPly(null);
		busyRef.current = true;
		setBusy(true);
		try {
			runId.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			sawMistake.current = false;
			setHistory([]);
			setFuture([]);
			setFeedback(null);
			setCandidates(null);
			setLossByPly({});
			// 'book': this is the trainer resuming, not the review page handing a
			// position to the engine.
			const s2 = await playFrom(moves, ply, state.ourColour, cfg, 'book');
			setState(s2);
			remember(s2);
			persistRun(s2, lossByPly);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	/** Train from the position on the board, and stay within it. */
	function pinHere() {
		if (!state?.path.length) return;
		const path = previewing ? state.path.slice(0, previewPly!) : [...state.path];
		if (!path.length) return;
		// Prefer a name over "After 7 moves": the explorer's if it gave one, the
		// bundled index's otherwise, which also covers positions the explorer has
		// stopped naming because they are too deep.
		const named = state.opening?.name ?? nameForPath(path)?.name;
		const root = { path, name: named ?? `After ${Math.ceil(path.length / 2)} moves` };
		if (practice.roots.some((r) => r.path.join(' ') === path.join(' '))) return;
		updatePractice({ roots: [...practice.roots, root] });
	}

	function chips(): MoveChip[] {
		const path = state?.path ?? [];
		return path.map((san, i) => ({
			san,
			ply: i + 1,
			mistake: mistakePlies.has(`${i + 1}|${san}`),
			suboptimal: (lossByPly[i + 1] ?? 0) > 10,
			cpLoss: lossByPly[i + 1],
			// Shading follows the side that moved, not who we are.
			white: i % 2 === 0,
		}));
	}

	function toolbarActions(): ToolbarAction[] {
		return [
			{ id: 'first', title: 'Play again from move 1', icon: 'first', onClick: newRun, disabled: busy },
			{ id: 'back', title: 'Take back your last move', icon: 'back', onClick: takeBack, disabled: busy || !history.length },
			{ id: 'forward', title: 'Replay the move you took back', icon: 'forward', onClick: redo, disabled: busy || !future.length },
			{
				id: 'branch',
				title: 'Same position, they try something else',
				icon: 'branch',
				onClick: () => state?.retryPoint && replayFrom(state.retryPoint),
				disabled: busy || !state?.retryPoint,
			},
			{
				id: 'mistake',
				title: 'Replay the same mistake',
				icon: 'mistake',
				onClick: () => state?.deviationPoint && replayFrom(state.deviationPoint),
				disabled: busy || !state?.deviationPoint,
			},
			{
				id: 'reveal',
				title: 'Show me the move',
				icon: 'reveal',
				onClick: showMe,
				disabled: !yourTurn || busy || state?.phase === 'freeplay',
			},
			{
				id: 'options',
				title: 'Show every option, weighted by how good it is (stops this move counting)',
				icon: 'options',
				onClick: showOptions,
				disabled: !yourTurn || busy,
			},
			{
				id: 'stats',
				title: 'What players at your rating actually play here — frequency and score',
				icon: 'stats',
				onClick: showDistribution,
				accent: !!distribution,
				disabled: !state || busy,
			},
			{
				id: 'share',
				title: 'Copy or share this position',
				icon: 'share',
				onClick: () => setSharing((v) => !v),
				accent: sharing,
				disabled: !state?.path.length,
			},
			{
				id: 'resign',
				title: 'Resign — end this run',
				icon: 'resign',
				onClick: () => {
					if (!state || state.finished) return;
					const ended = resign(state);
					setState(ended);
					persistRun(ended, lossByPly);
				},
				disabled: busy || !state || !!state.finished,
			},
			{
				id: 'playon',
				title: 'Play on against the engine from here',
				icon: 'playon',
				onClick: continuePlaying,
				disabled: busy || !state || state.phase === 'freeplay' || !state.finished,
				accent: state?.finished === 'punished',
			},
		];
	}

	return (
		<div
			style={{
				display: 'flex',
				gap: vp.phone ? 20 : 32,
				alignItems: 'flex-start',
				flexWrap: 'wrap',
			}}
		>
			<div
				style={{
					flex: vp.stacked ? '1 1 100%' : '1 1 320px',
					minWidth: 0,
					maxWidth: vp.stacked ? undefined : 560,
				}}
			>
			{/* The line's name belongs above the board, not below it.
				Underneath it was one short paragraph among the move list, the
				options, the commentary and the controls — which is to say it was
				findable rather than visible, and what line you are in is context
				for the position, not a footnote to it. */}
			{state && !state.finished && (
				<p
					style={{
						margin: `0 0 ${6}px`,
						fontSize: 13,
						color: color.ink2,
						minHeight: 18,
					}}
				>
					{state.phase === 'punish'
						? 'Off book — find the strongest continuation.'
						: state.opening
							? state.opening.name
							: state.bookHere?.length
								? `${state.bookHere.filter((m) => m.verdict === 'main' || m.verdict === 'book').length} book replies here`
								: ''}
				</p>
			)}

			<BoardPanel
				fen={shownFen}
				ourColour={state?.ourColour ?? 'w'}
				evalCp={previewing ? null : (state?.evalNow ?? null)}
				interactive={yourTurn && !busy && !previewing && !explaining}
				lastMove={shownLastMove}
				arrows={
					explaining
						? explaining.arrows
						: previewing
							? []
							: hint.length
								? hint
								: feedback && !feedback.correct
									? feedback.arrows
									: []
				}
				onMove={onMove}
				version={boardVersion}
				actions={toolbarActions()}
				busy={busy}
			>
				<div style={{ marginTop: 10 }}>
					{resumed && (
						<div
							style={{
								fontSize: 13,
								background: '#e3f2fd',
								border: '1px solid #90caf9',
								borderRadius: 6,
								padding: '6px 8px',
								marginBottom: 6,
							}}
						>
							Picked up where you left off.{' '}
							<button onClick={newRun} style={{ fontSize: 12 }}>
								Start fresh instead
							</button>
						</div>
					)}
					<MoveList
						chips={chips()}
						currentPly={previewing ? previewPly! : (state?.path.length ?? 0)}
						onJump={busy ? undefined : previewAt}
						onPlayFrom={busy ? undefined : (ply) => void playFromPly(ply)}
					/>
					<MoveListLegend />

					{previewing && (
						<div
							style={{
								fontSize: 13,
								background: '#fff8e1',
								border: '1px solid #ffe082',
								borderRadius: 6,
								padding: '6px 8px',
								marginTop: 6,
								display: 'flex',
								gap: 8,
								alignItems: 'center',
								flexWrap: 'wrap',
							}}
						>
							{/* Name the move rather than a ply number — §1.1, do not make
								the reader derive what can be shown. */}
							<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
								Looking back at
								<strong>
									{Math.floor((previewPly! - 1) / 2) + 1}.
									{previewPly! % 2 === 0 ? '..' : ''}
								</strong>
								<Move
									san={state!.path[previewPly! - 1]}
									colour={colourAtPly(previewPly! - 1)}
									bold
									size={13}
								/>
								— the game is where you left it.
							</span>
							<button onClick={() => setPreviewPly(null)} style={{ fontSize: 12 }}>
								Back to the game
							</button>
							<button
								onClick={() => previewPly !== null && void playFromPly(previewPly)}
								style={{ fontSize: 12 }}
								disabled={busy}
							>
								Play from here
							</button>
						</div>
					)}

					{/* ---------------------------------------------------------------
						Two different things were sharing one paragraph, in the wrong
						order: commentary on the CURRENT position sat above the verdict
						on the move you had just played, so "Correct" appeared underneath
						a sentence about something else and the two read as one run-on
						remark.

						They are separate blocks now, each captioned, and in the order
						they happened — your move, then their reply. Chronology is the
						only ordering a reader does not have to be taught.
					--------------------------------------------------------------- */}
					{feedback && (
						<div
							style={{
								marginTop: 8,
								fontSize: 14,
								color: feedback.correct ? '#2e7d32' : '#c62828',
								borderLeft: `3px solid ${feedback.correct ? '#2e7d32' : '#c62828'}`,
								paddingLeft: 8,
							}}
						>
							<div
								style={{
									fontSize: 11,
									textTransform: 'uppercase',
									letterSpacing: '0.06em',
									opacity: 0.7,
									marginBottom: 1,
								}}
							>
								Your move
							</div>
							{feedback.message}
							{!feedback.correct && feedback.explanation && (
								<div style={{ opacity: 0.9, marginTop: 2 }}>{feedback.explanation}</div>
							)}
						{/* A sequence in prose asks the reader to replay it in their head
							before they can check the claim — which is the work they are
							here to learn. §1.1: never make the learner derive what can be
							shown. */}
						{!feedback.correct && feedback.refutation.length > 0 && (
							<button
								onClick={() =>
									setExplain({
										line: lineFromUci(feedback.fen, [
											feedback.playedUci,
											...feedback.refutation,
										]),
										label: 'Why that move does not work',
									})
								}
								style={{
									marginTop: 4,
									fontSize: 12,
									border: `1px solid ${color.line}`,
									background: color.page,
									color: color.ink,
									borderRadius: 4,
									padding: '4px 8px',
									cursor: 'pointer',
									minHeight: 32,
								}}
							>
								Show it on the board
							</button>
						)}
							{!feedback.correct && feedback.refutation.length > 0 && (
								<div
									style={{
										opacity: 0.8,
										fontSize: 12,
										display: 'flex',
										flexWrap: 'wrap',
										gap: 6,
										marginTop: 2,
									}}
								>
									{/* Our move, then their refutation — colours alternate from ours. */}
									<Move
										san={feedback.played}
										colour={state?.ourColour ?? 'w'}
										size={12}
									/>
									{sanLine(feedback.fen, feedback.playedUci, feedback.refutation).map(
										(san, i) => (
											<Move
												key={i}
												san={san}
												colour={
													i % 2 === 0
														? other(state?.ourColour ?? 'w')
														: (state?.ourColour ?? 'w')
												}
												size={12}
											/>
										),
									)}
								</div>
							)}
							{!feedback.correct && attempts >= 2 && (
								<div style={{ fontSize: 12, opacity: 0.7 }}>
									Two misses — &ldquo;Show me&rdquo; will play it for you.
								</div>
							)}
						</div>
					)}

					{/* Their reply, second, because it happened second. */}
					{state?.lastOpponent && !state.finished && (
						<div
							style={{
								fontSize: 14,
								marginTop: 8,
								borderLeft: `3px solid ${
									state.lastOpponent.kind === 'mistake' ? '#c62828' : '#e6e5e2'
								}`,
								paddingLeft: 8,
							}}
						>
							<div
								style={{
									fontSize: 11,
									textTransform: 'uppercase',
									letterSpacing: '0.06em',
									opacity: 0.7,
									marginBottom: 1,
								}}
							>
								They played
							</div>
							{state.lastOpponent.kind === 'mistake' ? (
								<span style={{ color: '#c62828' }}>
									<Move
										san={state.lastOpponent.san}
										colour={other(state.ourColour)}
										bold
										size={14}
									/>{' '}
									—{' '}
									{state.lastOpponent.severity === 'blunder' ? 'a mistake' : 'loose'},{' '}
									{(state.lastOpponent.frequency * 100).toFixed(0)}% play it here. Punish it.
								</span>
							) : (
								<span style={{ opacity: 0.75 }}>
									<Move
										san={state.lastOpponent.san}
										colour={other(state.ourColour)}
										bold
										size={14}
									/>
									{state.lastOpponent.lineName ? ` — ${state.lastOpponent.lineName}` : ''}
								</span>
							)}
						</div>
					)}

					{state?.finished && (
						<div style={{ marginTop: 8, fontWeight: 600, color: '#2e7d32' }}>
							{state.finished === 'line-complete' ? 'Line complete.' : state.note}
						</div>
					)}

					{explain && (
						<LinePlayer
							line={explain.line}
							label={explain.label}
							onBoard={setExplaining}
							onClose={() => setExplain(null)}
						/>
					)}

					{sharing && state && (
						<ShareMenu
							items={[
								{
									id: 'pgn',
									label: 'Copy PGN',
									note: 'The whole run, for pasting into a board or an analysis tool.',
									kind: 'copy',
									value: toPgn(state, state.opening ? [state.opening.name] : []),
								},
								{
									id: 'fen',
									label: 'Copy FEN',
									note: 'Just this position.',
									kind: 'copy',
									value: state.fen,
								},
								{
									id: 'lichess',
									label: 'Analyse on Lichess',
									note: 'Opens this position in their analysis board.',
									kind: 'open',
									value: `https://lichess.org/analysis/${state.fen.replace(/ /g, '_')}`,
								},
								...(canShareNatively()
									? [
											{
												id: 'native',
												label: 'Share…',
												note: 'Your device\u2019s own share sheet.',
												kind: 'copy' as const,
												value: toPgn(state, state.opening ? [state.opening.name] : []),
											},
										]
									: []),
							]}
							onClose={() => setSharing(false)}
						/>
					)}

					{distribution && state && (
						<div style={{ marginTop: 10 }}>
							<DistributionList
								distribution={distribution}
								mover={colourOfFen(state.fen)}
							/>
						</div>
					)}

					{error && <div style={{ color: '#c62828', fontSize: 14 }}>{error}</div>}
				</div>
			</BoardPanel>
			</div>

			{/* minWidth: 300 forced the shell wider than a phone and produced a
				horizontal scrollbar across the whole app. Basis, not minimum — and
				below NARROW_MAX a full row of its own, so the board is not made to
				share a width that is already scarce. On a 768px tablet, splitting
				gave a SMALLER board than a 393px phone got. */}
			<div style={{ flex: vp.stacked ? '1 1 100%' : '1 1 300px', minWidth: 0 }}>
				<h3 style={{ marginTop: 0 }}>Session</h3>
				<div style={{ fontSize: 15 }}>
					{stats.moves === 0 ? (
						<em>No moves yet.</em>
					) : (
						<>
							<strong>
								{stats.correct}/{stats.moves}
							</strong>{' '}
							moves ({Math.round((stats.correct / stats.moves) * 100)}%)
							<div style={{ fontSize: 13, opacity: 0.8 }}>
								{stats.runs} runs · {stats.punished} punished
								{stats.missed > 0 && ` · ${stats.missed} punishments missed`}
								{stats.shown > 0 && ` · ${stats.shown} shown`}
							</div>
						</>
					)}
				</div>


				{candidates && (
					<>
						<h3>Options here</h3>
						<ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
							{candidates.map((c) => (
								<li
									key={c.uci}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										padding: '3px 0',
										fontSize: 14,
									}}
								>
									{/* Swatch uses the board's own ramp, so the two are read together. */}
									<span
										style={{
											width: 18,
											height: 6,
											borderRadius: 3,
											background: colourForGrade(c.grade),
											flexShrink: 0,
										}}
									/>
									<Move san={c.san} colour={state?.ourColour ?? 'w'} bold size={14} />
									<span style={{ opacity: 0.75, marginLeft: 'auto' }}>
										{c.cp > 0 ? '+' : ''}
										{(c.cp / 100).toFixed(2)}
										{c.loss > 0 && (
											<span style={{ opacity: 0.6 }}> −{c.loss}</span>
										)}
									</span>
								</li>
							))}
						</ul>
						<p style={{ fontSize: 12, opacity: 0.65 }}>
							Arrow weight and swatch share one ramp — thick and dark is best. The evaluation
							is drawn on each arrow head too. This move will not count towards your
							accuracy.
						</p>
					</>
				)}

				<h3>Engine strength</h3>
				<div style={{ fontSize: 14 }}>
					<select
						value={botLevel}
						onChange={(e) =>
							setBotLevel(e.target.value === 'auto' ? 'auto' : Number(e.target.value))
						}
						style={{ fontSize: 14 }}
					>
						<option value="auto">
							{/* "(default until measured)" said what the app was doing and
								not what it would do. The number is the answer. */}
							Match me{' '}
							{rating.confident
								? `(~${bot.elo}, from your play)`
								: `(~${bot.elo} until you have played enough to measure)`}
						</option>
						{BOT_LEVELS.map((l) => (
							<option key={l.level} value={l.level}>
								{l.label} (~{l.elo})
							</option>
						))}
					</select>
				</div>
				<p style={{ fontSize: 12, opacity: 0.65 }}>
					{rating.elo === null
						? 'No estimate yet — play on from a won position and your moves get scored.'
						: rating.confident
							? `Estimated ${rating.elo} from ${rating.sample} free-play moves (${rating.acpl}cp average loss).`
							: `Provisional ${rating.elo} from only ${rating.sample} moves — not yet trusted.`}{' '}
					Repertoire answers are excluded: recalling a memorised move measures memory, not
					strength.
				</p>

				<h3>Scheduling</h3>
				<Schedule memory={memory} />

				<div
					style={{
						display: 'flex',
						alignItems: 'baseline',
						justifyContent: 'space-between',
						gap: 8,
					}}
				>
					<h3 style={{ marginBottom: 0 }}>What you are practising</h3>
					<button
						onClick={() => setPractice(resetPractice())}
						style={{ fontSize: 11 }}
						title="Back to White, any book move over 3%, no pinned opening, 35% mistakes"
					>
						Reset
					</button>
				</div>
				<p style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
					{describePractice(practice)}
				</p>

				<label style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
					Colour{' '}
					<select
						value={practice.colour}
						onChange={(e) => updatePractice({ colour: e.target.value as 'w' | 'b' })}
					>
						<option value="w">White</option>
						<option value="b">Black</option>
					</select>
				</label>

				<div style={{ fontSize: 14, marginBottom: 4 }}>How strict?</div>
				{STRICTNESS.map((s) => (
					<label key={s.id} style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
						<input
							type="radio"
							name="strictness"
							checked={practice.strictness === s.id}
							onChange={() => updatePractice({ strictness: s.id })}
						/>{' '}
						{s.label}
						<div style={{ fontSize: 12, opacity: 0.6, marginLeft: 22 }}>{s.note}</div>
					</label>
				))}

				{practice.strictness !== 'repertoire' && (
					<label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
						Opponent plays replies above{' '}
						<strong>{(practice.minFreq * 100).toFixed(0)}%</strong> of games
						<input
							type="range"
							min={1}
							max={20}
							step={1}
							value={Math.round(practice.minFreq * 100)}
							onChange={(e) => updatePractice({ minFreq: Number(e.target.value) / 100 })}
							style={{ width: '100%' }}
						/>
						<div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
							{/* This used to say "counts as theory", and it governed YOUR
								moves as well as theirs — which is how a sound move could
								be marked wrong for being unpopular. It now does only what
								it should: decide how mainstream an opponent you face. */}
							How mainstream your opponent is. Lower it to meet rarer replies. It does
							not judge your own moves — those are judged on whether they give
							anything away, not on how many other people choose them.
						</div>
					</label>
				)}

				<h3>Where from</h3>
				{practice.roots.length === 0 ? (
					<p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 8px' }}>
						Starting from move 1, whole tree. Whatever you play decides the opening.
					</p>
				) : (
					<>
						<ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
							{practice.roots.map((r, i) => (
								<li
									key={`${r.name}-${i}`}
									style={{
										display: 'flex',
										alignItems: 'baseline',
										gap: 6,
										padding: '3px 0',
										borderBottom: '1px solid #eee',
									}}
								>
									<div style={{ flex: 1 }}>
										<div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
										<div style={{ opacity: 0.6, fontSize: 11 }}>
											<MoveLine sans={r.path} size={11} />
										</div>
									</div>
									<button
										onClick={() =>
											updatePractice({
												roots: practice.roots.filter((_, j) => j !== i),
											})
										}
										title="Remove from the filter"
										style={{ fontSize: 11 }}
									>
										×
									</button>
								</li>
							))}
						</ul>

						<label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
							<input
								type="checkbox"
								checked={practice.playFromStart}
								onChange={(e) => updatePractice({ playFromStart: e.target.checked })}
							/>{' '}
							Play from move 1
							<div style={{ fontSize: 12, opacity: 0.6, marginLeft: 22 }}>
								The moves that reach the opening are part of it. Off, and they are
								played for you so each run starts at the position itself.
							</div>
						</label>

						<button
							onClick={() => updatePractice({ roots: [] })}
							style={{ fontSize: 12, marginBottom: 8 }}
						>
							Clear the filter
						</button>
					</>
				)}

				<OpeningSearch
					colour={practice.colour}
					onPick={(o) =>
						updatePractice({
							// Same opening twice is not two filters.
							roots: practice.roots.some((r) => r.path.join(' ') === o.path.join(' '))
								? practice.roots
								: [...practice.roots, { path: o.path, name: o.name }],
						})
					}
				/>

				<div style={{ marginTop: 8 }}>
					<button
						onClick={pinHere}
						disabled={!state?.path.length}
						style={{ fontSize: 12 }}
						title="Add the position on the board to the filter"
					>
						…or add the position on the board
					</button>
				</div>

				<h3>Mistake rate</h3>
				<label style={{ fontSize: 14 }}>
					{Math.round(practice.deviationChance * 100)}% of their moves
					<input
						type="range"
						min={0}
						max={100}
						value={practice.deviationChance * 100}
						onChange={(e) => updatePractice({ deviationChance: Number(e.target.value) / 100 })}
						style={{ width: '100%' }}
					/>
				</label>
				<p style={{ fontSize: 12, opacity: 0.65 }}>
					At 0% the opponent only ever plays book, so a run is pure recall. Higher, and they
					keep stepping outside theory — but only with moves that are genuinely bad and
					actually played at your band, never with a sound move from another opening.
				</p>
			</div>
		</div>
	);
}

/**
 * What the scheduler currently believes.
 *
 * Worth showing: a trainer that silently decides what to ask is hard to trust,
 * and "known" going up is the closest thing to a progress bar this app has.
 */
function Schedule({ memory }: { memory: MemoryStore }) {
	const s = summarise(memory, Date.now());
	if (!s.total) {
		return (
			<p style={{ fontSize: 13, opacity: 0.7 }}>
				Nothing scheduled yet — every reply is equally likely until you have met it.
			</p>
		);
	}
	return (
		<div style={{ fontSize: 13 }}>
			<div>
				<strong>{s.known}</strong> known · {s.learning} learning · {s.due} due now
			</div>
			<p style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
				Answer a reply correctly and it is pushed further out — 1 min, 5 min, 25 min, 2 h, then
				days. Miss it and it comes straight back, harder than before.
			</p>
		</div>
	);
}

function sanOf(fen: string, uci: string): string {
	try {
		return applyUci(fen, uci).san;
	} catch {
		return uci;
	}
}

function arrowFor(
	uci: string,
	brush: 'red' | 'blue' | 'green',
): { orig: string; dest: string; brush: string } {
	return { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush };
}

/**
 * Render the engine's refutation.
 *
 * `fen` is the position BEFORE our move and the PV starts after it, so our move
 * has to be applied first — otherwise the line is replayed from the wrong side
 * of the board and comes out as nonsense.
 */
function sanLine(fen: string, playedUci: string, ucis: string[]): string[] {
	let cur: string;
	try {
		cur = applyUci(fen, playedUci).fen;
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const uci of ucis) {
		try {
			const r = applyUci(cur, uci);
			out.push(r.san);
			cur = r.fen;
		} catch {
			break;
		}
	}
	return out;
}

/** The position the board is showing: the previewed ply, or the live one. */
function boardFenOf(state: RunState | null, previewPly: number | null): string | null {
	if (!state) return null;
	if (previewPly === null || previewPly >= state.path.length) return state.fen;
	return replayLine(state.path)[previewPly]?.fen ?? state.fen;
}

function lastMove(state: RunState | null): [string, string] | undefined {
	const u = state?.lastOpponent?.uci;
	return u ? [u.slice(0, 2), u.slice(2, 4)] : undefined;
}

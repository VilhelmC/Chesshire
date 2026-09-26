// The trainer: play the opening from move 1, over and over.
//
// Each run starts at the initial position. You play your side; the opponent
// either continues into one of the variations you are training, or plays a real
// mistake you have to notice and punish. Reset and they may choose differently.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { nameOf } from '../domain/caption';

import {
	startRun,
	submitMove,
	resumeFrom,
	playFrom,
	resign,
	explainMistake,
	type RunState,
	type RestorePoint,
	type SessionConfig,
} from '../engine/session';
import { applyUci, replayLine, parseSquare } from '../domain/chess';
import { getToken } from '../data/explorer';
import { MoveTable } from '../components/MoveTable';
import { useMoveTable } from '../hooks/useMoveTable';
import {
	filterMoves,
	effectiveSources,
	type MoveRow,
	type MoveSource,
} from '../domain/moveTable';
import { ShareMenu, shareItemsFor } from '../components/ShareMenu';
import { LinePlayer, type BoardOverride } from '../components/LinePlayer';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import { TrainingWheels } from '../components/TrainingWheels';
import { useTrainingWheels } from '../hooks/useTrainingWheels';
import { useLineOverlay } from '../hooks/useLineOverlay';
import { useCommentary } from '../hooks/useCommentary';
import { Commentary } from '../components/CommentaryPanel';
import { lineFromUci, stepAt, type Line } from '../domain/line';
import { walkBack, walkBackTo, walkThrough } from '../domain/walk';
import { color, space, text, verdictColor } from '../ui/theme';
import { markTraining } from '../data/autoImport';
import { Button, Note, Select, Toggle } from '../ui/primitives';
import type { ToolbarAction } from '../components/Toolbar';
import { BoardPanel } from '../components/BoardPanel';
import { Thinking } from '../components/Thinking';
import { useMoveTableToggle } from '../hooks/useMoveTableToggle';
import { PositionStack } from '../components/PositionStack';
import type { Shape } from '../components/Board';
import { Move, MoveLine } from '../components/Move';
import { other, colourAtPly, colourOfFen, withGlyph } from '../domain/notation';
import { MoveList, MoveListHeader, MoveListLegend, type MoveChip } from '../components/MoveList';
import { brushForGrade, type Candidate } from '../engine/candidates';
import { BOT_LEVELS, levelFor, estimate, type Estimate } from '../domain/rating';
import { freeplayLosses, gameLosses } from '../domain/progress';
import { fromGame, type Reviewable } from '../domain/reviewable';
import { splitBySpeed } from '../domain/playedGames';
import { db } from '../data/db';
// Aliased: this file already has a `remember` — the one that stores the RUN.
import { recall as recallView, remember as rememberView } from '../data/viewState';
import { loadProgress } from '../data/progress';
import { logRun } from '../data/progress';
import { recordOutcome } from '../data/outcome';
import { saveSession, loadSession, clearSession } from '../data/session';
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
	onPlayFrom,
	onNeedsToken,
}: {
	/** Hand this position to the Play tab. The same door Review and Mistakes use. */
	onPlayFrom?: (h: { moves: string[]; ply: number; ourColour: 'w' | 'b' }) => void;
	/** Somewhere to send someone who cannot train yet, rather than naming a tab. */
	onNeedsToken?: () => void;
}) {
	const [state, setState] = useState<RunState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [feedback, setFeedback] = useState<{
		correct: boolean;
		/*
		 * THREE OUTCOMES, THREE COLOURS.
		 *
		 * Will, issue #3: "the explanation for why my move is rejected is in red
		 * text even though move is judged sound by engine." There were two tones
		 * and three things to say — right, refused-but-sound, and wrong — so one
		 * of the three had to borrow a colour, and the one that borrowed was the
		 * one where the colour does the most damage. Red is read before the
		 * sentence, and the sentence began "sound, but".
		 */
		tone: 'good' | 'warn' | 'bad';
		message: string;
		refutation: string[];
		fen: string;
		played: string;
		playedUci: string;
		explanation: string;
		arrows: Arrow[];
		/** The engine's choice here, when it differs — see `MoveOutcome.better`. */
		better?: { uci: string; san: string; line: string[] };
	} | null>(null);
	const [stats, setStats] = useState<Stats>(EMPTY);
	const [practice, setPractice] = useState<PracticeConfig>(() => loadPractice());
	const vp = useViewport();
	/*
	 * `q0`–`q4` are the quality ramp registered in Board, and `book` is the ring.
	 *
	 * THE SAME `Shape` THE BOARD TAKES, not a local narrowing of it. This was
	 * declared here with `dest` REQUIRED, which is narrower than what it is
	 * forwarded to — and the difference is exactly the shape that now matters: a
	 * `Shape` with no `dest` is a CIRCLE, which is how a book move is marked.
	 * `BoardPanel` had already been caught making this mistake once.
	 */
	type Arrow = Shape;
	const [hint, setHint] = useState<Arrow[]>([]);
	/*
	 * THE RUN IS WAITING FOR YOU TO SAY YOU HAVE READ IT.
	 *
	 * A resolver, not a boolean: the thing being paused is a point inside
	 * `onMove`, and the natural way to express "carry on from here when told" is
	 * to hand the continuation out and hold it. A flag would need the handler
	 * split in two around it, with the half after the pause re-entering from an
	 * effect — the same state reachable two ways, which is how this repo's
	 * bugs start.
	 *
	 * Stored wrapped (`setHolding(() => resolve)`) because React treats a bare
	 * function argument to a setter as an updater and would CALL it.
	 */
	const [holding, setHolding] = useState<null | (() => void)>(null);

	/*
	 * Read ONCE, at mount. `getToken()` reads localStorage, and calling it in
	 * the render path would make every frame of a run touch storage to answer a
	 * question that changes at most once a session.
	 */
	const [signedIn] = useState(() => !!getToken());
	const [hushed, setHushed] = useState(
		() => recallView('bookNoticeHushed', (v) => typeof v === 'boolean') === true,
	);
	const hush = useCallback(() => {
		setHushed(true);
		rememberView({ bookNoticeHushed: true });
	}, []);
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
			mode: state?.mode ?? null,
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
			// Whether this run was restored rather than started. Nothing says so on
			// screen any more — see the note where the banner used to be — but it is
			// still a real fact about the session and worth having in a bug report.
			resumed,
			feedback,
			hintArrows: hint.length,
			// The two that decide what the board draws, since they are derived and
			// so cannot be read off any stored value.
			tableOn: [...tableOn],
			tableArrows: tableArrows.length,
			wheelArrows: wheels.arrows.length,
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
	/**
	 * The engine's top few for the position on the board.
	 *
	 * OWNED BY THE EFFECT that follows the `engine` tag — see `showOptions`.
	 * Anything else writing it is a second owner, and a second owner is how the
	 * tag and the arrows came to disagree.
	 */
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
		void clearSession('train');
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
			// Replaying reuses ply numbers with different moves, so anything keyed
			// by ply alone is stale from here on.
			setLossByPly({});
			const resumed = await resumeFrom(point, cfg, state);
			/*
			 * REWIND ONE MOVE AT A TIME, here too.
			 *
			 * Will: "I asked you before that whenever we rewind the animation is a
			 * single move at a time. That is not happening when user clicks 'new
			 * reply'." It was not: this set the state and nothing else, so the
			 * board jumped — and a jump slides every piece to its destination at
			 * once, which is exactly what the walk exists to stop. See
			 * `domain/walk`'s `walkBack` for why neither existing helper fitted.
			 */
			setVia(
				walkBack(
					replayLine(state.path).map((p) => p.fen),
					state.path.length,
					point.path.length,
					resumed.fen,
				),
			);
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
			/*
			 * THE GAMES YOU PLAYED ARE THE BETTER MEASUREMENT, so the bot matches
			 * against those when there are enough of them.
			 *
			 * Will: "why is my rating estimate only based on 28 scored moves, when
			 * there are plenty of games imported." It was, and the answer was that
			 * imported games never reached the estimator — which also meant the bot
			 * was sizing itself off a couple of dozen moves played against a bot,
			 * rather than off hundreds played against people. Free play stays as the
			 * fallback: a reader with no imported games still gets a level.
			 */
			try {
				const games = await db.imported.toArray();
				const played = games.map(fromGame).filter((r): r is Reviewable => r !== null);
				// Correspondence games are excluded here too, and for the bot it
				// matters most: sizing the opponent off games played with an analysis
				// board open would set it 300 points above the reader.
				const fromGames = estimate(
					gameLosses(splitBySpeed(played).counted, (moves) => nameForPath(moves)?.path.length ?? 0),
				);
				setRating(fromGames.confident ? fromGames : estimate(freeplayLosses(answers)));
			} catch {
				setRating(estimate(freeplayLosses(answers)));
			}
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
		void saveSession('train', {
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

	/*
	 * NOTHING IS HANDED TO THE TRAINER ANY MORE.
	 *
	 * This effect took a position from Review and started a run on it. Review
	 * was never asking for a run, though — it was asking for a board, and so
	 * were Mistakes and this tab's own free-play button. All three go to Play
	 * now, which is the whole point of it existing. See `App`'s `playFrom`.
	 */

	useEffect(() => {
		if (!memoryReady) return;
		void (async () => {
			// Pick the game back up rather than throwing it away.
			const saved = await loadSession('train');
			if (saved?.state) {
				const s = saved.state as RunState;
				runId.current = saved.runId;
				sawMistake.current = saved.sawMistake ?? false;
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
	}, [memoryReady]);

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
	/**
	 * Jump to a ply in the game, animating the moves in between.
	 *
	 * -------------------------------------------------------------------------
	 * Will: "I'm wondering whether whenever we step or forward we can actually
	 * show the animation?"
	 *
	 * Chessground animates every position change already, so one ply was always
	 * fine. Clicking a move eight plies back was not: it slid every piece
	 * straight to where it ends up, simultaneously, which is a picture of the
	 * DIFFERENCE rather than of the moves. The positions in between are right
	 * here in `line`, so the board is handed them — see `Board`'s `via`.
	 */
	/**
	 * Give the move list back to the game, walking out of the line first.
	 *
	 * -------------------------------------------------------------------------
	 * Will: "if we've been stepping through a branch move sequence, if we return
	 * to the game it would be useful to animate the sequence of moving the
	 * pieces back — that way user gets intuitive visual cue."
	 *
	 * The borrowed line and the game share a position — the line starts from the
	 * board you were looking at — so the way back is the line's own moves
	 * unplayed, one at a time, ending on the live position. Without it the board
	 * cut from somewhere four plies deep in a hypothetical straight to the real
	 * game, which looks like a different position appearing rather than like
	 * coming back from somewhere.
	 *
	 * Wrapped rather than pushed into `useLineOverlay`, because the destination
	 * is the GAME's position and the overlay deliberately does not know about
	 * the game — see that hook's note on what it does not own.
	 */
	function closeLine() {
		const o = lineOverlay.overlay;
		if (o && state) {
			// Index −1 is the position the line starts from, so the cursor at `at`
			// sits at index `at + 1` of this array.
			const positions = [
				stepAt(o.line, -1).fen,
				...o.line.steps.map((_, i) => stepAt(o.line, i).fen),
			];
			// The destination is what the board shows ONCE THE OVERLAY IS GONE, so
			// it is `shownFen`'s own fallback chain minus the overlay — reading
			// `shownFen` here would give the line's position, which is where we
			// are leaving from.
			setVia(walkBackTo(positions, o.at, explaining?.fen ?? shown?.fen ?? state.fen));
		}
		lineOverlay.close();
	}

	function previewAt(ply: number) {
		if (busyRef.current || !state) return;
		setHint([]);
		// Clicking the ply you are already on, or the last one, goes back to the
		// live position — so the DESTINATION is not always the ply clicked.
		const leaving = previewPly ?? state.path.length;
		const landing = previewPly === ply || ply === state.path.length ? state.path.length : ply;
		setVia(walkThrough(line.map((p) => p.fen), leaving, landing));
		setPreviewPly(landing === state.path.length ? null : landing);
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
	/**
	 * WHICH LISTS THE ONE TABLE IS SHOWING.
	 *
	 * Will: "we should unify these three buttons: one table, the buttons just
	 * toggle different entries (may overlap)". So the three toolbar buttons no
	 * longer each own a rendering — they fetch their source and switch its tag on.
	 * Empty means everything that has been fetched.
	 */
	/*
	 * WHICH SOURCES THE TABLE ADMITS — remembered, and all three by default.
	 *
	 * Will: "which filters are active in the show table should be persisted.
	 * Default is all three toggled (so the intersection of engine's top moves,
	 * book moves, and actually played moves)."
	 *
	 * That default is a good first view precisely because it intersects: the
	 * moves that are theory AND sound AND actually played are the ones with
	 * nothing against them. When it comes back empty that is worth knowing too,
	 * and the table says which sources disagreed.
	 */
	const [tableOn, setTableOnState] = useState<ReadonlySet<MoveSource>>(
		() =>
			new Set(
				(recallView('tableOn', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')) ?? [
					'line',
					'engine',
					'popular',
				]).filter((k): k is MoveSource => k === 'line' || k === 'engine' || k === 'popular'),
			),
	);
	const setTableOn = useCallback(
		(next: ReadonlySet<MoveSource> | ((cur: ReadonlySet<MoveSource>) => ReadonlySet<MoveSource>)) => {
			setTableOnState((cur) => {
				const value = typeof next === 'function' ? next(cur) : next;
				rememberView({ tableOn: [...value] });
				return value;
			});
		},
		[],
	);

	/*
	 * THE MOVE TABLE'S BUTTON, from the shared hook.
	 *
	 * Three tabs held their own `tableShown` boolean with their own setter
	 * writing the same stored key, and all three were about to need the same two
	 * new behaviours — closing after a move, and a double press that pins. See
	 * `hooks/useMoveTableToggle`, and `domain/tableToggle` for why closing is the
	 * default: the table being up counts as HELP, so a toggle that lingers
	 * silently marks every later move as assisted.
	 */
	const moveTable = useMoveTableToggle();
	const tableShown = moveTable.shown;
	const [sharing, setSharing] = useState(false);
	/**
	 * Positions the board should pass through on its way to the next one.
	 *
	 * Set by the handful of actions that move the board more than one ply at a
	 * time; ignored by the board unless its `to` names the position actually
	 * being shown, so a leftover value cannot be replayed at the wrong moment.
	 */
	const [via, setVia] = useState<{ to: string; through: string[] } | null>(null);
	/** A claim being demonstrated on the board rather than described in prose. */
	const [explain, setExplain] = useState<{ line: Line; label: string } | null>(null);
	const [explaining, setExplaining] = useState<BoardOverride>(null);
	/**
	 * A borrowed line, shown in the move list under the board.
	 *
	 * One list, one cursor, one set of step buttons — the explainer and the
	 * mate proof hand their sequence to this rather than each rendering a
	 * stepper of their own.
	 */
	const lineOverlay = useLineOverlay();
	/**
	 * PLAN-EXPLAINER §5: one panel, three hosts. Train is the second — the same
	 * `explain(fen, move, alternatives)` the Lab asks, reached through a different
	 * door. The board needs no changes at all: `ExplainPanel` publishes through
	 * `BoardOverride`, which `explaining` already honours for `LinePlayer`.
	 */
	const [asking, setAsking] = useState<Ask | null>(null);
	/**
	 * The same overlays the Lab has, on the position being played.
	 *
	 * Will: "Maybe we should integrate with train and mistakes so I can test in a
	 * more realistic setting." The Lab is a bench; this is where somebody is
	 * actually learning, which is where a training wheel belongs. One hook, so a
	 * change lands in all three tabs at once.
	 */
	/**
	 * The man the safe-moves overlay is about.
	 *
	 * That wheel draws for ONE piece — a position has 27 legal moves on average
	 * and drawing them all is a scribble — so it needs somewhere to be told which.
	 * Clicking the same square again clears it.
	 */
	const [focus, setFocus] = useState<number | null>(null);
	
	/**
	 * Every legal move, weighted — and available after the line is over.
	 *
	 * Will: "after reaching end of line the 'show options' button is disabled, but
	 * we should be able to see Stockfish evaluations of continuations same as any
	 * board position."
	 *
	 * It was gated on `yourTurn`, which is false once `state.finished` is set. But
	 * `yourTurn` is a fact about the DRILL — is there an answer being asked for —
	 * and this button is a fact about the POSITION, which is still a position with
	 * legal moves and evaluations. The two got conflated because for most of the
	 * run they coincide.
	 *
	 * The scoring lines below are the part that genuinely belongs to the drill, so
	 * they are skipped once it is over: there is no item left to mark as missed and
	 * nothing to withhold credit from. Counting a look at a finished line as help
	 * would penalise the one moment when help cannot possibly be cheating.
	 *
	 * "Show me the move" stays disabled here, and correctly — there is no canon
	 * move left to show. That is a different fact, and it keeps its own gate.
	 */
	
	/** Carry on against the engine from a won position. */

	async function onMove(uci: string, opts: { revealed?: boolean } = {}) {
		if (!state || busyRef.current || state.finished) return;
		// Free play has no expected list — every legal move is allowed there.
		if (!state.expected.length && state.mode !== 'free') return;
		busyRef.current = true;
		setBusy(true);
		/*
		 * THE LAST MOVE'S VERDICT GOES NOW, not when the next one arrives.
		 *
		 * Will: "after submitting a move the commentary on the past move should be
		 * immediately hidden so user doesn't think that's the new commentary while
		 * the app is thinking. Display the thinking or loading animation there in
		 * place of the old text."
		 *
		 * Exactly the failure: an engine search takes a second or two, and for the
		 * whole of it the panel headed "Your move" held the verdict on the PREVIOUS
		 * move — in the same place, in the same words, with no sign it was stale.
		 * A verdict that survives the move it was about is worse than no verdict,
		 * because it is read as an answer.
		 */
		setFeedback(null);

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
			/*
			 * A REFUSED MOVE IS MARKED; THE ANSWER IS NOT DRAWN.
			 *
			 * Will: "when a mistake is made, or a better or equivalent move is not
			 * accepted because the current strictness is book for example, we
			 * shouldn't write out the correct move and show the arrow. User should
			 * just get to guess again after being informed why their move wasn't
			 * accepted."
			 *
			 * There used to be a green arrow to `expected[0]` here, and the old
			 * comment justified it — "whenever the message NAMES a move, the board
			 * should show it". That premise was sound and the conclusion followed
			 * from it; what changed is that the message no longer names the move.
			 * The run does not advance on a refusal, so drawing the answer left the
			 * next attempt with nothing to retrieve.
			 *
			 * The arrow on YOUR OWN move stays: it says which move was refused,
			 * which you already know, and on a board where nothing moved it is the
			 * only thing connecting the sentence to a square. Blue for a novelty,
			 * red for a mistake — the colour is read before the words.
			 */
			const arrows: Arrow[] = [...explained.arrows];
			if (!out.correct && before.mode === 'drill' && before.phase === 'book') {
				arrows.length = 0;
				arrows.push({
					orig: uci.slice(0, 2),
					dest: uci.slice(2, 4),
					brush: out.novelty ? 'blue' : 'red',
				});
			}

			setFeedback({
				// A novelty is not `out.correct` — the run has not moved — but it must
				// not be shown in the failure tone either. See `MoveOutcome.novelty`.
				correct: out.correct || !!out.novelty,
				tone: out.correct ? 'good' : out.novelty || out.sound ? 'warn' : 'bad',
				message: out.message,
				refutation: out.refutation,
				fen: before.fen,
				played: out.played,
				playedUci: uci,
				explanation: explained.text,
				arrows,
				...(out.better ? { better: out.better } : {}),
			});
			// A novelty does not count as a failed attempt. Attempts drive the
			// escalating help, and escalating help at someone who just played a move
			// the engine likes is the app arguing with itself.
			setAttempts((a) => (out.correct || out.novelty ? 0 : a + 1));
			// A rejected move leaves the piece where it was dropped until the board
			// is told otherwise — the run state has not moved on.
			if (!out.correct) setBoardVersion((v) => v + 1);

			if (out.correct && out.cpLoss > 10) {
				setLossByPly((m) => ({ ...m, [before.path.length + 1]: out.cpLoss }));
			}

			/*
			 * ACCEPTED, BUT SOMETHING WAS BETTER — the one case that DOES show the
			 * move, and the one that waits.
			 *
			 * Will: "the one case we should show the move is when move is accepted
			 * but there was a better allowed one … we should probably show the
			 * better move with an arrow. Prompt user before continuing so user has
			 * a chance to actually read and consider."
			 *
			 * It used to hold for 1200ms and move on. A fixed beat is the wrong
			 * shape for this: it is too long when you have already seen it and far
			 * too short to read a sentence, compare two moves on the board and
			 * decide what you think — which is the entire point of showing it. So
			 * the run waits for a gesture instead.
			 *
			 * Safe to block here: `busyRef` is still held, so the board takes no
			 * move, and the position on screen is still the one the arrows refer to
			 * because `setState(out.state)` is further down.
			 */
			/*
			 * AT EVERY RUNG, and pointing at the ENGINE's move.
			 *
			 * Will: "when there is a better engine move we should always get the
			 * notification a better move exists, regardless of strictness."
			 *
			 * This used to require the move to be off the accepted set
			 * (`!wasExact`), which is the opposite of "regardless of strictness":
			 * the looser the rung, the more moves it accepted and the less often
			 * it said anything. At 'free' it was silent almost always, which is
			 * exactly where a beginner most needs telling. `out.better` is set by
			 * the session whenever something measurably better existed, whatever
			 * the rung — see `MoveOutcome.better`.
			 *
			 * The green arrow was `expected[0]`, the first ACCEPTED move, which at
			 * a loose rung is whatever the explorer happened to list first and is
			 * not the better move at all.
			 */
			if (out.correct && out.better) {
				setHint([
					{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'blue' },
					arrowFor(out.better.uci, 'green'),
				]);
				await new Promise<void>((resolve) => setHolding(() => resolve));
				setHolding(null);
				setHint([]);
			}

			/*
			 * WHAT THE MOVE LEAVES BEHIND — a progress row, and sometimes a card.
			 *
			 * This was ~100 lines here, and it is the densest part of the handler
			 * that has nothing to do with rendering: free play logs every
			 * measurable move, the drill logs one row per encounter with a novelty
			 * exemption and a first-miss-only rule for cards. See `data/outcome`,
			 * which is also the measurement — about half of what `onMove` does is
			 * spaced-repetition bookkeeping that means nothing in a game.
			 */
			const once = { logged: loggedThisItem.current, mistake: loggedMistake.current };
			recordOutcome({
				before,
				out,
				uci,
				runId: runId.current,
				assisted: assistedThisItem.current || !!opts.revealed,
				revealed: !!opts.revealed,
				once,
				sanOf,
			});
			loggedThisItem.current = once.logged;
			loggedMistake.current = once.mistake;
			if (before.mode === 'drill' && before.phase === 'punish') sawMistake.current = true;

			if (out.novelty) {
				// NOT A MISS. Will: "it should not count as error ... The card does not
				// go into the opening mistakes bin." So no `missedThisItem` — which would
				// mark the position as failed for spaced repetition — and no card. The
				// position is unchanged, so the drill simply waits for the line's move.
				setBoardVersion((v) => v + 1);
			} else if (!out.correct) {
				// The CARD is `recordOutcome`'s, including the first-miss-only rule.
				// This is the scheduler's own flag: the position failed, so it is not
				// retired when the encounter closes below.
				missedThisItem.current = true;
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
			// THE TABLE CLOSES UNLESS IT WAS PINNED. Here rather than at the top of
			// the handler so it stays up through the verdict and the held arrows —
			// it is the thing you would be reading them against.
			if (!out.novelty) moveTable.played();
			setStats((s) => ({
				...s,
				// The run did not advance on a novelty, so it is not a move played.
				moves: s.moves + (out.novelty ? 0 : 1),
				// A move you were shown is not a move you recalled.
				correct: s.correct + (out.correct && !opts.revealed ? 1 : 0),
				/*
				 * A PUNISHMENT THAT DID NOT COME OFF IS NOT A PUNISHMENT.
				 *
				 * Will, issue #1: the drill ends on its ply cap whatever the
				 * evaluation, and `finished: 'punished'` was set on both paths — so
				 * a run that ran out of moves while LOSING was counted in the tally
				 * of punishments taken. The session line then reported a success
				 * rate built partly from failures.
				 *
				 * Measured on the evaluation rather than on the label, because the
				 * label is the thing that was wrong.
				 */
				punished:
					s.punished +
					(out.state.finished === 'punished' && (out.state.evalNow ?? 0) > 0 ? 1 : 0),
				missed:
					s.missed + (!out.correct && before.mode === 'drill' && before.phase === 'punish' ? 1 : 0),
			}));
			if (out.correct) {
				setHint([]);
				// `setCandidates(null)` used to be here. It is the effect's job now —
				// this was the second owner of that state, and it is the one that
				// produced the bug: it cleared the engine's picks while the `engine`
				// tag stayed on, so the button read ON with nothing behind it.
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

	/*
	 * ---------------------------------------------------------------------------
	 * THERE WAS A SIGN-IN WALL HERE, AND IT WAS THE WHOLE APP'S FRONT DOOR.
	 *
	 * Will: "when user navigates to site they can't access anything without
	 * logging in to lichess. But most of our functionality does not require
	 * lichess so I think that gating is really unnecessary."
	 *
	 * The gating was one `return` in this file, and it was the only one that
	 * mattered, because Train is the landing tab. Everything else — Play,
	 * Mistakes, Review, Progress, the engine, cloud evaluation, and game import
	 * from BOTH sites — already worked signed out. The app looked locked and was
	 * not.
	 *
	 * Taking the wall down alone would have produced a trainer that says "the
	 * explorer has no games from this position" on move one, so the book comes
	 * from `domain/localBook` instead when there is no token. What signing in
	 * adds is real, and it is now offered as a reason rather than imposed as a
	 * condition — see the banner below, which says what you gain, not what you
	 * are being refused.
	 * ---------------------------------------------------------------------------
	 */

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
	const shownFen = lineOverlay.board?.fen ?? explaining?.fen ?? shown?.fen ?? preview?.fen ?? state?.fen ?? '';
	// THE POSITION THE BOARD IS SHOWING, not the one the run is on.
	//
	// This took `state.fen` at first, which is the live position — so while the
	// reader was stepping back through the line, or previewing, the overlay was
	// computed for a position that was not on screen. An overlay describing a
	// different board than the one under it is worse than no overlay.
	//
	// `explaining` is deliberately excluded: while a line is being walked the
	// explainer owns the arrows anyway, and recomputing the wheels for each ply of
	// somebody else's line is work nobody asked for.
	// `!busy` IS THE SETTLED FLAG. It is true from the drop until the reply has
	// landed, which is exactly the window in which `preview` is showing a position
	// that is about to be replaced — and exactly the window chessground needs for
	// its animation. See `useTrainingWheels`: the mate search costs 250–660ms of
	// blocked main thread, and it was running inside that window, twice.
	const wheels = useTrainingWheels(
		shown?.fen ?? preview?.fen ?? state?.fen ?? null,
		focus,
		!busy,
	);
	// COMMENTARY FOLLOWS THE BOARD, including into a borrowed line: the panel
	// and the position under it must never be about different things. The move
	// is passed too, because a page is written about the moves LEAVING a
	// position, so that is the one its prose might name.
	const commentary = useCommentary(shownFen || null, asking?.fen === shownFen ? asking.uci : null);

	/*
	 * EVERYTHING KNOWN ABOUT THE MOVES HERE — fetched by the shared hook, so
	 * Mistakes gets the same table from the same code.
	 *
	 * Two effects and a merge used to live inline here, and a near-copy of them
	 * lived in Quiz. The difference between the copies was not cosmetic: this
	 * one gated each fetch on its own chip, which is what made a book move show
	 * a blank evaluation. See `useMoveTable`.
	 */
	const table = useMoveTable(
		tableShown && !previewing ? (state?.fen ?? null) : null,
		state?.ourColour,
		tableShown,
		{ minFreq: practice.minFreq },
	);
	const moveRows = table.rows;

	/**
	 * THE BOARD DRAWS WHAT THE TABLE IS SHOWING.
	 *
	 * -------------------------------------------------------------------------
	 * Will, on the thirty-six green arrows "show me the move" produced: "that
	 * wouldn't be a problem if user also toggled intersection with show picked or
	 * best."
	 *
	 * Exactly. The arrows are DERIVED from the admitted rows rather than stored,
	 * so the filter chips became the arrow control without gaining a button.
	 *
	 * -------------------------------------------------------------------------
	 * AND THE COLOUR NO LONGER DEPENDS ON A CHIP.
	 *
	 * Will: "when 'show moves' engine option is untoggled arrows are drawn
	 * without their colour mapping — they should have eval scores just like
	 * engine top list moves."
	 *
	 * They were plain green because the grade came from `candidates`, and
	 * `candidates` was only fetched while the engine chip was down. So turning
	 * off a FILTER silently withdrew a FACT, and the board went from a ranked
	 * ramp to nine identical arrows. The search runs whenever the table is up
	 * now, so the ramp survives every combination of chips — which is what it
	 * always claimed to mean.
	 */
	const tableArrows = useMemo<Arrow[]>(() => {
		// HIDDEN TABLE, NO ARROWS. The chips are what say which source an arrow
		// came from; drawn without them the board is coloured for no stated reason.
		if (!tableShown) return [];
		return filterMoves(moveRows, effectiveSources(moveRows, tableOn)).flatMap((row) =>
			arrowForRow(row, table.grades, table.book),
		);
	}, [tableShown, moveRows, tableOn, table.grades, table.book]);

	const shownLastMove: [string, string] | undefined = lineOverlay.board
		? lineOverlay.board.lastMove
		: explaining
		? explaining.lastMove
		: previewing
			? shown?.uci
				? [shown.uci.slice(0, 2), shown.uci.slice(2, 4)]
				: undefined
			: (preview?.lastMove ?? lastMove(state));

	const yourTurn =
		!!state && !state.finished && (state.expected.length > 0 || state.mode === 'free');

	/*
	 * AND THE HELP IS STILL CHARGED FOR, once per position.
	 *
	 * The press used to do this, which was right when a press meant one answer.
	 * Now the tag can stand for a whole run, so leaving it on is being shown the
	 * engine's answer on every move — and a run where every answer was given
	 * cannot count towards recall or towards the rating. Keyed on the position so
	 * it is charged once, not once per re-render.
	 */
	/*
	 * ONE RULE: IF IT IS ON SCREEN WHILE YOU ARE BEING ASKED, IT IS HELP.
	 *
	 * Will: "any of the show options (played, book, engine) should mark the
	 * user's move as assisted, so should any training wheel displayed."
	 *
	 * He is right, and what was here was worse than inconsistent — it was three
	 * different rules that between them let most assistance through:
	 *
	 *   book     charged ONCE, on the press. Leave the tag on and every later
	 *            answer was free.
	 *   engine   charged per position (correct, and the only one that was).
	 *   played   never charged at all.
	 *   wheels   never charged at all — and the mate wheel draws the forced mate,
	 *            which is more of an answer than any table row.
	 *
	 * So: anything DISPLAYED about this position while a move is being asked of
	 * you is assistance, whatever produced it. Charged once per position, because
	 * these are standing settings and the question is asked once per position.
	 *
	 * The wheels' master switch does the right thing for free: `active` is false
	 * when they are selected but hidden, and hidden overlays tell you nothing.
	 *
	 * A CONSEQUENCE WORTH STATING: train with the wheels permanently on and no
	 * move is ever counted — not towards recall, not towards the rating. That is
	 * the honest reading of a run where you were shown the answer every time, and
	 * it is why the estimate says what it is measured on.
	 */
	const assisting =
		yourTurn &&
		((tableShown && tableOn.size > 0) || (wheels.active && wheels.on.size > 0));

	const liveFen = state?.fen ?? null;
	const chargedFor = useRef<string | null>(null);
	useEffect(() => {
		if (!assisting || !liveFen) return;
		if (chargedFor.current === liveFen) return;
		chargedFor.current = liveFen;
		missedThisItem.current = true;
		assistedThisItem.current = true;
		setStats((s) => ({ ...s, shown: s.shown + 1 }));
	}, [assisting, liveFen]);

	/**
	 * Is there a POSITION to ask the engine about — as opposed to a MOVE being
	 * asked of you?
	 *
	 * `yourTurn` answers the second question and was being used for both. A
	 * finished line still has a position, and Stockfish has just as much to say
	 * about it; the drill is what ended, not the board. Anything that inspects
	 * rather than answers hangs off this instead.
	 */
	const canInspect = !!state && !previewing;

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
			setLossByPly({});
			// 'drill': this is the trainer resuming, not another tab handing a
			// position over to be played out.
			const s2 = await playFrom(moves, ply, state.ourColour, cfg, 'drill');
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
		// Prefer a name over "After 7 moves". WHICH name is `nameOf`'s business —
		// this had its own copy of the explorer-then-table rule, which is one
		// copy more than there should be of a rule the caption above the board
		// now applies on every screen.
		const named = nameOf({ path, opening: state.opening?.name ?? null });
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
		// THE STEP BUTTONS DRIVE WHATEVER SEQUENCE IS SHOWING. While a line is
		// borrowed they walk it; otherwise they take back and replay the run. One
		// set of controls, because there is one move list.
		if (lineOverlay.overlay)
			return [
				{
					id: 'first',
					title: 'Back to the start of the line',
					icon: 'first',
					onClick: () => lineOverlay.setAt(-1),
					disabled: lineOverlay.overlay.at === -1,
				},
				{
					id: 'back',
					title: 'Previous move in the line',
					icon: 'back',
					onClick: () => lineOverlay.step(-1),
					disabled: lineOverlay.overlay.at === -1,
				},
				{
					id: 'forward',
					title: 'Next move in the line',
					icon: 'forward',
					onClick: () => lineOverlay.step(1),
					disabled: lineOverlay.overlay.at >= lineOverlay.overlay.line.steps.length - 1,
				},
				{
					id: 'resign',
					title: 'Stop showing this line',
					icon: 'resign',
					onClick: closeLine,
				},
			];

		return [
			{ id: 'first', title: 'Play again from move 1', icon: 'first', onClick: newRun, disabled: busy },
			{ id: 'back', title: 'Take back your last move', icon: 'back', onClick: takeBack, disabled: busy || !history.length },
			{ id: 'forward', title: 'Replay the move you took back', icon: 'forward', onClick: redo, disabled: busy || !future.length },
			{
				id: 'branch',
				title: 'Same position — make them try a different reply',
				icon: 'branch',
				onClick: () => state?.retryPoint && replayFrom(state.retryPoint),
				disabled: busy || !state?.retryPoint,
			},
			/*
			 * THERE IS NO "REPLAY THE SAME MISTAKE" BUTTON.
			 *
			 * Will: "maybe we don't need a 'replay same mistake' button since user
			 * can just step backwards?"
			 *
			 * They can. `deviationPoint` is a snapshot of the position immediately
			 * AFTER their blunder — which is precisely where `back` lands you, and
			 * `forward` brings you out again. So it was a third way to reach a
			 * position that two permanently-available controls already reach, taking
			 * up a cell in a strip whose icons were already hard to tell apart.
			 *
			 * The distinction worth keeping is the one `branch` makes: stepping back
			 * gives you the SAME reply again, while that re-rolls it. Same position,
			 * genuinely different outcome — which is a thing stepping cannot do.
			 */
			{
				/*
				 * ONE BUTTON WHERE THERE WERE THREE.
				 *
				 * Will: "labels are not intuitive and icons too similar… possibly
				 * these three options are moved to the move table (they are all
				 * filters of the same table) and there is only one button to show
				 * the table."
				 *
				 * They were three buttons for three filters over one table, which is
				 * why their icons had to be abstract enough to be confusable. The
				 * filters live in the table now, labelled in words — book, engine,
				 * played — and this says only whether the table is up.
				 */
				id: 'options',
				/*
				 * THE EYE, AND "SHOW MOVES", as it was before.
				 *
				 * Will: "the toggle moves button should have the eye icon and be
				 * called 'show moves' like before. It shows the arrows on the board
				 * and toggles the table, but the arrows are obviously the most
				 * important thing."
				 *
				 * Right — the table is where the filters live, but what the button
				 * DOES, from the board's point of view, is draw the moves on it. The
				 * icon should name the effect you are looking at, not the panel that
				 * happens to carry the controls.
				 */
				// The title says what a second press does, because a double press is
				// a gesture nobody finds without being told. See `domain/tableToggle`.
				title: moveTable.title,
				icon: 'reveal',
				accent: tableShown,
				onClick: moveTable.press,
				disabled: !canInspect || busy,
			},
			{
				id: 'share',
				title: 'Copy or share this position',
				icon: 'share',
				onClick: () => setSharing((v) => !v),
				accent: sharing,
				disabled: !state?.path.length,
			},
			/*
			 * ONLY IN FREE PLAY, AND HIDDEN RATHER THAN DISABLED.
			 *
			 * Will: "maybe we only need to display a 'resign' button in free play
			 * mode."
			 *
			 * Right, and the reason is what the word means. Resigning is conceding
			 * a GAME — an act with an opponent on the other end of it. A drill has
			 * no opponent to concede to and no result to concede: leaving one is
			 * `restart`, the first cell in this same strip. So in the book phase
			 * the button was offering to lose something that was not being played
			 * for.
			 *
			 * In free play there IS a game: you are playing the position out
			 * against the engine, the result is scored and it feeds the rating.
			 * There, resigning is the ordinary thing it sounds like.
			 *
			 * Hidden rather than greyed, because a disabled cell still spends a
			 * slot in a strip that has to cross a 360px screen, and still has to be
			 * read and dismissed before it can be ignored.
			 */
			...(state?.mode === 'free'
				? [
						{
							id: 'resign',
							title: 'Resign — end this game',
							icon: 'resign',
							onClick: () => {
								if (!state || state.finished) return;
								const ended = resign(state);
								setState(ended);
								persistRun(ended, lossByPly);
							},
							disabled: busy || !!state.finished,
						} satisfies ToolbarAction,
					]
				: []),
			{
				/*
				 * FREE PLAY IS NOT A REWARD FOR FINISHING.
				 *
				 * Will: "I think 'play on' should be always available (sometimes it
				 * is disabled). There is no reason I can see why user shouldn't be
				 * able to go into free play mode against the engine from any
				 * position."
				 *
				 * There is no reason, and there never was one in the engine. The
				 * `!state.finished` guard was a statement about when the button was
				 * OFFERED, and it smuggled in a claim — that leaving the drill is
				 * something you earn by completing it — that nobody decided.
				 *
				 * IT IS A HANDOFF NOW, not a phase change in place. Will: "worth
				 * considering if free play is its own tab, so when we press free
				 * play what is really happening is we're switching tabs and loading
				 * that position?" That is what happens: the same door Review and
				 * Mistakes use, because all three were asking for the same thing —
				 * this position, on a board, with the drill switched off.
				 *
				 * The two names are the same act described from where you are
				 * standing. At the end of a line, continuing IS playing on. In the
				 * middle of one it is abandoning the drill, and saying "play on"
				 * there would hide that.
				 */
				id: 'playon',
				title: state?.finished
					? 'Play on against the engine, in the Play tab'
					: 'Leave the drill and play this position out, in the Play tab',
				caption: state?.finished ? 'play on' : 'free play',
				icon: 'playon',
				onClick: () =>
					state &&
					onPlayFrom?.({
						moves: [...state.path],
						ply: state.path.length,
						ourColour: state.ourColour,
					}),
				disabled: busy || !state || !onPlayFrom,
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
			{/*
			  * THE LINE'S NAME IS NOT WRITTEN HERE ANY MORE.
			  *
			  * It was a paragraph in this file with three cases in it, and the
			  * other three boards in the app had no equivalent — Will: "perhaps
			  * that message should be part of the standard machinery everything
			  * consumes, so a board is always displayed with the line it belongs
			  * to if such a line exists." It is `BoardPanel`'s `caption` prop now;
			  * see `components/PositionCaption`.
			  *
			  * Two of the three cases moved into `also` below, because they are
			  * Train's and nothing else's. The third — the opening name — was the
			  * shared half, and it is the part every other board was missing.
			  */}

			{/*
			  * THERE IS NO "PICKED UP WHERE YOU LEFT OFF" BANNER.
			  *
			  * Will: "I don't know why we need the 'Picked up where you left off'
			  * banner and 'start fresh instead' button. These confer nothing
			  * 'restart' button doesn't already do. Sessions are not being persisted
			  * anyway currently, so it's only the board position."
			  *
			  * Both halves hold. The button duplicated `restart`, which is the first
			  * control in the strip and permanently available; and the notice was
			  * announcing a continuity the app does not actually provide — what
			  * survives a reload is the position, not the session, so "where you
			  * left off" was a slightly larger claim than the truth. A banner whose
			  * button already exists and whose sentence is not quite right is two
			  * reasons to delete it.
			  *
			  * `resumed` is still tracked: it is read by the debug snapshot, and
			  * whether a run was restored is a real fact about the session even with
			  * nothing on screen saying so.
			  */}

			{/*
			  * WHAT SIGNING IN ADDS, offered rather than demanded.
			  *
			  * This replaces a full-page wall. The difference is not politeness: a
			  * wall says "you may not", which was false, and this says "here is what
			  * you are missing", which is true and specific. Dismissible, and it
			  * stays dismissed — a notice you cannot silence becomes furniture, and
			  * furniture is not read.
			  */}
			{!signedIn && !hushed && (
				<Note style={{ marginBottom: space.card }}>
					<strong>Training from the bundled opening book.</strong> 1821 named lines, no
					account needed. Signing in to Lichess swaps it for the live explorer: real
					frequencies from players at your rating band, and an opponent whose mistakes are
					the ones people actually make.{' '}
					{onNeedsToken && (
						<button onClick={onNeedsToken} style={{ fontSize: 13 }}>
							Sign in
						</button>
					)}{' '}
					<button onClick={() => hush()} style={{ fontSize: 13 }}>
						Not now
					</button>
				</Note>
			)}

			<BoardPanel
				fen={shownFen}
				ourColour={state?.ourColour ?? 'w'}
				evalCp={previewing ? null : (state?.evalNow ?? null)}
				interactive={yourTurn && !busy && !previewing && !explaining}
				lastMove={shownLastMove}
				caption={{
					/*
					 * THE PATH TO WHAT IS ON THE BOARD, not to where the run is.
					 *
					 * Stepping back is the common case here and the caption has to
					 * follow it: a board showing move 3 of the Italian under a line
					 * reading "move 11" is worse than no line at all. Same slice
					 * `pinHere` takes, for the same reason.
					 */
					path: previewing ? (state?.path ?? []).slice(0, previewPly!) : (state?.path ?? []),
					// Only while the board is at the run's own position: the explorer
					// named THAT one, and it is not the name of a position five plies
					// earlier.
					opening: previewing ? null : (state?.opening?.name ?? null),
					also: [
						// Train's two, which no other screen has: the drill has gone off
						// book and is now asking for the strongest move, and — failing
						// that — how much book there is to pick from here.
						/*
						 * SAYS THAT THE RUNG DOES NOT APPLY HERE.
						 *
						 * Will, issue #2 ("punishment outside strictness setting"):
						 * "this punishment asks for a move that is outside the current
						 * strictness setting … there is no clear way to discover that."
						 *
						 * There was not, and the rule is real: `withExpected` sets the
						 * punish phase's expected move from the ENGINE's best line and
						 * never consults `practice.strictness`. That is right — you are
						 * off book, so there is no book to be strict about — but the
						 * setting is visible on the same screen and says otherwise by
						 * implication. A rule that only exists in the code is a rule the
						 * reader is entitled to think is a bug.
						 */
						state && !state.finished && state.mode === 'drill' && state.phase === 'punish'
							? 'off book — find the strongest move (strictness does not apply here)'
							: null,
						state && !state.finished && state.phase !== 'punish' && !state.opening && state.bookHere?.length
							? `${state.bookHere.filter((m) => m.verdict === 'main' || m.verdict === 'book').length} book replies here`
							: null,
					],
				}}
				onSelectSquare={(sqName) =>
					setFocus((f) => {
						const n = parseSquare(sqName);
						return n === undefined || f === n ? null : n;
					})
				}
				arrows={
					lineOverlay.board
						? lineOverlay.board.arrows
						: explaining
						? explaining.arrows
						: // A wheel is a deliberate choice the reader has just made, so it
						  // outranks the automatic arrows — but not an explanation, which is
						  // showing a different position entirely.
						  wheels.arrows.length
						? wheels.arrows
						: previewing
							? []
							: // `hint` is now ONLY the momentary teaching arrow after an
								// accepted-but-not-best move. It outranks the filter because it
								// is shown for a beat and then gone.
								hint.length
								? hint
								: tableArrows.length
									? tableArrows
									: feedback && !feedback.correct
										? feedback.arrows
										: []
				}
				onMove={onMove}
				version={boardVersion}
				/*
				 * THE OVERLAY'S WALK WINS WHILE IT OWNS THE BOARD.
				 *
				 * Same precedence as `shownFen` a few lines up, and for the same
				 * reason: whoever is deciding which position is shown is also the
				 * only one who can say how it was reached. Leaving the line is the
				 * exception and it is `closeLine`'s — by then the overlay is gone,
				 * so this falls through to the run's own.
				 */
				via={lineOverlay.via ?? via}
				actions={toolbarActions()}
			>
				<PositionStack
					popover={
						<>
								{/*
								  * DIRECTLY UNDER THE BUTTON THAT OPENS IT.
								  *
								  * Will: "the share options should appear right below the share
								  * button. Clicking it again should hide the options. Unfocusing
								  * (interacting with something else) should also close the share
								  * options — that way we don't need a close button."
								  *
								  * It was rendered last, below the move history, so pressing a
								  * control at the top of the strip made a panel appear a screen
								  * further down — which on a phone is not visible at all. A menu
								  * belongs against the thing that opened it; that is what makes it
								  * a menu rather than a section.
								  *
								  * The toolbar renders before `children` now, so first child IS
								  * directly under the strip.
								  */}
								{sharing && state && (
									<ShareMenu
										items={shareItemsFor(state)}
										onClose={() => setSharing(false)}
									/>
								)}
						</>
					}
					verdict={
						<>
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
								{/* Thinking, in the slot the verdict will land in — so the
									block does not appear from nowhere, and nothing stale is
									left standing in for it. */}
								{!feedback && busy && (
									<div
										style={{
											marginTop: 8,
											fontSize: 14,
											color: color.ink2,
											borderLeft: `3px solid ${color.line}`,
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
										<Thinking show />
									</div>
								)}
								{feedback && (
									<div
										style={{
											marginTop: 8,
											fontSize: 14,
											color: verdictColor(feedback.tone),
											borderLeft: `3px solid ${verdictColor(feedback.tone)}`,
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
										{/*
										  * THE RUN IS HELD HERE, waiting to be told to carry on.
										  *
										  * Will: "prompt user before continuing so user has a chance
										  * to actually read and consider." The two arrows are on the
										  * board while this is up — yours in blue, the better move in
										  * green — and the board is still the position they refer to.
										  *
										  * Deliberately NOT disabled by `busy`: `busy` is true for
										  * exactly as long as this is waiting, so a control that
										  * respected it could never be pressed.
										  */}
										{holding && (
											<div
												style={{
													marginTop: space.tight,
													display: 'flex',
													gap: space.snug,
													flexWrap: 'wrap',
												}}
											>
												{/*
												  * THE SAME DOOR A REFUTED MISTAKE GETS.
												  *
												  * Will: "when user is alerted to better move they
												  * should be offered to see the sequence on the board
												  * the same way we do for when a move is an error."
												  *
												  * Right, and for the same reason: "Bc4 was better" is
												  * an assertion, and the line after it is the argument.
												  * A reader who cannot see WHY cannot learn anything
												  * from being told.
												  *
												  * The run stays held while the line is walked — the
												  * explainer borrows the board and the move list, and
												  * pressing on below hands them back.
												  */}
												{feedback?.better && feedback.better.line.length > 1 && (
													<Button
														onClick={() =>
															setExplain({
																line: lineFromUci(feedback.fen, feedback.better!.line),
																label: `Why ${withGlyph(feedback.better!.san, state?.ourColour ?? 'w')} was better`,
															})
														}
													>
														Show it on the board
													</Button>
												)}
												<Button onClick={() => holding()}>Got it — play on</Button>
											</div>
										)}
									{/* A sequence in prose asks the reader to replay it in their head
										before they can check the claim — which is the work they are
										here to learn. §1.1: never make the learner derive what can be
										shown. */}
									{!feedback.correct && feedback.refutation.length > 0 && (
										<div style={{ marginTop: space.tight }}>
											<Button
												onClick={() =>
													setExplain({
														line: lineFromUci(feedback.fen, [
															feedback.playedUci,
															...feedback.refutation,
														]),
														label: 'Why that move does not work',
													})
												}
											>
												Show it on the board
											</Button>
										</div>
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
												state.lastOpponent.kind === 'mistake' ? color.bad : color.line
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
											<span style={{ color: color.bad }}>
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
									<div style={{ marginTop: space.snug, fontWeight: 600, color: color.good }}>
										{state.finished === 'line-complete' ? 'Line complete.' : state.note}
									</div>
								)}
						</>
					}
					moves={
						<>
								{/*
								  * ONE TABLE, THREE FILTERS. Will: "we should unify these three
								  * buttons: one table, the buttons just toggle which moves are
								  * included ... so we use the same component for all three."
								  *
								  * The move is the row; being in the line, being popular and being one
								  * of the engine's picks are TAGS on it. A move in two lists used to
								  * appear twice, in two shapes, with different columns filled in.
								  */}
								{/*
								  * ONLY ONCE A BUTTON HAS ASKED. `state.expected` is always populated —
								  * out of book it is every legal move — so gating on "are there rows"
								  * put thirty unevaluated rows on screen unbidden the moment the table
								  * shipped. The three buttons are what request a source; before any of
								  * them is pressed there is no question on the table.
								  */}
								{/*
								  * NOT WHILE LOOKING BACK. The table describes the live position, and
								  * the board already hides its arrows while previewing — so showing
								  * the rows would put a list of moves beside a board they are not
								  * legal on. `previewAt` used to achieve this by clearing
								  * `candidates`, which made it a second owner of state the effect now
								  * holds; this says the same thing where it belongs.
								  */}
								{/* NOT GATED ON HAVING ROWS. Turn every source off and there are no
									rows — and the table carrying the chips would unmount, taking the
									only way back with it. Same fault as the vanishing chip, one level
									up. An empty table says it is empty; it does not disappear. */}
								{tableShown && state && !previewing && (
									<>
										<h3 data-region="train-moves-head">Moves here</h3>
										<MoveTable
											rows={moveRows}
											mover={colourOfFen(state.fen)}
											on={tableOn}
											// All three, always — a chip is how you switch a source back on,
											// so it cannot be allowed to vanish with the source's rows.
											offers={['line', 'engine', 'popular']}
											onToggle={(src) =>
												setTableOn((cur) => {
													const next = new Set(cur);
													if (next.has(src)) next.delete(src);
													else next.add(src);
													return next;
												})
											}
											onAsk={(uci) =>
												state?.fen &&
												setAsking({ fen: state.fen, uci, alternatives: moveRows.map((r) => r.uci) })
											}
											askedPopularity={table.askedPopularity}
											marksBook
											region="train-moves"
										/>
									</>
								)}
						</>
					}
					lines={
						<>
								{/* ---------------------------------------------------------------
									ANALYSIS, THEN HISTORY. See `BoardPanel` for the order and why
									it is the same on every tab. The move list used to come FIRST
									here and last in Mistakes, so the two tabs disagreed about what
									the page was about.
								--------------------------------------------------------------- */}
								{explain && (
									<LinePlayer
										line={explain.line}
										label={explain.label}
										onBoard={setExplaining}
										onClose={() => setExplain(null)}
									/>
								)}
						</>
					}
					wheels={
						<>
								{state && (
									<TrainingWheels
										on={wheels.on}
										onChange={wheels.setOn}
										active={wheels.active}
										onActiveChange={wheels.setActive}
										notes={wheels.notes}
										hasFocus={focus !== null}
										working={wheels.working}
									/>
								)}
						</>
					}
					commentary={
						<>
								{/* Only appears when the register says there is a page. */}
								<Commentary state={commentary} region="train-commentary" />
						</>
					}
					explain={
						<>
								{asking && (
									<ExplainPanel
										{...asking}
										onShowLine={lineOverlay.show}
										onClose={() => {
											setAsking(null);
											closeLine();
										}}
									/>
								)}
						</>
					}
					history={
						<>
								{/* THE HISTORY, after everything that is about the position in
									front of you. Will: "I think the past move list (history) is not
									really important — it should be after analytical content (but
									before options and preferences)." */}
								{/*
								  * ONE MOVE LIST. While a line is borrowed it shows that instead of
								  * the game — same component, same chips, same cursor — with a banner
								  * saying whose line it is and how to give it back.
								  */}
								<MoveListHeader borrowed={lineOverlay.overlay?.label} onClose={closeLine} />
								<MoveList
									region="train-move-list"
									onAsk={lineOverlay.overlay?.onAsk}
									chips={lineOverlay.chips ?? chips()}
									currentPly={
										lineOverlay.overlay
											? lineOverlay.overlay.at
											: previewing
												? previewPly!
												: (state?.path.length ?? 0)
									}
									onJump={
										lineOverlay.overlay ? lineOverlay.setAt : busy ? undefined : previewAt
									}
									onPlayFrom={
										lineOverlay.overlay ? undefined : busy ? undefined : (ply) => void playFromPly(ply)
									}
								/>
								{!lineOverlay.overlay && <MoveListLegend />}
						</>
					}
					footer={
						<>
								{previewing && (
									<div
										style={{
											fontSize: 13,
											background: color.warnSoft,
											border: `1px solid ${color.warn}`,
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
										<Button kind="quiet" onClick={() => setPreviewPly(null)}>
											Back to the game
										</Button>
										<Button
											onClick={() => previewPly !== null && void playFromPly(previewPly)}
											disabled={busy}
										>
											Play from here
										</Button>
									</div>
								)}

								{error && <div style={{ color: color.bad, fontSize: text.body }}>{error}</div>}
						</>
					}
				/>
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
						? 'No estimate yet — import your games on Settings, or play on from a won position.'
						: rating.confident
							? `Estimated ${rating.elo} from ${rating.sample} scored moves (${rating.acpl}cp average loss).`
							: `Provisional ${rating.elo} from only ${rating.sample} moves — not yet trusted.`}{' '}
					Opening moves are excluded, in your games and in the repertoire alike: recalling a
					memorised move measures memory, not strength. Progress breaks it down.
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
					<Button
						kind="quiet"
						onClick={() => setPractice(resetPractice())}
						title="Back to White, any book move over 3%, no pinned opening, 35% mistakes"
					>
						Reset
					</Button>
				</div>
				<p style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
					{describePractice(practice)}
				</p>

				<label style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
					Colour{' '}
					<Select
						label="Which colour you are practising"
						value={practice.colour}
						onChange={(v) => updatePractice({ colour: v })}
						options={[
							{ id: 'w' as const, label: 'White' },
							{ id: 'b' as const, label: 'Black' },
						]}
					/>
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

				{/* This used to be hidden on the strictest setting, back when strictness
					was decided by FREQUENCY and the narrowest rung pinned this slider to
					"the single most popular move". It no longer touches your own moves at
					any rung, so hiding it only made the opponent's behaviour unexplainable
					on exactly the setting where you notice it most. */}
				<label style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
					{/*
					  * "OF GAMES" IS ONLY TRUE SIGNED IN.
					  *
					  * The bar is a share, and what it is a share OF depends on which
					  * book is answering: games at your band from the explorer, named
					  * variations from the bundled table. Printing "of games" over the
					  * offline book is the same small lie as quoting a played-percentage
					  * off it — see `domain/localBook`. The control does the same job
					  * either way; only the unit changes, so only the unit is swapped.
					  */}
					Opponent plays replies above{' '}
					<strong>{(practice.minFreq * 100).toFixed(0)}%</strong>{' '}
					{signedIn ? 'of games' : 'of the named lines here'}
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

				<h3>Training repertoire</h3>
				{practice.roots.length === 0 ? (
					<p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 8px' }}>
						No repertoires saved. Search below to add one — you can keep several and
						switch each on or off; the ones switched on are trained together.
					</p>
				) : (
					<>
						<ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
							{practice.roots.map((r, i) => (
								<li
									key={`${r.name}-${i}`}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: space.snug,
										padding: '6px 0',
										borderBottom: `1px solid ${color.line}`,
										// A saved-but-inactive repertoire is still yours; it just
										// is not today's. Dimmed, not hidden.
										opacity: r.active === false ? 0.55 : 1,
									}}
								>
									{/*
									  * SAVED AND ACTIVE ARE TWO DIFFERENT THINGS.
									  *
									  * Will: "we should be able to save training repertoires…
									  * with toggle buttons to make them active / inactive", and
									  * "multiple toggled means union".
									  *
									  * The list used to BE the active set, so the only way to
									  * stop training a line was to delete it, and the only way
									  * back was to find it in the search field again. The list is
									  * the library now and the switch is this session.
									  */}
									{/*
									  * A SWITCH, NOT A BUTTON WHOSE CAPTION IS ITS STATE.
									  *
									  * Will: "the training repertoire should have normal toggle
									  * buttons instead of the labelled buttons."
									  *
									  * It said "training" when on and "off" when off, which is
									  * the pattern nobody can read at a glance: a button saying
									  * "off" might be REPORTING that it is off or OFFERING to
									  * turn it off, and there is nothing in the pixels to say
									  * which. A switch has a position instead of a word.
									  */}
									<Toggle
										on={r.active !== false}
										onChange={(on) =>
											updatePractice({
												roots: practice.roots.map((x, j) =>
													j === i ? { ...x, active: on } : x,
												),
											})
										}
										label={
											r.active !== false
												? `Training ${r.name} — switch it off without losing it`
												: `${r.name} is saved but not being trained — switch it back on`
										}
									/>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ fontSize: text.body, fontWeight: 600 }}>{r.name}</div>
										<div style={{ opacity: 0.6, fontSize: 11 }}>
											<MoveLine sans={r.path} size={11} />
										</div>
									</div>
									<Button
										kind="quiet"
										onClick={() =>
											updatePractice({
												roots: practice.roots.filter((_, j) => j !== i),
											})
										}
										title={`Forget ${r.name}`}
									>
										×
									</Button>
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

						<Button
							kind="quiet"
							onClick={() => updatePractice({ roots: [] })}
						>
							Clear the filter
						</Button>
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
					<Button
						onClick={pinHere}
						disabled={!state?.path.length}
						title="Add the position on the board to the filter"
					>
						…or add the position on the board
					</Button>
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

/**
 * `brush` was `'red' | 'blue' | 'green'` — the three named ones — which was
 * true of every caller until the board started drawing the engine's graded
 * ramp (`q0`…`q4`) through here as well. Widened rather than duplicated.
 */
function arrowFor(
	uci: string,
	brush: string,
): { orig: string; dest: string; brush: string } {
	return { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush };
}

/**
 * One table row, as shapes on the board.
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES, NOT A LONGER LABEL.
 *
 * Will: "with the ◆ denoting book moves the text becomes too small to read in
 * the arrow labels. We need another way to denote book moves."
 *
 * Chessground sizes label text as `0.4 * 0.75 ** text.length`, so appending to
 * a label shrinks the WHOLE label exponentially: "+0.3" renders at 0.127 and
 * "+0.3 ◆" at 0.071. The marker did not take a corner of the badge, it took
 * half the evaluation's legibility — which is the one thing on the arrow that
 * has to be readable.
 *
 * So the move keeps its arrow, carrying quality in colour and width and its
 * score in a four-character label, and a book move gets a SECOND shape: a ring
 * round the square it lands on. Separate object, separate channel, and the
 * arrow is untouched.
 *
 * Exported so the two tabs draw the same thing. They had two copies of this,
 * and the copies had already diverged on whether an unranked move gets a label.
 */
export function arrowForRow(
	row: MoveRow,
	grades: Map<string, Candidate>,
	book: ReadonlySet<string>,
): Shape[] {
	const dest = row.uci.slice(2, 4);
	const c = grades.get(row.uci);
	const out: Shape[] = [
		c
			? {
					...arrowFor(row.uci, brushForGrade(c.grade)),
					// ONE DECIMAL, and it is load-bearing: at two the label is already
					// down to 0.095 and at three it would be unreadable. A tenth of a
					// pawn is also as fine a distinction as this search can support.
					label: `${c.cp > 0 ? '+' : ''}${(c.cp / 100).toFixed(1)}`,
				}
			: // A row the engine never scored is drawn green: shown, but making no
				// claim about how good it is. Rare now that the table asks for two
				// dozen lines, and it means what it says when it happens.
				arrowFor(row.uci, 'green'),
	];
	// A shape with no `dest` is a circle on its `orig` — see `Board`'s mapping.
	if (book.has(row.uci)) out.push({ orig: dest, brush: 'book' });
	return out;
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

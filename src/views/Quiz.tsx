// Quiz: the positions you got wrong, until you do not.
//
// Deliberately stricter than a run. There is no "works too" here — the card
// exists because a specific move was missed, and the point is to produce that
// move. Getting it wrong puts the card straight back in the queue rather than
// moving on, which is what "repeat until correct" means.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardPanel } from '../components/BoardPanel';
import { PositionStack } from '../components/PositionStack';
import type { ToolbarAction } from '../components/Toolbar';
import { analysePosition, toColourPov } from '../data/cloudEval';
import { loadMistakes, saveCard, clearMistakes, deleteCard } from '../data/mistakes';
import {
	due,
	summarise,
	inCategories,
	countByCategory,
	applyAnswer,
	CATEGORIES,
	RETIRE_STREAK,
	type MistakeCard,
} from '../domain/mistakes';
import { applyUci, sameMove, replayLine, parseSquare } from '../domain/chess';
import { Chip, Empty, Button, Panel, Select } from '../ui/primitives';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import { TrainingWheels } from '../components/TrainingWheels';
import { useTrainingWheels } from '../hooks/useTrainingWheels';
import { useLineOverlay } from '../hooks/useLineOverlay';
import { useMoveTableToggle } from '../hooks/useMoveTableToggle';
import { acceptedAt } from '../engine/session';
import { STRICTNESS, type Strictness } from '../domain/book';
import { loadPractice } from '../domain/practice';
import { useCommentary } from '../hooks/useCommentary';
import { Commentary } from '../components/CommentaryPanel';
import { MoveList, MoveListHeader, MoveListLegend } from '../components/MoveList';
import { MoveTable } from '../components/MoveTable';
import { useMoveTable } from '../hooks/useMoveTable';
import { arrowForRow } from './Train';
import { filterMoves, effectiveSources, type MoveSource } from '../domain/moveTable';
import { Move } from '../components/Move';
import { withGlyph } from '../domain/notation';
import { nameOf, moveNumber, whereYouAre } from '../domain/caption';
import { registerDebug, describePosition } from '../data/debug';
import { useViewport } from '../components/useViewport';
import { color, space, text } from '../ui/theme';
import { recall, remember } from '../data/viewState';

const INK_2 = color.ink2;

export function Quiz({
	onOpenSettings,
	onPlayFrom,
}: {
	onOpenSettings?: () => void;
	/** Hand a position to the trainer. The same shape Review hands over. */
	onPlayFrom?: (h: { moves: string[]; ply: number; ourColour: 'w' | 'b' }) => void;
}) {
	const [cards, setCards] = useState<MistakeCard[]>([]);
	const [queue, setQueue] = useState<MistakeCard[]>([]);
	const [current, setCurrent] = useState<MistakeCard | null>(null);
	const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
	/** Help of ANY kind was used, so a correct answer no longer counts. */
	const [helped, setHelped] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [done, setDone] = useState(0);
	const [boardVersion, setBoardVersion] = useState(0);
	/** Evaluation of the card's position, from our side. Null until it arrives. */
	const [evalCp, setEvalCp] = useState<number | null>(null);
	/**
	 * Which tags the shared move table is showing.
	 *
	 * Mistakes used to render its own ordered list of candidates — a fourth
	 * rendering of "moves you could play here", with its own columns and its own
	 * colour swatch. Will: "UI should be basically the same for mistakes as for
	 * train". It is the same table now, and the buttons switch tags on it.
	 */
	const [tableOn, setTableOnState] = useState<ReadonlySet<MoveSource>>(
		() =>
			new Set(
				(recall('tableOn', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')) ?? [
					'engine',
					'popular',
				]).filter((k): k is MoveSource => k === 'line' || k === 'engine' || k === 'popular'),
			),
	);
	const setTableOn = useCallback(
		(next: ReadonlySet<MoveSource> | ((cur: ReadonlySet<MoveSource>) => ReadonlySet<MoveSource>)) => {
			setTableOnState((cur) => {
				const value = typeof next === 'function' ? next(cur) : next;
				remember({ tableOn: [...value] });
				return value;
			});
		},
		[],
	);
	/**
	 * …and whether the table is on screen at all.
	 *
	 * -----------------------------------------------------------------------
	 * THE SAME TWO FACTS TRAIN KEEPS, AND THE SAME STORAGE KEYS.
	 *
	 * Will: "in Train tab we swapped show and options and played to one button
	 * design — but that change has not been applied to Mistakes. All buttons and
	 * the buttons bar should be unified."
	 *
	 * Mistakes still had the old arrangement: an `options` button that owned the
	 * engine rows and a `stats` button that owned the explorer rows, each a
	 * one-shot fetch that a second press threw away. So the same two sources
	 * behaved differently depending on which tab you were in — and the tab that
	 * had been fixed was not the one where the abstract icons were hardest to
	 * tell apart.
	 *
	 * They share the stored keys deliberately. "Show me the moves, filtered like
	 * this" is one preference about how you want to be taught, not two, and
	 * having it reset when you crossed a tab boundary was itself a small lie
	 * about the two screens being different things.
	 */
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

	/*
	 * THE DECK'S OWN STRICTNESS.
	 *
	 * Will: "user needs to know the repertoire and strictness for the mistake
	 * card to make sense, or the Mistakes tab needs its own strictness and
	 * repertoire settings and card solutions are not saved with the card but
	 * dynamic."
	 *
	 * Its own, and dynamic. Defaulting to whatever the trainer is set to, because
	 * that is where the cards came from and a deck that judged differently from
	 * the drill on day one would be its own puzzle — but a SEPARATE setting after
	 * that, because reviewing is not drilling. Wanting to be held to the best
	 * book move while practising and to accept anything sound while clearing a
	 * backlog is a coherent pair of wishes, and one knob could not express it.
	 *
	 * Repertoire is deliberately NOT here: a card is a position, and a pinned
	 * root is a filter over which positions a RUN visits. It has nothing to say
	 * about a position already in front of you.
	 */
	const [strictness, setStrictnessState] = useState<Strictness>(
		() =>
			(recall('quizStrictness', (v) => STRICTNESS.some((s) => s.id === v)) as
				| Strictness
				| undefined) ?? loadPractice().strictness,
	);
	const setStrictness = useCallback((next: Strictness) => {
		setStrictnessState(next);
		remember({ quizStrictness: next });
	}, []);

	/**
	 * Every move that counts as right for the card in hand.
	 *
	 * Null while it is being worked out. `onMove` awaits the same promise rather
	 * than reading this, so an answer played before it lands is still judged
	 * against the full set — a race here would mark a correct move wrong, which
	 * is the exact failure being fixed.
	 */
	const [accepted, setAccepted] = useState<{ uci: string; san: string }[] | null>(null);
	const acceptedFor = useRef<{ id: string; strictness: Strictness; moves: Promise<{ uci: string; san: string }[]> } | null>(null);

	const acceptedNow = useCallback(
		(card: MistakeCard): Promise<{ uci: string; san: string }[]> => {
			const hit = acceptedFor.current;
			if (hit && hit.id === card.id && hit.strictness === strictness) return hit.moves;
			const moves = acceptedAt({
				fen: card.fen,
				mover: card.ourColour,
				minFreq: loadPractice().minFreq,
				strictness,
				// See `acceptedAt`: the card's own answer was accepted once, and a
				// later search deciding it is 31cp short must not make the card
				// unanswerable.
				alwaysUci: card.expectedUci,
			});
			acceptedFor.current = { id: card.id, strictness, moves };
			return moves;
		},
		[strictness],
	);

	// Fetched for display as well as for judging — the card says how many moves
	// would be accepted, which is the fact Will could not see.
	useEffect(() => {
		let live = true;
		setAccepted(null);
		if (!current) return;
		void acceptedNow(current).then((m) => {
			if (live) setAccepted(m);
		});
		return () => {
			live = false;
		};
	}, [current, acceptedNow]);
	const vp = useViewport();
	/**
	 * Categories to draw from. Empty means all of them, not none.
	 *
	 * Will: "the toggled categories do not persist when the app is reloaded or when
	 * I switch tab and return. When I return to the mistakes tab it should be as I
	 * left it with same choices selected in the UI."
	 *
	 * Restored through `viewState`, which validates on the way out — a category id
	 * written by an older build and since removed is dropped rather than restored,
	 * because a filter naming a phase that no longer exists selects nothing and
	 * presents as an empty deck. Note this view is also REMOUNTED on every game
	 * import (`<Quiz key={dataVersion}>` in App.tsx), so the initialiser runs far
	 * more often than a reload would suggest, and losing the selection there was
	 * most of what made it feel arbitrary.
	 */
	const [categories, setCategories] = useState<MistakeCard['phase'][]>(
		() =>
			(recall(
				'quizCategories',
				(v) => Array.isArray(v) && v.every((x) => CATEGORIES.some((c) => c.id === x)),
			) as MistakeCard['phase'][] | undefined) ?? [],
	);

	async function reload(cats: MistakeCard['phase'][] = categories, keepPlace = true) {
		const all = await loadMistakes();
		setCards(all);
		const q = due(inCategories(all, cats), Date.now());

		/*
		 * PICK THE DECK BACK UP WHERE YOU LEFT IT.
		 *
		 * ---------------------------------------------------------------------
		 * Will: "mistakes … currently it starts over same sequence every time
		 * user leaves tab."
		 *
		 * `App` unmounts a tab the moment you leave it, so this ran fresh on every
		 * visit — and `due()` is deterministic, so the first card was always the
		 * same one.
		 *
		 * ONLY THE CURRENT CARD IS REMEMBERED, and that is the whole fix. The
		 * obvious-looking alternative — recording which cards you have answered so
		 * they do not come back — is both unnecessary and a slow bug: `answer()`
		 * already pushes a correct card's `dueAt` into the future, so `due()`
		 * excludes it by itself, and a list of answered ids would keep growing
		 * with nothing to clear it until the deck read as empty on a day when it
		 * was full.
		 *
		 * A card answered WITH HELP is deliberately still due — it is recorded as
		 * incorrect, so it comes straight back. Remembering it as "done" would
		 * have quietly undone that.
		 * ---------------------------------------------------------------------
		 */
		const wasOn = keepPlace
			? (recall('quizCurrentId', (v) => typeof v === 'string') as string | undefined)
			: undefined;
		const at = wasOn ? q.findIndex((c) => c.id === wasOn) : -1;
		const ordered = at > 0 ? [q[at], ...q.slice(0, at), ...q.slice(at + 1)] : q;

		setQueue(ordered);
		setCurrent(ordered[0] ?? null);
		setLoaded(true);
	}

	/**
	 * Remember which card is in front of you, so leaving the tab does not lose it.
	 *
	 * GUARDED ON `loaded`, and that guard is the whole thing working. An effect
	 * watching `current` also fires on MOUNT, when `current` is still null — so
	 * without this it wrote an empty id and erased the stored one a moment before
	 * `reload` got round to reading it. The restore then found nothing and the
	 * deck started over, which is precisely the symptom being fixed, caused by
	 * the fix for it.
	 */
	useEffect(() => {
		if (!loaded) return;
		remember({ quizCurrentId: current?.id ?? '' });
	}, [current, loaded]);

	/** One place to change the selection, so nothing can set it without storing it. */
	function chooseCategories(next: MistakeCard['phase'][]) {
		setCategories(next);
		remember({ quizCategories: next });
		// Changing what you are drilling starts that drill, rather than resuming
		// one through a filter the remembered card may not even pass.
		void reload(next, false);
	}

	function toggleCategory(id: MistakeCard['phase']) {
		chooseCategories(
			categories.includes(id) ? categories.filter((c) => c !== id) : [...categories, id],
		);
	}

	useEffect(() => {
		void reload();
	}, []);

	// Exposed to the console: schackal.dump(). Registered fresh on every render
	// so the snapshot closes over current state rather than the first render's.
	useEffect(() =>
		registerDebug('quiz', () => ({
			fen: current?.fen ?? null,
			position: describePosition(current?.fen),
			boardVersion,
			helped,
			feedback,
			queueLength: queue.length,
			answeredThisSession: done,
			card: current && {
				id: current.id,
				phase: current.phase,
				ourColour: current.ourColour,
				expected: `${current.expectedSan} (${current.expectedUci})`,
				played: current.playedSan,
				ply: current.ply,
				streak: current.streak,
				lapses: current.lapses,
				retired: current.retired,
				dueAt: new Date(current.dueAt).toISOString(),
				origin: current.origin ?? null,
			},
			deck: cards.map((c) => ({
				id: c.id,
				phase: c.phase,
				expected: c.expectedUci,
				lapses: c.lapses,
				streak: c.streak,
				retired: c.retired,
				due: new Date(c.dueAt).toISOString(),
				// The check most worth making automatically: a card whose position
				// has the wrong side to move can never be answered.
				stmMatchesUs: safeStm(c.fen) === c.ourColour,
			})),
		})),
	);

	// The trainer has always shown a running evaluation; the quiz did not, so the
	// same position read as two different exercises depending on the tab. One
	// search per card, cached, and null until it lands rather than a fake zero.
	useEffect(() => {
		let live = true;
		setEvalCp(null);
		if (!current) return;
		const fen = current.fen;
		const colour = current.ourColour;
		void (async () => {
			try {
				const a = await analysePosition(fen, 14, 1, 250);
				if (live) setEvalCp(toColourPov(a.pvs[0]?.cpWhite ?? 0, colour));
			} catch {
				/* leave it blank — see "honest numbers or no numbers" */
			}
		})();
		return () => {
			live = false;
		};
	}, [current?.id]);

	/** One place to switch a tag on the shared table. */
	function tag(src: MoveSource, on: boolean) {
		setTableOn((cur: ReadonlySet<MoveSource>) => {
			const next = new Set(cur);
			if (on) next.add(src);
			else next.delete(src);
			return next;
		});
	}

	/**
	 * The moves that led to this position, replayed.
	 *
	 * A card used to appear as a position with no history — you were asked what
	 * you should have played without being shown what had just happened, which
	 * for a mistake mined from a real game is most of the information. The path
	 * is already stored on every card; nothing has to be fetched.
	 */
	const line = useMemo(() => (current?.path?.length ? replayLine(current.path) : []), [current]);

	// replayLine returns the START position at index 0 and the position AFTER
	// ply i at index i, so the last entry is the card's own position and there
	// is one more entry than there are moves.
	const lastPly = Math.max(0, line.length - 1);

	/** Which position is on the board. `null` means the card itself. */
	const [previewPly, setPreviewPly] = useState<number | null>(null);
	/**
	 * PLAN-EXPLAINER §5's third host. A mistake is the position where "why was
	 * that wrong" is the whole question, so this is the doorway that most needed
	 * to exist — and it is the same `explain(fen, move, alternatives)` the Lab and
	 * Train ask, not a third implementation of the same idea.
	 */
	const [asking, setAsking] = useState<Ask | null>(null);
	/**
	 * A line the explainer handed over, shown in the move list already on screen.
	 *
	 * I claimed this view had no game list to lend and so had to keep a stepper of
	 * its own. That was wrong, and Will said so: "all the mistakes are from actual
	 * play so they should come with a move list". They do — the card carries the
	 * path and it has been replayed under the board since the run-up went in. So
	 * the line borrows THAT list, the way Train's does, and there is one move list
	 * in this view as well.
	 */
	const lineOverlay = useLineOverlay();
	/** The same overlays the Lab and Train have, from the same hook. */
	/** The man the safe-moves overlay is about. See Train, and the wheel's own note. */
	const [focus, setFocus] = useState<number | null>(null);
	const atCard = previewPly === null || previewPly >= lastPly;
	const boardFen = atCard ? current?.fen : line[previewPly as number]?.fen;
	/*
	 * EVERYTHING KNOWN ABOUT THE MOVES HERE — the same hook Train uses.
	 *
	 * -------------------------------------------------------------------------
	 * Will: "you added a 'show moves' button in Mistakes, but it does not have
	 * the 'book' filter category. It should be unified across tabs. Instead you
	 * added an 'answer' button for no reason. Remove it."
	 *
	 * Both halves of that are one mistake. `line` here used to be THE CARD'S
	 * ANSWER — a private meaning for a chip that says "book" in the other tab —
	 * and because the answer had to be earned, it needed a button to earn it
	 * with. So the tab grew a control Train does not have, in order to feed a
	 * source that meant something Train's does not.
	 *
	 * `line` is theory at this position in both tabs now, read off the explorer
	 * that is being fetched anyway. The answer needs no button: it is a move in
	 * the position, so it appears in the table like every other move, and
	 * putting the table up already counts as help. One less control, one less
	 * meaning, and the two tabs finally describe the same thing.
	 */
	const table = useMoveTable(
		atCard ? (current?.fen ?? null) : null,
		current?.ourColour,
		tableShown,
	);
	const moveRows = table.rows;
	/*
	 * `busy` is the shared hook's search — the only thing on this tab slow
	 * enough to need the board's working indicator. It used to be a state field
	 * set by hand inside `showOptions`, which is one more owner of a fact the
	 * hook already knows.
	 */
	const busy = table.working;

	// THE POSITION THE BOARD IS SHOWING, not the card's. Train had this exact bug:
	// stepping back through the run-up left the wheels describing a position that
	// was no longer on screen. The borrowed line is excluded on purpose — while it
	// is up the explainer owns the arrows.
	// Same settled flag as Train's, for the same reason — see `useTrainingWheels`.
	const wheels = useTrainingWheels(boardFen ?? current?.fen ?? null, focus, !busy);
	// Follows the board, borrowed line included — see Train.
	const commentaryFen = lineOverlay.board?.fen ?? boardFen ?? current?.fen ?? null;
	const commentary = useCommentary(
		commentaryFen,
		asking?.fen === commentaryFen ? asking.uci : null,
	);


	/*
	 * THE SAME RULE AS TRAIN'S: if it is on screen while the card is being
	 * answered, it is help.
	 *
	 * Will: "I think this has been applied incorrectly in mistakes as well." It
	 * was. `showOptions` and reveal set `helped`; the explorer never did, and the
	 * training wheels never did in any view — and the mate wheel draws the forced
	 * mate, which is more of an answer than a table of evaluations.
	 *
	 * An effect rather than a line inside each button, so a source that gets added
	 * later cannot forget to say it helped.
	 */
	useEffect(() => {
		if (!current) return;
		const showing =
			(tableShown && tableOn.size > 0) || (wheels.active && wheels.on.size > 0);
		if (showing) setHelped(true);
	}, [current, tableShown, tableOn, wheels.active, wheels.on]);

	const tableArrows = useMemo(() => {
		// NOT WHILE LOOKING BACK. The table is about the card's position; stepping
		// back through the run-up puts a different board under it, and moves drawn
		// there are not legal, let alone recommended. Same rule the board already
		// applies to `interactive`, and the wheels to their own overlays.
		//
		// HIDDEN TABLE, NO ARROWS — the chips are what say which source an arrow
		// came from, and drawn without them the board is coloured for no stated
		// reason.
		if (!atCard || !tableShown) return [];
		// `arrowForRow`, not a second copy of it: this one had already drifted
		// from Train's, on whether an unranked move gets a label.
		return filterMoves(moveRows, effectiveSources(moveRows, tableOn)).flatMap((row) =>
			arrowForRow(row, table.grades, table.book),
		);
	}, [moveRows, tableOn, tableShown, table.grades, table.book, atCard]);

	/**
	 * The move that produced the position being shown.
	 *
	 * On the card itself this is the OPPONENT'S last move — which is exactly the
	 * thing you need to see in order to know what you are being asked.
	 */
	const lastMove = ((): [string, string] | undefined => {
		// While a line is borrowed it owns the board, so the highlight has to follow
		// it. Leaving the card's own last move lit would put a marker on a position
		// that is no longer on screen.
		if (lineOverlay.board) return lineOverlay.board.lastMove;
		const uci = line[atCard ? lastPly : (previewPly as number)]?.uci;
		return uci ? [uci.slice(0, 2), uci.slice(2, 4)] : undefined;
	})();

	function step(delta: number) {
		const at = previewPly === null ? lastPly : previewPly;
		const to = Math.max(0, Math.min(lastPly, at + delta));
		setPreviewPly(to >= lastPly ? null : to);
	}

	function actions(): ToolbarAction[] {
		// THE STEP BUTTONS DRIVE WHATEVER SEQUENCE IS SHOWING — the same rule Train
		// follows. While a line is borrowed they walk it; otherwise they walk the
		// run-up to the card. One set of controls, because there is one move list.
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
					onClick: lineOverlay.close,
				},
			];

		return [
			/*
			 * THERE IS NO "RESTART" HERE.
			 *
			 * Will: "a skip button could also be useful and could replace 'restart'
			 * in Mistakes, since it is not meaningful there."
			 *
			 * Right on both counts. Nothing restarts on this tab — a card is a
			 * position, not a run — and the button captioned `restart` actually
			 * jumped to the start of the RUN-UP, which is a third thing again. A
			 * control whose word, picture and behaviour are three different claims
			 * is worse than no control.
			 *
			 * The jump itself is not lost: every chip in the list below is
			 * clickable, and the list now says what it is ("How you got here"), so
			 * going to its first move is a tap on the thing you are looking at
			 * rather than an icon you have to decode.
			 */
			{
				id: 'back',
				title: 'Step back through the moves that led here',
				icon: 'back',
				onClick: () => step(-1),
				disabled: !lastPly || previewPly === 0,
			},
			{
				id: 'forward',
				title: 'Step forward, back towards the position you have to answer',
				icon: 'forward',
				onClick: () => step(1),
				disabled: !lastPly || atCard,
			},
			{
				/*
				 * ONE BUTTON WHERE THERE WERE TWO, exactly as in Train.
				 *
				 * `options` owned the engine rows and `stats` owned the explorer
				 * rows, with two abstract icons — a ramp of arrows and a bar chart —
				 * that Will could not tell apart, which is the same complaint that
				 * collapsed Train's three into one. The sources are chips inside the
				 * table now, labelled in words, and this says only whether the table
				 * and its arrows are up.
				 */
				id: 'options',
				title: moveTable.title,
				icon: 'reveal',
				accent: tableShown,
				onClick: moveTable.press,
				disabled: !current,
			},
			/*
			 * FREE PLAY, FROM THE POSITION IN FRONT OF YOU.
			 *
			 * Will: "user should be able to go into free play mode directly from
			 * mistakes imo."
			 *
			 * A mistake card is a position you got wrong and were never allowed to
			 * play out — which is the one thing that would actually answer "what
			 * would have happened?". The card already carries the moves that reach
			 * it, and Train already accepts exactly that shape from Review, so this
			 * is the handoff that exists rather than a second way in.
			 */
			...(onPlayFrom && current
				? [
						{
							id: 'playon',
							title: 'Play this position out against the engine, in the Train tab',
							icon: 'playon',
							caption: 'free play',
							onClick: () =>
								onPlayFrom({
									// `path` is the moves BEFORE the mistake, so the position
									// it reaches is the one being asked about — you play on
									// from where you went wrong, not from after it.
									moves: current.path ?? [],
									ply: current.path?.length ?? 0,
									ourColour: current.ourColour,
								}),
						} satisfies ToolbarAction,
					]
				: []),
			{
				id: 'skip',
				title: 'Skip — put this card to the back of the queue',
				icon: 'skip',
				onClick: () => next([...queue.slice(1), queue[0]]),
				disabled: queue.length < 2,
			},
		];
	}

	function next(fromQueue: MistakeCard[]) {
		setQueue(fromQueue);
		setCurrent(fromQueue[0] ?? null);
		setFeedback(null);
		setHelped(false);
		// NOTHING TO CLEAR. The rows belonged to the last card's position and the
		// hook owns them, keyed on the fen — it is the only writer, which is the
		// rule Train had to learn twice. `setTableOn(new Set())` used to be here
		// too, silently switching the filters off on every card, so a preference
		// that now persists across reloads would have been wiped one card later.
		setAsking(null);
		lineOverlay.close();
		// Back to the position being asked about. Carrying a preview across cards
		// would show one card's history under another card's question.
		setPreviewPly(null);
		// Always, not just on rejection. Two cards can share a position (same slip,
		// two candidate answers), and then `fen` does not change between them —
		// the board would keep the dests it consumed on the last move, i.e. none.
		setBoardVersion((v) => v + 1);
	}

	async function onMove(uci: string) {
		if (!current) return;
		// The last answer's verdict goes NOW rather than when the next one lands —
		// see Train's `onMove` for the failure that is. Here the gap is short, but
		// "correct" left standing under a board you have just played a second move
		// on is the same lie for however long it lasts.
		setFeedback(null);

		/*
		 * JUDGED AGAINST THE POSITION, not against one stored string.
		 *
		 * `sameMove` rather than string equality is still needed — a card whose
		 * answer is castling was stored with chessops' king-takes-rook spelling —
		 * but it is now applied to every accepted move rather than to one. See
		 * `acceptedAt`.
		 *
		 * Awaited rather than read off `accepted`: answering before the lookup
		 * lands is normal on a fast connection with an obvious card, and judging
		 * that against a half-built set would mark a correct move wrong, which is
		 * the whole bug.
		 */
		const allowed = await acceptedNow(current);
		const correct = allowed.some((m) => sameMove(current.fen, uci, m.uci));
		const wasRecorded = sameMove(current.fen, uci, current.expectedUci);
		// ANY help, not only a named answer — the table of evaluations names the
		// move too, which is why `helped` is set by the table being up rather than
		// by a button that promises the answer.
		// `applyAnswer`, not `answer` — it hands back the card AND the deck, so there
		// is no second copy left to go stale. See its comment for the failure it is
		// named after.
		const step = applyAnswer(current, cards, correct && !helped, Date.now());
		const updated = step.card;
		await saveCard(updated);
		setCards(step.deck);
		// THE CARD IN HAND MUST BE THE CARD THAT WAS JUST SAVED.
		//
		// Will: "the 'three-correct-in-a-row' principle is not enforced (I suspect
		// cards are retired after three correct, not resetting count if there was an
		// error in between)."
		//
		// The rule itself is right — `answer()` does `correct ? streak + 1 : 0`. What
		// was wrong is that on a WRONG answer nothing replaced `current`. The reset
		// card went to the database and to `cards`, and the stale one stayed on
		// screen, so the next attempt incremented from the streak the card had
		// BEFORE the failure:
		//
		//   streak 2 → wrong → saved as 0, `current` still says 2
		//                    → correct → answer(2, true) = 3 → RETIRED
		//
		// Three correct in a row, from two corrects with a failure between them.
		// `next()` hid it on the correct path by replacing the card wholesale, which
		// is why it only ever showed up after a miss.
		setCurrent(updated);
		setQueue((q) => q.map((c) => (c.id === updated.id ? updated : c)));

		let san = uci;
		try {
			san = withGlyph(applyUci(current.fen, uci).san, current.ourColour);
		} catch {
			/* keep the uci */
		}

		// Closes unless pinned — and only on a CORRECT answer. A wrong one leaves
		// the card in front of you to try again, and pulling the table away at the
		// moment you most need it would be the opposite of help.
		if (correct) moveTable.played();

		if (correct) {
			// A card can have several answers now, so "correct" sometimes means a
			// move other than the one that was missed on the day. Saying so is the
			// difference between a deck that feels arbitrary and one that does not.
			const also = wasRecorded
				? ''
				: ` (${withGlyph(current.expectedSan, current.ourColour)} was the one you missed)`;
			setFeedback({
				ok: true,
				text: helped
					? `${san} — correct${also}, but you used help. The card stays in the deck.`
					: updated.retired
						? `${san} — correct${also} ${RETIRE_STREAK} times running. Retired.`
						: `${san} — correct${also}. ${RETIRE_STREAK - updated.streak} more to retire it.`,
			});
			setDone((d) => d + 1);
			// Correct answers leave the queue; a shown one goes to the back.
			const rest = queue.slice(1);
			setTimeout(() => next(helped ? [...rest, updated] : rest), 900);
		} else {
			// Straight back to the same card.
			setBoardVersion((v) => v + 1);
			/*
			 * AND WHERE TO LOOK, now that there is no button that just tells you.
			 *
			 * Removing the answer button is right — it was a control Train does not
			 * have, feeding a source that meant something Train's did not — but
			 * "not it, try again" with no route out is a loop. The route is the
			 * table, which lists every move here with what the engine and the
			 * explorer think of it, so it TEACHES the answer rather than handing it
			 * over. Only said once you are actually stuck, and only while the table
			 * is not already up.
			 */
			setFeedback({
				ok: false,
				text: tableShown
					? `${san} is not it. Try again.`
					: `${san} is not it. Try again — or show the moves to see what is on offer here.`,
			});
		}
	}

	if (!loaded) return <p style={{ opacity: 0.6 }}>Loading…</p>;

	const stats = summarise(inCategories(cards, categories), Date.now());
	const counts = countByCategory(cards, Date.now());

	if (!cards.length) {
		return (
			<Empty>
				<p style={{ margin: '0 0 10px', maxWidth: 520, display: 'inline-block' }}>
					No mistakes recorded yet. Anything you get wrong while training lands here on its
					own — and your real games are mined for the mistakes you made when it counted.
				</p>
				<div>
					{onOpenSettings && (
						<Button onClick={onOpenSettings}>Check your game import</Button>
					)}
				</div>
			</Empty>
		);
	}

	/*
	 * THE DECK PANEL, built once and placed by the layout.
	 *
	 * Two columns when there is room; one when there is not, and then it goes
	 * INTO the stack under the board rather than after it — above the history,
	 * per Will. Written as a value rather than duplicated into both branches
	 * because a panel rendered twice is a panel that drifts.
	 */
	const deckPanel = (
		<div data-region="quiz-deck">
				<h3 style={{ marginTop: 0 }}>Deck</h3>

				{/*
				  * WHAT COUNTS AS RIGHT, said out loud and changeable.
				  *
				  * Will: "user needs to know the repertoire and strictness for the
				  * mistake card to make sense". Both halves are here: the rung is
				  * named rather than inherited invisibly from the other tab, and the
				  * line under it says how many moves that makes acceptable in the card
				  * in front of you — which is the fact that was missing while four
				  * right answers out of five were being marked wrong.
				  */}
				<div style={{ marginBottom: space.card }}>
					<Select
						label="What counts as right"
						value={strictness}
						onChange={setStrictness}
						options={STRICTNESS.map((r) => ({ id: r.id, label: r.label }))}
					/>
					<p style={{ fontSize: text.note, color: INK_2, margin: `${space.tight}px 0 0` }}>
						{STRICTNESS.find((r) => r.id === strictness)?.note}
					</p>
					{current && (
						<p style={{ fontSize: text.note, color: INK_2, margin: `${space.tight}px 0 0` }}>
							{accepted === null
								? 'Working out what is accepted here…'
								: accepted.length === 1
									? 'One move is accepted in this position.'
									: `${accepted.length} moves are accepted in this position.`}
						</p>
					)}
				</div>

				{/* Four different exercises share one deck; drilling one of them is a
					reasonable thing to want. Nothing selected means everything, so an
					empty filter never looks like an empty deck. */}
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
					{CATEGORIES.map((cat) => {
						const n = counts[cat.id] ?? { total: 0, due: 0 };
						const on = categories.includes(cat.id);
						return (
							<Chip
								key={cat.id}
								on={on}
								onClick={() => toggleCategory(cat.id)}
								disabled={n.total === 0}
								title={`${cat.note} ${n.due} due of ${n.total}.`}
							>
								{cat.label}{' '}
								<span style={{ opacity: 0.7 }}>
									{n.due}/{n.total}
								</span>
							</Chip>
						);
					})}
				</div>
				{categories.length > 0 && (
					<div style={{ marginBottom: 8 }}>
						<Button kind="quiet" onClick={() => chooseCategories([])}>
							Show all categories
						</Button>
					</div>
				)}
				<div style={{ fontSize: 14 }}>
					<strong>{stats.due}</strong> due · {stats.learning} in the deck · {stats.retired}{' '}
					retired
				</div>
				<p style={{ fontSize: 12, color: INK_2 }}>
					A card retires after {RETIRE_STREAK} correct answers in a row on separate occasions.
					Being shown the move does not count towards that — answering right after seeing the
					answer is not evidence you knew it.
				</p>

				<h3>Hardest</h3>
				{/*
				  * WHAT THE POSITION WAS, AND A WAY INTO IT.
				  *
				  * Will: "the annotation is useless. Just says a move and variation,
				  * but that tells user nothing about what the position was. Also user
				  * needs to be able to click to display the problem on the board."
				  *
				  * Right on both counts, and they are the same fault. The row led with
				  * the ANSWER — a bare `d5` — which is meaningless without the position
				  * and is also the one thing a list of your weak spots should not be
				  * shouting at you. What identifies a card is where it happened and
				  * what you were answering, so that is what it leads with now, and the
				  * answer is not shown at all: the row is a door to the card, and the
				  * card is where you get to try it.
				  */}
				<ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: text.note }}>
					{[...inCategories(cards, categories)]
						.sort((a, b) => b.lapses - a.lapses)
						.slice(0, 8)
						.map((c) => {
							const last = lastMoveOf(c);
							return (
								<li key={c.id} style={{ borderBottom: `1px solid ${color.line}` }}>
									<button
										onClick={() =>
											next([c, ...queue.filter((q) => q.id !== c.id)])
										}
										title="Put this position on the board"
										style={{
											display: 'block',
											width: '100%',
											textAlign: 'left',
											background:
												current?.id === c.id ? color.accentSoft : 'transparent',
											border: 'none',
											borderLeft: `3px solid ${
												current?.id === c.id ? color.accent : 'transparent'
											}`,
											padding: `${space.snug}px ${space.snug}px`,
											font: 'inherit',
											color: color.ink,
											cursor: 'pointer',
											touchAction: 'manipulation',
										}}
									>
										<div style={{ color: color.ink }}>{namesFor(c)}</div>
										<div style={{ color: color.ink2, marginTop: 2 }}>
											{last ? (
												<>
													after <Move san={last.san} colour={last.colour} size={12} />{' '}
													·{' '}
												</>
											) : null}
											you played <Move san={c.playedSan} colour={c.ourColour} size={12} />
											{' · '}
											missed {c.lapses}×{c.retired && ' · retired'}
										</div>
									</button>
								</li>
							);
						})}
				</ul>

				{/* The debug handle now lives in the screen corner on every tab
					(components/DebugCorner.tsx) — a bug is not always on this one. */}
				<button
					onClick={async () => {
						await clearMistakes();
						await reload();
					}}
					style={{ fontSize: 13, marginTop: 8 }}
				>
					Clear deck
				</button>
		</div>
	);

	return (
		<div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
			<div
				style={{
					flex: vp.stacked ? '1 1 100%' : '1 1 320px',
					minWidth: 0,
					maxWidth: vp.stacked ? undefined : 560,
				}}
			>
				{current ? (
					<BoardPanel
						fen={lineOverlay.board?.fen ?? boardFen ?? current.fen}
						ourColour={current.ourColour}
						evalCp={evalCp}
						lastMove={lastMove}
						caption={{
							// Stepping back through the run-up moves the caption with the
							// board, same as Train. The card's own `ply` is authoritative at
							// the card, because a card old enough to have no path still
							// knows which move it was.
							path: atCard ? (current.path ?? []) : (current.path ?? []).slice(0, previewPly as number),
							opening: atCard ? (current.opening ?? null) : null,
							...(atCard ? { ply: plyOf(current) } : {}),
							also: atCard
								? [
										// Will's example, in full: "Scotch opening, move 5 · you
										// played ♞Nxe5 · missed 4×". The first segment is the
										// shared half; the rest are the deck's, and they are the
										// only place in the app that knows them.
										<>
											you played{' '}
											<Move san={current.playedSan} colour={current.ourColour} size={12} />
										</>,
										`missed ${current.lapses}×`,
										current.origin ? gameLabel(current.origin) : null,
										current.origin ? (
											<a
												href={current.origin.url}
												target="_blank"
												rel="noreferrer"
												style={{ color: 'inherit' }}
											>
												see the game
											</a>
										) : null,
									]
								: [],
						}}
						// Only the card's own position accepts a move. Stepping back is
						// for looking; answering somewhere else in the game would be
						// answering a different question.
						interactive={!busy && atCard && !lineOverlay.overlay}
						onSelectSquare={(sqName) =>
							setFocus((f) => {
								const n = parseSquare(sqName);
								return n === undefined || f === n ? null : n;
							})
						}
						onMove={onMove}
						version={boardVersion}
						// The borrowed line owns the board while it is up, so it is also
						// what knows how the board got here — see `useLineOverlay`'s
						// `via`. Mistakes has no walk of its own: every other position
						// change on this tab is one ply, or a new card, which is a jump.
						via={lineOverlay.via}
						actions={actions()}
						busy={busy}
						// BOTH KINDS OF HELP CAN BE ON SCREEN AT ONCE, and the solution is
						// drawn last so it sits on top of the weighted options rather than
						// being replaced by them. This used to be an either/or, which is
						// the same conflation as the button being greyed out: asking for
						// options meant you could not also be shown the move.
						//
						// AND THE OPTIONS ARE THE TABLE'S, filtered — same derivation as
						// Train's, for the same reason. The board and the table were being
						// driven from two places, so pressing a filter chip narrowed the
						// list and left the arrows alone.
						arrows={
							lineOverlay.board
								? lineOverlay.board.arrows
								: wheels.arrows.length
									? wheels.arrows
									: tableArrows}
					>
						<PositionStack
							verdict={
								<>
									{brokenReason(current) ? (
										<div
											style={{
												fontSize: 13,
												background: color.badSoft,
												border: `1px solid ${color.bad}`,
												borderRadius: 6,
												padding: '6px 8px',
												marginBottom: 6,
											}}
										>
											<strong>This card cannot be answered.</strong> {brokenReason(current)}{' '}
											<button
												onClick={async () => {
													await deleteCard(current.id);
													await reload();
												}}
												style={{ fontSize: 12, marginLeft: 4 }}
											>
												Remove it
											</button>
										</div>
									) : null}
									<div style={{ fontSize: 15 }}>
										<strong>Your move.</strong> {promptFor(current)}
									</div>
									{/*
									  * THE CARD'S LABEL IS ABOVE THE BOARD NOW, not here.
									  *
									  * This div said "Scotch opening, move 3 · you played ♞Nxe4 ·
									  * missed 4×", which is Will's example of what a board should
									  * always be captioned with — so when the caption became
									  * shared machinery, this became the second copy of it, six
									  * inches lower. One of the two had to go, and the one that
									  * goes is the one only this tab has.
									  */}

									{feedback && (
										<div
											style={{
												marginTop: 8,
												fontSize: 14,
												color: feedback.ok ? color.good : color.bad,
											}}
										>
											{feedback.text}
										</div>
									)}
								</>
							}
							moves={
								<>
									{/*
									  * THE SAME TABLE TRAIN HAS. One row per move, with the tags
									  * that say where it came from — the engine's picks, what
									  * people play, and the card's own answer once revealed. Every
									  * row has a `?`, which is the doorway §1 asked for.
									  */}
									{tableShown && (
										<div>
											<MoveTable
												rows={moveRows}
												mover={current.ourColour}
												on={tableOn}
												// All three, and the SAME three Train offers — a chip is
												// how you switch a source back on, so it cannot vanish
												// with its rows, and "book" has to mean the same thing on
												// both tabs or the word is doing two jobs.
												offers={['line', 'engine', 'popular']}
												onToggle={(src) => tag(src, !tableOn.has(src))}
												onAsk={(uci) =>
													setAsking({
														fen: current.fen,
														uci,
														alternatives: moveRows.map((r) => r.uci),
													})
												}
												askedPopularity={table.askedPopularity}
												marksBook
												region="quiz-moves"
											/>
										</div>
									)}
								</>
							}
							wheels={
								<>
									<TrainingWheels
										on={wheels.on}
										onChange={wheels.setOn}
										active={wheels.active}
										onActiveChange={wheels.setActive}
										notes={wheels.notes}
										hasFocus={focus !== null}
										working={wheels.working}
									/>
								</>
							}
							commentary={
								<>
									{/* Only appears when the register says there is a page. Stepping
										back through the run-up lands on the opening plies, which is
										exactly where the book has something to say. */}
									<Commentary state={commentary} region="quiz-commentary" />
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
												lineOverlay.close();
											}}
										/>
									)}
								</>
							}
							// Stacked, the deck comes in here — above the history, because on
							// this tab the run-up is the least important thing on the screen.
							controls={vp.stacked ? deckPanel : null}
							history={
								<>
									{/* The run-up to the position. A mistake from a real game
										without the moves that produced it is a puzzle with the
										premise removed — and every card already stores the path,
										so nothing is fetched to show this.

										ONE MOVE LIST: while a line is borrowed it shows that
										instead of the game, with a banner saying whose it is. */}
									{(lastPly > 0 || lineOverlay.overlay) && (
										<div>
											{/* "How you got here" rather than "moves so far": on a
												mistake card the list is the run-up to the position
												being asked about, not a game in progress. */}
											<MoveListHeader
												title="How you got here"
												borrowed={lineOverlay.overlay?.label}
												onClose={lineOverlay.close}
											/>
											<MoveList
												region="quiz-move-list"
												onAsk={lineOverlay.overlay?.onAsk}
												// Index 0 is the starting position, not a move.
												chips={
													lineOverlay.chips ??
													line.slice(1).map((m, i) => ({
														san: m.san ?? '',
														ply: i + 1,
														mistake: false,
														suboptimal: false,
														white: i % 2 === 0,
													}))
												}
												currentPly={
													lineOverlay.overlay
														? lineOverlay.overlay.at
														: atCard
															? lastPly
															: (previewPly as number)
												}
												onJump={
													lineOverlay.overlay
														? lineOverlay.setAt
														: (ply) => setPreviewPly(ply >= lastPly ? null : ply)
												}
											/>
											{!lineOverlay.overlay && <MoveListLegend />}
											{!lineOverlay.overlay && !atCard && (
												<Panel tone="accent" style={{ marginTop: 8, fontSize: 13 }}>
													Looking back at move {Math.ceil(((previewPly ?? 0) + 1) / 2)}. Step
													forward to answer the card.
												</Panel>
											)}
										</div>
									)}
								</>
							}
						/>
					</BoardPanel>
				) : (
					<p style={{ fontSize: 15 }}>
						Nothing due right now — {done} answered this session. Cards come back on the usual
						schedule, sooner if you miss them.
						{categories.length > 0 && (
							<>
								{' '}
								You are only drawing from{' '}
								{categories
									.map((c) => CATEGORIES.find((x) => x.id === c)?.label ?? c)
									.join(' and ')}
								;{' '}
								<button
									onClick={() => chooseCategories([])}
									style={{ fontSize: 13 }}
								>
									show all
								</button>{' '}
								for the rest.
							</>
						)}
					</p>
				)}
			</div>

			{!vp.stacked && (
				<div style={{ flex: '1 1 260px', minWidth: 0 }}>{deckPanel}</div>
			)}

		</div>
	);
}

/**
 * Why this card can never be answered, or '' if it can.
 *
 * A card whose position has the opponent to move looks completely normal — the
 * board is oriented your way and the pieces are all there — but chessground
 * will only let the side to move be dragged, so every piece you reach for is
 * inert. From the outside that is indistinguishable from a broken board, which
 * is exactly why it is worth naming rather than leaving to be diagnosed.
 */
function brokenReason(c: MistakeCard): string {
	const stm = safeStm(c.fen);
	if (stm !== c.ourColour) {
		const side = (x: string) => (x === 'w' ? 'White' : x === 'b' ? 'Black' : `"${x}"`);
		return `The position has ${side(stm)} to move, but the card is stored as ${side(
			c.ourColour,
		)}. Nothing you drag will be accepted.`;
	}
	const pos = describePosition(c.fen) as { error?: string; legalMoves?: number };
	if (pos.error) return `The stored position is not valid (${pos.error}).`;
	if (!pos.legalMoves) return 'The stored position has no legal moves — the game is already over.';
	return '';
}

function safeStm(fen: string): string {
	try {
		return fen.split(' ')[1] ?? '?';
	} catch {
		return '?';
	}
}

export function promptFor(c: MistakeCard): string {
	// The motif comes first: a card mined from a real game where THEY blundered
	// asks a different question from one where we simply went wrong, and reading
	// "you played X and it cost 4.0" over a position you were winning describes
	// the wrong event.
	if (c.motif === 'missed-punish') {
		return `They had just blundered here. You played ${withGlyph(
			c.playedSan,
			c.ourColour,
		)} and let it go — find the punishment.`;
	}

	switch (c.phase) {
		case 'punish':
			return 'You missed the punishment here.';
		case 'book':
			return 'You lost the line here.';
		case 'game':
			return `You played ${withGlyph(c.playedSan, c.ourColour)} here in a real game, and it cost ${(
				(c.origin?.loss ?? 0) / 100
			).toFixed(1)}.`;
		default:
			return 'This move cost you material here.';
	}
}

/**
 * Which line this position belongs to, and where in it.
 *
 * Cards mined from real games used to show only the opponent and the date,
 * which says where the card came FROM but not what it is ABOUT — and "what is
 * it about" is the thing that makes a card connect to the rest of the deck. The
 * name is derived from the path when it was not recorded, so old cards and
 * game-mined cards get labelled too rather than only new book ones.
 */
export function lineLabelFor(c: MistakeCard): string | null {
	// Cards made before openings were recorded still carry their old line IDs.
	// That fallback is this deck's and nobody else's, which is why it stays here
	// — the explorer-then-table rule underneath it is `nameOf`'s, because three
	// files were applying it independently.
	if (c.lineIds?.length && !c.opening) return c.lineIds[0];
	return nameOf({ path: c.path ?? [], opening: c.opening ?? null });
}

/**
 * The move number the mistake was played on.
 *
 * `path` holds the moves BEFORE it, so the mistake is ply `path.length` counting
 * from zero — one further on than the path is long.
 *
 * READS `ply` FIRST. It used to read `c.path?.length ?? c.ply`, and `?? ` never
 * reaches the second term because an absent path gives length 0, not undefined
 * — so every card old enough to have no path was reported as move 1. The two
 * agree on every card that has both; `ply` is the one that is always recorded.
 */
export function plyOf(c: MistakeCard): number {
	return c.ply || c.path?.length || 0;
}

export function moveNumberFor(c: MistakeCard): { no: number; white: boolean } {
	const ply = plyOf(c);
	return { no: moveNumber(ply), white: ply % 2 === 0 };
}

/**
 * The move that PRODUCED this position — their last one.
 *
 * `path` holds the moves before the mistake, so its last entry is the move you
 * were answering. On a card from move 24 of a real game that single fact is the
 * difference between "a position" and "this position".
 */
export function lastMoveOf(c: MistakeCard): { san: string; colour: 'w' | 'b' } | null {
	const path = c.path ?? [];
	if (!path.length) return null;
	const ply = path.length - 1;
	return { san: path[ply], colour: ply % 2 === 0 ? 'w' : 'b' };
}

/**
 * A card's label in a list.
 *
 * The first segment is `whereYouAre`'s, not a second copy of it. This file had
 * its own `"<line>, move <n>"` and so did the line above the board, and the two
 * described the SAME card a few hundred pixels apart — which is where a
 * disagreement about the move number or the name would have shown up first, and
 * where it would have looked like a bug in the app rather than a duplicated
 * format string.
 */
export function namesFor(c: MistakeCard): string {
	const parts: string[] = [];

	/*
	 * The one fallback a ROW needs and a caption does not.
	 *
	 * `whereYouAre` is silent at ply 0, because a board showing the initial
	 * position does not need telling where it is. A card AT ply 0 is a real
	 * card — you played a bad first move — and a row in a list of your weak
	 * spots still has to be identifiable, so it says which move it was.
	 */
	parts.push(
		whereYouAre({ path: c.path ?? [], opening: lineLabelFor(c), ply: plyOf(c) }) ??
			`move ${moveNumber(plyOf(c))}`,
	);

	if (c.phase === 'game' && c.origin) parts.push(gameLabel(c.origin));

	return parts.join(' · ');
}

/** Which real game a card came out of. */
export function gameLabel(o: NonNullable<MistakeCard['origin']>): string {
	return `${o.platform} vs ${o.opponent}, ${new Date(o.playedAt).toISOString().slice(0, 10)}`;
}

// Quiz: the positions you got wrong, until you do not.
//
// Deliberately stricter than a run. There is no "works too" here — the card
// exists because a specific move was missed, and the point is to produce that
// move. Getting it wrong puts the card straight back in the queue rather than
// moving on, which is what "repeat until correct" means.

import { useEffect, useMemo, useState } from 'react';
import { BoardPanel } from '../components/BoardPanel';
import type { ToolbarAction } from '../components/Toolbar';
import { analysePosition, toColourPov } from '../data/cloudEval';
import { candidateMoves, brushForGrade, type Candidate } from '../engine/candidates';
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
import { Empty, Button, Panel } from '../ui/primitives';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import { TrainingWheels } from '../components/TrainingWheels';
import { useTrainingWheels } from '../hooks/useTrainingWheels';
import { useLineOverlay } from '../hooks/useLineOverlay';
import { useCommentary } from '../hooks/useCommentary';
import { Commentary } from '../components/CommentaryPanel';
import { MoveList, MoveListLegend } from '../components/MoveList';
import { MoveTable } from '../components/MoveTable';
import { mergeMoves, filterMoves, type MoveSource } from '../domain/moveTable';
import { distributionOf, type Distribution } from '../domain/distribution';
import { fetchExplorer } from '../data/explorer';
import { colourOfFen } from '../domain/notation';
import { Move } from '../components/Move';
import { withGlyph } from '../domain/notation';
import { nameForPath } from '../domain/openings';
import { registerDebug, describePosition } from '../data/debug';
import { useViewport } from '../components/useViewport';
import { color } from '../ui/theme';
import { recall, remember } from '../data/viewState';

const INK_2 = color.ink2;

export function Quiz({ onOpenSettings }: { onOpenSettings?: () => void }) {
	const [cards, setCards] = useState<MistakeCard[]>([]);
	const [queue, setQueue] = useState<MistakeCard[]>([]);
	const [current, setCurrent] = useState<MistakeCard | null>(null);
	const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
	/**
	 * THE ANSWER IS ON SCREEN. Only the reveal button sets this.
	 *
	 * It used to mean two things at once and that is the bug Will hit: "when I
	 * click 'show options' the 'show solution' button is greyed out and becomes
	 * unclickable — that's annoying and wrong behaviour." Quite. `showOptions`
	 * set `reveal` because using help stops the card counting, and the reveal
	 * button is disabled on `reveal`, so asking for one kind of help withdrew the
	 * other. The two facts are now separate fields.
	 */
	const [reveal, setReveal] = useState(false);
	/** Help of ANY kind was used, so a correct answer no longer counts. */
	const [helped, setHelped] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [done, setDone] = useState(0);
	const [boardVersion, setBoardVersion] = useState(0);
	/** Evaluation of the card's position, from our side. Null until it arrives. */
	const [evalCp, setEvalCp] = useState<number | null>(null);
	const [candidates, setCandidates] = useState<Candidate[] | null>(null);
	/** What players actually play here — the same explorer Train asks. */
	const [distribution, setDistribution] = useState<Distribution | null>(null);
	/**
	 * Which tags the shared move table is showing.
	 *
	 * Mistakes used to render its own ordered list of candidates — a fourth
	 * rendering of "moves you could play here", with its own columns and its own
	 * colour swatch. Will: "UI should be basically the same for mistakes as for
	 * train". It is the same table now, and the buttons switch tags on it.
	 */
	const [tableOn, setTableOn] = useState<ReadonlySet<MoveSource>>(() => new Set<MoveSource>());
	const [busy, setBusy] = useState(false);
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

	async function reload(cats: MistakeCard['phase'][] = categories) {
		const all = await loadMistakes();
		setCards(all);
		const q = due(inCategories(all, cats), Date.now());
		setQueue(q);
		setCurrent(q[0] ?? null);
		setLoaded(true);
	}

	/** One place to change the selection, so nothing can set it without storing it. */
	function chooseCategories(next: MistakeCard['phase'][]) {
		setCategories(next);
		remember({ quizCategories: next });
		void reload(next);
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
			reveal,
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
		setTableOn((cur) => {
			const next = new Set(cur);
			if (on) next.add(src);
			else next.delete(src);
			return next;
		});
	}

	/** Every legal move, weighted by quality — the trainer's own help, unchanged. */
	async function showOptions() {
		if (!current || busy) return;
		// A second press puts the rows away, exactly as in Train: the button
		// switches a tag on the one table rather than owning a rendering.
		if (tableOn.has('engine')) {
			tag('engine', false);
			return;
		}
		setBusy(true);
		try {
			setCandidates(await candidateMoves(current.fen, current.ourColour, 5));
			tag('engine', true);
			// Using help means the answer no longer counts, exactly as in the trainer
			// — but it does not mean the answer has been SHOWN. Weighted options are a
			// hint; the solution is still a separate thing to ask for.
			setHelped(true);
		} catch (e) {
			setFeedback({ ok: false, text: (e as Error).message });
		} finally {
			setBusy(false);
		}
	}

	/**
	 * What people actually played from this position.
	 *
	 * Train has had this since the explorer went in; a mistake is a position out
	 * of a real game and the same question applies to it. Costs one request, and
	 * only when asked.
	 */
	async function showDistribution() {
		if (!current) return;
		if (distribution) {
			setDistribution(null);
			tag('popular', false);
			return;
		}
		try {
			const data = await fetchExplorer(current.fen);
			setDistribution(distributionOf(data, colourOfFen(current.fen)));
			tag('popular', true);
		} catch (e) {
			setFeedback({ ok: false, text: (e as Error).message });
		}
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
	// THE POSITION THE BOARD IS SHOWING, not the card's. Train had this exact bug:
	// stepping back through the run-up left the wheels describing a position that
	// was no longer on screen. The borrowed line is excluded on purpose — while it
	// is up the explainer owns the arrows.
	const wheels = useTrainingWheels(boardFen ?? current?.fen ?? null, focus);
	// Follows the board, borrowed line included — see Train.
	const commentaryFen = lineOverlay.board?.fen ?? boardFen ?? current?.fen ?? null;
	const commentary = useCommentary(
		commentaryFen,
		asking?.fen === commentaryFen ? asking.uci : null,
	);

	/**
	 * Everything known about the moves here, merged — the same table Train shows.
	 *
	 * `line` is the card's own answer, and it is only tagged once the answer has
	 * been revealed: before that, putting it in the table would be the solution
	 * printed next to the question.
	 */
	const moveRows = useMemo(
		() =>
			mergeMoves({
				line:
					reveal && current
						? [{ uci: current.expectedUci, san: current.expectedSan }]
						: undefined,
				engine: candidates ?? undefined,
				popular: distribution?.moves,
			}),
		[reveal, current, candidates, distribution],
	);

	/**
	 * The rows the table admits, drawn on the board.
	 *
	 * The grade comes from the engine's own ranking or not at all — see Train's
	 * `tableArrows` for why re-deriving it from the visible subset would be a
	 * claim nothing supports. The card's answer keeps its plain green, and is
	 * pushed last so it sits on top rather than being replaced.
	 */
	const tableArrows = useMemo(() => {
		const graded = new Map((candidates ?? []).map((c) => [c.uci, c]));
		const out = (tableOn.size ? filterMoves(moveRows, tableOn) : []).map((row) => {
			const c = graded.get(row.uci);
			return {
				orig: row.uci.slice(0, 2),
				dest: row.uci.slice(2, 4),
				brush: c ? brushForGrade(c.grade) : 'green',
				...(c ? { label: `${c.cp > 0 ? '+' : ''}${(c.cp / 100).toFixed(1)}` } : {}),
			};
		});
		if (reveal && current)
			out.push({
				orig: current.expectedUci.slice(0, 2),
				dest: current.expectedUci.slice(2, 4),
				brush: 'green',
			});
		return out;
	}, [moveRows, tableOn, candidates, reveal, current]);

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
			{
				id: 'first',
				title: 'Back to the start of the game',
				icon: 'first',
				onClick: () => setPreviewPly(0),
				disabled: !lastPly || previewPly === 0,
			},
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
				id: 'options',
				title: 'Show every legal move, weighted by how good it is (stops this card counting)',
				icon: 'options',
				// ACCENT FOLLOWS THE TABLE, as in Train: the button switches a tag on
				// rather than owning a rendering, and one that looked the same either
				// way would be lying about what pressing it did. It is also no longer
				// disabled once pressed — pressing again puts the rows away.
				accent: tableOn.has('engine'),
				onClick: showOptions,
				disabled: !current || busy,
			},
			{
				id: 'stats',
				title: 'What players actually play here — frequency and score',
				icon: 'stats',
				accent: tableOn.has('popular'),
				onClick: showDistribution,
				disabled: !current || busy,
			},
			{
				id: 'reveal',
				title: 'Show me the move (stops this card counting)',
				icon: 'reveal',
				accent: reveal,
				onClick: () => {
					setReveal(true);
					setHelped(true);
					// The answer joins the one table, tagged "the line", instead of
					// being a second way of naming a move.
					tag('line', true);
				},
				disabled: !current || reveal,
			},
			{
				id: 'skip',
				title: 'Skip — put this card to the back of the queue',
				icon: 'playon',
				onClick: () => next([...queue.slice(1), queue[0]]),
				disabled: queue.length < 2,
			},
		];
	}

	function next(fromQueue: MistakeCard[]) {
		setQueue(fromQueue);
		setCurrent(fromQueue[0] ?? null);
		setFeedback(null);
		setReveal(false);
		setHelped(false);
		setCandidates(null);
		// Everything the table was showing belonged to the last card's position.
		setDistribution(null);
		setTableOn(new Set());
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

		// Not string equality — a card whose answer is castling was stored with
		// chessops' king-takes-rook spelling and could never be answered.
		const correct = sameMove(current.fen, uci, current.expectedUci);
		// ANY help, not only the revealed answer — the weighted-options list names
		// the move too. `reveal` is about what is on screen; `helped` is about score.
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

		if (correct) {
			setFeedback({
				ok: true,
				text: helped
					? `${san} — correct, but you used help. The card stays in the deck.`
					: updated.retired
						? `${san} — correct ${RETIRE_STREAK} times running. Retired.`
						: `${san} — correct. ${RETIRE_STREAK - updated.streak} more to retire it.`,
			});
			setDone((d) => d + 1);
			// Correct answers leave the queue; a shown one goes to the back.
			const rest = queue.slice(1);
			setTimeout(() => next(helped ? [...rest, updated] : rest), 900);
		} else {
			// Straight back to the same card.
			setBoardVersion((v) => v + 1);
			setFeedback({ ok: false, text: `${san} is not it. Try again.` });
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
						<div style={{ marginTop: 10, minHeight: 96 }}>
							{brokenReason(current) ? (
								<div
									style={{
										fontSize: 13,
										background: '#ffebee',
										border: '1px solid #ef9a9a',
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
							<div style={{ fontSize: 13, color: INK_2, marginTop: 2 }}>
								{namesFor(current)} · you played{' '}
								<Move san={current.playedSan} colour={current.ourColour} size={13} /> ·
								missed {current.lapses}×
								{current.origin && (
									<>
										{' · '}
										<a
											href={current.origin.url}
											target="_blank"
											rel="noreferrer"
											style={{ color: INK_2 }}
										>
											see the game
										</a>
									</>
								)}
							</div>

							{feedback && (
								<div
									style={{
										marginTop: 8,
										fontSize: 14,
										color: feedback.ok ? '#2e7d32' : '#c62828',
									}}
								>
									{feedback.text}
								</div>
							)}

							<TrainingWheels
								on={wheels.on}
								onChange={wheels.setOn}
								active={wheels.active}
								onActiveChange={wheels.setActive}
								notes={wheels.notes}
								hasFocus={focus !== null}
								working={wheels.working}
							/>

							{/* Only appears when the register says there is a page. Stepping
								back through the run-up lands on the opening plies, which is
								exactly where the book has something to say. */}
							<Commentary state={commentary} region="quiz-commentary" />

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

							{/*
							  * THE SAME TABLE TRAIN HAS. One row per move, with the tags
							  * that say where it came from — the engine's picks, what
							  * people play, and the card's own answer once revealed. Every
							  * row has a `?`, which is the doorway §1 asked for.
							  */}
							{tableOn.size > 0 && moveRows.length > 0 && (
								<div style={{ marginTop: 10 }}>
									<MoveTable
										rows={moveRows}
										mover={current.ourColour}
										on={tableOn}
										onToggle={(src) => tag(src, !tableOn.has(src))}
										onAsk={(uci) =>
											setAsking({
												fen: current.fen,
												uci,
												alternatives: moveRows.map((r) => r.uci),
											})
										}
										askedPopularity={distribution !== null}
										region="quiz-moves"
									/>
								</div>
							)}

							{/* The run-up to the position. A mistake from a real game
								without the moves that produced it is a puzzle with the
								premise removed — and every card already stores the path,
								so nothing is fetched to show this.

								ONE MOVE LIST: while a line is borrowed it shows that
								instead of the game, with a banner saying whose it is. */}
							{(lastPly > 0 || lineOverlay.overlay) && (
								<div style={{ marginTop: 10 }}>
									{lineOverlay.overlay && (
										<div
											data-region="line-banner"
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: 8,
												fontSize: 13,
												color: INK_2,
												marginBottom: 4,
											}}
										>
											<span>{lineOverlay.overlay.label}</span>
											<button
												onClick={lineOverlay.close}
												style={{
													marginLeft: 'auto',
													border: 'none',
													background: 'none',
													color: '#1565c0',
													cursor: 'pointer',
													fontSize: 13,
												}}
											>
												Back to the game
											</button>
										</div>
									)}
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
						</div>
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

			<div style={{ flex: vp.stacked ? '1 1 100%' : '1 1 260px', minWidth: 0 }}>
				<h3 style={{ marginTop: 0 }}>Deck</h3>

				{/* Four different exercises share one deck; drilling one of them is a
					reasonable thing to want. Nothing selected means everything, so an
					empty filter never looks like an empty deck. */}
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
					{CATEGORIES.map((cat) => {
						const n = counts[cat.id] ?? { total: 0, due: 0 };
						const on = categories.includes(cat.id);
						return (
							<button
								key={cat.id}
								onClick={() => toggleCategory(cat.id)}
								disabled={n.total === 0}
								title={`${cat.note} ${n.due} due of ${n.total}.`}
								style={{
									fontSize: 12,
									padding: '4px 8px',
									borderRadius: 14,
									border: `1px solid ${on ? '#1565c0' : '#ddd'}`,
									background: on ? '#e3f2fd' : '#fff',
									color: n.total === 0 ? '#b5b4b0' : '#1a1a19',
									cursor: n.total === 0 ? 'default' : 'pointer',
									touchAction: 'manipulation',
								}}
							>
								{cat.label}{' '}
								<span style={{ color: INK_2 }}>
									{n.due}/{n.total}
								</span>
							</button>
						);
					})}
				</div>
				{categories.length > 0 && (
					<button
						onClick={() => chooseCategories([])}
						style={{ fontSize: 11, marginBottom: 8 }}
					>
						Show all categories
					</button>
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
				<ol style={{ fontSize: 13, paddingLeft: 20 }}>
					{[...inCategories(cards, categories)]
						.sort((a, b) => b.lapses - a.lapses)
						.slice(0, 8)
						.map((c) => (
							<li key={c.id} style={{ marginBottom: 2 }}>
								<Move san={c.expectedSan} colour={c.ourColour} bold size={13} />{' '}
								<span style={{ color: INK_2 }}>
									(played{' '}
									<Move san={c.playedSan} colour={c.ourColour} size={12} />) — missed{' '}
									{c.lapses}×{c.retired && ' · retired'}
								</span>
								{lineLabelFor(c) && (
									<div style={{ fontSize: 11, color: INK_2 }}>{lineLabelFor(c)}</div>
								)}
							</li>
						))}
				</ol>

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
	if (c.opening) return c.opening;
	// Cards made before openings were recorded still carry their old line IDs.
	if (c.lineIds?.length) return c.lineIds[0];
	if (c.path?.length) return nameForPath(c.path)?.name ?? null;
	return null;
}

/**
 * The move number the mistake was played on.
 *
 * `path` holds the moves BEFORE it, so the mistake is ply `path.length` counting
 * from zero — one further on than the path is long.
 */
export function moveNumberFor(c: MistakeCard): { no: number; white: boolean } {
	const ply = c.path?.length ?? c.ply ?? 0;
	return { no: Math.floor(ply / 2) + 1, white: ply % 2 === 0 };
}

function namesFor(c: MistakeCard): string {
	const parts: string[] = [];

	const line = lineLabelFor(c);
	const { no, white } = moveNumberFor(c);
	// Spelled out rather than left to the reader: "7…" is only obviously Black's
	// if you already know the convention, and the point is to be read, not decoded.
	parts.push(line ? `${line}, move ${no}${white ? '' : '…'}` : `Move ${no}${white ? '' : '…'}`);

	if (c.phase === 'game' && c.origin) {
		const when = new Date(c.origin.playedAt).toISOString().slice(0, 10);
		parts.push(`${c.origin.platform} vs ${c.origin.opponent}, ${when}`);
	}

	return parts.join(' · ');
}

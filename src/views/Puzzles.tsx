// Puzzles: a position, one right answer, and a rating that moves.
//
// ---------------------------------------------------------------------------
// Will: "redesign the dev only 'Lab' tab to a proper user facing Puzzle tab
// (like in lichess, with puzzle difficulty tracking using something like elo on
// puzzle difficulty)."
//
// This is thin, and it is thin because almost nothing here is new. The corpus
// was already bundled for the Lab with Lichess's own ratings and themes; the
// board, the strip, the order under it, the overlays, the explainer and the
// move list are the same components every other tab uses; and the three things
// that ARE new — the rating, the selection, the rules of solving — are in
// `domain/` where they can be tested without a board.
//
// What is left in this file is the wiring, which is what a view should be.
//
// ---------------------------------------------------------------------------
// HELP IS ALLOWED AND IT COSTS THE RATING, NOT THE PUZZLE.
//
// Will: "needs to be able to use our existing assistance machinery (like show
// moves and training wheels overlay), but of course doesn't count puzzle as
// solved if assistance were used."
//
// So the wheels and the move table are here in full, and switching either on
// marks the attempt. The mark is sticky for the attempt — turning the arrows
// off again after looking does not unsee them — which is the same rule Mistakes
// applies to `helped`, and for the same reason.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardPanel } from '../components/BoardPanel';
import { PositionStack } from '../components/PositionStack';
import { MoveTable } from '../components/MoveTable';
import { TrainingWheels } from '../components/TrainingWheels';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import { Move } from '../components/Move';
import { MoveList, MoveListHeader, type MoveChip } from '../components/MoveList';
import { useMoveTable } from '../hooks/useMoveTable';
import { useMoveTableToggle } from '../hooks/useMoveTableToggle';
import { useTrainingWheels } from '../hooks/useTrainingWheels';
import { useLineOverlay } from '../hooks/useLineOverlay';
import { filterMoves, effectiveSources, type MoveSource } from '../domain/moveTable';
import { arrowForRow } from './Train';
import { lineFromUci } from '../domain/line';
import { applyUci, parseSquare } from '../domain/chess';
import { colourOfFen } from '../domain/notation';
import {
	pickPuzzle,
	poolNote,
	solverColour,
	themeName,
	themePools,
	themes,
	type Puzzle,
} from '../domain/puzzles';
import { streaks } from '../domain/puzzleProgress';
import {
	giveUp,
	playMove,
	progress,
	remainingLine,
	startSolve,
	type SolveState,
} from '../domain/puzzleSolve';
import { describeRating, ratingParts, type Rating } from '../domain/glicko';
import { loadRating, record, seenIds, attempts, tally } from '../data/puzzleHistory';
import { recordMistake } from '../data/mistakes';
import { positionKey } from '../domain/chess';
import type { AssistLevel, PuzzleAttempt } from '../data/db';
import { recall, remember } from '../data/viewState';
import { Button, Chip, Note } from '../ui/primitives';
import { color, space, text } from '../ui/theme';
import type { ToolbarAction } from '../components/Toolbar';
import type { Shape } from '../components/Board';

export function Puzzles() {
	const [rating, setRating] = useState<Rating | null>(null);
	const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
	const [solve, setSolve] = useState<SolveState | null>(null);
	const [history, setHistory] = useState<PuzzleAttempt[]>([]);
	const [boardVersion, setBoardVersion] = useState(0);
	const [focus, setFocus] = useState<number | null>(null);
	const [asking, setAsking] = useState<Ask | null>(null);
	const [showing, setShowing] = useState(false);
	const busy = useRef(false);

	/*
	 * STICKY FOR THE ATTEMPT. Turning the arrows off after looking does not
	 * unsee them, which is the rule Mistakes already applies to `helped`.
	 */
	const [assist, setAssist] = useState<AssistLevel>('none');
	const raise = useCallback((level: AssistLevel) => {
		setAssist((cur) => (cur === 'moves' || level === 'moves' ? level : cur === 'none' ? level : cur));
	}, []);

	/*
	 * WHICH KINDS OF PUZZLE, AS A UNION.
	 *
	 * Will: "puzzle set options should be toggles that signal union (like the
	 * repertoire but for puzzle categories)." So this is a list, and empty means
	 * everything — the rule the Mistakes deck already uses, so that clearing every
	 * chip cannot present as an empty set.
	 *
	 * The single-theme key it replaces is still read once, so a selection made by
	 * the previous build is carried over instead of quietly reset. Validated on
	 * the way out like every other restored value: a theme the corpus no longer
	 * carries is dropped rather than left selecting nothing.
	 */
	const [selected, setSelectedState] = useState<string[]>(() => {
		const known = new Set(themes().map((t) => t.id));
		const many = recall(
			'puzzleThemes',
			(v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
		) as string[] | undefined;
		const one = recall('puzzleTheme', (v) => typeof v === 'string') as string | undefined;
		return (many ?? (one ? [one] : [])).filter((t) => known.has(t));
	});
	const setSelected = useCallback((next: string[]) => {
		setSelectedState(next);
		remember({ puzzleThemes: next });
	}, []);
	/** A stable dependency for "the drill changed", since the array is rebuilt. */
	const themeKey = selected.join(' ');

	const moveTable = useMoveTableToggle();
	const lineOverlay = useLineOverlay();
	const shownFen = lineOverlay.board?.fen ?? solve?.fen ?? '';
	const wheels = useTrainingWheels(shownFen, focus, true);
	const mover = shownFen ? colourOfFen(shownFen, 'w') : 'w';
	const table = useMoveTable(moveTable.shown ? shownFen || null : null, mover, moveTable.shown);

	// Using either kind of help marks the attempt — see the header.
	useEffect(() => {
		if (moveTable.shown) raise('moves');
	}, [moveTable.shown, raise]);
	useEffect(() => {
		if (wheels.active && wheels.on.size > 0) raise('wheels');
	}, [wheels.active, wheels.on, raise]);

	const [tableOn, setTableOn] = useState<ReadonlySet<MoveSource>>(new Set(['engine']));

	const next = useCallback(
		async (r?: Rating) => {
			if (busy.current) return;
			busy.current = true;
			try {
				const now = r ?? (await loadRating());
				const seen = await seenIds();
				const p = pickPuzzle(now, { themes: selected, seen });
				setRating(now);
				setPuzzle(p);
				setSolve(p ? startSolve(p) : null);
				setAssist('none');
				setShowing(false);
				setFocus(null);
				setAsking(null);
				lineOverlay.close();
				moveTable.close();
				setBoardVersion((v) => v + 1);
			} finally {
				busy.current = false;
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[themeKey],
	);

	useEffect(() => {
		void (async () => {
			setHistory(await attempts());
			await next();
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// A theme change is a different drill, so it serves a new puzzle rather than
	// leaving the old one up under a filter it may not pass.
	const firstRun = useRef(true);
	useEffect(() => {
		if (firstRun.current) {
			firstRun.current = false;
			return;
		}
		void next();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [themeKey]);

	async function onMove(uci: string) {
		if (!solve || !puzzle || !rating || solve.status !== 'solving' || lineOverlay.overlay) return;
		const before = solve;
		const out = playMove(before, uci);
		setSolve(out.state);
		if (out.verdict === 'wrong') setBoardVersion((v) => v + 1);
		if (out.state.status === 'solving') return;
		await finish(before, out.state.status === 'solved', uci);
	}

	/**
	 * Write down how it ended, whichever way it ended.
	 *
	 * One path for solving, for playing a wrong move and for giving up, because
	 * all three produce the same two things — a rated attempt and, on a failure,
	 * a card — and three copies of that is three chances for them to disagree
	 * about what a failure is.
	 */
	async function finish(before: SolveState, solved: boolean, playedUci: string | null) {
		if (!puzzle || !rating) return;
		const done = await record({
			puzzle,
			solved,
			assist,
			movesMade: progress(before).done,
			rating,
		});
		setRating(done.rating);
		setHistory(await attempts());

		/*
		 * A FAILED PUZZLE BECOMES A CARD.
		 *
		 * Will: "failed puzzles into the Mistakes deck". The deck's own argument:
		 * a puzzle you got wrong and never saw again was a measurement, not a
		 * lesson. The card stores the position you faced and the move you missed,
		 * which is exactly the shape every other card has — so it needs no special
		 * handling there beyond its category.
		 */
		if (!solved) {
			const want = before.puzzle.moves[before.at];
			let wantSan = want;
			try {
				wantSan = applyUci(before.fen, want).san;
			} catch {
				/* keep the uci */
			}
			let playedSan = playedUci ?? 'gave up';
			if (playedUci) {
				try {
					playedSan = applyUci(before.fen, playedUci).san;
				} catch {
					/* keep the uci */
				}
			}
			void recordMistake({
				fen: before.fen,
				positionKey: positionKey(before.fen),
				ourColour: solverColour(puzzle),
				expectedUci: want,
				expectedSan: wantSan,
				playedSan,
				path: [],
				ply: 0,
				phase: 'puzzle',
				now: Date.now(),
			});
		}
	}

	function actions(): ToolbarAction[] {
		if (lineOverlay.overlay)
			return [
				{
					id: 'first',
					title: 'Back to the start of the line',
					icon: 'first',
					onClick: () => lineOverlay.setAt(-1),
				},
				{ id: 'back', title: 'Previous move', icon: 'back', onClick: () => lineOverlay.step(-1) },
				{ id: 'forward', title: 'Next move', icon: 'forward', onClick: () => lineOverlay.step(1) },
				{ id: 'resign', title: 'Stop showing the solution', icon: 'resign', onClick: lineOverlay.close },
			];
		/*
		 * TWO BUTTONS, AND WHICH TWO DEPENDS ON WHETHER IT IS OVER.
		 *
		 * ------------------------------------------------------------------------
		 * Will: "the buttons don't make sense."
		 *
		 * They did not. There were four, two of which — try again, show solution —
		 * can only do anything AFTER the attempt ends, so half the strip sat greyed
		 * out for the whole time you were actually solving; and the fourth was
		 * "skip" and "next" sharing one slot, which put a button that RECORDS A
		 * FAILURE exactly where the harmless one would be a moment later.
		 *
		 * So: while solving, the only two things there are to do — ask for help, or
		 * give up. Once it is over, one thing — the next puzzle. Try again and show
		 * solution moved into the column beside the verdict, which is where the
		 * result is already being read and where a choice about the puzzle you just
		 * finished belongs.
		 * ------------------------------------------------------------------------
		 */
		if (solve?.status !== 'solving')
			return [
				{
					id: 'skip',
					title: 'Next puzzle',
					caption: 'next',
					icon: 'skip',
					accent: true,
					onClick: () => void next(rating ?? undefined),
				},
			];
		return [
			{
				id: 'options',
				title: moveTable.title,
				icon: 'reveal',
				accent: moveTable.shown,
				onClick: moveTable.press,
			},
			{
				id: 'giveup',
				title: 'Give up on this one — it counts as a failure',
				caption: 'give up',
				icon: 'resign',
				onClick: () => {
					if (!solve) return;
					// Giving up is failing — see `giveUp`.
					const before = solve;
					setSolve(giveUp(before));
					void finish(before, false, null);
				},
			},
		];
	}

	/** Show the rest of the line on the board. Only meaningful once it is over. */
	function showSolution() {
		if (!solve) return;
		const rest = remainingLine(solve);
		if (!rest.length) return;
		setShowing(true);
		raise('moves');
		lineOverlay.show(lineFromUci(solve.fen, rest), 'The solution');
	}

	/** Put the position back. Deliberately unrated — the answer has been seen. */
	function tryAgain() {
		if (!puzzle) return;
		setSolve(startSolve(puzzle));
		setShowing(false);
		setBoardVersion((v) => v + 1);
	}

	const arrows = useMemo<Shape[]>(() => {
		if (lineOverlay.board) return lineOverlay.board.arrows;
		if (wheels.arrows.length) return wheels.arrows;
		if (!moveTable.shown) return [];
		return filterMoves(table.rows, effectiveSources(table.rows, tableOn)).flatMap((row) =>
			arrowForRow(row, table.grades, table.book),
		);
	}, [lineOverlay.board, wheels.arrows, moveTable.shown, table.rows, table.grades, table.book, tableOn]);

	if (!puzzle || !solve || !rating) {
		return <p style={{ opacity: 0.6 }}>Loading…</p>;
	}

	const at = progress(solve);
	const counts = tally(history);
	const streak = streaks(history);
	const pool = poolNote(rating, selected);
	const pools = themePools(rating);
	const solvedNow = solve.status === 'solved';
	const failedNow = solve.status === 'failed';

	return (
		<div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
			<div style={{ flex: '1 1 320px', minWidth: 0, maxWidth: 560 }}>
				<BoardPanel
					fen={shownFen}
					ourColour={solverColour(puzzle)}
					interactive={solve.status === 'solving' && !lineOverlay.overlay}
					lastMove={lineOverlay.board?.lastMove ?? solve.lastMove}
					arrows={arrows}
					onSelectSquare={(sq) =>
						setFocus((f) => {
							const n = parseSquare(sq);
							return n === undefined || f === n ? null : n;
						})
					}
					onMove={onMove}
					version={boardVersion}
					via={lineOverlay.via}
					caption={{
						path: [],
						// A puzzle is a position, not a line, so there is no opening to
						// name. What belongs here is what you are being asked.
						ply: 0,
						also: [
							`rated ${puzzle.rating}`,
							/*
							 * HOW DEEP IT GOES IS NOT OURS TO SAY.
							 *
							 * Will: "we can't write out the number of moves - that breaks the
							 * puzzle - user can't know the puzzle depth."
							 *
							 * Right, and it is worse than a spoiler: told "3 moves to find",
							 * you can rule out every quiet line and every one-move win before
							 * looking at the board, which is most of the work. It said the
							 * count here AND counted you through it in the verdict below.
							 * Both are gone; `progress` is still used, for what gets recorded.
							 */
							// ONLY WHILE IT IS STILL IN DOUBT. After the attempt is recorded
							// the warning is describing a decision already taken, and it
							// appears the moment you press "solution" — which is after the
							// rating has already moved, so it reads as a threat about
							// something that has finished happening.
							assist !== 'none' && solve.status === 'solving'
								? 'help is on — this one will not be rated'
								: null,
						],
					}}
					actions={actions()}
				>
					<PositionStack
						verdict={
							<div style={{ fontSize: text.body }}>
								{solve.status === 'solving' ? (
									<>
										<strong>{solverColour(puzzle) === 'w' ? 'White' : 'Black'} to play.</strong>{' '}
										{/* "Move 2 of 3" was here, and it gave the depth away — see
											the caption. "Keep going" says the line continues without
											saying how far, which is what you would know from the
											board anyway once a reply has been made. */}
										{at.done > 0 ? 'Good — keep going.' : 'Find the best move.'}
									</>
								) : solvedNow ? (
									<span style={{ color: color.good }}>
										<strong>Solved.</strong>{' '}
										{assist === 'none'
											? `Rating ${describeRating(rating)}.`
											: 'With help, so the rating did not move.'}
									</span>
								) : (
									<span style={{ color: color.bad }}>
										<strong>Not it.</strong> The move was{' '}
										<Move
											san={sanOrUci(solve.fen, solve.puzzle.moves[solve.at])}
											colour={solverColour(puzzle)}
											size={13}
										/>
										. Filed in your Mistakes deck.
									</span>
								)}
							</div>
						}
						moves={
							moveTable.shown ? (
								<MoveTable
									rows={table.rows}
									mover={mover}
									on={tableOn}
									offers={['engine', 'popular']}
									onToggle={(src) =>
										setTableOn((cur) => {
											const n = new Set(cur);
											if (n.has(src)) n.delete(src);
											else n.add(src);
											return n;
										})
									}
									onAsk={(uci) => setAsking({ fen: solve.fen, uci, alternatives: [] })}
									askedPopularity={table.askedPopularity}
									region="puzzle-moves"
								/>
							) : null
						}
						wheels={
							<TrainingWheels
								on={wheels.on}
								onChange={wheels.setOn}
								active={wheels.active}
								onActiveChange={wheels.setActive}
								notes={wheels.notes}
								hasFocus={focus !== null}
								working={wheels.working}
							/>
						}
						history={
							/*
							 * THE LIST THE SOLUTION IS WALKED IN.
							 *
							 * Left out of the first version, and the solution overlay had
							 * nowhere to land: `useLineOverlay` publishes chips and a label
							 * for whatever list is already on the screen — that is the whole
							 * design, one move list per tab — so a tab without one shows the
							 * board moving and says nothing about what is being shown.
							 *
							 * A puzzle has no game before it, so with nothing borrowed this
							 * is the solver's own moves so far, which is short by design and
							 * still worth having: it is what says how far in you are.
							 */
							<>
								<MoveListHeader
									title="This puzzle"
									borrowed={lineOverlay.overlay?.label}
									onClose={lineOverlay.close}
								/>
								<MoveList
									region="puzzle-move-list"
									onAsk={lineOverlay.overlay?.onAsk}
									chips={lineOverlay.chips ?? playedChips(solve)}
									currentPly={lineOverlay.overlay ? lineOverlay.overlay.at : solve.at - 1}
									onJump={lineOverlay.overlay ? lineOverlay.setAt : undefined}
								/>
							</>
						}
						explain={
							asking ? (
								<ExplainPanel
									{...asking}
									onShowLine={lineOverlay.show}
									onClose={() => {
										setAsking(null);
										lineOverlay.close();
									}}
								/>
							) : null
						}
					/>
				</BoardPanel>
			</div>

			<div style={{ flex: '1 1 300px', minWidth: 0 }}>
				<h3 style={{ marginTop: 0 }}>Your puzzle rating</h3>
				{/*
				 * THE NUMBER BIG, THE UNCERTAINTY SMALL.
				 *
				 * Will: "the ratings row is not formatted nicely - line break, because
				 * it does not fit screen width." `describeRating` is one sentence —
				 * "1500 — still finding your level (±350)" — and at 30px that is 400
				 * points of text in a 300px column, so it broke mid-phrase. The two
				 * halves are two facts and they are now drawn as two, which needs no
				 * width at all. `ratingParts` is the split; `describeRating` still
				 * composes the sentence for the places that want one line.
				 */}
				<div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>
					{ratingParts(rating).value}
				</div>
				{ratingParts(rating).qualifier && (
					<div style={{ fontSize: text.note, color: color.ink2 }}>
						{ratingParts(rating).qualifier}
					</div>
				)}
				<Note style={{ marginTop: space.snug }}>
					{counts.rated.total === 0
						? 'Solve a few and this settles. It starts wide on purpose — a rating with no evidence behind it should say so.'
						: `${counts.rated.solved} of ${counts.rated.total} rated attempts solved.` +
							(counts.helped.total
								? ` ${counts.helped.total} more solved with help, which the rating leaves out.`
								: '')}
				</Note>

				{/*
				 * THE STREAK, AND WHY IT IS NOT THE HEADLINE.
				 *
				 * A streak measures how well the app has matched you lately as much as
				 * it measures you — the band is centred so that you solve most of what
				 * you are given, so a long one is partly the selection working. Worth
				 * showing, worth keeping small, and it is silent until there is one.
				 */}
				{streak.best > 0 && (
					<div style={{ marginTop: space.snug, fontSize: text.note, color: color.ink2 }}>
						{streak.current > 0 ? (
							<>
								<strong style={{ color: streak.current > 2 ? color.good : color.ink }}>
									{streak.current} in a row
								</strong>{' '}
								· best {streak.best}
							</>
						) : (
							<>Streak broken · best {streak.best}</>
						)}
					</div>
				)}

				<h3>What to practise</h3>
				{/*
				 * TOGGLES, AND THEY UNION.
				 *
				 * Will: "puzzle set options should be toggles that signal union (like
				 * the repertoire but for puzzle categories)." A `<select>` could only
				 * ever mean one, and one is the wrong shape for this: a puzzle carries
				 * two or three themes, so "forks and pins" is a real drill while the
				 * intersection of them is a handful in the whole corpus.
				 *
				 * The same `Chip` the deck's categories and the move table's filters
				 * use — pressing them has to feel the same because it means the same
				 * thing. Nothing selected is EVERYTHING, so clearing the last chip
				 * cannot look like an empty set.
				 *
				 * Each chip carries two numbers: how many of that theme sit near your
				 * rating, of how many exist. That is the honest thing to show beside a
				 * filter whose cost is invisible — see the note below it.
				 */}
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
					{pools.map((t) => {
						const on = selected.includes(t.id);
						return (
							<Chip
								key={t.id}
								on={on}
								onClick={() =>
									setSelected(on ? selected.filter((s) => s !== t.id) : [...selected, t.id])
								}
								title={`${themeName(t.id)} — ${t.near} of ${t.count} sit near your rating.`}
							>
								{themeName(t.id)} <span style={{ opacity: 0.7 }}>{t.near}</span>
							</Chip>
						);
					})}
				</div>
				{selected.length > 0 && (
					<div style={{ marginTop: space.snug }}>
						<Button kind="quiet" onClick={() => setSelected([])}>
							Every kind of puzzle
						</Button>
					</div>
				)}
				{/*
				 * MEASURED, NOT WARNED-ABOUT IN GENERAL.
				 *
				 * This was a fixed sentence under every theme — "the pool is smaller, so
				 * the puzzles may sit further from your rating" — which is true of no
				 * theme in particular and so says nothing about the one you picked.
				 * `poolNote` counts what your band actually holds: it stays quiet when
				 * there is plenty, reports the number when there is, and only raises its
				 * voice when the selection is about to serve you difficulty you did not
				 * choose. See `domain/puzzles`.
				 */}
				{pool && (
					<Note
						style={{ marginTop: space.snug, ...(pool.tone === 'warn' ? { color: color.bad } : {}) }}
					>
						{pool.text}
					</Note>
				)}

				{/*
				 * WHAT TO DO WITH THE ONE YOU JUST FINISHED.
				 *
				 * Two identical `Next puzzle` blocks used to sit here, one per outcome,
				 * which is two chances to change one of them. And the other two choices
				 * — try again, show solution — were greyed-out icons in the board strip
				 * the whole time you were solving. They are here now, beside the verdict
				 * that makes them mean something, and only once there is a verdict.
				 */}
				{(solvedNow || failedNow) && (
					<div
						style={{
							marginTop: space.card,
							display: 'flex',
							gap: space.snug,
							flexWrap: 'wrap',
							alignItems: 'center',
						}}
					>
						<Button kind="primary" onClick={() => void next(rating)}>
							Next puzzle
						</Button>
						<Button kind="quiet" onClick={tryAgain}>
							Try it again
						</Button>
						{remainingLine(solve).length > 0 && (
							<Button kind="quiet" onClick={showSolution}>
								{showing ? 'Showing the solution' : 'Show the solution'}
							</Button>
						)}
					</div>
				)}

				<h3>Recently</h3>
				{!history.length ? (
					<Note>Nothing yet.</Note>
				) : (
					<ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: text.note }}>
						{history.slice(0, 12).map((a) => (
							<li
								key={a.id}
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									gap: space.snug,
									padding: '3px 0',
									borderBottom: `1px solid ${color.line}`,
								}}
							>
								<span style={{ color: a.solved ? color.good : color.bad }}>
									{a.solved ? 'solved' : 'missed'} {a.puzzleRating}
									{a.assist !== 'none' && (
										<span style={{ color: color.ink3 }}> · with help</span>
									)}
								</span>
								<span style={{ color: color.ink2 }}>{Math.round(a.ratingAfter)}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/**
 * The moves played so far in this puzzle, as chips.
 *
 * Including the opponent's opening move, because it is the reason the position
 * is worth anything — a list starting after it would begin mid-sentence.
 */
function playedChips(state: SolveState): MoveChip[] {
	const out: MoveChip[] = [];
	let fen = state.puzzle.fen;
	for (let i = 0; i < state.at && i < state.puzzle.moves.length; i++) {
		let san = state.puzzle.moves[i];
		try {
			const r = applyUci(fen, san);
			san = r.san;
			fen = r.fen;
		} catch {
			break;
		}
		out.push({
			san,
			ply: i + 1,
			mistake: false,
			suboptimal: false,
			white: fen.split(' ')[1] === 'b',
		});
	}
	return out;
}

function sanOrUci(fen: string, uci: string | undefined): string {
	if (!uci) return '';
	try {
		return applyUci(fen, uci).san;
	} catch {
		return uci;
	}
}

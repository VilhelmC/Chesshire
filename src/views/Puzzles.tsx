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
import { describeRating, type Rating } from '../domain/glicko';
import { loadRating, record, seenIds, attempts, tally } from '../data/puzzleHistory';
import { recordMistake } from '../data/mistakes';
import { positionKey } from '../domain/chess';
import type { AssistLevel, PuzzleAttempt } from '../data/db';
import { recall, remember } from '../data/viewState';
import { Button, Note, Select } from '../ui/primitives';
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

	const [theme, setThemeState] = useState<string | null>(
		() => (recall('puzzleTheme', (v) => typeof v === 'string') as string) || null,
	);
	const setTheme = useCallback((next: string | null) => {
		setThemeState(next);
		remember({ puzzleTheme: next ?? '' });
	}, []);

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
				const p = pickPuzzle(now, { theme, seen });
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
		[theme],
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
	}, [theme]);

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
		const over = solve?.status !== 'solving';
		return [
			{
				id: 'options',
				title: moveTable.title,
				icon: 'reveal',
				accent: moveTable.shown,
				onClick: moveTable.press,
			},
			{
				id: 'branch',
				title: 'Try this one again — it will not be rated',
				caption: 'try again',
				icon: 'branch',
				onClick: () => {
					if (!puzzle) return;
					setSolve(startSolve(puzzle));
					setShowing(false);
					setBoardVersion((v) => v + 1);
				},
				disabled: !over,
			},
			{
				id: 'playon',
				title: 'Show the rest of the solution on the board',
				caption: 'solution',
				icon: 'playon',
				accent: showing,
				onClick: () => {
					if (!solve) return;
					const rest = remainingLine(solve);
					if (!rest.length) return;
					setShowing(true);
					raise('moves');
					lineOverlay.show(lineFromUci(solve.fen, rest), 'The solution');
				},
				disabled: !over || !remainingLine(solve ?? startSolve(puzzle!)).length,
			},
			{
				id: 'skip',
				title: over ? 'Next puzzle' : 'Skip this one — it counts as a failure',
				caption: over ? 'next' : 'skip',
				icon: 'skip',
				onClick: () => {
					if (over) return void next(rating ?? undefined);
					if (!solve) return;
					// Skipping is failing — see `giveUp`.
					const before = solve;
					setSolve(giveUp(before));
					void finish(before, false, null);
				},
			},
		];
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
	const pool = poolNote(rating, theme);
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
							at.total > 1 ? `${at.total} moves to find` : 'one move to find',
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
										{at.total > 1 ? `Move ${at.done + 1} of ${at.total}.` : 'Find the move.'}
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
				<div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>
					{describeRating(rating)}
				</div>
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
				<Select
					label="Theme"
					value={theme ?? ''}
					onChange={(v) => setTheme(v || null)}
					options={[
						{ id: '', label: 'Everything' },
						...themes().map((t) => ({ id: t.id, label: `${themeName(t.id)} (${t.count})` })),
					]}
				/>
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

				{failedNow && (
					<div style={{ marginTop: space.card }}>
						<Button kind="primary" onClick={() => void next(rating)}>
							Next puzzle
						</Button>
					</div>
				)}
				{solvedNow && (
					<div style={{ marginTop: space.card }}>
						<Button kind="primary" onClick={() => void next(rating)}>
							Next puzzle
						</Button>
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

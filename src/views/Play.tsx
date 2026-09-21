// A board you can play on.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A TAB AND NOT A MODE OF THE TRAINER.
//
// Will: "worth considering if free play is its own tab, so when we press free
// play what is really happening is we're switching tabs and loading that
// position? That would be the same tab we use to play games against bot,
// perhaps explore (just assign human player to both sides), and play against
// friends online?"
//
// The argument that decided it is not "free play is not training". It is that
// TWO OF THE THREE DOORS INTO TRAIN ALREADY WANTED ONLY HALF OF IT. Review
// hands over a position to play out; Mistakes hands over a card to play out;
// neither wants a drill. Train had quietly become the app's board as well as
// its trainer, and the board half was what everything else kept borrowing.
//
// The measurement backed it up. `RunState.mode` split "is this a drill" from
// "where in the drill", and `data/outcome` took the recording out of the move
// handler — about half of it turned out to be spaced-repetition bookkeeping
// that means nothing in a game. What is left here is genuinely thin, and it is
// thin because the surface was extracted first: `BoardPanel` holds the board
// and the strip, `PositionStack` holds the order, and the four hooks below are
// the same ones the trainer and the mistake deck use.
//
// ---------------------------------------------------------------------------
// WHAT IT DELIBERATELY DOES NOT HAVE.
//
// No online play. Everything in this app is local plus a read-only Lichess
// explorer; there is no transport and no server, and adding one is an
// architecture decision rather than a tab. So this is built so it does not
// DEPEND on that ever landing: `opponent` is a session setting with two values
// today, and a third would be a new value rather than a new screen.
//
// No strictness, no repertoire, no scheduler, no expected set. Those are the
// drill's, and the whole point of the split is that they stay there.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	playFrom,
	submitMove,
	type RunState,
	type SessionConfig,
} from '../engine/session';
import { applyUci, INITIAL_FEN, parseSquare } from '../domain/chess';
import { BoardPanel } from '../components/BoardPanel';
import { PositionStack } from '../components/PositionStack';
import { MoveTable } from '../components/MoveTable';
import { MoveList, MoveListHeader, type MoveChip } from '../components/MoveList';
import { TrainingWheels } from '../components/TrainingWheels';
import { Commentary } from '../components/CommentaryPanel';
import { GameStats } from '../components/GameStats';
import { ShareMenu, shareItemsFor } from '../components/ShareMenu';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import { useMoveTable } from '../hooks/useMoveTable';
import { useTrainingWheels } from '../hooks/useTrainingWheels';
import { useLineOverlay } from '../hooks/useLineOverlay';
import { useStepBack } from '../hooks/useStepBack';
import { useCommentary } from '../hooks/useCommentary';
import { filterMoves, effectiveSources, type MoveSource } from '../domain/moveTable';
import { arrowForRow } from './Train';
import { recordOutcome } from '../data/outcome';
import { loadPractice } from '../domain/practice';
import { BOT_LEVELS, levelFor, estimate } from '../domain/rating';
import { freeplayLosses } from '../domain/progress';
import { loadProgress } from '../data/progress';
import { recall, remember } from '../data/viewState';
import { colourOfFen, other } from '../domain/notation';
import { Button, Note, Segmented, Select } from '../ui/primitives';
import { color, space, text } from '../ui/theme';
import type { ToolbarAction } from '../components/Toolbar';
import type { Shape } from '../components/Board';

/** A position handed over by another tab. The same shape Train takes. */
export type PlayHandoff = { moves: string[]; ply: number; ourColour: 'w' | 'b' } | null;

type Opponent = 'engine' | 'none';

const OPPONENTS: { id: Opponent; label: string; title: string }[] = [
	{ id: 'engine', label: 'Against the engine', title: 'Stockfish answers, at the strength you pick' },
	{
		id: 'none',
		label: 'Explore',
		title: 'Nobody answers — move both colours and try things out',
	},
];

export function Play({
	handoff,
	onHandoffUsed,
}: {
	handoff?: PlayHandoff;
	onHandoffUsed?: () => void;
}) {
	const [state, setState] = useState<RunState | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/*
	 * WHAT EACH OF OUR MOVES GAVE UP, THIS GAME.
	 *
	 * Kept in the view rather than on `RunState` because it is not the session's
	 * business: the session decides what happens next, and this is a record of
	 * what already did. Reset with the game, not with the position, which is why
	 * it is not derived from `state.path`.
	 */
	const [losses, setLosses] = useState<number[]>([]);
	const busyRef = useRef(false);
	const runId = useRef<string>('');

	const [opponent, setOpponentState] = useState<Opponent>(
		() => (recall('playOpponent', (v) => v === 'engine' || v === 'none') as Opponent) ?? 'engine',
	);
	const setOpponent = useCallback((o: Opponent) => {
		setOpponentState(o);
		remember({ playOpponent: o });
	}, []);

	/*
	 * PERSISTED, unlike the trainer's copy of this.
	 *
	 * It was `useState('auto')` there and written nowhere, so picking an
	 * opponent lasted until the next reload. A setting that silently resets is
	 * worse than one that is not offered: you stop trusting the ones that do
	 * stick.
	 */
	const [botLevel, setBotLevelState] = useState<number | 'auto'>(
		() =>
			(recall(
				'botLevel',
				(v) => v === 'auto' || (typeof v === 'number' && v >= 1 && v <= BOT_LEVELS.length),
			) as number | 'auto' | undefined) ?? 'auto',
	);
	const setBotLevel = useCallback((v: number | 'auto') => {
		setBotLevelState(v);
		remember({ botLevel: v });
	}, []);

	/** Your own estimate, so "match me" has something to match. */
	const [elo, setElo] = useState<number | null>(null);
	useEffect(() => {
		void (async () => {
			try {
				const { answers } = await loadProgress();
				const e = estimate(freeplayLosses(answers));
				setElo(e.confident ? e.elo : null);
			} catch {
				/* no history is a fine reason to have no estimate */
			}
		})();
	}, []);

	const bot = botLevel === 'auto' ? levelFor(elo) : BOT_LEVELS[botLevel - 1];

	const cfg: SessionConfig = useMemo(
		() => ({
			practice: loadPractice(),
			bot: { window: bot.window, movetimeMs: bot.movetimeMs },
			opponent,
		}),
		[bot.window, bot.movetimeMs, opponent],
	);

	/** Start a game from a position, or from the beginning. */
	const start = useCallback(
		async (moves: string[], ply: number, ourColour: 'w' | 'b') => {
			if (busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			setError(null);
			try {
				runId.current = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				setLosses([]);
				setState(await playFrom(moves, ply, ourColour, cfg, 'free'));
			} catch (e) {
				setError((e as Error).message);
			} finally {
				busyRef.current = false;
				setBusy(false);
			}
		},
		[cfg],
	);

	// A position handed over by Review, Mistakes or the trainer. Consumed once —
	// `onHandoffUsed` clears it, so switching back later does not replay it.
	useEffect(() => {
		if (!handoff) return;
		void start(handoff.moves, handoff.ply, handoff.ourColour).then(() => onHandoffUsed?.());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [handoff]);

	useEffect(() => {
		if (!state && !handoff) void start([], 0, 'w');
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const [focus, setFocus] = useState<number | null>(null);
	const [asking, setAsking] = useState<Ask | null>(null);
	const [boardVersion, setBoardVersion] = useState(0);
	const [tableShown, setTableShownState] = useState<boolean>(
		() => recall('tableShown', (v) => typeof v === 'boolean') === true,
	);
	const setTableShown = useCallback((next: boolean) => {
		setTableShownState(next);
		remember({ tableShown: next });
	}, []);
	/*
	 * THE SCORING PANEL, under the same key Review uses.
	 *
	 * Will: "the statistics shown in review could be togglable since they really
	 * apply to any game?" They apply to this one while it is still being played —
	 * every number in the panel is computed from centipawn losses, and this game
	 * is producing them a move at a time. Off by default HERE and on by default
	 * in Review, until you say otherwise: a running accuracy is worth being able
	 * to see and not worth being shown a percentage after every move.
	 */
	const [statsShown, setStatsShownState] = useState<boolean>(
		() => recall('statsShown', (v) => typeof v === 'boolean') === true,
	);
	const setStatsShown = useCallback((next: boolean) => {
		setStatsShownState(next);
		remember({ statsShown: next });
	}, []);
	const [tableOn, setTableOnState] = useState<ReadonlySet<MoveSource>>(
		() =>
			new Set(
				(recall('tableOn', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')) ?? [
					'line',
					'engine',
					'popular',
				]).filter((k): k is MoveSource => k === 'line' || k === 'engine' || k === 'popular'),
			),
	);
	const setTableOn = useCallback(
		(next: (cur: ReadonlySet<MoveSource>) => ReadonlySet<MoveSource>) => {
			setTableOnState((cur) => {
				const v = next(cur);
				remember({ tableOn: [...v] });
				return v;
			});
		},
		[],
	);

	const lineOverlay = useLineOverlay();
	/*
	 * LOOKING BACK THROUGH THE GAME, which is not taking a move back.
	 *
	 * Will: "it should just step back so user can review history by stepping
	 * through it. Game remains in current position and user can only play on from
	 * that position. So no concession needed." See `hooks/useStepBack` for why
	 * that answer makes the whole question of what a take back costs go away.
	 */
	const back = useStepBack(state?.path ?? []);
	const [sharing, setSharing] = useState(false);
	/*
	 * A BORROWED LINE OUTRANKS LOOKING BACK, which outranks the game.
	 *
	 * Three things can claim the board and only one can have it. Ordered by how
	 * deliberate the act was: an explanation was asked for just now, stepping
	 * back was asked for a moment ago, and the game is what is there when neither
	 * is. Deciding this once, here, is why the arrows, the caption and the
	 * position cannot end up describing three different plies.
	 */
	const shownFen = lineOverlay.board?.fen ?? back.fen ?? state?.fen ?? INITIAL_FEN;
	const wheels = useTrainingWheels(shownFen, focus, !busy);
	const commentary = useCommentary(shownFen, asking?.fen === shownFen ? asking.uci : null);

	/*
	 * WHOSE MOVE IT IS, which is a different question here than in the trainer.
	 *
	 * Against the engine you are one colour and it is the other. Exploring, you
	 * are both — so the side to move is simply whoever is to move, and the board
	 * accepts either. `RunState.ourColour` still names the side the SESSION was
	 * started as, which is what an evaluation is reported from.
	 */
	const mover = colourOfFen(shownFen, state?.ourColour ?? 'w');
	const table = useMoveTable(tableShown ? (state?.fen ?? null) : null, mover, tableShown);

	const arrows = useMemo<Shape[]>(() => {
		if (lineOverlay.board) return lineOverlay.board.arrows;
		if (wheels.arrows.length) return wheels.arrows;
		if (!tableShown) return [];
		return filterMoves(table.rows, effectiveSources(table.rows, tableOn)).flatMap((row) =>
			arrowForRow(row, table.grades, table.book),
		);
	}, [lineOverlay.board, wheels.arrows, tableShown, table.rows, table.grades, table.book, tableOn]);

	async function onMove(uci: string) {
		if (!state || busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		const before = state;
		try {
			const out = await submitMove(state, cfg, uci);
			setState(out.state);
			/*
			 * EXPLORING WRITES NOTHING DOWN.
			 *
			 * Free play against the engine is the only source feeding the rating
			 * estimate, and it earns that by being a real game against a real
			 * opponent at a known strength. Moving both colours yourself is not
			 * that: half the moves are not yours in any sense the estimate could
			 * use, and `ourColour` flips meaning as you go. Logging it would
			 * quietly corrupt the one measurement with real history behind it.
			 */
			if (opponent === 'engine') {
				recordOutcome({
					before,
					out,
					uci,
					runId: runId.current,
					assisted: tableShown && tableOn.size > 0,
					revealed: false,
					// A game has no "encounter" to log once per — every move is its own
					// row. The flags are fresh each time and nothing reads them back.
					once: { logged: false, mistake: false },
					sanOf: (fen, u) => {
						try {
							return applyUci(fen, u).san;
						} catch {
							return u;
						}
					},
				});
			}
			/*
			 * THE ONLY NUMBERS THE LIVE SCORING PANEL GETS.
			 *
			 * One list, from one source: `submitMove` measures our move with
			 * `scoreMove`, which runs BOTH of its evaluations at the same budget —
			 * see `engine/score.ts` for why that matters and what it cost when it
			 * was not true. A negative loss is the sentinel for "could not be
			 * measured" and must not be averaged in as a zero.
			 *
			 * Nothing here scores the ENGINE's moves, and that is deliberate: see
			 * `components/GameStats`.
			 */
			if (opponent === 'engine' && out.cpLoss >= 0) setLosses((l) => [...l, out.cpLoss]);
			if (!out.correct) setBoardVersion((v) => v + 1);
		} catch (e) {
			setError((e as Error).message);
			setBoardVersion((v) => v + 1);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	}

	const chips = (): MoveChip[] =>
		(state?.path ?? []).map((san, i) => ({
			san,
			ply: i + 1,
			mistake: false,
			suboptimal: false,
			white: i % 2 === 0,
		}));

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
				{ id: 'resign', title: 'Stop showing this line', icon: 'resign', onClick: lineOverlay.close },
			];
		return [
			{
				/*
				 * THE START OF THE GAME, NOT A NEW ONE.
				 *
				 * This used to begin a fresh game, which is "New game" in the panel
				 * on the right and did not need a second door in the strip. In a
				 * strip whose next two cells are `back` and `forward`, the first cell
				 * means the start of what those are stepping through — it means that
				 * in every media player anyone has used, and it meant something else
				 * here only because there was nothing to step through yet.
				 */
				id: 'first',
				title: 'Back to the start of the game',
				icon: 'first',
				onClick: back.first,
				disabled: busy || !back.canBack,
			},
			{
				id: 'back',
				title: 'Look at the previous move',
				icon: 'back',
				onClick: () => back.step(-1),
				disabled: busy || !back.canBack,
			},
			{
				id: 'forward',
				// Not "replay the move you took back": nothing was taken back, and
				// the last press of this hands the board back to the game.
				title: back.at !== null ? 'Look at the next move' : 'Next move',
				icon: 'forward',
				onClick: () => back.step(1),
				disabled: busy || !back.canForward,
			},
			{
				id: 'options',
				title: tableShown ? 'Hide the moves' : 'Show the moves on the board',
				icon: 'reveal',
				accent: tableShown,
				onClick: () => setTableShown(!tableShown),
				disabled: busy,
			},
			/*
			 * NOT OFFERED WHILE EXPLORING. Nothing is measured there — see
			 * `SessionConfig.opponent` — so the panel would have an empty list to
			 * average and would say "not scored" for as long as you kept playing,
			 * which reads as a broken panel rather than as an honest one.
			 */
			...(opponent === 'engine'
				? [
						{
							id: 'stats',
							title: statsShown ? 'Hide the scoring' : 'Show how this game has gone',
							icon: 'stats' as const,
							accent: statsShown,
							onClick: () => setStatsShown(!statsShown),
						},
					]
				: []),
			{
				id: 'share',
				title: 'Copy or share this position',
				icon: 'share',
				onClick: () => setSharing((v) => !v),
				accent: sharing,
				disabled: !state?.path.length,
			},
		];
	}

	return (
		<div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
			<div style={{ flex: '1 1 320px', minWidth: 0, maxWidth: 560 }}>
				<BoardPanel
					fen={shownFen}
					ourColour={state?.ourColour ?? 'w'}
					evalCp={state?.evalNow ?? null}
					caption={{
						// Follows the board, not the game — see Train, same slice.
						path: back.live ? (state?.path ?? []) : (state?.path ?? []).slice(0, back.at ?? 0),
						opening: back.live ? (state?.opening?.name ?? null) : null,
						also: [
							back.live
								? null
								: 'looking back — step forward to play on',
							// Which game this is. The board looks identical in both modes
							// and the only thing that differs is whether anything answers,
							// which is worth saying next to the position rather than only
							// in the picker on the other side of the screen.
							opponent === 'none' ? 'exploring — you move both sides' : null,
							state?.finished ? state.note : null,
						],
					}}
					/*
					 * ONLY THE LIVE POSITION TAKES A MOVE.
					 *
					 * Will: "game remains in current position and user can only play on
					 * from that position." Same rule Mistakes applies to a card's
					 * run-up. Without it, stepping back and playing would silently be a
					 * take back — the thing this is deliberately not.
					 */
					interactive={!busy && !lineOverlay.overlay && back.live}
					// EXPLORING MOVES BOTH COLOURS. The board already had this — it is
					// what the Lab's sandbox uses — so it needed no new machinery.
					movableColor={opponent === 'none' ? 'both' : 'auto'}
					lastMove={lineOverlay.board?.lastMove ?? back.lastMove}
					arrows={arrows}
					onSelectSquare={(sq) =>
						setFocus((f) => {
							const n = parseSquare(sq);
							return n === undefined || f === n ? null : n;
						})
					}
					onMove={onMove}
					version={boardVersion}
					via={lineOverlay.via ?? back.via}
					actions={actions()}
					busy={busy}
				>
					<PositionStack
						popover={
							sharing && state ? (
								<ShareMenu items={shareItemsFor(state)} onClose={() => setSharing(false)} />
							) : null
						}
						verdict={
							<>
								{state?.finished && (
									<div style={{ fontWeight: 600, color: color.good }}>{state.note}</div>
								)}
								{error && <div style={{ color: color.bad, fontSize: text.body }}>{error}</div>}
							</>
						}
						moves={
							tableShown && state ? (
								<>
									<h3 style={{ margin: 0, fontSize: text.heading }}>Moves here</h3>
									<MoveTable
										rows={table.rows}
										mover={mover}
										on={tableOn}
										offers={['line', 'engine', 'popular']}
										onToggle={(src) =>
											setTableOn((cur) => {
												const n = new Set(cur);
												if (n.has(src)) n.delete(src);
												else n.add(src);
												return n;
											})
										}
										onAsk={(uci) =>
											state && setAsking({ fen: state.fen, uci, alternatives: table.rows.map((r) => r.uci) })
										}
										askedPopularity={table.askedPopularity}
										marksBook
										region="play-moves"
									/>
								</>
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
						commentary={<Commentary state={commentary} region="play-commentary" />}
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
						stats={
							statsShown && opponent === 'engine' ? (
								<GameStats ours={losses} title="How it has gone" region="play-stats" />
							) : null
						}
						history={
							<>
								<MoveListHeader
									title="Moves so far"
									borrowed={lineOverlay.overlay?.label}
									onClose={lineOverlay.close}
								/>
								<MoveList
									region="play-move-list"
									onAsk={lineOverlay.overlay?.onAsk}
									chips={lineOverlay.chips ?? chips()}
									currentPly={
										lineOverlay.overlay
											? lineOverlay.overlay.at
											: (back.at ?? state?.path.length ?? 0)
									}
									/*
									 * THE LIST IS A STEPPER TOO, and it always was — clicking a
									 * move is the same act as pressing `back` several times, and
									 * offering one without the other is how a reader concludes
									 * the list is decoration.
									 */
									onJump={lineOverlay.overlay ? lineOverlay.setAt : (ply) => back.step(ply - (back.at ?? (state?.path.length ?? 0)))}
								/>
							</>
						}
					/>
				</BoardPanel>
			</div>

			<div style={{ flex: '1 1 300px', minWidth: 0 }}>
				<h3 style={{ marginTop: 0 }}>Who you are playing</h3>
				<Segmented
					label="Who answers"
					options={OPPONENTS}
					value={opponent}
					onChange={setOpponent}
				/>

				{opponent === 'engine' ? (
					<div style={{ marginTop: space.card }}>
						<h3>Engine strength</h3>
						<Select
							label="Engine strength"
							value={String(botLevel)}
							onChange={(v) => setBotLevel(v === 'auto' ? 'auto' : Number(v))}
							options={[
								{
									id: 'auto',
									label: elo ? `Match me (~${elo})` : 'Match me (no estimate yet)',
								},
								...BOT_LEVELS.map((l) => ({
									id: String(l.level),
									label: `${l.label} (~${l.elo})`,
								})),
							]}
						/>
						<Note style={{ marginTop: space.tight }}>
							Games here are the only ones that feed your rating estimate — a real
							opponent at a known strength is the one thing it can be measured
							against. Showing the moves counts as help, and a helped game is kept
							out of it.
						</Note>
					</div>
				) : (
					<Note style={{ marginTop: space.card }}>
						Nobody is answering: you move both colours. Nothing here is recorded —
						half the moves are not yours in any sense the rating could use.
					</Note>
				)}

				<h3>The position</h3>
				<Note>
					{/*
					  * NO COUNT HERE ANY MORE. It read "5 moves played" off
					  * `path.length`, which is FIVE HALF-MOVES — so this panel said 5
					  * while the caption above the board said move 3, about the same
					  * position. Two counts of the same thing in two units is worse
					  * than one, and the caption is the one every tab shows.
					  */}
					{/*
					  * SAYS WHAT THE BOARD IS SHOWING, not what the game is doing.
					  *
					  * While you are stepping back these are two different positions,
					  * and a panel headed "The position" that describes the other one
					  * is the same split that put two different move counts on this
					  * screen a moment ago.
					  */}
					{!state
						? 'Starting…'
						: back.live
							? `${mover === 'w' ? 'White' : 'Black'} to move${
									opponent === 'engine' && mover === other(state.ourColour)
										? ' (the engine)'
										: ''
								}`
							: 'Looking back through the game. Step forward to play on.'}
				</Note>
				<div style={{ marginTop: space.card }}>
					<Button onClick={() => void start([], 0, 'w')} disabled={busy}>
						New game
					</Button>
				</div>
			</div>
		</div>
	);
}

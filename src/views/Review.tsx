// Game review: your past games, and the runs you did in here, replayed with the
// evaluation and the annotations attached.
//
// Deliberately built on what was already recorded rather than re-analysing from
// scratch — every position in a run was evaluated as it was played, so a review
// is a read of stored data, not a second engine pass.
//
// ---------------------------------------------------------------------------
// The list is the screen; the board is what you get after choosing from it.
//
// This was a dropdown, which is the wrong control for the job twice over. A
// dropdown shows one item at a time, so choosing between twenty games means
// opening it and reading them one line at a time with no accuracy, no result
// and no way to compare. And it hides the fact that anything is there at all —
// the honest answer to "what have I played?" is a list you can look at.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../components/Board';
import { MoveList, type MoveChip } from '../components/MoveList';
import { EvalBar } from '../components/EvalBar';
import { PositionCaption } from '../components/PositionCaption';
import { EvalGraph } from '../components/EvalGraph';
import { loadProgress } from '../data/progress';
import { applySan, INITIAL_FEN } from '../domain/chess';
import { QUALITY_COLOUR, QUALITY_LABEL } from '../domain/review';
import { GameStats } from '../components/GameStats';
import {
	annotate,
	lossesOf,
	punishTally,
	signed,
	type Annotation,
} from '../domain/annotate';
import type { AnswerRow } from '../domain/progress';
import { reviewables, summarise, type Reviewable, type ReviewSource } from '../domain/reviewable';
import { db, type ImportedGameRow } from '../data/db';
import { color, space, radius, text, TOUCH } from '../ui/theme';
import { Button, Empty, Segmented } from '../ui/primitives';
import { recall, remember } from '../data/viewState';

const INK = color.ink;
const INK_2 = color.ink2;
const GRID = color.line;

export function Review({
	onPlayFrom,
}: {
	onPlayFrom?: (h: { moves: string[]; ply: number; ourColour: 'w' | 'b' }) => void;
}) {
	// Runs AND imported games — the real ones are the ones most worth reviewing,
	// and they were previously reachable only as isolated mistake cards with no
	// way to see how the position came about.
	const [items, setItems] = useState<Reviewable[]>([]);
	const [answers, setAnswers] = useState<AnswerRow[]>([]);
	// Null means the list. Nothing is opened for you: which game to look at is
	// the choice this screen exists to offer.
	/*
	 * WHICH GAME, AND WHERE IN IT — kept across leaving the tab.
	 *
	 * Will: "review should also persist." Same cause as Mistakes and Play: `App`
	 * unmounts a tab when you leave it, so a game you were twenty plies into was
	 * closed by glancing at Progress, and the list you had scrolled to came back
	 * from the top.
	 *
	 * The empty string means the LIST, which is a real place and the one you get
	 * on a first visit. Stored rather than inferred because "no game open" and
	 * "never opened one" look identical from here and only one of them should
	 * survive pressing "All games".
	 */
	const [selected, setSelectedState] = useState<string | null>(
		() => (recall('reviewSelected', (v) => typeof v === 'string') as string) || null,
	);
	const setSelected = useCallback((id: string | null) => {
		setSelectedState(id);
		remember({ reviewSelected: id ?? '' });
	}, []);
	/*
	 * YOUR GAMES FIRST, and runs only if you ask.
	 *
	 * Will: "I don't know why training runs are even included in the list — what
	 * would user need to review there?"
	 *
	 * Mostly nothing, and the reason they are here is history: Review was built
	 * on runs, before games could be imported at all. A run is a DRILL. Its
	 * opening plies are a book line you were reciting, so replaying them tells
	 * you what you already knew; its evaluations are written only at your own
	 * turns, so the graph of one is half gaps by construction; and the one part
	 * that is real play — the punish phase, where you were off book and looking
	 * for the strongest move — has already become a card in Mistakes if you got
	 * it wrong. So the list opens on games.
	 *
	 * Kept rather than deleted, because a run IS the record of a session and
	 * "how did that go" is a fair question to ask of one. It is just not the
	 * question this screen is mostly for.
	 */
	const [filter, setFilter] = useState<ReviewSource | 'all'>('game');
	const [ply, setPlyState] = useState(
		() => recall('reviewPly', (v) => typeof v === 'number' && v >= 0) ?? 0,
	);
	const setPly = useCallback((next: number | ((p: number) => number)) => {
		setPlyState((cur) => {
			const v = typeof next === 'function' ? next(cur) : next;
			remember({ reviewPly: v });
			return v;
		});
	}, []);
	const [loaded, setLoaded] = useState(false);
	/*
	 * WHETHER THE SCORING IS ON SCREEN.
	 *
	 * Stored under the same key Play uses, deliberately: "do I want to see how
	 * this was played" is one preference about how you want to be shown a game,
	 * not one per tab. Same reasoning as `tableShown`, which Train and Mistakes
	 * already share.
	 */
	const [statsShown, setStatsShownState] = useState<boolean>(
		() => recall('statsShown', (v) => typeof v === 'boolean') ?? true,
	);
	const setStatsShown = (next: boolean) => {
		setStatsShownState(next);
		remember({ statsShown: next });
	};

	useEffect(() => {
		void (async () => {
			const d = await loadProgress();
			let games: ImportedGameRow[] = [];
			try {
				games = await db.imported.toArray();
			} catch {
				/* a review of runs alone beats no review */
			}
			const all = reviewables(d.runs, games);
			setItems(all);
			setAnswers(d.answers);
			setLoaded(true);
		})();
	}, []);

	const run = items.find((r) => r.id === selected) ?? null;

	// Replay to every position once, so stepping is instant.
	const positions = useMemo(() => {
		if (!run?.moves) return [INITIAL_FEN];
		const out = [INITIAL_FEN];
		let fen = INITIAL_FEN;
		for (const san of run.moves) {
			try {
				fen = applySan(fen, san).fen;
			} catch {
				break;
			}
			out.push(fen);
		}
		return out;
	}, [run]);

	// One pass over the evaluations gives every move on BOTH sides its verdict.
	// Deliberately not two code paths: "score our moves" and "score theirs" being
	// separate is how the app ended up grading only one of the two players.
	const notes = useMemo(
		() => (run ? annotate(run.evals ?? [], run.ourColour ?? 'w') : []),
		[run],
	);

	/*
	 * A DIFFERENT GAME STARTS AT THE BEGINNING — but returning to the SAME one
	 * does not.
	 *
	 * Keyed on the id it last ran for rather than on `selected` alone, because
	 * `selected` is restored on mount and an effect watching it fires then too —
	 * which would reset the ply to 0 on every visit and undo the thing being
	 * fixed one line after doing it.
	 */
	const lastGame = useRef<string | null>(selected);
	useEffect(() => {
		if (lastGame.current === selected) return;
		lastGame.current = selected;
		setPly(0);
	}, [selected, setPly]);

	if (!loaded) return <p style={{ opacity: 0.6 }}>Loading…</p>;
	if (!items.length) {
		return (
			<Empty>
				Nothing to review yet — no imported games with moves, and no finished runs. Import
				from Settings, or play a run through to the end on the Train tab and it appears
				here.
			</Empty>
		);
	}
	if (!run) {
		return (
			<GameList
				items={items}
				filter={filter}
				onFilter={setFilter}
				onOpen={setSelected}
			/>
		);
	}

	const ourColour = run.ourColour ?? 'w';
	const ourLosses = lossesOf(notes, 'us');
	const theirLosses = lossesOf(notes, 'them');
	const tally = punishTally(notes);

	const chips: MoveChip[] = (run.moves ?? []).map((san: string, i: number) => {
		const n = notes[i];
		return {
			san,
			ply: i + 1,
			// The move list's mistake marker means "a position worth going back
			// to and punishing", which is exactly what an opportunity is.
			mistake: !!n?.opportunity,
			suboptimal: n?.side === 'us' && (n.loss ?? 0) > 10,
			cpLoss: n?.loss ?? undefined,
			white: i % 2 === 0,
		};
	});

	const here: Annotation | null = ply > 0 ? (notes[ply - 1] ?? null) : null;
	const rowForPly = answers.find((a) => a.runId === run.id && a.ply === ply - 1);

	return (
		<div>
			<div
				style={{
					display: 'flex',
					gap: space.card,
					alignItems: 'baseline',
					flexWrap: 'wrap',
					marginBottom: space.section,
				}}
			>
				<button
					onClick={() => setSelected(null)}
					style={{
						border: 'none',
						background: 'none',
						color: color.accent,
						fontSize: text.body,
						padding: 0,
						minHeight: TOUCH,
						cursor: 'pointer',
					}}
				>
					← All games
				</button>
				<strong style={{ fontSize: text.heading }}>{run.title}</strong>
				<span style={{ fontSize: text.note, color: INK_2 }}>
					{new Date(run.ts).toLocaleString()} · {run.detail}
				</span>
				{run.url && (
					<a href={run.url} target="_blank" rel="noreferrer" style={{ fontSize: text.note }}>
						see the original
					</a>
				)}
			</div>

			<div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
				<div>
					{/*
					  * THE SAME LINE THE OTHER THREE BOARDS SHOW.
					  *
					  * Rendered directly rather than through `BoardPanel`'s `caption`
					  * prop, because this board does not go through `BoardPanel` at all
					  * — its own 380px square, its own evaluation bar, its own stepper.
					  * That is the remaining divergence and it is worth naming: this is
					  * the fourth board in the app and the only one outside the shared
					  * geometry. One component with two call sites is fine; one
					  * component and a hand-built copy of it is what this whole file
					  * exists to stop.
					  */}
					<PositionCaption path={(run.moves ?? []).slice(0, ply)} ply={ply} />

					<div style={{ display: 'flex', gap: 10 }}>
						<EvalBar
							cp={run.evals?.[ply] ?? null}
							ourColour={ourColour}
							height={380}
						/>
						<Board
							fen={positions[Math.min(ply, positions.length - 1)]}
							orientation={ourColour === 'b' ? 'black' : 'white'}
							lastMove={lastMoveOf(positions, run.moves ?? [], ply)}
							size={380}
						/>
					</div>

					<div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
						<Button title="Back to the start" onClick={() => setPly(0)} disabled={ply === 0}>
							⏮
						</Button>
						<Button
							title="Previous move"
							onClick={() => setPly((p) => Math.max(0, p - 1))}
							disabled={ply === 0}
						>
							◀
						</Button>
						<Button
							title="Next move"
							onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))}
							disabled={ply >= positions.length - 1}
						>
							▶
						</Button>
						<Button
							title="To the end"
							onClick={() => setPly(positions.length - 1)}
							disabled={ply >= positions.length - 1}
						>
							⏭
						</Button>
						<span style={{ fontSize: 13, color: INK_2, marginLeft: 6 }}>
							ply {ply} / {positions.length - 1}
						</span>
						{onPlayFrom && (
							<span style={{ marginLeft: space.snug }}>
								<Button
									onClick={() =>
										onPlayFrom({ moves: run.moves ?? [], ply, ourColour })
									}
									title="Take this position into the trainer and play it out against the engine"
								>
									Play on from here
								</Button>
							</span>
						)}
					</div>

					<div style={{ marginTop: 10, minHeight: 62, maxWidth: 430 }}>
						{here ? (
							<MoveNote note={here} assisted={rowForPly?.assisted} />
						) : (
							<div style={{ fontSize: text.body, color: INK_2 }}>
								Start of the game — step forward to walk through it.
							</div>
						)}
					</div>
				</div>

				<div style={{ flex: 1, minWidth: 340 }}>
					{/* Both players, side by side. A game is two people playing, and
						a review that grades one of them cannot show you the moment
						they went wrong — which in this app is the moment that
						matters most. */}
					{/*
					  * THE PANEL IS SHARED NOW, and toggleable — Will: "the statistics
					  * shown in review could be togglable since they really apply to any
					  * game?" They do; every number in it is computed from a list of
					  * centipawn losses, and a game being played right now produces the
					  * same list one entry at a time. See `components/GameStats`.
					  */}
					<div style={{ display: 'flex', alignItems: 'baseline', gap: space.card }}>
						<Button onClick={() => setStatsShown(!statsShown)} title={statsShown ? 'Hide the scoring' : 'Show how the game was played'}>
							{statsShown ? 'Hide scoring' : 'Show scoring'}
						</Button>
					</div>
					{statsShown && (
						<div style={{ marginTop: space.card }}>
							<GameStats
								ours={ourLosses}
								theirs={theirLosses}
								tally={tally}
								region="review-stats"
							/>
						</div>
					)}

					<h3>Evaluation</h3>
					<EvalGraph
						evals={run.evals ?? []}
						notes={notes}
						ply={ply}
						onSelect={setPly}
						plies={positions.length - 1}
					/>

					<h3>Moves</h3>
					<MoveList chips={chips} currentPly={ply} onJump={setPly} />
				</div>
			</div>
		</div>
	);
}

/**
 * The list of things you could look at.
 *
 * Each row carries the accuracy, because that is what makes one game worth
 * opening rather than another — a list of dates is a list you cannot choose
 * from. Games and runs are both here and both labelled: the real games are the
 * ones with something at stake, the runs are the practice, and telling them
 * apart is the reader's business rather than something to be tidied away.
 */
function GameList({
	items,
	filter,
	onFilter,
	onOpen,
}: {
	items: Reviewable[];
	filter: ReviewSource | 'all';
	onFilter: (f: ReviewSource | 'all') => void;
	onOpen: (id: string) => void;
}) {
	const games = items.filter((r) => r.source === 'game').length;
	const runs = items.length - games;
	const shown = items.filter((r) => filter === 'all' || r.source === filter);

	return (
		<div>
			{/*
			  * The shared one-of-N control, not a fourth private copy of it.
			  *
			  * `Pill` was tinting — accent text on `accentSoft` — which is the
			  * signal that was replaced everywhere ELSE months ago because it
			  * cannot be read at a glance. Two rules for "this one is selected"
			  * living on adjacent tabs is how a reader ends up unsure whether
			  * they pressed anything.
			  */}
			<div style={{ marginBottom: space.card }}>
				<Segmented
					label="Which of your games and runs to list"
					value={filter}
					onChange={onFilter}
					options={[
						{ id: 'all' as const, label: `Everything (${items.length})` },
						{ id: 'game' as const, label: `Your games (${games})` },
						{ id: 'run' as const, label: `Training runs (${runs})` },
					]}
				/>
			</div>

			{!shown.length ? (
				<Empty>
					{filter === 'game'
						? 'No imported games with moves yet — import from Settings.'
						: 'No finished training runs yet — play one through on the Train tab.'}
				</Empty>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: space.tight }}>
					{shown.map((r) => {
						const s = summarise(r);
						return (
							<button
								key={s.id}
								onClick={() => onOpen(s.id)}
								style={{
									display: 'grid',
									// minmax(0, …) or a long opponent name pushes the
									// accuracy off the right edge on a phone.
									gridTemplateColumns: 'minmax(0, 1fr) auto',
									gap: space.card,
									alignItems: 'center',
									textAlign: 'left',
									width: '100%',
									border: `1px solid ${GRID}`,
									borderRadius: radius.panel,
									background: color.surface,
									color: INK,
									padding: space.card,
									minHeight: TOUCH,
									cursor: 'pointer',
									font: 'inherit',
								}}
							>
								<span style={{ minWidth: 0 }}>
									<span
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: space.snug,
											flexWrap: 'wrap',
										}}
									>
										<Tag source={s.source} />
										<strong
											style={{
												fontSize: text.body,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{s.title}
										</strong>
										{s.result && <Result result={s.result} />}
									</span>
									<span
										style={{
											display: 'block',
											fontSize: text.note,
											color: INK_2,
											marginTop: 2,
										}}
									>
										{new Date(s.ts).toLocaleDateString()} · {s.detail} ·{' '}
										{s.plies} plies
										{s.incomplete && (
											/*
											 * SAID ON THE ROW, not discovered in the graph.
											 *
											 * Will: "many of the games in my review list are
											 * incompletely scored — often only a handful of plies
											 * at the beginning." Nothing was saying so: the row
											 * showed an accuracy computed from eight moves with
											 * the same confidence as one computed from forty.
											 * The cause is in `domain/scored.ts`; this is the
											 * part that stops it being a surprise.
											 */
											<span style={{ color: color.warn }}> · {s.incomplete}</span>
										)}
									</span>
								</span>

								<span style={{ textAlign: 'right' }}>
									{s.accuracy === null ? (
										// Not the same statement as 0%, and must never
										// print as one.
										<span style={{ fontSize: text.note, color: color.ink3 }}>
											not scored
										</span>
									) : (
										<>
											<span
												style={{ fontSize: 20, fontWeight: 700, display: 'block' }}
											>
												{s.accuracy}%
											</span>
											<span style={{ fontSize: text.note, color: INK_2 }}>
												{s.scored} moves
											</span>
										</>
									)}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function Tag({ source }: { source: ReviewSource }) {
	const game = source === 'game';
	return (
		<span
			style={{
				fontSize: 11,
				textTransform: 'uppercase',
				letterSpacing: 0.4,
				color: game ? color.accent : INK_2,
				border: `1px solid ${game ? color.accent : GRID}`,
				borderRadius: radius.small,
				padding: '1px 5px',
				flexShrink: 0,
			}}
		>
			{game ? 'game' : 'run'}
		</span>
	);
}

function Result({ result }: { result: 'win' | 'loss' | 'draw' }) {
	const c = result === 'win' ? color.good : result === 'loss' ? color.bad : INK_2;
	return <span style={{ fontSize: text.note, color: c }}>{result}</span>;
}

/**
 * What just happened, in one line, whoever played it.
 *
 * The label says how good the move was; the evaluation says where it leaves the
 * game. Neither is enough alone — "inaccuracy" does not tell you whether you are
 * still winning, and "+1.4" does not tell you it used to be +3.
 */
function MoveNote({ note, assisted }: { note: Annotation; assisted?: boolean }) {
	const mine = note.side === 'us';
	const badge = note.opportunity
		? { label: 'Chance to punish', colour: color.good }
		: note.missedPunish
			? { label: 'Chance missed', colour: color.bad }
			: note.quality
				? { label: QUALITY_LABEL[note.quality], colour: QUALITY_COLOUR[note.quality] }
				: { label: 'Unscored', colour: INK_2 };

	return (
		<div style={{ fontSize: text.body }}>
			<div style={{ display: 'flex', gap: space.snug, alignItems: 'baseline', flexWrap: 'wrap' }}>
				<span style={{ fontSize: text.note, color: INK_2 }}>
					{mine ? 'Your move' : 'Their move'}
				</span>
				<strong style={{ color: badge.colour }}>{badge.label}</strong>
				{note.after !== null && (
					<span style={{ fontSize: text.note, color: INK_2 }}>{signed(note.after)}</span>
				)}
			</div>
			<div style={{ color: INK, marginTop: 2 }}>{note.text}</div>
			{assisted && (
				// A run-only fact, and it changes what the number means.
				<div style={{ fontSize: text.note, color: INK_2, marginTop: 2 }}>
					Answered with help — not counted towards your rating.
				</div>
			)}
		</div>
	);
}






function lastMoveOf(
	positions: string[],
	moves: string[],
	ply: number,
): [string, string] | undefined {
	if (ply <= 0 || ply > moves.length) return undefined;
	try {
		const before = positions[ply - 1];
		const { uci } = applySan(before, moves[ply - 1]);
		return [uci.slice(0, 2), uci.slice(2, 4)];
	} catch {
		return undefined;
	}
}

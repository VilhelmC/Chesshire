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

import { useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { MoveList, type MoveChip } from '../components/MoveList';
import { EvalBar } from '../components/EvalBar';
import { loadProgress } from '../data/progress';
import { applySan, INITIAL_FEN } from '../domain/chess';
import {
	distribution,
	accuracyPercent,
	QUALITY_COLOUR,
	QUALITY_LABEL,
	QUALITY_ORDER,
	type Quality,
} from '../domain/review';
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
import { Empty, Note } from '../ui/primitives';

const INK = color.ink;
const INK_2 = color.ink2;
const GRID = color.line;
const SERIES = '#2a78d6';

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
	const [selected, setSelected] = useState<string | null>(null);
	const [filter, setFilter] = useState<ReviewSource | 'all'>('all');
	const [ply, setPly] = useState(0);
	const [loaded, setLoaded] = useState(false);

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

	useEffect(() => setPly(0), [selected]);

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
						<button onClick={() => setPly(0)} disabled={ply === 0}>
							⏮
						</button>
						<button onClick={() => setPly((p) => Math.max(0, p - 1))} disabled={ply === 0}>
							◀
						</button>
						<button
							onClick={() => setPly((p) => Math.min(positions.length - 1, p + 1))}
							disabled={ply >= positions.length - 1}
						>
							▶
						</button>
						<button
							onClick={() => setPly(positions.length - 1)}
							disabled={ply >= positions.length - 1}
						>
							⏭
						</button>
						<span style={{ fontSize: 13, color: INK_2, marginLeft: 6 }}>
							ply {ply} / {positions.length - 1}
						</span>
						{onPlayFrom && (
							<button
								onClick={() =>
									onPlayFrom({ moves: run.moves ?? [], ply, ourColour })
								}
								style={{ marginLeft: 8 }}
								title="Take this position into the trainer and play it out against the engine"
							>
								Play on from here
							</button>
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
					<h3 style={{ marginTop: 0 }}>How it was played</h3>
					{!ourLosses.length && !theirLosses.length ? (
						<p style={{ fontSize: text.body, color: INK_2 }}>
							Nothing in this game was evaluated, so there is nothing to score.
						</p>
					) : (
						<>
							<Scoreline
								ours={accuracyPercent(ourLosses)}
								theirs={accuracyPercent(theirLosses)}
								ourMoves={ourLosses.length}
								theirMoves={theirLosses.length}
							/>
							<QualityTable
								ours={distribution(ourLosses)}
								theirs={distribution(theirLosses)}
								ourTotal={ourLosses.length}
								theirTotal={theirLosses.length}
							/>
							{tally.offered > 0 && (
								// The app's whole thesis, as one line: they went wrong
								// this many times, and this is how often it was taken.
								<Note style={{ marginTop: space.snug }}>
									They gave you {tally.offered} chance
									{tally.offered === 1 ? '' : 's'} to punish
									{tally.missed > 0 ? (
										<>
											{' '}
											— <strong>{tally.missed}</strong> went by. Importing a
											game turns those into cards in your Mistakes deck.
										</>
									) : (
										<> and you took every one.</>
									)}
								</Note>
							)}
						</>
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
			<div style={{ display: 'flex', gap: space.tight, marginBottom: space.card, flexWrap: 'wrap' }}>
				<Pill on={filter === 'all'} onClick={() => onFilter('all')}>
					Everything ({items.length})
				</Pill>
				<Pill on={filter === 'game'} onClick={() => onFilter('game')}>
					Your games ({games})
				</Pill>
				<Pill on={filter === 'run'} onClick={() => onFilter('run')}>
					Training runs ({runs})
				</Pill>
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

function Pill({
	on,
	onClick,
	children,
}: {
	on: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				border: `1px solid ${on ? color.accent : GRID}`,
				background: on ? color.accentSoft : 'transparent',
				color: on ? color.accent : INK_2,
				borderRadius: radius.pill,
				padding: '6px 12px',
				fontSize: text.note,
				minHeight: 32,
				cursor: 'pointer',
			}}
		>
			{children}
		</button>
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

/** The two accuracies, next to each other, because that is the comparison. */
function Scoreline({
	ours,
	theirs,
	ourMoves,
	theirMoves,
}: {
	ours: number | null;
	theirs: number | null;
	ourMoves: number;
	theirMoves: number;
}) {
	return (
		<div style={{ display: 'flex', gap: space.page, marginBottom: space.card }}>
			<Score label="You" value={ours} moves={ourMoves} strong />
			<Score label="Opponent" value={theirs} moves={theirMoves} />
		</div>
	);
}

function Score({
	label,
	value,
	moves,
	strong,
}: {
	label: string;
	value: number | null;
	moves: number;
	strong?: boolean;
}) {
	return (
		<div>
			<div style={{ fontSize: text.note, color: INK_2 }}>{label}</div>
			<div
				style={{
					fontSize: strong ? 30 : 24,
					fontWeight: 700,
					color: value === null ? INK_2 : INK,
					lineHeight: 1.1,
				}}
			>
				{value === null ? '—' : `${value}%`}
			</div>
			<div style={{ fontSize: text.note, color: INK_2 }}>
				{value === null ? 'not scored' : `${moves} moves`}
			</div>
		</div>
	);
}

/**
 * The judgement counts for both players.
 *
 * A table rather than two sets of bars: the interesting reading is across a row
 * — three blunders to their one — and bars put that comparison in two different
 * places on the page.
 */
function QualityTable({
	ours,
	theirs,
	ourTotal,
	theirTotal,
}: {
	ours: Record<Quality, number>;
	theirs: Record<Quality, number>;
	ourTotal: number;
	theirTotal: number;
}) {
	const rows = QUALITY_ORDER.filter((q) => ours[q] || theirs[q]);
	if (!rows.length) return null;

	return (
		<table style={{ borderCollapse: 'collapse', fontSize: text.body }}>
			<thead>
				<tr style={{ color: INK_2, fontSize: text.note, textAlign: 'left' }}>
					<th style={{ fontWeight: 400, padding: '2px 10px 4px 0' }}>Move</th>
					<th style={{ fontWeight: 400, padding: '2px 10px 4px 0' }}>You</th>
					<th style={{ fontWeight: 400, padding: '2px 0 4px 0' }}>Opponent</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((q) => (
					<tr key={q}>
						<td style={{ padding: '2px 10px 2px 0', color: QUALITY_COLOUR[q] }}>
							{QUALITY_LABEL[q]}
						</td>
						<Cell n={ours[q]} total={ourTotal} q={q} />
						<Cell n={theirs[q]} total={theirTotal} q={q} last />
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Cell({
	n,
	total,
	q,
	last,
}: {
	n: number;
	total: number;
	q: Quality;
	last?: boolean;
}) {
	return (
		<td style={{ padding: `2px ${last ? 0 : 10}px 2px 0` }}>
			<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<span style={{ minWidth: 16, color: n ? INK : INK_2 }}>{n}</span>
				<span
					style={{
						height: 8,
						width: total ? `${Math.round((n / total) * 90)}px` : 0,
						background: QUALITY_COLOUR[q],
						borderRadius: 4,
						opacity: n ? 1 : 0,
					}}
				/>
			</span>
		</td>
	);
}

/**
 * Evaluation through the game.
 *
 * One series, so no legend — the heading names it. The zero line is the thing
 * being read against, so it is drawn properly rather than left to the grid.
 *
 * The dots carry the second story: a point is filled in a judgement colour when
 * the move that reached it was bad, whoever played it, and ringed where they
 * gave us something. A graph that marked only our own errors would show a line
 * dropping for reasons it never explains.
 */
function EvalGraph({
	evals,
	notes,
	ply,
	plies,
	onSelect,
}: {
	evals: (number | null)[];
	notes: Annotation[];
	ply: number;
	plies: number;
	onSelect: (p: number) => void;
}) {
	const W = 360;
	const H = 96;
	const PAD = 6;
	const pts: { x: number; y: number; p: number; cp: number }[] = [];
	const clamp = (cp: number) => Math.max(-600, Math.min(600, cp));

	for (let i = 0; i <= plies; i++) {
		const cp = evals[i];
		if (cp === null || cp === undefined) continue;
		const x = PAD + (plies ? (i / plies) * (W - PAD * 2) : 0);
		const y = H / 2 - (clamp(cp) / 600) * (H / 2 - PAD);
		pts.push({ x, y, p: i, cp });
	}

	if (pts.length < 2) {
		return <p style={{ fontSize: text.note, color: INK_2 }}>Not enough evaluations recorded.</p>;
	}

	const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
	const here = pts.find((pt) => pt.p === ply);

	return (
		<svg width={W} height={H} role="img" aria-label="Evaluation through the game">
			<line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke={GRID} strokeWidth={1} />
			<path d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
			{pts.map((pt) => {
				const n = notes[pt.p - 1];
				const marked = n && n.quality && WORTH_MARKING.has(n.quality);
				const fill = pt.p === ply
					? SERIES
					: marked
						? QUALITY_COLOUR[n!.quality as Quality]
						: '#fff';
				return (
					<circle
						key={pt.p}
						cx={pt.x}
						cy={pt.y}
						r={pt.p === ply ? 5 : marked || n?.opportunity ? 4 : 3}
						fill={fill}
						stroke={n?.opportunity ? color.good : SERIES}
						strokeWidth={n?.opportunity ? 2.5 : 1.5}
						style={{ cursor: 'pointer' }}
						onClick={() => onSelect(pt.p)}
					>
						<title>
							{n ? `${n.side === 'us' ? 'you' : 'them'}, ` : ''}ply {pt.p}:{' '}
							{signed(pt.cp)}
							{n?.opportunity ? ' — chance to punish' : ''}
							{n?.missedPunish ? ' — chance missed' : ''}
						</title>
					</circle>
				);
			})}
			{here && (
				<text
					x={Math.min(W - 34, here.x + 6)}
					y={here.y < H / 2 ? here.y + 14 : here.y - 6}
					fontSize={11}
					fill={INK}
				>
					{signed(here.cp)}
				</text>
			)}
		</svg>
	);
}

/** Judgements bad enough that the graph should point at them. */
const WORTH_MARKING = new Set<Quality>(['inaccuracy', 'mistake', 'blunder']);

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

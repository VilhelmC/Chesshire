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
	classifyQuality,
	distribution,
	accuracyPercent,
	comment,
	QUALITY_COLOUR,
	QUALITY_LABEL,
	QUALITY_ORDER,
	type Quality,
} from '../domain/review';
import type { AnswerRow } from '../domain/progress';
import { reviewables, summarise, type Reviewable, type ReviewSource } from '../domain/reviewable';
import { db, type ImportedGameRow } from '../data/db';
import { color, space, radius, text, TOUCH } from '../ui/theme';
import { Empty } from '../ui/primitives';

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
	const losses: number[] = Object.values(run.losses ?? {});
	const dist = distribution(losses);
	const acc = accuracyPercent(losses);

	const chips: MoveChip[] = (run.moves ?? []).map((san: string, i: number) => ({
		san,
		ply: i + 1,
		mistake: false,
		suboptimal: (run.losses?.[i + 1] ?? 0) > 10,
		cpLoss: run.losses?.[i + 1],
		white: i % 2 === 0,
	}));

	const currentLoss = run.losses?.[ply];
	const rowForPly = answers.find((a) => a.runId === run.id && a.ply === ply - 1);
	const quality: Quality | null = currentLoss === undefined ? null : classifyQuality(currentLoss);

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

					<div style={{ marginTop: 10, minHeight: 44, maxWidth: 430 }}>
						{quality ? (
							<div style={{ fontSize: 14 }}>
								<strong style={{ color: QUALITY_COLOUR[quality] }}>
									{QUALITY_LABEL[quality]}
								</strong>{' '}
								<span style={{ color: INK }}>
									{comment({
										quality,
										cpLoss: currentLoss ?? 0,
										phase: rowForPly?.phase,
										assisted: rowForPly?.assisted,
									})}
								</span>
							</div>
						) : ply === 0 ? (
							<div style={{ fontSize: 14, color: INK_2 }}>Start of the run.</div>
						) : (
							<div style={{ fontSize: 14, color: INK_2 }}>
								Their move — nothing scored here.
							</div>
						)}
					</div>
				</div>

				<div style={{ flex: 1, minWidth: 340 }}>
					<h3 style={{ marginTop: 0 }}>Your moves</h3>
					{acc === null ? (
						<p style={{ fontSize: 14, color: INK_2 }}>Nothing scored in this run.</p>
					) : (
						<>
							<div style={{ fontSize: 30, fontWeight: 700, color: INK, lineHeight: 1.1 }}>
								{acc}%
							</div>
							<div style={{ fontSize: 12, color: INK_2, marginBottom: 10 }}>
								accuracy over {losses.length} scored moves
							</div>
							<QualityBars dist={dist} total={losses.length} />
						</>
					)}

					<h3>Evaluation</h3>
					<EvalGraph
						evals={run.evals ?? []}
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

function QualityBars({ dist, total }: { dist: Record<Quality, number>; total: number }) {
	return (
		<div>
			{QUALITY_ORDER.map((q) => {
				const n = dist[q];
				if (!n) return null;
				return (
					<div key={q} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
						<span style={{ width: 78, fontSize: 13, color: INK_2 }}>{QUALITY_LABEL[q]}</span>
						<div
							style={{
								height: 10,
								width: `${Math.max(4, (n / total) * 180)}px`,
								background: QUALITY_COLOUR[q],
								borderRadius: 4,
							}}
						/>
						<span style={{ fontSize: 13, color: INK }}>{n}</span>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Evaluation through the run.
 *
 * One series, so no legend — the heading names it. The zero line is the thing
 * being read against, so it is drawn properly rather than left to the grid.
 */
function EvalGraph({
	evals,
	ply,
	plies,
	onSelect,
}: {
	evals: (number | null)[];
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
		return <p style={{ fontSize: 13, color: INK_2 }}>Not enough evaluations recorded.</p>;
	}

	const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
	const here = pts.find((pt) => pt.p === ply);

	return (
		<svg width={W} height={H} role="img" aria-label="Evaluation through the run">
			<line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke={GRID} strokeWidth={1} />
			<path d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
			{pts.map((pt) => (
				<circle
					key={pt.p}
					cx={pt.x}
					cy={pt.y}
					r={pt.p === ply ? 5 : 3}
					fill={pt.p === ply ? SERIES : '#fff'}
					stroke={SERIES}
					strokeWidth={1.5}
					style={{ cursor: 'pointer' }}
					onClick={() => onSelect(pt.p)}
				>
					<title>
						ply {pt.p}: {pt.cp > 0 ? '+' : ''}
						{(pt.cp / 100).toFixed(2)}
					</title>
				</circle>
			))}
			{here && (
				<text
					x={Math.min(W - 34, here.x + 6)}
					y={here.y < H / 2 ? here.y + 14 : here.y - 6}
					fontSize={11}
					fill={INK}
				>
					{here.cp > 0 ? '+' : ''}
					{(here.cp / 100).toFixed(1)}
				</text>
			)}
		</svg>
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

// Game review: replay a run with the evaluation and the annotations attached.
//
// Deliberately built on what was already recorded rather than re-analysing from
// scratch — every position in a run was evaluated as it was played, so a review
// is a read of stored data, not a second engine pass.

import { useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { MoveList, type MoveChip } from '../components/MoveList';
import { EvalBar } from '../components/EvalBar';
import { loadProgress } from '../data/progress';
import { applySan, INITIAL_FEN } from '../domain/chess';
import { LINES } from '../domain/lines';
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
import type { AnswerRow, RunRow } from '../domain/progress';

const INK = '#0b0b0b';
const INK_2 = '#52514e';
const GRID = '#e6e5e2';
const SERIES = '#2a78d6';

export function Review({
	onPlayFrom,
}: {
	onPlayFrom?: (h: { moves: string[]; ply: number; ourColour: 'w' | 'b' }) => void;
}) {
	const [runs, setRuns] = useState<RunRow[]>([]);
	const [answers, setAnswers] = useState<AnswerRow[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [ply, setPly] = useState(0);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		void (async () => {
			const d = await loadProgress();
			// Only runs recorded with their moves can be replayed.
			const playable = d.runs.filter((r) => r.moves?.length).sort((a, b) => b.ts - a.ts);
			setRuns(playable);
			setAnswers(d.answers);
			setSelected(playable[0]?.id ?? null);
			setLoaded(true);
		})();
	}, []);

	const run = runs.find((r) => r.id === selected) ?? null;

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
	if (!runs.length) {
		return (
			<p style={{ opacity: 0.7 }}>
				No finished runs recorded yet. Play a run through to the end on the Train tab and it
				appears here.
			</p>
		);
	}
	if (!run) return null;

	const ourColour = run.ourColour ?? 'w';
	const losses = Object.entries(run.losses ?? {}).map(([, v]) => v);
	const dist = distribution(losses);
	const acc = accuracyPercent(losses);

	const chips: MoveChip[] = (run.moves ?? []).map((san, i) => ({
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
			<div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
				<select
					value={selected ?? ''}
					onChange={(e) => setSelected(e.target.value)}
					style={{ fontSize: 14, maxWidth: 460 }}
				>
					{runs.map((r) => (
						<option key={r.id} value={r.id}>
							{new Date(r.ts).toLocaleString()} — {namesFor(r)} · {r.plies} plies ·{' '}
							{r.finished ?? 'unfinished'}
						</option>
					))}
				</select>
				<span style={{ fontSize: 13, color: INK_2 }}>{runs.length} runs recorded</span>
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

function namesFor(r: RunRow): string {
	if (r.opening) return r.opening;
	const names = (r.lineIds ?? []).map((id) => LINES.find((l) => l.id === id)?.name ?? id);
	return names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? '—');
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

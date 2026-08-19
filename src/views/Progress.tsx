// Progress.
//
// Built around one question: WHERE does recall break down? "78% accurate" is a
// number you can do nothing with. "Solid to move 4, falls apart on move 5" tells
// you what to train tomorrow.

import { useEffect, useState } from 'react';
import { ProgressTree } from '../components/ProgressTree';
import { MoveLine } from '../components/Move';
import { buildTree, weakSpots, accuracyOf, deepestKnown, type TreeNode } from '../domain/tree';
import { loadPractice, savePractice } from '../domain/practice';
import { nameForPath } from '../domain/openings';
import { estimate, ratingSeries, type RatingPoint } from '../domain/rating';
import { loadProgress, clearProgress } from '../data/progress';
import { db } from '../data/db';
import { loadMistakes } from '../data/mistakes';
import { transferReport, coverage, describeChange, type PlayedGame } from '../domain/transfer';
import { accuracy, freeplayLosses, type AnswerRow, type RunRow } from '../domain/progress';

// Single series, so no categorical palette to validate — one hue for magnitude,
// status colours for state, and every status carries a label rather than relying
// on colour alone.
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const SERIES = '#2a78d6';
const CRITICAL = '#d03b3b';
const GOOD = '#0ca30c';
const GRID = '#e6e5e2';

export function Progress() {
	const [answers, setAnswers] = useState<AnswerRow[]>([]);
	const [runs, setRuns] = useState<RunRow[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [pinned, setPinned] = useState<string | null>(null);
	const [played, setPlayed] = useState<PlayedGame[]>([]);

	async function reload() {
		const d = await loadProgress();
		setAnswers(d.answers);
		setRuns(d.runs);
		// Real games, plus where in each one a mistake was made — the two halves
		// the transfer measurement needs. Cards carry the path; games carry the
		// moves that say whether the position was even reached.
		try {
			const [games, cards] = await Promise.all([db.imported.toArray(), loadMistakes()]);
			const byGame = new Map<string, string[][]>();
			for (const c of cards) {
				if (!c.origin || !c.path?.length) continue;
				const id = `${c.origin.platform}:${c.origin.url.split('/').pop() ?? ''}`;
				byGame.set(id, [...(byGame.get(id) ?? []), c.path]);
			}
			setPlayed(
				games.map((g) => ({
					id: g.id,
					moves: g.moves,
					playedAt: g.playedAt,
					mistakePaths: byGame.get(g.id) ?? [],
				})),
			);
		} catch {
			setPlayed([]);
		}
		setLoaded(true);
	}

	useEffect(() => {
		void reload();
	}, []);

	// The tree is built from the answers themselves — nothing is asserted about
	// which lines exist. See domain/tree.ts.
	const { root, unplaced } = buildTree(
		answers.map((a) => ({
			path: a.path,
			correct: a.correct,
			assisted: a.assisted,
			phase: a.phase,
			ts: a.ts,
		})),
	);
	const weak = weakSpots(root);
	const deepest = deepestKnown(root);

	// Positions worth asking the transfer question about: the ones actually
	// drilled, deepest first, plus their pinned roots.
	const drills = answers
		.filter((a) => a.path?.length && a.phase !== 'freeplay')
		.map((a) => ({ path: a.path, ts: a.ts }));
	const candidates = [...new Set(drills.map((d) => d.path.slice(0, 6).join(' ')))]
		.filter(Boolean)
		.map((k) => k.split(' '));
	const transfer = transferReport(candidates, played, drills).slice(0, 6);
	const gameCoverage = coverage(played);

	// One definition of "a move that measures strength", shared with the trainer.
	const scored = answers.filter(
		(a) => a.phase === 'freeplay' && !a.assisted && a.cpLoss >= 0,
	);
	const rating = estimate(freeplayLosses(answers));
	const series = ratingSeries(
		scored.map((a) => ({ runId: a.runId, ts: a.ts, cpLoss: a.cpLoss })),
	);
	/** A readable label for a position with no name of its own. */
	function nameFor(node: TreeNode): string {
		return (
			nameForPath(node.path)?.name ??
			`After ${node.path.map((s2, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s2}` : s2)).join(' ')}`
		);
	}

	/** Send the user to train from a position on the tree. */
	function pin(node: TreeNode) {
		const cfg = loadPractice();
		const root = { path: node.path, name: nameFor(node) };
		// Added to the filter, not replacing it — pinning a second weak spot from
		// this page is how you build a session out of the things you keep missing.
		const roots = cfg.roots.some((r) => r.path.join(' ') === root.path.join(' '))
			? cfg.roots
			: [...cfg.roots, root];
		savePractice({ ...cfg, roots });
		setPinned(`${root.name} (${roots.length} pinned)`);
	}

	if (!loaded) return <p style={{ opacity: 0.6 }}>Loading…</p>;

	if (!root.total.attempts && !scored.length) {
		return (
			<p style={{ opacity: 0.7 }}>
				No answers recorded yet. Play a few runs on the Train tab and this fills in.
			</p>
		);
	}

	const totals = {
		book: root.total.attempts,
		bookOk: root.total.correct,
		punish: root.total.punishAttempts,
		punishOk: root.total.punishCorrect,
	};
	const runsSeen = runs.filter((r) => r.sawMistake).length;
	const runsPunished = runs.filter((r) => r.punished).length;

	return (
		<div>
			{pinned && (
				<div
					style={{
						fontSize: 13,
						background: '#e3f2fd',
						border: '1px solid #90caf9',
						borderRadius: 6,
						padding: '6px 8px',
						marginBottom: 12,
					}}
				>
					Pinned <strong>{pinned}</strong> — the Train tab will start there from now on.
				</div>
			)}
			{/* A grid rather than a wrapping flex row: with `minWidth` each tile
				claimed a whole line on a phone and four of them pushed everything
				else 800px down the page. auto-fit gives two columns at 360px and
				four on a desktop, with no breakpoint to keep in sync. */}
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
					gap: 12,
					marginBottom: 20,
				}}
			>
				<Tile
					label="Book recall"
					value={pct(accuracy(totals.bookOk, totals.book))}
					note={`${totals.bookOk} of ${totals.book} moves, first try`}
				/>
				<Tile
					label="Depth reached"
					value={deepest ? `move ${Math.ceil(deepest / 2)}` : '—'}
					note={
						deepest
							? 'deepest position ever answered correctly'
							: 'nothing answered correctly yet'
					}
				/>
				<Tile
					label="Punish accuracy"
					value={pct(accuracy(totals.punishOk, totals.punish))}
					note={`${totals.punishOk} of ${totals.punish} refutations found`}
				/>
				<Tile
					label="Punishments finished"
					value={pct(accuracy(runsPunished, runsSeen))}
					note={
						runsSeen === 0
							? 'no mistakes met yet'
							: `${runsPunished} of ${runsSeen} carried to the end`
					}
				/>
			</div>

			<section
				style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: 16, marginBottom: 16 }}
			>
				<h3 style={{ margin: '0 0 2px', color: INK }}>Estimated rating</h3>
				<p style={{ fontSize: 13, color: INK_2, margin: '0 0 10px' }}>
					From free-play moves only. Recalling a repertoire move measures memory, so those are
					excluded — otherwise the number would climb every time you revised.
				</p>

				{rating.elo === null ? (
					<p style={{ fontSize: 14, color: INK_2 }}>
						Nothing measured yet. Punish a mistake, then use <em>play on</em> — those moves get
						scored.
					</p>
				) : (
					<>
						<div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
							<div style={{ fontSize: 34, fontWeight: 700, color: INK, lineHeight: 1.1 }}>
								{rating.elo}
							</div>
							<div style={{ fontSize: 13, color: INK_2 }}>
								{rating.confident ? '' : 'provisional — '}
								{rating.sample} scored moves · {rating.acpl}cp average loss
							</div>
						</div>
						{series.length >= 2 ? (
							<RatingChart series={series} />
						) : (
							<p style={{ fontSize: 13, color: INK_2, marginTop: 8 }}>
								One run so far — the trend needs at least two.
							</p>
						)}
					</>
				)}
			</section>

			{weak.length > 0 && (
				<section
					style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: 16, marginBottom: 16 }}
				>
					<h3 style={{ margin: '0 0 2px', color: INK }}>Where it breaks down</h3>
					<p style={{ fontSize: 13, color: INK_2, margin: '0 0 10px' }}>
						The deepest positions you are getting wrong. Ancestors are left out: if you fail on
						move 6, being told you also fail &ldquo;somewhere in the Italian&rdquo; adds nothing.
					</p>
					<ol style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
						{weak.map((n) => (
							<li key={n.path.join(' ')} style={{ marginBottom: 6 }}>
								<MoveLine sans={n.path} size={12} />{' '}
								<span style={{ color: CRITICAL, fontWeight: 600 }}>
									{Math.round((accuracyOf(n.own) ?? 0) * 100)}%
								</span>{' '}
								<span style={{ color: INK_2 }}>of {n.own.attempts}</span>{' '}
								<button onClick={() => pin(n)} style={{ fontSize: 11 }}>
									practise from here
								</button>
							</li>
						))}
					</ol>
				</section>
			)}

			<section
				style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: 16, marginBottom: 16 }}
			>
				<h3 style={{ margin: '0 0 2px', color: INK }}>Does it carry into your games?</h3>
				<p style={{ fontSize: 13, color: INK_2, margin: '0 0 10px' }}>
					Every other number here measures how you do inside the app, which is circular —
					drilling a position until you can answer it proves you can answer it when asked. This
					compares mistakes per game in your imported games <em>before</em> you first drilled a
					position with <em>after</em>. Games that reached the position are counted whether or
					not they went wrong; without that denominator, playing fewer Italians would look like
					improvement.
				</p>

				{gameCoverage.usable === 0 ? (
					<p style={{ fontSize: 14, color: INK_2 }}>
						No imported games with recorded moves yet.{' '}
						{gameCoverage.unusable > 0
							? `${gameCoverage.unusable} games were imported before moves were kept — re-import them from the Mistakes tab to include them.`
							: 'Import your games from the Mistakes tab to start measuring this.'}
					</p>
				) : (
					<>
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
							<tbody>
								{transfer.map((t) => (
									<tr key={t.path.join(' ')} style={{ borderTop: `1px solid ${GRID}` }}>
										<td style={{ padding: '4px 8px 4px 0' }}>
											<MoveLine sans={t.path} size={12} />
										</td>
										<td
											style={{
												textAlign: 'right',
												whiteSpace: 'nowrap',
												color: t.meaningful
													? (t.change ?? 0) < -0.05
														? GOOD
														: (t.change ?? 0) > 0.05
															? CRITICAL
															: INK_2
													: INK_2,
												fontWeight: t.meaningful ? 600 : 400,
											}}
										>
											{describeChange(t)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{gameCoverage.unusable > 0 && (
							<p style={{ fontSize: 12, color: INK_2, marginTop: 8 }}>
								{gameCoverage.unusable} imported games predate move recording and are left out
								entirely rather than shrinking every denominator. Re-import to include them.
							</p>
						)}
					</>
				)}
			</section>

			<section
				style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: 16, marginBottom: 16 }}
			>
				<h3 style={{ margin: '0 0 2px', color: INK }}>The tree</h3>
				<p style={{ fontSize: 13, color: INK_2, margin: '0 0 10px' }}>
					Each row shows itself and everything below it, so a collapsed branch is still an
					honest summary. Expand to find where a shared trunk stops being shared.{' '}
					<span title="Fewer than 3 attempts">An asterisk marks too little data to trust.</span>
				</p>
				<ProgressTree root={root} unplaced={unplaced} onPin={pin} />
			</section>

			<button
				onClick={async () => {
					await clearProgress();
					await reload();
				}}
				style={{ marginTop: 24, fontSize: 13 }}
			>
				Reset progress
			</button>
		</div>
	);
}

/**
 * Rating over time.
 *
 * Two series, so a legend is required. The per-run line is deliberately faint:
 * it is the noisy one, and drawing both at equal weight would invite reading
 * run-to-run swings as real movement.
 */
function RatingChart({ series }: { series: RatingPoint[] }) {
	const W = 520;
	const H = 150;
	const PAD_L = 40;
	const PAD_B = 20;
	const PAD_T = 10;

	const values = series.flatMap((s) => [s.elo, s.cumulative]);
	const lo = Math.min(...values) - 60;
	const hi = Math.max(...values) + 60;
	const x = (i: number) =>
		PAD_L + (series.length > 1 ? (i / (series.length - 1)) * (W - PAD_L - 12) : 0);
	const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

	const path = (get: (p: RatingPoint) => number) =>
		series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(get(p)).toFixed(1)}`).join(' ');

	const last = series[series.length - 1];

	return (
		<figure style={{ margin: '12px 0 0' }}>
			<svg width={W} height={H} role="img" aria-label="Estimated rating over time">
				{[lo, (lo + hi) / 2, hi].map((v) => (
					<g key={v}>
						<line x1={PAD_L} x2={W - 12} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
						<text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill={INK_2}>
							{Math.round(v)}
						</text>
					</g>
				))}

				<path d={path((p) => p.elo)} fill="none" stroke={SERIES} strokeWidth={2} opacity={0.3} />
				<path d={path((p) => p.cumulative)} fill="none" stroke={SERIES} strokeWidth={2} />

				{series.map((p, i) => (
					<circle key={p.runId} cx={x(i)} cy={y(p.cumulative)} r={4} fill={SERIES}>
						<title>
							{new Date(p.ts).toLocaleDateString()} — run {p.elo}, overall {p.cumulative} (
							{p.moves} moves)
						</title>
					</circle>
				))}

				<text x={W - 12} y={y(last.cumulative) - 8} textAnchor="end" fontSize={12} fill={INK}>
					{last.cumulative}
				</text>
			</svg>
			<figcaption style={{ fontSize: 12, color: INK_2, display: 'flex', gap: 14 }}>
				<span>
					<span
						style={{
							display: 'inline-block',
							width: 14,
							height: 2,
							background: SERIES,
							verticalAlign: 'middle',
							marginRight: 4,
						}}
					/>
					overall
				</span>
				<span>
					<span
						style={{
							display: 'inline-block',
							width: 14,
							height: 2,
							background: SERIES,
							opacity: 0.3,
							verticalAlign: 'middle',
							marginRight: 4,
						}}
					/>
					per run
				</span>
			</figcaption>
		</figure>
	);
}

function Tile({
	label,
	value,
	note,
}: {
	label: string;
	value: React.ReactNode;
	note: string;
}) {
	return (
		<div style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: '10px 12px' }}>
			<div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: INK_2 }}>
				{label}
			</div>
			<div style={{ fontSize: 26, fontWeight: 700, color: INK, lineHeight: 1.2 }}>{value}</div>
			<div style={{ fontSize: 12, color: INK_2 }}>{note}</div>
		</div>
	);
}

function pct(v: number | null): string {
	return v === null ? '—' : `${Math.round(v * 100)}%`;
}

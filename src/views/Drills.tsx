// M2 audit harness.
//
// The spec makes M2 the go/no-go gate: the punishment generator must produce
// SOUND, branching, non-trivial refutations automatically, verified by hand on
// at least ten lines. This screen exists to make that verification possible —
// it is a reviewing tool, not the trainer. The trainer UI is M3.

import { useRef, useState } from 'react';
import { Board } from '../components/Board';
import { buildRepertoire, activeRepertoire, type Deviation } from '../domain/repertoire';
import { DRILL_MIN_MASS } from '../domain/classify';
import {
	generatePunishment,
	classifyDeviation,
	describeSolution,
	formatDrillsForClipboard,
	type PunishmentResult,
} from '../engine/punishment';
import { getToken } from '../data/explorer';
import { resetCloudCircuit } from '../data/cloudEval';
import { CancelledError } from '../engine/punishment';
import { Move, MoveLine } from '../components/Move';
import { colourAtPly, withGlyph } from '../domain/notation';

type Row = { dev: Deviation; result: PunishmentResult };

export function Drills() {
	const [rows, setRows] = useState<Row[]>([]);
	const [status, setStatus] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [topN, setTopN] = useState(12);
	const [sweep, setSweep] = useState<{ total: number; counts: Record<string, number> } | null>(null);
	const [blunderMass, setBlunderMass] = useState<number | null>(null);
	const [selected, setSelected] = useState<Row | null>(null);
	const [copied, setCopied] = useState(false);
	const cancelRef = useRef(false);

	const spec = activeRepertoire();

	async function run() {
		setBusy(true);
		setError(null);
		setRows([]);
		setSelected(null);

		resetCloudCircuit();
		cancelRef.current = false;
		const t0 = performance.now();

		try {
			setStatus('building repertoire tree…');
			const build = await buildRepertoire(spec, {
				onProgress: (p) => setStatus(`tree: node ${p.step} — ${p.label}`),
				shouldCancel: () => cancelRef.current,
			});
			if (!build.complete) throw new Error(build.warnings.join(' | '));

			// PHASE 1 — cheap classification sweep over EVERY deviation, including
			// the rare tail. Selecting candidates by frequency was the flaw in the
			// first run: the most popular replies are the soundest ones, so it
			// found nothing to punish. Two cached evaluations each, so this is
			// seconds, not minutes.
			// The branching tree yields hundreds of opponent moves. Anything below
			// DRILL_MIN_MASS (0.2% — about one game in five hundred) cannot matter
			// however bad it is, and analysing it wastes the whole budget on noise.
			const all = [...build.deviations, ...build.dropped]
				.filter((d) => d.mass >= DRILL_MIN_MASS)
				.sort((a, b) => b.mass - a.mass);
			const classified: { dev: Deviation; cls: Awaited<ReturnType<typeof classifyDeviation>> }[] = [];
			const counts: Record<string, number> = {};

			for (let i = 0; i < all.length; i++) {
				if (cancelRef.current) throw new CancelledError();
				setStatus(
					`sweep ${i + 1}/${all.length} — ${all[i].path.join(' ')} ${withGlyph(
						all[i].san,
						colourAtPly(all[i].path.length),
					)}`,
				);
				const cls = await classifyDeviation(all[i], build.colour);
				counts[cls.classification] = (counts[cls.classification] ?? 0) + 1;
				classified.push({ dev: all[i], cls });
			}
			setSweep({ total: all.length, counts });

			// Total share of games the blunders account for — the number that says
			// whether any of this is worth doing.
			const blunderMass = classified
				.filter((c) => c.cls.classification === 'blunder')
				.reduce((s, c) => s + c.dev.mass, 0);
			setBlunderMass(blunderMass);

			// PHASE 2 — build refutations only for what is actually punishable,
			// ranked by how much of your games it costs.
			const candidates = classified
				.filter((c) => c.cls.classification === 'blunder')
				.sort((a, b) => b.dev.mass - a.dev.mass)
				.slice(0, topN)
				.map((c) => c.dev);

			const out: Row[] = [];
			const failures: string[] = [];

			if (!candidates.length) {
				setStatus(
					`swept ${all.length} deviations — none classified as blunders. ` +
						`Distribution: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
				);
				return;
			}

			for (let i = 0; i < candidates.length; i++) {
				const dev = candidates[i];
				setStatus(
					`refuting ${i + 1}/${candidates.length} — ${dev.path.join(' ')} ${withGlyph(
						dev.san,
						colourAtPly(dev.path.length),
					)}`,
				);
				// One position failing (engine timeout, odd FEN) must not throw away
				// the whole batch — the earlier depth-24 timeout killed a run that
				// had already done all the useful work.
				try {
					const result = await generatePunishment(dev, build.colour, {
						onProgress: (m) => setStatus(`${i + 1}/${candidates.length} — ${m}`),
						shouldCancel: () => cancelRef.current,
					});
					out.push({ dev, result });
				} catch (err) {
					if (err instanceof CancelledError) throw err;
					failures.push(
						`${dev.path.join(' ')} ${withGlyph(dev.san, colourAtPly(dev.path.length))}: ${
							(err as Error).message
						}`,
					);
				}
				setRows([...out]);
			}

			const secs = Math.round((performance.now() - t0) / 1000);
			const drillableCount = out.filter((r) => r.result.solution).length;
			const verifiedCount = out.filter((r) => r.result.verified === true).length;
			setStatus(
				`done in ${secs}s — ${drillableCount} drillable of ${out.length}, ${verifiedCount} verified` +
					(failures.length ? ` · ${failures.length} failed: ${failures.join('; ')}` : ''),
			);
		} catch (e) {
			if (e instanceof CancelledError) setStatus('cancelled — partial results kept');
			else setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	const drillable = rows.filter((r) => r.result.solution);
	const byGap = [...drillable].sort(
		(a, b) =>
			(b.result.punishmentGap ?? 0) * b.dev.mass - (a.result.punishmentGap ?? 0) * a.dev.mass,
	);

	return (
		<div>
			<p style={{ margin: '0 0 12px', fontSize: 14, opacity: 0.75, maxWidth: 820 }}>
				This is the project&apos;s go/no-go gate. Each refutation is re-checked by an
				independent deeper search — the <strong>Verified</strong> column, not eyeballing, is what
				decides it. Use <em>Copy drill data</em> to export the lines for review. Analysis is local Stockfish at depth 20+, single-threaded — budget
				roughly a minute per position, and leave the tab open.
			</p>

			<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
				<label style={{ fontSize: 14 }}>
					Refute top{' '}
					<input
						type="number"
						min={1}
						max={40}
						value={topN}
						onChange={(e) => setTopN(Number(e.target.value))}
						style={{ width: 56 }}
					/>{' '}
					blunders
				</label>
				<button onClick={run} disabled={busy || !getToken()}>
					{busy ? 'Analysing…' : 'Generate'}
				</button>
				{busy && <button onClick={() => (cancelRef.current = true)}>Cancel</button>}
				{rows.length > 0 && (
					<button
						onClick={async () => {
							await navigator.clipboard.writeText(formatDrillsForClipboard(rows));
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
					>
						{copied ? 'Copied ✓' : 'Copy drill data'}
					</button>
				)}
				<span style={{ fontSize: 13, opacity: 0.7 }}>{status}</span>
			</div>

			{!getToken() && (
				<p style={{ fontSize: 13, color: '#c62828' }}>
					Save a Lichess token on the Checks tab first — the deviation list comes from the
					explorer.
				</p>
			)}
			{error && <p style={{ color: '#c62828' }}>{error}</p>}

			{sweep && (
				<div
					style={{
						border: '1px solid #ddd',
						borderRadius: 8,
						padding: 12,
						margin: '8px 0 16px',
						fontSize: 14,
					}}
				>
					{blunderMass !== null && (
						<div style={{ fontSize: 15, marginBottom: 6 }}>
							Punishable positions account for{' '}
							<strong style={{ color: blunderMass >= 0.15 ? '#2e7d32' : '#c62828' }}>
								{(blunderMass * 100).toFixed(1)}%
							</strong>{' '}
							of your games as this colour. The five-ply tree managed 4.1%; anything under
							~15% probably is not worth training against.
						</div>
					)}
					<strong>Sweep:</strong> {sweep.total} deviations classified —{' '}
					{Object.entries(sweep.counts)
						.sort((a, b) => b[1] - a[1])
						.map(([k, v]) => `${v} ${k}`)
						.join(', ')}
					<div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
						Frequency and punishability pull in opposite directions: the popular replies are
						main-line openings, so anything drillable is in the rare tail.
					</div>
				</div>
			)}

			{rows.length > 0 && (
				<div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
					<div style={{ flex: '1 1 560px', minWidth: 460 }}>
						<table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
							<thead>
								<tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
									<th>Position</th>
									<th>Move</th>
									<th style={{ textAlign: 'right' }}>Δ cp</th>
									<th>Verdict</th>
									<th>Verified</th>
									<th style={{ textAlign: 'right' }}>Gap</th>
									<th style={{ textAlign: 'right' }}>Nodes</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr
										key={r.dev.id}
										onClick={() => setSelected(r)}
										style={{
											borderBottom: '1px solid #f0f0f0',
											cursor: 'pointer',
											background: selected?.dev.id === r.dev.id ? '#e3f2fd' : undefined,
										}}
									>
										<td style={{ opacity: 0.7 }}>{r.dev.path.join(' ') || '(start)'}</td>
										<td>
											<Move
												san={r.dev.san}
												colour={colourAtPly(r.dev.path.length)}
												bold
											/>{' '}
											<span style={{ opacity: 0.5 }}>{(r.dev.mass * 100).toFixed(1)}%</span>
										</td>
										<td style={{ textAlign: 'right' }}>
											{r.result.delta > 0 ? '+' : ''}
											{r.result.delta}
										</td>
										<td>
											<Verdict r={r.result} />
										</td>
										<td
											style={{
												color:
													r.result.verified === true
														? '#2e7d32'
														: r.result.verified === false
															? '#c62828'
															: '#999',
												fontWeight: 600,
											}}
										>
											{r.result.verified === true
												? '✓'
												: r.result.verified === false
													? '✗'
													: '—'}
										</td>
										<td style={{ textAlign: 'right' }}>
											{r.result.punishmentGap === null
												? '—'
												: `${(r.result.punishmentGap * 100).toFixed(0)}pp`}
										</td>
										<td style={{ textAlign: 'right', opacity: 0.6 }}>
											{r.result.nodeCount || '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>

						{byGap.length > 0 && (
							<>
								<h3 style={{ marginTop: 24 }}>Ranked by punishment gap × frequency</h3>
								<p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
									How much your opponent is getting away with, weighted by how often it comes
									up. This is the drill order the trainer should use — not raw frequency.
								</p>
								<ol style={{ fontSize: 14 }}>
									{byGap.slice(0, 8).map((r) => (
										<li key={r.dev.id}>
											<strong>
												<MoveLine sans={[...r.dev.path, r.dev.san]} size={12} />
											</strong>{' '}
											— they score {(r.dev.scoreForOpponent * 100).toFixed(0)}% in a position
											worth {fmtCp(r.result.finalEval)} to you (
											{(r.result.punishmentGap! * 100).toFixed(0)}pp unearned,{' '}
											{(r.dev.mass * 100).toFixed(1)}% of games)
										</li>
									))}
								</ol>
							</>
						)}
					</div>

					<div style={{ minWidth: 340 }}>
						{selected ? (
							<>
								<Board
									fen={selected.result.rootFen}
									orientation={selected.result.ourColour === 'w' ? 'white' : 'black'}
									size={340}
								/>
								<h4 style={{ margin: '10px 0 4px' }}>
									<MoveLine sans={[...selected.dev.path, selected.dev.san]} size={12} />
								</h4>
								<div style={{ fontSize: 13, lineHeight: 1.5 }}>
									eval {fmtCp(selected.result.evalBefore)} → {fmtCp(selected.result.evalAfter)}{' '}
									(Δ {selected.result.delta > 0 ? '+' : ''}
									{selected.result.delta})
									<br />
									<Verdict r={selected.result} />
									{selected.result.verifyNote && (
										<div
											style={{
												marginTop: 6,
												color: selected.result.verified === false ? '#c62828' : '#2e7d32',
											}}
										>
											{selected.result.verifyNote}
										</div>
									)}
									{selected.result.downgradeReason && (
										<div style={{ opacity: 0.75, marginTop: 4 }}>
											{selected.result.downgradeReason}
										</div>
									)}
									{selected.result.motifs.length > 0 && (
										<div style={{ marginTop: 6 }}>
											motifs: {selected.result.motifs.join(', ')}
										</div>
									)}
									<div style={{ marginTop: 4, opacity: 0.6 }}>
										{selected.result.engineCalls} analyses ({selected.result.cloudHits} from
										Lichess cloud, {selected.result.engineCalls - selected.result.cloudHits}{' '}
										local)
									</div>
								</div>

								{selected.result.solution && (
									<>
										<h4 style={{ margin: '12px 0 4px' }}>Validated lines</h4>
										<ul style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', paddingLeft: 18 }}>
											{describeSolution(selected.result.rootFen, selected.result.solution).map(
												(line, i) => (
													<li key={i}>{line}</li>
												),
											)}
										</ul>
										<p style={{ fontSize: 12, opacity: 0.65 }}>
											Every branch is a reply within {100}cp of their best — i.e. a move a
											human might actually find. If any of these lines is unsound, that is
											the M2 gate failing.
										</p>
									</>
								)}
							</>
						) : (
							<p style={{ fontSize: 13, opacity: 0.7 }}>Select a row to review its line.</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function Verdict({ r }: { r: PunishmentResult }) {
	const map: Record<string, { text: string; colour: string }> = {
		blunder: { text: r.solution ? 'drillable' : 'too branchy', colour: r.solution ? '#2e7d32' : '#ef6c00' },
		inaccuracy: { text: 'pressure only', colour: '#ef6c00' },
		playable: { text: 'sound move', colour: '#666' },
		refutes_us: { text: 'hole in our line', colour: '#c62828' },
		book: { text: 'book', colour: '#666' },
	};
	const v = map[r.classification] ?? { text: r.classification, colour: '#666' };
	return <span style={{ color: v.colour, fontWeight: 600 }}>{v.text}</span>;
}

function fmtCp(cp: number | null): string {
	if (cp === null) return '—';
	if (Math.abs(cp) > 9000) return cp > 0 ? '#' : '-#';
	return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
}

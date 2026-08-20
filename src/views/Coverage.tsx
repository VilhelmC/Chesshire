// M1 — the coverage audit. SPEC.md §5 Mode D.
//
// This is the screen that tells you the uncomfortable truth: how little of a
// real game your preparation actually covers, and which single gap costs you
// the most. It is deliberately the first thing worth building after the
// plumbing, because it decides what everything else works on.

import { useState } from 'react';
import { Board } from '../components/Board';
import {
	buildRepertoire,
	activeRepertoire,
	formatBuildForClipboard,
	type BuildResult,
	type Deviation,
} from '../domain/repertoire';
import { getToken, setToken } from '../data/explorer';
import { CONFIG } from '../config';
import { Move, MoveLine } from '../components/Move';
import { colourAtPly } from '../domain/notation';

export function Coverage() {
	const [result, setResult] = useState<BuildResult | null>(null);
	const [status, setStatus] = useState<string>('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Deviation | null>(null);
	const [hasToken, setHasToken] = useState(() => !!getToken());
	const [tokenInput, setTokenInput] = useState('');
	const [copied, setCopied] = useState(false);

	const spec = activeRepertoire();

	async function run() {
		setBusy(true);
		setError(null);
		setResult(null);
		setSelected(null);
		try {
			const r = await buildRepertoire(spec, {
				onProgress: (p) => setStatus(`node ${p.step} — ${p.label}`),
			});
			setResult(r);
			setStatus('');
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div>
			<header style={{ marginBottom: 16 }}>
				<p style={{ margin: '4px 0', opacity: 0.7, fontSize: 14 }}>
					{spec.line} · band {CONFIG.explorer.ratings.join('/')} ·{' '}
					{CONFIG.explorer.speeds.join('+')}
				</p>
				<button onClick={run} disabled={busy || !hasToken}>
					{busy ? 'Building…' : 'Build repertoire tree'}
				</button>{' '}
				{result && (
					<button
						onClick={async () => {
							await navigator.clipboard.writeText(formatBuildForClipboard(result, spec));
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
					>
						{copied ? 'Copied ✓' : 'Copy audit data'}
					</button>
				)}{' '}
				<span style={{ fontSize: 13, opacity: 0.7 }}>{status}</span>
				<div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
					Lichess token: {hasToken ? 'saved in this browser' : 'not set'}
				</div>
			</header>

			{!hasToken && (
				<div
					style={{
						border: '1px solid #1565c0',
						background: '#e3f2fd',
						borderRadius: 8,
						padding: 12,
						marginBottom: 16,
					}}
				>
					<strong>Lichess token needed</strong>
					<p style={{ margin: '4px 0 8px', fontSize: 13 }}>
						The opening explorer stopped serving anonymous requests. Create a token at{' '}
						<a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
							lichess.org/account/oauth/token
						</a>{' '}
						with no scopes ticked. It is stored in this browser only.
					</p>
					<div style={{ display: 'flex', gap: 8 }}>
						<input
							type="password"
							placeholder="lip_..."
							value={tokenInput}
							onChange={(e) => setTokenInput(e.target.value)}
							style={{ flex: 1, maxWidth: 360, padding: 4 }}
						/>
						<button
							onClick={() => {
								setToken(tokenInput || null);
								setHasToken(!!tokenInput);
								setTokenInput('');
							}}
						>
							Save
						</button>
					</div>
				</div>
			)}

			{error && (
				<p style={{ color: '#c62828', fontWeight: 600 }}>
					{error}
					<br />
					<span style={{ fontWeight: 400, fontSize: 13 }}>
						If this is a 401, save a Lichess API token on the Checks tab first.
					</span>
				</p>
			)}

			{result && !result.complete && (
				<div
					style={{
						border: '2px solid #c62828',
						background: '#ffebee',
						borderRadius: 8,
						padding: 16,
						margin: '16px 0',
					}}
				>
					<strong style={{ color: '#c62828' }}>Build incomplete — metrics withheld</strong>
					<p style={{ margin: '6px 0 0', fontSize: 14 }}>
						At least one explorer query failed, so the tree is truncated. Any coverage number
						computed from it would look <em>better</em> than reality (positions we never asked
						about appear to have no deviations), so nothing is shown.
					</p>
					<ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
						{result.warnings.map((w, i) => (
							<li key={i}>{w}</li>
						))}
					</ul>
				</div>
			)}

			{result && result.complete && (
				<>
					<Headline result={result} />
					{result.warnings.length > 0 && <Warnings warnings={result.warnings} />}

					<div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
						<div style={{ flex: '1 1 520px', minWidth: 420 }}>
							<h3>They left your line early</h3>
							<p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
								Sorted by how much of your total games as{' '}
								{result.colour === 'w' ? 'White' : 'Black'} each one costs you. Click a row to
								see the position. These become punishment drills in M2.
							</p>
							<DeviationTable
								rows={result.deviations.filter((d) => !d.terminal)}
								selected={selected}
								onSelect={setSelected}
							/>

							<h3 style={{ marginTop: 24 }}>Your book ran out</h3>
							<p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
								You played the whole line and reached these. Not a surprise — just the edge of
								your preparation. Extending the trunk fixes these; drills fix the ones above.
							</p>
							<DeviationTable
								rows={result.deviations.filter((d) => d.terminal)}
								selected={selected}
								onSelect={setSelected}
							/>

							{result.dropped.length > 0 && (
								<details style={{ marginTop: 16 }}>
									<summary style={{ cursor: 'pointer', fontSize: 14 }}>
										Deliberately ignored: {result.dropped.length} rare moves (
										{(result.dropped.reduce((s, d) => s + d.mass, 0) * 100).toFixed(1)}% of
										games)
									</summary>
									<p style={{ fontSize: 13, opacity: 0.7 }}>
										Below the 0.5% frequency floor or past the 95% coverage target. Listed
										rather than hidden — a trainer that conceals its gaps is worse than no
										trainer.
									</p>
									<DeviationTable rows={result.dropped} selected={selected} onSelect={setSelected} />
								</details>
							)}
						</div>

						<div>
							<Board
								fen={selected?.fen ?? result.trunk[result.trunk.length - 1]?.fen ?? ''}
								orientation={result.colour === 'w' ? 'white' : 'black'}
								size={340}
							/>
							<div style={{ fontSize: 13, marginTop: 8, maxWidth: 340 }}>
								{selected ? (
									<>
										<div>
											<MoveLine sans={[...selected.path, selected.san]} />
										</div>
										<br />
										{(selected.frequency * 100).toFixed(1)}% of replies here ·{' '}
										{(selected.mass * 100).toFixed(2)}% of all your games
										<br />
										{selected.gameCount.toLocaleString()} games · opponent scores{' '}
										{(selected.scoreForOpponent * 100).toFixed(0)}%
										{selected.averageRating ? ` · avg ${selected.averageRating}` : ''}
									</>
								) : (
									<em>End of your line. Select a deviation to inspect it.</em>
								)}
							</div>
						</div>
					</div>

					<h3 style={{ marginTop: 32 }}>
						Repertoire tree — {result.stats.nodes} nodes to ply {result.stats.maxPly}
					</h3>
					<p style={{ fontSize: 13, opacity: 0.7, marginTop: 0 }}>
						Past your seed line the moves are chosen automatically: the most popular reply the
						engine does not dislike. Restricting to popular moves keeps us in lines the
						explorer has data for. Showing the 30 most-reached nodes.
					</p>
					<TrunkTable result={result} />
				</>
			)}
		</div>
	);
}

function Headline({ result }: { result: BuildResult }) {
	const all = [...result.deviations, ...result.dropped];
	const early = all.filter((d) => !d.terminal);

	// The first opponent decision point. A deviation THERE means they chose a
	// different opening entirely (1...c5, 1...d5, ...) — that is missing
	// repertoire, not a punishable mistake. Lumping it in with genuine off-book
	// errors, as the first version of this screen did, is a category error: you
	// cannot "punish" the Sicilian.
	const firstPly = early.length ? Math.min(...early.map((d) => d.path.length)) : 0;
	const wrongOpeningMass = early
		.filter((d) => d.path.length === firstPly)
		.reduce((s, d) => s + d.mass, 0);
	const offBookMass = early
		.filter((d) => d.path.length > firstPly)
		.reduce((s, d) => s + d.mass, 0);

	const biggestOffBook = result.deviations
		.filter((d) => !d.terminal && d.path.length > firstPly)
		.sort((a, b) => b.mass - a.mass)[0];

	return (
		<>
			<div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '16px 0 8px' }}>
				<Tile
					label="Never reaches your opening"
					value={`${(wrongOpeningMass * 100).toFixed(0)}%`}
					note="they play a different opening — needs repertoire, not drills"
					tone="warn"
				/>
				<Tile
					label="Off book inside your opening"
					value={`${(offBookMass * 100).toFixed(0)}%`}
					note="the punishable territory"
					tone="warn"
				/>
				<Tile
					label="You complete your line"
					value={`${(result.trunkSurvivalMass * 100).toFixed(0)}%`}
					note="and your book ends there anyway"
					tone={result.trunkSurvivalMass < 0.15 ? 'warn' : 'ok'}
				/>
				<Tile
					label="Biggest off-book hole"
					value={
						biggestOffBook ? (
							<Move
								san={biggestOffBook.san}
								colour={colourAtPly(biggestOffBook.path.length)}
								bold
							/>
						) : (
							'—'
						)
					}
					note={
						biggestOffBook
							? `${(biggestOffBook.mass * 100).toFixed(1)}% — 1 in ${Math.round(
									1 / biggestOffBook.mass,
								)} games`
							: ''
					}
					tone="warn"
				/>
			</div>
			<p style={{ fontSize: 13, opacity: 0.75, maxWidth: 820, marginTop: 0 }}>
				These three sum to 100%. The split matters: the first column is a{' '}
				<strong>scope</strong> problem (you have no answer to the Sicilian, and no drill can
				invent one), the second is the <strong>off-book</strong> problem this app is built for,
				and the third means your book runs out the moment you finish it. Until M2 adds engine
				evaluation, none of these distinguish a blunder from a perfectly sound move.
			</p>
		</>
	);
}

function Tile({
	label,
	value,
	note,
	tone,
}: {
	label: string;
	value: React.ReactNode;
	note: string;
	tone: 'ok' | 'warn' | 'mute';
}) {
	const colour = tone === 'ok' ? '#2e7d32' : tone === 'warn' ? '#c62828' : '#666';
	return (
		<div
			style={{
				border: '1px solid #ddd',
				borderRadius: 8,
				padding: '12px 16px',
				minWidth: 170,
			}}
		>
			<div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
				{label}
			</div>
			<div style={{ fontSize: 26, fontWeight: 700, color: colour }}>{value}</div>
			<div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div>
		</div>
	);
}

function Warnings({ warnings }: { warnings: string[] }) {
	return (
		<div
			style={{
				border: '1px solid #ef6c00',
				background: '#fff8e1',
				borderRadius: 8,
				padding: 12,
				marginBottom: 20,
				fontSize: 13,
			}}
		>
			<strong>Data quality</strong>
			<ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
				{warnings.map((w, i) => (
					<li key={i}>{w}</li>
				))}
			</ul>
		</div>
	);
}

function DeviationTable({
	rows,
	selected,
	onSelect,
}: {
	rows: Deviation[];
	selected: Deviation | null;
	onSelect: (d: Deviation) => void;
}) {
	return (
		<table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%' }}>
			<thead>
				<tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
					<th>After</th>
					<th>They play</th>
					<th style={{ textAlign: 'right' }}>Of replies</th>
					<th style={{ textAlign: 'right' }}>Of your games</th>
					<th style={{ textAlign: 'right' }}>1 in</th>
					<th style={{ textAlign: 'right' }}>They score</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((d) => (
					<tr
						key={d.id}
						onClick={() => onSelect(d)}
						style={{
							borderBottom: '1px solid #f0f0f0',
							cursor: 'pointer',
							background: selected?.id === d.id ? '#e3f2fd' : undefined,
						}}
					>
						<td style={{ opacity: 0.7, fontSize: 13 }}>
							{d.path.length ? <MoveLine sans={d.path} size={12} /> : '—'}
						</td>
						<td>
							<Move san={d.san} colour={colourAtPly(d.path.length)} bold />
						</td>
						<td style={{ textAlign: 'right' }}>{(d.frequency * 100).toFixed(1)}%</td>
						<td style={{ textAlign: 'right', fontWeight: 600 }}>
							{(d.mass * 100).toFixed(2)}%
						</td>
						<td style={{ textAlign: 'right', opacity: 0.7 }}>
							{d.mass > 0 ? Math.round(1 / d.mass) : '—'}
						</td>
						<td style={{ textAlign: 'right' }}>{(d.scoreForOpponent * 100).toFixed(0)}%</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function TrunkTable({ result }: { result: BuildResult }) {
	return (
		<table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
			<thead>
				<tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
					<th>Ply</th>
					<th>Line</th>
					<th>To move</th>
					<th>Our move</th>
					<th style={{ textAlign: 'right' }}>Reached</th>
					<th style={{ textAlign: 'right' }}>Games in band</th>
				</tr>
			</thead>
			<tbody>
				{result.trunk.slice(0, 30).map((n) => (
					<tr key={n.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
						<td>{n.ply}</td>
						<td>{n.path.length ? <MoveLine sans={n.path} size={12} /> : <em>start</em>}</td>
						<td>{n.toMove === result.colour ? 'you' : 'them'}</td>
						<td>
							{n.ourMove ? (
								<span title={n.ourMove.reason}>
									<Move san={n.ourMove.san} colour={colourAtPly(n.ply)} bold />{' '}
									<span style={{ opacity: 0.5, fontSize: 11 }}>
										{n.onSeed ? 'seed' : 'auto'}
									</span>
								</span>
							) : (
								''
							)}
						</td>
						<td style={{ textAlign: 'right' }}>{(n.mass * 100).toFixed(1)}%</td>
						<td style={{ textAlign: 'right', color: n.sparse ? '#c62828' : undefined }}>
							{n.gameCount ? n.gameCount.toLocaleString() : '—'}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

// M0/M1 harness: verifies the three external dependencies the whole pipeline
// rests on — the board, the engine, and the Lichess explorer — before any
// drill logic is built on top of them.

import { useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { engine } from '../engine/stockfish';
import { smokeTest, probeEndpoints, getToken, setToken, type ProbeResult } from '../data/explorer';
import { SignIn } from '../components/SignIn';
import { applyUci, playSanLine, sideToMove, INITIAL_FEN } from '../domain/chess';
import { CONFIG } from '../config';
import type { ExplorerResponse } from '../domain/types';
import { Move } from '../components/Move';
import { DataPanel } from '../components/DataPanel';
import { colourOfFen } from '../domain/notation';

type Check = { state: 'idle' | 'running' | 'ok' | 'fail'; note: string };

const IDLE: Check = { state: 'idle', note: 'not run' };
const ITALIAN_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';

export function Build() {
	// --- board sandbox state -------------------------------------------------
	const [history, setHistory] = useState<{ fen: string; san: string; uci: string }[]>([]);
	const [startFen, setStartFen] = useState(ITALIAN_FEN);
	const fen = history.length ? history[history.length - 1].fen : startFen;
	const lastMove = useMemo<[string, string] | undefined>(() => {
		const u = history[history.length - 1]?.uci;
		return u ? [u.slice(0, 2), u.slice(2, 4)] : undefined;
	}, [history]);

	const [boardCheck, setBoardCheck] = useState<Check>(IDLE);
	const [engineCheck, setEngineCheck] = useState<Check>(IDLE);
	const [explorerCheck, setExplorerCheck] = useState<Check>(IDLE);
	const [explorerRaw, setExplorerRaw] = useState<ExplorerResponse | null>(null);
	const [probe, setProbe] = useState<ProbeResult[] | null>(null);
	const [probing, setProbing] = useState(false);
	const [tokenInput, setTokenInput] = useState(getToken() ?? '');

	useEffect(() => {
		try {
			const { fen: out } = playSanLine(CONFIG.repertoires[0].line);
			setBoardCheck(
				out === ITALIAN_FEN
					? { state: 'ok', note: 'Italian root FEN matches' }
					: { state: 'fail', note: `got ${out}` },
			);
		} catch (e) {
			setBoardCheck({ state: 'fail', note: (e as Error).message });
		}
	}, []);

	function onMove(uci: string) {
		try {
			const { fen: next, san } = applyUci(fen, uci);
			setHistory((h) => [...h, { fen: next, san, uci }]);
		} catch {
			/* illegal — chessground shouldn't offer it, but never trust that */
		}
	}

	function reset(to: string) {
		setStartFen(to);
		setHistory([]);
	}

	async function runEngine() {
		setEngineCheck({ state: 'running', note: 'loading WASM (7 MB, first run only)…' });
		try {
			const t0 = performance.now();
			const r = await engine.analyse(fen, 16, 3);
			const ms = Math.round(performance.now() - t0);
			if (!r.lines.length) throw new Error('no PV lines returned');
			setEngineCheck({
				state: 'ok',
				note: `depth ${r.lines[0].depth} in ${ms}ms — ${r.lines
					.map((l) => `${l.pv[0]} ${(l.cp / 100).toFixed(2)}`)
					.join(' | ')}`,
			});
		} catch (e) {
			setEngineCheck({ state: 'fail', note: (e as Error).message });
		}
	}

	async function runExplorer() {
		setExplorerCheck({ state: 'running', note: 'fetching…' });
		const r = await smokeTest();
		setExplorerCheck({ state: r.ok ? 'ok' : 'fail', note: r.note });
		setExplorerRaw((r.raw as ExplorerResponse) ?? null);
	}

	async function runProbe() {
		setProbing(true);
		setProbe(null);
		try {
			setProbe(await probeEndpoints());
		} finally {
			setProbing(false);
		}
	}

	const turn = sideToMove(fen) === 'w' ? 'White' : 'Black';

	return (
		<div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
			<div>
				{/*
					movableColor="both": this is a sandbox, not a drill. Restricting
					drag to the side to move made the board look broken — you were
					White by orientation but it was Black's move in the Italian root.
				*/}
				<Board
					fen={fen}
					orientation="white"
					interactive
					movableColor="both"
					lastMove={lastMove}
					onMove={onMove}
				/>
				<div style={{ marginTop: 8, fontSize: 13 }}>
					<strong>{turn} to move</strong> · both sides draggable (sandbox)
				</div>
				<div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					<button onClick={() => reset(ITALIAN_FEN)}>Italian root</button>
					<button onClick={() => reset(INITIAL_FEN)}>Start position</button>
					<button onClick={() => setHistory((h) => h.slice(0, -1))} disabled={!history.length}>
						Undo
					</button>
				</div>
				<div style={{ marginTop: 8, fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
					{history.length ? (
						history.map((h, i) => (
							// Colour comes from the position the move was played FROM: the
							// sandbox can start from either side, so ply parity is no guide.
							<Move
								key={i}
								san={h.san}
								colour={colourOfFen(i ? history[i - 1].fen : startFen)}
								size={13}
							/>
						))
					) : (
						<em>no moves yet</em>
					)}
				</div>
				<p style={{ fontSize: 12, opacity: 0.6, maxWidth: 420 }}>
					Drag any piece of either colour. Only legal moves are offered — the destinations still
					come from the real side to move.
				</p>
			</div>

			<div style={{ minWidth: 440, flex: 1 }}>

				<CheckRow label="Board + chessops" check={boardCheck} />

				<CheckRow label="Stockfish WASM (single-thread)" check={engineCheck}>
					<button onClick={runEngine} disabled={engineCheck.state === 'running'}>
						Analyse this position
					</button>
				</CheckRow>

				<CheckRow label="Lichess explorer API" check={explorerCheck}>
					<button onClick={runExplorer} disabled={explorerCheck.state === 'running'}>
						Fetch {CONFIG.explorer.ratings.join('/')} · {CONFIG.explorer.speeds.join('+')}
					</button>
				</CheckRow>

				<SignIn />

				<section style={{ borderTop: '1px solid #ddd', paddingTop: 16, marginTop: 8 }}>
					<h3 style={{ margin: '0 0 4px' }}>Endpoint probe</h3>
					<p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
						The explorer returned <code>401</code> from nginx — a proxy-level rejection. That
						means one of: the endpoint now requires a token, it has moved, or a query parameter
						is tripping a filter. This tries six variants and tells us which.
					</p>

					<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
						<input
							type="password"
							placeholder="Lichess API token (optional)"
							value={tokenInput}
							onChange={(e) => setTokenInput(e.target.value)}
							style={{ flex: 1, minWidth: 220, padding: 4 }}
						/>
						<button
							onClick={() => {
								setToken(tokenInput || null);
								alert(tokenInput ? 'Token saved locally.' : 'Token cleared.');
							}}
						>
							Save token
						</button>
						<button onClick={runProbe} disabled={probing}>
							{probing ? 'Probing…' : 'Run probe'}
						</button>
					</div>
					<p style={{ fontSize: 12, opacity: 0.6 }}>
						Pasting a token by hand still works and is kept for exactly that reason — signing
						in above is the same credential obtained without leaving the app. Either way it is
						stored in this browser&apos;s localStorage only, never committed, and never sent
						anywhere but lichess.org. To make one by hand:{' '}
						<a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
							lichess.org/account/oauth/token
						</a>
						, no scopes ticked.
					</p>

					{probe && <ProbeTable results={probe} />}
				</section>

				<DataPanel />

				{explorerRaw && (
					<>
						<h3 style={{ marginTop: 24 }}>Black&apos;s replies at your band</h3>
						<ExplorerTable data={explorerRaw} colour={colourOfFen(fen)} />
					</>
				)}
			</div>
		</div>
	);
}

function CheckRow({
	label,
	check,
	children,
}: {
	label: string;
	check: Check;
	children?: React.ReactNode;
}) {
	const colour =
		check.state === 'ok'
			? '#2e7d32'
			: check.state === 'fail'
				? '#c62828'
				: check.state === 'running'
					? '#ef6c00'
					: '#888';
	const glyph =
		check.state === 'ok' ? '✓' : check.state === 'fail' ? '✗' : check.state === 'running' ? '…' : '·';

	return (
		<div style={{ borderTop: '1px solid #ddd', padding: '12px 0' }}>
			<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
				<span style={{ color: colour, fontWeight: 700, width: 16 }}>{glyph}</span>
				<strong>{label}</strong>
				{children}
			</div>
			<div style={{ fontSize: 13, color: colour, marginLeft: 24, wordBreak: 'break-word' }}>
				{check.note}
			</div>
		</div>
	);
}

function ProbeTable({ results }: { results: ProbeResult[] }) {
	const winner = results.find((r) => r.ok);

	return (
		<div style={{ marginTop: 12 }}>
			{winner ? (
				<p style={{ color: '#2e7d32', fontWeight: 600 }}>
					✓ Working: {winner.label}
					{winner.withToken ? ' (token required)' : ' (anonymous OK)'}
				</p>
			) : (
				<p style={{ color: '#c62828', fontWeight: 600 }}>
					✗ Nothing worked — copy this table back to me.
				</p>
			)}
			<table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
				<thead>
					<tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
						<th>Candidate</th>
						<th>Token</th>
						<th>Status</th>
						<th>Body (first 300 chars)</th>
					</tr>
				</thead>
				<tbody>
					{results.map((r, i) => (
						<tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
							<td>{r.label}</td>
							<td>{r.withToken ? 'yes' : 'no'}</td>
							<td style={{ color: r.ok ? '#2e7d32' : '#c62828', fontWeight: 600 }}>
								{r.status}
							</td>
							<td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
								{r.body.slice(0, 300)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function ExplorerTable({ data, colour }: { data: ExplorerResponse; colour: 'w' | 'b' }) {
	const total = data.moves.reduce((s, m) => s + m.white + m.draws + m.black, 0);

	return (
		<table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%' }}>
			<thead>
				<tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
					<th>Move</th>
					<th style={{ textAlign: 'right' }}>Games</th>
					<th style={{ textAlign: 'right' }}>Freq</th>
					<th style={{ textAlign: 'right' }}>Black score</th>
				</tr>
			</thead>
			<tbody>
				{data.moves.map((m) => {
					const games = m.white + m.draws + m.black;
					const freq = total ? games / total : 0;
					const blackScore = games ? (m.black + m.draws / 2) / games : 0;
					return (
						<tr key={m.uci} style={{ borderBottom: '1px solid #f0f0f0' }}>
							<td>
								<Move san={m.san} colour={colour} bold />{' '}
								<span style={{ opacity: 0.5, fontSize: 12 }}>{m.uci}</span>
							</td>
							<td style={{ textAlign: 'right' }}>{games.toLocaleString()}</td>
							<td style={{ textAlign: 'right' }}>{(freq * 100).toFixed(1)}%</td>
							<td style={{ textAlign: 'right' }}>{(blackScore * 100).toFixed(0)}%</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

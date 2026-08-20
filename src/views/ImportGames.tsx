// Pulling real games in.
//
// Shown inside the Mistakes tab because that is what it feeds. Everything here
// is per-source and explicit: which platform answered, how many games came
// back, what went wrong if nothing did. Chess.com in particular may be blocked
// by CORS depending on the route, and a silent zero would look identical to
// "you played no games", so failures are reported rather than swallowed.

import { useEffect, useState } from 'react';
import {
	getUsernames,
	setUsernames,
	importedGames,
	clearImported,
	type ImportProgress,
	type ImportResult,
	type SourceStatus,
} from '../data/importGames';
import { MISTAKE_CP } from '../engine/analyseGame';
import type { ImportedGameRow } from '../data/db';
import { Move } from '../components/Move';
import { ThinkingBar } from '../components/Thinking';
import { useViewport } from '../components/useViewport';
import { color, space, radius, text as textScale } from '../ui/theme';
import { Button } from '../ui/primitives';
import {
	runState,
	subscribeRun,
	startRun,
	cancelRun,
	describeRun,
	runFraction,
	type RunState,
} from '../data/importRunner';

const INK_2 = color.ink2;

export function ImportGames({ onImported }: { onImported: () => void }) {
	const saved = getUsernames();
	const [lichess, setLichess] = useState(saved.lichess);
	const [chesscom, setChesscom] = useState(saved.chesscom);
	const [max, setMax] = useState(10);
	const [minLoss, setMinLoss] = useState(MISTAKE_CP);
	// The run itself lives in data/importRunner.ts, not here. Analysing games
	// takes minutes, and state that dies when this component unmounts means the
	// import appears to have been cancelled the moment you look at another tab.
	// This view subscribes to a run; it does not own one.
	const [run_, setRun] = useState(runState);
	useEffect(() => subscribeRun(setRun), []);
	const running = run_.running;
	const progress = run_.progress;
	const result = run_.result;
	const [history, setHistory] = useState<ImportedGameRow[]>([]);
	const [repairNote, setRepairNote] = useState<string | null>(null);

	useEffect(() => {
		void importedGames().then(setHistory);
	}, []);

	async function run(force = false, overrideMax?: number) {
		setUsernames({ lichess, chesscom });
		// 'manual' matters: a run someone pressed a button for is never cancelled
		// by them going to look at something else.
		await startRun({
			kind: 'manual',
			lichess,
			chesscom,
			max: overrideMax ?? max,
			minLoss,
			force,
		});
		setHistory(await importedGames());
		onImported();
	}

	// Rows imported before moves were kept. They are excluded from the transfer
	// measurement entirely — see domain/transfer.ts — so they are not a cosmetic
	// gap: they are games that happened and cannot be counted.
	const missingMoves = history.filter((g) => !g.moves?.length);

	/**
	 * Re-fetch far enough back to reach the oldest of them and analyse again.
	 *
	 * `force` because those rows are already marked analysed, so an ordinary run
	 * skips exactly the games that need fixing. The reach is bounded, and some
	 * games may simply be older than the API will return — which is reported
	 * afterwards rather than left as a silently smaller number.
	 */
	async function repair() {
		const reach = Math.min(100, history.length + 10);
		setRepairNote(null);
		const before = missingMoves.length;
		await run(true, reach);
		const after = (await importedGames()).filter((g) => !g.moves?.length).length;
		const fixed = before - after;
		setRepairNote(
			after === 0
				? `Recovered moves for all ${before} games.`
				: `Recovered ${fixed} of ${before}. The remaining ${after} are older than the API will return, so they stay excluded rather than counted on a guess.`,
		);
	}

	return (
		<section>
			{/* No heading here: the Section this sits inside already carries one, and
				a second larger one underneath it inverted the hierarchy — the detail
				shouting louder than the thing it belongs to. */}
			<p style={{ fontSize: 12, color: INK_2, margin: '0 0 10px', maxWidth: 560 }}>
				Mistakes are mined from your recent games and filed as cards — at most four per game,
				worst first. Already-analysed games are skipped, so running it again only picks up what
				is new.
			</p>

			{(missingMoves.length > 0 || repairNote) && (
				<div
					style={{
						border: '1px solid #eda100',
						background: '#eda10010',
						borderRadius: 8,
						padding: 10,
						margin: '0 0 12px',
						fontSize: 13,
						maxWidth: 560,
					}}
				>
					{repairNote ? (
						repairNote
					) : (
						<>
							<strong>
								{missingMoves.length} imported game
								{missingMoves.length === 1 ? '' : 's'} have no moves stored.
							</strong>{' '}
							They were imported before moves were kept, so the transfer measurement cannot
							tell whether they reached any position and leaves them out entirely. Re-fetching
							them is the only way to count them.
							<div style={{ marginTop: 8 }}>
								<button onClick={() => void repair()} disabled={running}>
									{running ? 'Working…' : `Re-import to recover moves`}
								</button>
							</div>
						</>
					)}
				</div>
			)}

			<div style={{ display: 'grid', gap: 8, maxWidth: 560 }}>
				<Field label="Lichess username">
					<input
						value={lichess}
						onChange={(e) => setLichess(e.target.value)}
						placeholder="e.g. VilhelmC"
						style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
					/>
				</Field>
				<Field label="Chess.com username">
					<input
						value={chesscom}
						onChange={(e) => setChesscom(e.target.value)}
						placeholder="e.g. VilhelmC"
						style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
					/>
				</Field>
				<div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
					<Field label="Games per site" inline>
						<input
							type="number"
							min={1}
							max={100}
							value={max}
							onChange={(e) => setMax(Number(e.target.value))}
							style={{ ...inputStyle, width: 88 }}
						/>
					</Field>
					<Field label="Min. loss (cp)" inline>
						<input
							type="number"
							min={50}
							max={600}
							step={25}
							value={minLoss}
							onChange={(e) => setMinLoss(Number(e.target.value))}
							style={{ ...inputStyle, width: 96 }}
						/>
					</Field>
				</div>

				<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
					{/* Themed buttons rather than bare <button>: a browser default
						button is grey-on-grey once the page goes dark. */}
					<Button kind="primary" onClick={() => void run(false)} disabled={running}>
						{running ? 'Importing…' : 'Import new games'}
					</Button>
					<Button onClick={() => void run(true)} disabled={running}>
						Re-analyse all
					</Button>
					{running && <Button kind="quiet" onClick={cancelRun}>Cancel</Button>}
				</div>

				{/* Shown whenever a run is going, including one started before this
					view existed — a background pass, or a manual one from before you
					switched tabs. Leaving is no longer indistinguishable from
					stopping. */}
				<ImportProgressBar state={run_} />
			</div>

			<p style={{ fontSize: 12, color: INK_2, maxWidth: 560 }}>
				Lichess games you have already had analysed on the site come with their evaluations
				attached and cost nothing to mine. Everything else is searched here, roughly a quarter of
				a second per position — a ten-game import is a minute or two.
			</p>

			{progress && <ProgressBlock p={progress} />}
			{result && <ResultBlock r={result} />}

			{history.length > 0 && (
				<details style={{ marginTop: 12, fontSize: 13 }}>
					<summary style={{ cursor: 'pointer' }}>
						{history.length} games analysed so far
					</summary>
					<table style={{ borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
						<tbody>
							{history.slice(0, 30).map((g) => (
								<tr key={g.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
									<td style={{ padding: '2px 8px 2px 0' }}>
										{new Date(g.playedAt).toISOString().slice(0, 10)}
									</td>
									<td style={{ padding: '2px 8px 2px 0' }}>{g.platform}</td>
									<td style={{ padding: '2px 8px 2px 0' }}>vs {g.opponent}</td>
									<td style={{ padding: '2px 8px 2px 0' }}>{g.result}</td>
									<td style={{ padding: '2px 8px 2px 0', color: INK_2 }}>
										{g.mistakes} card{g.mistakes === 1 ? '' : 's'}
									</td>
									<td>
										<a href={g.url} target="_blank" rel="noreferrer">
											game
										</a>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<button
						onClick={async () => {
							await clearImported();
							setHistory([]);
						}}
						style={{ fontSize: 12, marginTop: 8 }}
					>
						Forget import history
					</button>
					<span style={{ fontSize: 11, color: INK_2, marginLeft: 8 }}>
						(cards stay; only the &ldquo;already seen&rdquo; list is cleared)
					</span>
				</details>
			)}
		</section>
	);
}

/** Outside React state so the analysis loop sees a cancel on the same tick. */
const inputStyle: React.CSSProperties = {
	// 16px: anything smaller makes iOS Safari zoom the page on focus.
	fontSize: 16,
	color: color.ink,
	background: color.page,
	border: `1px solid ${color.line}`,
	borderRadius: 4,
	padding: 6,
	minWidth: 0,
};

function Field({
	label,
	children,
	inline,
}: {
	label: string;
	children: React.ReactNode;
	inline?: boolean;
}) {
	const { phone } = useViewport();
	// Label above the field on a phone. Side by side, the label eats half the
	// width and leaves a number input stretched across the rest of it.
	if (phone) {
		return (
			<label style={{ display: 'block', fontSize: 13 }}>
				<span style={{ color: INK_2, display: 'block', marginBottom: 2 }}>{label}</span>
				{children}
			</label>
		);
	}
	return (
		<label
			style={{
				display: 'flex',
				gap: 8,
				alignItems: 'center',
				fontSize: 13,
				...(inline ? {} : { justifyContent: 'space-between', maxWidth: 400 }),
			}}
		>
			<span style={{ color: INK_2 }}>{label}</span>
			{children}
		</label>
	);
}

function ProgressBlock({ p }: { p: ImportProgress }) {
	return (
		<div style={{ marginTop: 12, fontSize: 13 }}>
			<div>
				<strong>
					{p.stage === 'done' ? 'Finished' : p.stage === 'fetching' ? 'Fetching' : 'Analysing'}
				</strong>{' '}
				— {p.note}
			</div>
			{p.total > 0 ? (
				<div
					style={{
						height: 6,
						background: '#eee',
						borderRadius: 3,
						marginTop: 6,
						maxWidth: 400,
					}}
				>
					<div
						style={{
							height: 6,
							width: `${Math.round((p.done / p.total) * 100)}%`,
							background: '#1565c0',
							borderRadius: 3,
						}}
					/>
				</div>
			) : (
				// Fetching: there is no denominator yet, so an indeterminate sweep is
				// the honest shape. A progress bar with a made-up total is a lie.
				p.stage !== 'done' && (
					<div style={{ marginTop: 8, maxWidth: 400 }}>
						<ThinkingBar />
					</div>
				)
			)}
			{p.sources.map((s) => (
				<SourceLine key={s.platform} s={s} />
			))}
		</div>
	);
}

function SourceLine({ s }: { s: SourceStatus }) {
	const colour =
		s.state === 'ok'
			? '#2e7d32'
			: s.state === 'fail'
				? '#c62828'
				: s.state === 'skipped'
					? '#888'
					: '#ef6c00';
	const glyph = s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : s.state === 'skipped' ? '·' : '…';
	return (
		<div style={{ fontSize: 13, color: colour, marginTop: 2 }}>
			<span style={{ fontWeight: 700, marginRight: 6 }}>{glyph}</span>
			{s.platform}: {s.note || s.state}
		</div>
	);
}

function ResultBlock({ r }: { r: ImportResult }) {
	// The engine never started, so nothing was measured. Saying "0 cards" here
	// would be a claim about the games; this is a claim about the program, and
	// they are not the same sentence.
	if (r.engineError) {
		return (
			<div
				style={{
					fontSize: 14,
					marginTop: 12,
					padding: 10,
					borderRadius: 8,
					border: `1px solid ${color.bad}`,
					background: color.badSoft,
				}}
			>
				<strong>No games were analysed — the engine did not start.</strong>
				<p style={{ margin: '6px 0 0', fontSize: 13 }}>
					Nothing here says anything about how you played. Try the analysis check on the
					Checks tab, which reports the same failure with the URL it tried.
				</p>
				<code style={{ display: 'block', marginTop: 6, fontSize: 12, opacity: 0.8 }}>
					{r.engineError}
				</code>
			</div>
		);
	}

	if (!r.cards) {
		// A game with nothing measured is not a clean game. Which of the two this
		// is decides the sentence.
		const blind = r.analysed > 0 && r.measured === 0;
		return (
			<p style={{ fontSize: 14, marginTop: 12 }}>
				{blind
					? `Walked ${r.analysed} game${r.analysed === 1 ? '' : 's'} but could not evaluate a single position, so there is nothing to report about them.`
					: r.analysed
						? `Analysed ${r.analysed} game${r.analysed === 1 ? '' : 's'} — nothing above the threshold. Lower the minimum loss to catch smaller slips.` +
							(r.unmeasured ? ` (${r.unmeasured} positions could not be evaluated.)` : '')
						: r.skipped
							? `Nothing new — all ${r.skipped} games have been analysed already.`
							: 'No games came back. See the per-site status above.'}
			</p>
		);
	}

	const worst = [...r.mistakes].sort((a, b) => b.loss - a.loss).slice(0, 8);

	return (
		<div style={{ marginTop: 12 }}>
			<p style={{ fontSize: 14, margin: '0 0 6px' }}>
				<strong>{r.cards}</strong> card{r.cards === 1 ? '' : 's'} from {r.analysed} game
				{r.analysed === 1 ? '' : 's'}
				{r.skipped ? ` · ${r.skipped} already analysed` : ''}
				{r.unmeasured ? ` · ${r.unmeasured} positions unmeasured` : ''}.
			</p>
			<ol style={{ fontSize: 13, paddingLeft: 20, margin: 0 }}>
				{worst.map((m, i) => (
					<li key={i} style={{ marginBottom: 2 }}>
						<Move san={m.playedSan} colour={m.game.ourColour} bold size={13} /> lost{' '}
						{(m.loss / 100).toFixed(1)} —{' '}
						<span style={{ color: INK_2 }}>
							<Move san={m.bestSan} colour={m.game.ourColour} size={13} /> instead, vs{' '}
							{m.game.opponent}
						</span>{' '}
						<a href={m.game.url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
							game
						</a>
					</li>
				))}
			</ol>
		</div>
	);
}

/**
 * How far along an import is, if one is going.
 *
 * A determinate bar where the total is known and an indeterminate note where it
 * is not — a bar that invents a percentage during the fetch, when the number of
 * games is not yet known, would be showing a number it does not have.
 */
function ImportProgressBar({ state }: { state: RunState }) {
	if (!state.running) return null;
	const f = runFraction(state);

	return (
		<div style={{ marginTop: space.snug }}>
			<div style={{ fontSize: textScale.note, color: color.ink2, marginBottom: space.hair }}>
				{describeRun(state)}
				{state.kind === 'background' && ' · started automatically'}
			</div>
			<div
				style={{
					height: 6,
					borderRadius: radius.pill,
					background: color.line,
					overflow: 'hidden',
				}}
				role="progressbar"
				aria-valuenow={f === null ? undefined : Math.round(f * 100)}
			>
				<div
					style={{
						height: '100%',
						width: f === null ? '100%' : `${Math.round(f * 100)}%`,
						background: color.accent,
						opacity: f === null ? 0.35 : 1,
						transition: 'width 300ms linear',
					}}
				/>
			</div>
		</div>
	);
}

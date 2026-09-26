// Progress.
//
// Built around one question: WHERE does recall break down? "78% accurate" is a
// number you can do nothing with. "Solid to move 4, falls apart on move 5" tells
// you what to train tomorrow.

import { useEffect, useMemo, useState } from 'react';
import { ProgressTree } from '../components/ProgressTree';
import { MoveLine } from '../components/Move';
import { buildTree, weakSpots, accuracyOf, deepestKnown, type TreeNode } from '../domain/tree';
import { loadPractice, savePractice } from '../domain/practice';
import { nameForPath } from '../domain/openings';
import { estimate, ratingSeries, type RatingPoint } from '../domain/rating';
import { loadProgress, clearProgress } from '../data/progress';
import { attempts } from '../data/puzzleHistory';
import { puzzleSeries, streaks } from '../domain/puzzleProgress';
import { db, type PuzzleAttempt } from '../data/db';
import { loadMistakes } from '../data/mistakes';
import {
	transferReport,
	dataCoverage,
	gamesStillNeeded,
	describeChange,
	type DataCoverage,
	type PlayedGame,
} from '../domain/transfer';
import { SyncStatus } from '../components/SyncStatus';
import { useMeasure } from '../components/useViewport';
import {
	performanceReport,
	accuracyByBand,
	weakestBand,
	MIN_MOVES_PER_BAND as MIN_BAND,
	type MeasurableGame,
} from '../domain/performance';
import {
	accuracy,
	freeplayLosses,
	gameLosses,
	gameLossRows,
	type AnswerRow,
	type RunRow,
} from '../domain/progress';
import { fromGame, type Reviewable } from '../domain/reviewable';
import { splitBySpeed } from '../domain/playedGames';
import { color, radius, space, text as type } from '../ui/theme';
import { Button, Segmented } from '../ui/primitives';

// Single series, so no categorical palette to validate — one hue for magnitude,
// status colours for state, and every status carries a label rather than relying
// on colour alone.
const INK = color.ink;
const INK_2 = color.ink2;
/*
 * The accent, not a blue of its own.
 *
 * `#2a78d6` was chosen back when the app's chrome was blue; the chrome is
 * violet now and this was the largest remaining piece of the old palette still
 * on screen. A single-series chart has no reason to pick its own hue — "the one
 * colour this app uses for the thing you are looking at" IS the accent.
 */
const SERIES = color.accent;

/**
 * Which measurement the chart is plotting.
 *
 * ---------------------------------------------------------------------------
 * THE NAMES CHANGED, AND THAT WAS THE LARGER HALF OF THE FIX.
 *
 * Will: "'from free play' is not intuitive since free play arguably is games.
 * New name for clarity — something like Chesshire free play. And 'from your
 * games' could be Imported games."
 *
 * He is right that the old pair did not distinguish anything: "your games" and
 * "free play" are both games, both yours, and the difference between them —
 * one was played here against the bot, the other was played elsewhere against
 * people — was the one thing neither label said. The new pair says WHERE each
 * came from, which is the whole distinction.
 */
export type RatingSource = 'games' | 'freeplay' | 'puzzles';

const SOURCES: { id: RatingSource; label: string; title: string }[] = [
	{
		id: 'games',
		label: 'Imported games',
		title: 'Real opponents, from games imported on the Settings tab',
	},
	{
		id: 'freeplay',
		label: 'Chesshire free play',
		title: 'Played on against the bot here, after a punished mistake',
	},
	/*
	 * A THIRD SOURCE, NOT A THIRD CHART.
	 *
	 * Will: "puzzle rating over time perhaps is just an option on existing graph
	 * in 'Progress' tab?" It is, and it is the cheapest of the three to add
	 * because nothing has to be recomputed — every attempt stored the rating that
	 * came out of it.
	 *
	 * It is NOT comparable with the other two and the chart does not pretend
	 * otherwise: each series sets its own vertical scale, and this one plots a
	 * Glicko rating on the puzzles' scale while those two plot an estimate
	 * derived from centipawn loss. Same axis label, different measurements — the
	 * segmented control is what keeps them from being read as one line.
	 */
	{
		id: 'puzzles',
		label: 'Puzzles',
		title: 'Your puzzle rating, from the Puzzles tab',
	},
];
const CRITICAL = color.bad;
const GOOD = color.good;
const GRID = color.line;

export function Progress({ onOpenReview }: { onOpenReview?: () => void } = {}) {
	const [answers, setAnswers] = useState<AnswerRow[]>([]);
	const [runs, setRuns] = useState<RunRow[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [pinned, setPinned] = useState<string | null>(null);
	const [source, setSource] = useState<RatingSource>('games');
	const [played, setPlayed] = useState<PlayedGame[]>([]);
	const [puzzleRows, setPuzzleRows] = useState<PuzzleAttempt[]>([]);
	/** The same games, kept whole, for the accuracy measurement. */
	const [rawGames, setRawGames] = useState<MeasurableGame[]>([]);
	/**
	 * And again as reviewables, which is where the evaluations get turned to OUR
	 * point of view. Not reconstructed from `rawGames`: that conversion has a
	 * warning on it in `fromGame` for good reason, and one copy of it is enough.
	 */
	const [playedGames, setPlayedGames] = useState<Reviewable[]>([]);

	async function reload() {
		const d = await loadProgress();
		setAnswers(d.answers);
		setRuns(d.runs);
		// Its own read, and its own failure: `attempts` already swallows a broken
		// table and returns nothing, so a missing puzzle history must not take the
		// rest of this page down with it.
		setPuzzleRows(await attempts(2000));
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
			setPlayedGames(
				games.map(fromGame).filter((r): r is Reviewable => r !== null),
			);
			setRawGames(
				games.map((g) => ({
					id: g.id,
					playedAt: g.playedAt,
					ourColour: g.ourColour ?? 'w',
					evals: g.evals,
					moves: g.moves,
				})),
			);
		} catch {
			setPlayed([]);
			setRawGames([]);
			setPlayedGames([]);
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
	const perf = performanceReport(rawGames);
	const bands = accuracyByBand(rawGames);
	const worst = weakestBand(bands);
	const gameCoverage = dataCoverage(played);
	const stillNeeded = gamesStillNeeded(transfer);

	// One definition of "a move that measures strength", shared with the trainer.
	const scored = answers.filter(
		(a) => a.phase === 'freeplay' && !a.assisted && a.cpLoss >= 0,
	);
	const rating = estimate(freeplayLosses(answers));
	const freeSeries = ratingSeries(
		scored.map((a) => ({ runId: a.runId, ts: a.ts, cpLoss: a.cpLoss })),
	);

	/*
	 * TWO NUMBERS, BECAUSE THEY MEASURE TWO THINGS.
	 *
	 * Will: "why is my rating estimate only based on 28 scored moves, when there
	 * are plenty of games imported." Because imported games never reached the
	 * estimator at all — see `gameLosses`. They do now, and they are kept
	 * SEPARATE rather than pooled: one is real opponents at your own time
	 * control, the other is a bot after a punished mistake, and merged into a
	 * single figure a change in it could not be attributed to either.
	 */
	const live = useMemo(() => splitBySpeed(playedGames), [playedGames]);
	/** The app's own idea of where the book ends, shared by both readers below. */
	const bookDepth = (moves: string[]) => nameForPath(moves)?.path.length ?? 0;
	const fromGames = useMemo(() => estimate(gameLosses(live.counted, bookDepth)), [live]);
	/*
	 * THE SAME TREND, OVER GAMES INSTEAD OF RUNS.
	 *
	 * Will: "the graph in Progress only shows the 'from free play' estimate.
	 * User should be able to choose 'from your games' instead."
	 *
	 * One chart, two sources, and NO second chart component: `ratingSeries` was
	 * always general over (id, when, how much) and only ever saw one source
	 * because the game losses were thrown into a flat array before anything
	 * could keep their dates. `gameLossRows` keeps them.
	 */
	const gameSeries = useMemo(
		() => ratingSeries(gameLossRows(live.counted, bookDepth)),
		[live],
	);
	const puzzleSeriesPoints = useMemo(() => puzzleSeries(puzzleRows), [puzzleRows]);
	const puzzleStreak = useMemo(() => streaks(puzzleRows), [puzzleRows]);
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

	// `fromGames` belongs in this test now: a deck built entirely from imported
	// games has no answers at all and still has a rating, and the old condition
	// sent exactly that reader away with "play a few runs".
	if (!root.total.attempts && !scored.length && fromGames.elo === null) {
		return (
			<p style={{ opacity: 0.7 }}>
				Nothing measured yet. Play a run on the Train tab, or import your games on Settings.
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
						fontSize: type.note,
						color: color.ink,
						background: color.accentSoft,
						border: `1px solid ${color.accent}`,
						borderRadius: radius.small,
						padding: `${space.snug}px ${space.gap}px`,
						marginBottom: space.card,
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

			{/* A shortcut into the Review tab, not the only way in. Going to look
				at a game because a number here said so is a real path, but it is
				not the only reason anyone opens a game.

				It was `background: '#fff'` with `color: INK`. INK follows the theme
				and the white did not, so in dark mode this was near-white text on
				white — the exact report. Through the shared Button it cannot
				happen: both halves of the pairing come from the same palette. */}
			{onOpenReview && (
				<div style={{ marginBottom: space.section }}>
					<Button onClick={onOpenReview}>Review your games and runs →</Button>
				</div>
			)}

			<section
				style={{ border: `1px solid ${GRID}`, borderRadius: 10, padding: 16, marginBottom: 16 }}
			>
				<h3 style={{ margin: '0 0 2px', color: INK }}>Estimated rating</h3>
				<p style={{ fontSize: 13, color: INK_2, margin: '0 0 10px' }}>
					Two measurements of two different things, kept apart on purpose. Both skip the
					opening: recalling a memorised move measures memory, so counting it would show the
					number climbing every time you revised. Correspondence games are left out for the
					same reason — with an analysis board open, the moves are not yours alone. The graph
					can also plot your puzzle rating, which is measured a third way again — by which
					puzzles you solve, on the Puzzles tab — so read each line on its own.
				</p>

				<div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 4 }}>
					<Estimate
						label="Imported games"
						note={
							live.population.correspondence > 0
								? `real opponents, past the named opening · ${live.population.correspondence} correspondence ${live.population.correspondence === 1 ? 'game' : 'games'} set aside`
								: 'real opponents, past the named opening'
						}
						e={fromGames}
						empty="Import your games on the Settings tab."
					/>
					<Estimate
						label="Chesshire free play"
						note="played on against the bot after a mistake"
						e={rating}
						empty="Punish a mistake, then use play on."
					/>
				</div>

				{(() => {
					const series: Record<
						RatingSource,
						{ points: RatingPoint[]; unit: string; faint: string; empty: string }
					> = {
						games: {
							points: gameSeries,
							unit: 'game',
							faint: 'per game',
							empty: 'No analysed games yet. Import some on the Settings tab.',
						},
						freeplay: {
							points: freeSeries,
							unit: 'run',
							faint: 'per run',
							empty: 'No free play yet. Punish a mistake, then use play on.',
						},
						puzzles: {
							points: puzzleSeriesPoints,
							unit: 'puzzle',
							// NOT "per puzzle", which would claim the faint line is an estimate
							// of you from one puzzle. It is the puzzle's own rating — the
							// difficulty you were handed — and mislabelling it would make the
							// two lines look like a noisy and a smooth version of one thing.
							faint: 'difficulty met',
							empty: 'No rated puzzle attempts yet. Solve some on the Puzzles tab.',
						},
					};
					const { points: plotted, unit, faint, empty } = series[source];
					const anywhere = Object.values(series).some((s) => s.points.length >= 2);
					return (
						<>
							{/* Only offered when there is a second thing to switch TO. A
								control whose alternative is empty is a control that punishes
								you for trying it. */}
							{anywhere && (
								<div style={{ marginTop: space.gap }}>
									<Segmented
										label="Which rating to plot"
										options={SOURCES}
										value={source}
										onChange={setSource}
									/>
								</div>
							)}
							{plotted.length >= 2 ? (
								<RatingChart series={plotted} unit={unit} faint={faint} />
							) : (
								<p style={{ fontSize: type.body, color: INK_2, marginTop: space.snug }}>
									{plotted.length === 1 ? `One ${unit} so far — a trend needs at least two.` : empty}
								</p>
							)}
							{source === 'puzzles' && puzzleStreak.best > 0 && (
								<p style={{ fontSize: type.note, color: INK_2, margin: `${space.snug}px 0 0` }}>
									{puzzleStreak.current > 1
										? `${puzzleStreak.current} solved in a row right now`
										: 'No streak running'}{' '}
									· best {puzzleStreak.best}. Helped solves are skipped, not counted against you.
								</p>
							)}
						</>
					);
				})()}
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
								<Button kind="quiet" onClick={() => pin(n)}>
									practise from here
								</Button>
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

				{/* What the measurement can see, stated before any of its numbers.
					An empty report otherwise reads as a verdict on the training when
					it is a fact about the sample. */}
				<CoverageLine c={gameCoverage} stillNeeded={stillNeeded} />
				<SyncStatus />

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
				<h3 style={{ margin: '0 0 2px', color: INK }}>How well you actually play</h3>
				<p style={{ fontSize: 13, color: INK_2, marginTop: 2 }}>
					Accuracy over your imported games, by{' '}
					<a href="https://lichess.org/page/accuracy" target="_blank" rel="noreferrer">
						Lichess&apos;s published method
					</a>{' '}
					— so a game here should read the same as the same game does there. This moves
					faster than the transfer measurement above and answers a different question:
					not <em>is the training working</em>, but <em>what should you practise next</em>.
				</p>

				{perf.accuracy === null ? (
					<div style={{ fontSize: 14, color: INK_2 }}>
						No games could be scored yet.
						{perf.reasons.length > 0 && (
							<ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
								{perf.reasons.map((r) => (
									<li key={r.reason}>
										{r.count} — {r.reason}
									</li>
								))}
							</ul>
						)}
					</div>
				) : (
					<>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
								gap: 8,
								margin: '10px 0',
							}}
						>
							<Tile
								label="Accuracy, last 10"
								value={perf.recent === null ? '—' : `${perf.recent.toFixed(1)}%`}
								note={`${Math.min(10, perf.scored.length)} most recent games`}
							/>
							<Tile
								label="Accuracy, all games"
								value={`${perf.accuracy.toFixed(1)}%`}
								note={`${perf.scored.length} measured`}
							/>
							<Tile
								label="Blunders per game"
								value={perf.blundersPerGame === null ? '—' : perf.blundersPerGame.toFixed(2)}
								note="a 30-point drop in win chance"
							/>
						</div>

						{/* The band table is the diagnostic half: an overall number is a
							scoreboard, "94% to move 10 and 61% after 20" is an instruction. */}
						<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
							<tbody>
								{bands.map((b) => (
									<tr key={b.label} style={{ borderTop: `1px solid ${GRID}` }}>
										<td style={{ padding: '4px 8px 4px 0' }}>{b.label}</td>
										<td
											style={{
												textAlign: 'right',
												fontVariantNumeric: 'tabular-nums',
												color: b.label === worst?.label ? CRITICAL : INK_2,
												fontWeight: b.label === worst?.label ? 600 : 400,
											}}
										>
											{b.accuracy === null
												? `— (${b.moves} of ${MIN_BAND} moves)`
												: `${b.accuracy.toFixed(1)}%`}
										</td>
									</tr>
								))}
							</tbody>
						</table>

						{worst && (
							<p style={{ fontSize: 13, color: INK, marginTop: 8 }}>
								Weakest stretch: <strong>{worst.label}</strong>, at{' '}
								{worst.accuracy?.toFixed(1)}%.
							</p>
						)}

						{perf.unmeasured > 0 && (
							<div style={{ fontSize: 12, color: INK_2, marginTop: 8 }}>
								{/* A bare "15 excluded" is a number with no remedy attached.
									Each cause needs a different action, so each is named. */}
								{perf.unmeasured} game{perf.unmeasured === 1 ? '' : 's'} could not be
								measured, left out entirely rather than averaged over whichever moves
								happen to have been analysed:
								<ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
									{perf.reasons.map((r) => (
										<li key={r.reason}>
											{r.count} — {r.reason}
										</li>
									))}
								</ul>
							</div>
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

			<div style={{ marginTop: space.page }}>
				<Button
					kind="danger"
					onClick={async () => {
						await clearProgress();
						await reload();
					}}
				>
					Reset progress
				</Button>
			</div>
		</div>
	);
}

/** One estimate, said the same way wherever it appears. */
function Estimate({
	label,
	note,
	e,
	empty,
}: {
	label: string;
	note: string;
	e: { elo: number | null; acpl: number | null; sample: number; confident: boolean };
	empty: string;
}) {
	return (
		<div>
			<div style={{ fontSize: 13, color: INK_2 }}>{label}</div>
			{e.elo === null ? (
				<div style={{ fontSize: 14, color: INK_2, marginTop: 4, maxWidth: 240 }}>{empty}</div>
			) : (
				<>
					<div style={{ fontSize: 34, fontWeight: 700, color: INK, lineHeight: 1.1 }}>
						{e.elo}
					</div>
					<div style={{ fontSize: 13, color: INK_2 }}>
						{e.confident ? '' : 'provisional — '}
						{e.sample} moves · {e.acpl}cp average loss
					</div>
					<div style={{ fontSize: 12, color: INK_2, opacity: 0.75 }}>{note}</div>
				</>
			)}
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
function RatingChart({
	series,
	unit,
	faint,
}: {
	series: RatingPoint[];
	unit: string;
	/**
	 * What the faint line IS, in the caller's words.
	 *
	 * It was hard-coded as `per ${unit}` back when both sources were cp-loss
	 * estimates and the faint line really was "the same estimate, from one item".
	 * The puzzle series breaks that: its faint line is the difficulty it served
	 * you, which is not an estimate of you at all. A legend that says otherwise is
	 * worse than no legend.
	 */
	faint: string;
}) {
	/*
	 * THE WIDTH IS MEASURED, NOT ASSUMED.
	 *
	 * This was `const W = 520` written straight onto the SVG's `width` attribute
	 * with no `viewBox`, so on any column narrower than 520px the chart simply
	 * hung out of its card. The repo already had the answer twice over —
	 * `BoardPanel` sizes the board from its container and `MoveList` picks its
	 * column count the same way, both using `useMeasure` — and this was the one
	 * drawing that never got it.
	 *
	 * Measured rather than scaled with a `viewBox`, which was the cheaper fix:
	 * a viewBox shrinks the axis labels along with the plot, and a 10px label at
	 * 60% is not a label any more.
	 */
	const [ref, available] = useMeasure<HTMLDivElement>();
	// 520 while unmeasured, so the first paint is the old size rather than zero.
	const W = Math.max(240, Math.min(available || 520, 520));
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
		<figure ref={ref} style={{ margin: '12px 0 0', minWidth: 0 }}>
			<svg
				width={W}
				height={H}
				viewBox={`0 0 ${W} ${H}`}
				style={{ maxWidth: '100%', display: 'block' }}
				role="img"
				aria-label={`Rating over time, one point per ${unit}`}
			>
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
							{new Date(p.ts).toLocaleDateString()} — {faint} {p.elo}, overall {p.cumulative}
							{p.moves > 1 ? ` (${p.moves} moves)` : ''}
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
					{faint}
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

/**
 * What the transfer measurement is working from.
 *
 * Count AND span. Four games from one evening split into two windows that are
 * really the same afternoon; four spread over two months are a comparison. A
 * bare count cannot tell those apart, so it does not get to stand alone.
 */
function CoverageLine({
	c,
	stillNeeded,
}: {
	c: DataCoverage;
	stillNeeded: number | null;
}) {
	const day = (t: number) => new Date(t).toISOString().slice(0, 10);
	return (
		<p style={{ fontSize: 12, color: INK_2, margin: '0 0 8px' }}>
			<strong>{c.usable}</strong> game{c.usable === 1 ? '' : 's'} with moves
			{c.from !== null && c.to !== null && (
				<>
					{' '}
					· {day(c.from)} to {day(c.to)}
					{c.spanDays !== null && c.spanDays > 0 && ` (${c.spanDays} days)`}
				</>
			)}
			{c.unusable > 0 && ` · ${c.unusable} without moves, excluded`}
			{stillNeeded !== null &&
				stillNeeded > 0 &&
				` · ${stillNeeded} more game${stillNeeded === 1 ? '' : 's'} through a drilled position before anything can be said`}
			{stillNeeded === null && c.usable > 0 && ' · nothing drilled yet to compare against'}
		</p>
	);
}

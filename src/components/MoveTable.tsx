// One table of moves, in every tab, with a way to ask about each one.
//
// ---------------------------------------------------------------------------
// Will, on the three buttons this replaces:
//
//   "We should unify these three buttons: one table, the buttons just toggle
//    different entries (may overlap) … so we use the same component for all
//    three buttons and the buttons just toggle which moves are included."
//
// And on the explainer:
//
//   "Our standard move list component needs a way to let user ask for move
//    explanation ('?' button for each one, or a '?' button to toggle in the
//    array and then user clicks on the move they want explained)."
//
// Both are here. The filter chips switch which rows show; the `?` on each row
// opens an explanation of it. Which means the doorway into the explainer is now
// a property of the move list rather than something each host wires up its own
// way — the Lab had a clickable table, Train had a list that did nothing, and
// Mistakes had a third arrangement.
//
// EVERY COLUMN CAN BE EMPTY, and shows blank rather than zero when it is. An
// evaluation costs a search per move, popularity costs a round trip, and neither
// is available the instant the table appears. A zero in an eval column reads as
// "equal", which is a claim; "…" is the truth.
// ---------------------------------------------------------------------------

import { Move } from './Move';
import { evalText, lossText, type MoveRow, type MoveSource } from '../domain/moveTable';
import { color, space, text, mono, radius } from '../ui/theme';
import { sharePercent } from '../domain/distribution';

const SOURCE_LABEL: Record<MoveSource, string> = {
	line: 'the line',
	popular: 'played here',
	engine: 'engine',
};

/** What each tag means, said once, so the chips do not have to be guessed at. */
const SOURCE_TITLE: Record<MoveSource, string> = {
	line: 'A move the opening line allows',
	popular: 'Played here in real games — the explorer',
	engine: "Among Stockfish's own top moves",
};

export type MoveTableProps = {
	rows: MoveRow[];
	mover: 'w' | 'b';
	/** Which sources are shown. Empty means all of them. */
	on: ReadonlySet<MoveSource>;
	onToggle: (source: MoveSource) => void;
	/** Ask about a move. Absent in a host with no explainer. */
	onAsk?: (uci: string) => void;
	/** Marked with a star — the move actually played, or the puzzle's answer. */
	marked?: string;
	/** Named so the region can be referred to. See `docs/REGIONS.md`. */
	region?: string;
	/** Said when the filters admit nothing. */
	empty?: string;
};

export function MoveTable({
	rows,
	mover,
	on,
	onToggle,
	onAsk,
	marked,
	region = 'move-table',
	empty = 'Nothing to show with these filters.',
}: MoveTableProps) {
	// The best row for the loss column is the best row OVERALL, not the best one
	// the filter happens to admit — otherwise hiding the engine's pick silently
	// re-bases every gap beneath it.
	const best = rows.find((r) => r.cp !== null);
	const shown = on.size ? rows.filter((r) => r.sources.some((s) => on.has(s))) : rows;

	// A source with no rows at all is a chip nobody can usefully press.
	const available = new Set<MoveSource>();
	for (const r of rows) for (const s of r.sources) available.add(s);
	// A column nobody has data for is a column of blanks with a heading, which
	// reads as missing data rather than as a question not asked.
	const anyPopularity = rows.some((r) => r.share !== null);

	return (
		<div data-region={region}>
			{/*
			  * NO CHIPS WHEN THERE IS NOTHING TO CHOOSE BETWEEN. A single-source
			  * table — the explainer's, which only ever has the engine — would show
			  * one button that filters to everything, which is a control that does
			  * nothing and has to be understood before it can be ignored.
			  */}
			<div
				style={{
					display: available.size > 1 ? 'flex' : 'none',
					gap: space.tight,
					flexWrap: 'wrap',
					marginBottom: space.tight,
				}}
			>
				{(['line', 'engine', 'popular'] as MoveSource[])
					.filter((s) => available.has(s))
					.map((s) => (
						<button
							key={s}
							onClick={() => onToggle(s)}
							title={SOURCE_TITLE[s]}
							style={{
								fontSize: text.note,
								padding: '2px 8px',
								borderRadius: radius.small,
								border: `1px solid ${on.has(s) ? color.accent : color.line}`,
								background: on.has(s) ? color.accentSoft : 'transparent',
								color: color.ink,
								cursor: 'pointer',
							}}
						>
							{SOURCE_LABEL[s]}
						</button>
					))}
				{on.size > 0 && (
					<span style={{ fontSize: text.note, color: color.ink3, alignSelf: 'center' }}>
						{shown.length} of {rows.length}
					</span>
				)}
			</div>

			{!shown.length ? (
				<div style={{ fontSize: text.note, color: color.ink2 }}>{empty}</div>
			) : (
				<div style={{ overflowX: 'auto' }}>
					<table style={{ borderCollapse: 'collapse', fontSize: text.body, width: '100%' }}>
						<thead>
							<tr style={{ color: color.ink2, fontSize: text.note }}>
								<th style={th}> </th>
								<th style={th}>move</th>
								<th style={{ ...th, textAlign: 'right' }}>eval</th>
								<th style={{ ...th, textAlign: 'right' }}>loss</th>
								{anyPopularity && <th style={{ ...th, textAlign: 'right' }}>played</th>}
								{anyPopularity && <th style={{ ...th, textAlign: 'right' }}>scores</th>}
								<th style={th}> </th>
							</tr>
						</thead>
						<tbody>
							{shown.map((r) => (
								<tr key={r.uci} style={{ borderTop: `1px solid ${color.line}` }}>
									<td style={td}>{r.uci === marked ? '★' : ''}</td>
									<td style={{ ...td, fontWeight: r.uci === marked ? 600 : 400 }}>
										<Move san={r.san} colour={mover} size={14} />
										{/* The tags, so a row says which lists it is in without the
										    reader having to toggle the filters to find out. */}
										{available.size > 1 && (
											<span style={{ marginLeft: 6, fontSize: 10, color: color.ink3 }}>
												{r.sources.map((s) => SOURCE_LABEL[s]).join(' · ')}
											</span>
										)}
									</td>
									<td style={{ ...td, textAlign: 'right', fontFamily: mono }}>{evalText(r)}</td>
									<td
										style={{
											...td,
											textAlign: 'right',
											fontFamily: mono,
											color: r.loss ? color.ink2 : color.good,
										}}
									>
										{lossText(r, best)}
									</td>
									{/*
									  * THE BAR, back from `DistributionList`. Its comment had the
									  * reason and the first version of this table threw both away:
									  * "Frequency is the length of the bar because frequency is the
									  * point: this is a list of what you will actually meet."
									  *
									  * A column of percentages is read one number at a time; a column
									  * of bars is read at a glance, which is the whole difference
									  * between knowing 34% and seeing that one move is most of the
									  * position.
									  */}
									{anyPopularity && (
									<td style={{ ...td, minWidth: 92 }}>
										{r.share === null ? null : (
											<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
												<div
													style={{
														flex: 1,
														height: 8,
														background: color.line,
														borderRadius: radius.pill,
														overflow: 'hidden',
														minWidth: 40,
													}}
													title={r.games === null ? undefined : `${r.games.toLocaleString()} games`}
												>
													<div
														style={{
															width: `${Math.max(1, r.share * 100)}%`,
															height: '100%',
															background: color.accent,
														}}
													/>
												</div>
												<span
													style={{
														color: color.ink2,
														fontVariantNumeric: 'tabular-nums',
														whiteSpace: 'nowrap',
														fontSize: text.note,
													}}
												>
													{sharePercent(r.share)}
												</span>
											</div>
										)}
									</td>
									)}
									{anyPopularity && (
									<td
										style={{
											...td,
											textAlign: 'right',
											fontFamily: mono,
											// 50% is the neutral point of an expected score, not zero, so
											// the tone turns there rather than at the bottom of the range.
											color:
												r.score === null
													? color.ink2
													: r.score > 0.55
														? color.good
														: r.score < 0.45
															? color.bad
															: color.ink2,
										}}
									>
										{r.score === null ? '' : `${(r.score * 100).toFixed(0)}%`}
									</td>
									)}
									<td style={td}>
										{onAsk && (
											<button
												onClick={() => onAsk(r.uci)}
												title={`Why ${r.san}?`}
												style={{
													border: 'none',
													background: 'none',
													color: color.accent,
													cursor: 'pointer',
													fontSize: 13,
												}}
											>
												?
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{anyPopularity && (
					<div style={{ fontSize: text.note, color: color.ink3, marginTop: space.tight }}>
						<strong>played</strong> is the share of games from this position; <strong>scores</strong> is the
						expected score for {mover === 'w' ? 'White' : 'Black'} — a win is 100%, a draw 50%. Neither is
						an evaluation. A blank cell is <em>not looked up</em>, never zero.
					</div>
					)}
				</div>
			)}
		</div>
	);
}

const th: React.CSSProperties = { fontWeight: 400, padding: '2px 12px 4px 0' };
const td: React.CSSProperties = { padding: '3px 12px 3px 0' };

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

import { useState } from 'react';
import { Move } from './Move';
import {
	availableSources,
	effectiveSources,
	evalText,
	filterMoves,
	lossText,
	nothingAsked,
	type MoveRow,
	type MoveSource,
} from '../domain/moveTable';
import { ACTIVE, color, space, text, mono, radius } from '../ui/theme';
import { sharePercent } from '../domain/distribution';

/*
 * THE WORD IS THE SAME EVERYWHERE IT APPEARS.
 *
 * Will: "labels are not intuitive and icons too similar… change 'show' to
 * 'book' since it displays the book moves."
 *
 * "book" is the app's own word — the tagline is "drills what happens when the
 * book runs out", the strictness options say "book move", the run has a book
 * phase — and "the line" was a second name for it. The deeper fault was that
 * the toolbar button and the table chip were one control under two names, which
 * is why one of them always read as unintuitive.
 *
 * `engine` over `stockfish`: the explainer already says "the engine's line", and
 * naming the implementation would be a second name again. `played` over "stats"
 * or "frequent" — it says whose fact it is, which is what the other two do.
 */
const SOURCE_LABEL: Record<MoveSource, string> = {
	line: 'book',
	popular: 'played',
	engine: 'engine',
};

/** What each tag means, said once, so the chips do not have to be guessed at. */
const SOURCE_TITLE: Record<MoveSource, string> = {
	line: 'Theory: a move your repertoire allows here',
	popular: 'Played here in real games — the Lichess explorer',
	engine: "Among Stockfish's own top moves for this position",
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
	/**
	 * Said when the filters admit nothing.
	 *
	 * Left undefined by default so the table can say something better: with an
	 * intersection an empty result is a FINDING — these sources share no move —
	 * and naming the sources is the whole of it. A host with a different story
	 * can still override.
	 */
	empty?: string;
	/**
	 * How many rows before the tail is folded away.
	 *
	 * `DistributionList` had `limit = 8` and the first version of this table
	 * dropped it, so an opening position rendered its entire long tail — thirty
	 * rows, every share under 1%, every bar empty. The tail is real data and
	 * occasionally what you want, so it folds rather than vanishing.
	 */
	limit?: number;
	/**
	 * The explorer has been asked and has answered.
	 *
	 * A position deep in a real game has no games in the explorer, and pressing
	 * "played here" then did nothing visible: no rows, no chip (a source with no
	 * rows has no chip to press), no message. Silence after a button press reads
	 * as a broken button rather than as an answer, so the host says it asked and
	 * this says what came back.
	 */
	askedPopularity?: boolean;
};

export function MoveTable({
	rows,
	mover,
	on,
	onToggle,
	onAsk,
	marked,
	region = 'move-table',
	empty,
	limit = 10,
	askedPopularity = false,
}: MoveTableProps) {
	const [all, setAll] = useState(false);
	// The best row for the loss column is the best row OVERALL, not the best one
	// the filter happens to admit — otherwise hiding the engine's pick silently
	// re-bases every gap beneath it.
	const best = rows.find((r) => r.cp !== null);
	const available = availableSources(rows);
	// ONE FILTER, and it is the tested one. This had its own inline copy of the
	// rule while `filterMoves` sat in the domain with tests on it — two answers
	// to one question, and the shipped one was the untested one.
	// A SOURCE THAT IS NOT HERE DOES NOT GET A VETO — see `effectiveSources`.
	// The board filters by the same rule, which is why it is in the domain.
	const effective = effectiveSources(rows, on);
	const absent = nothingAsked(rows, on);
	const admitted = absent ? [] : filterMoves(rows, effective);
	const shown = all ? admitted : admitted.slice(0, limit);
	const folded = admitted.length - shown.length;

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
								// The same "on" as the toolbar's — see `ACTIVE`. This used to
								// be a tint and a hairline, which is not enough to answer
								// "is this one on" at a glance.
								border: `1px solid ${on.has(s) ? ACTIVE.border : color.line}`,
								background: on.has(s) ? ACTIVE.background : 'transparent',
								color: on.has(s) ? ACTIVE.color : color.ink,
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

			{askedPopularity && !anyPopularity && (
				<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight }}>
					No games from this position in the explorer.
				</div>
			)}

			{!shown.length ? (
				/*
				  * AN EMPTY TABLE IS AN ANSWER, so it says which answer.
				  *
				  * Under the union this could only happen with no rows at all. Under
				  * the intersection it happens whenever two sources genuinely share no
				  * move — which is worth knowing and is exactly what was asked — and a
				  * bare "nothing to show" would read as the filter being broken. That
				  * is the same failure as the button that answered silence.
				  */
				<div style={{ fontSize: text.note, color: color.ink2 }}>
					{empty ??
						(absent
							? `Nothing here is ${[...on].map((s2) => SOURCE_LABEL[s2]).join(' or ')}.`
							: effective.size > 1
								? `No move is ${[...effective].map((s2) => SOURCE_LABEL[s2]).join(' and ')} at once.`
								: 'Nothing to show with these filters.')}
				</div>
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
					{folded > 0 && (
						<button
							onClick={() => setAll(true)}
							style={{
								border: 'none',
								background: 'none',
								color: color.accent,
								cursor: 'pointer',
								fontSize: text.note,
								padding: `${space.tight}px 0 0`,
							}}
						>
							show {folded} more
						</button>
					)}
					{all && admitted.length > limit && (
						<button
							onClick={() => setAll(false)}
							style={{
								border: 'none',
								background: 'none',
								color: color.accent,
								cursor: 'pointer',
								fontSize: text.note,
								padding: `${space.tight}px 0 0`,
							}}
						>
							show fewer
						</button>
					)}
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

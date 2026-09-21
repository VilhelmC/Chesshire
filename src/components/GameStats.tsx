// How a game was played: two accuracies, the judgement counts, and the chances.
//
// ---------------------------------------------------------------------------
// WHY THIS LEFT REVIEW.
//
// Will: "the statistics shown in review could be togglable since they really
// apply to any game?"
//
// They do, and the reason is in the inputs: every number here is computed from
// a list of CENTIPAWN LOSSES. Nothing in it knows about a stored run, an
// imported PGN or a review screen — it takes how much each move gave up and
// counts. A game being played right now produces exactly the same list, one
// entry at a time, so the panel works live with no new machinery at all.
//
// ---------------------------------------------------------------------------
// AND WHY IT IS NOT ON EVERY TAB.
//
// "Any game" is the operative word. Train and Mistakes are DRILLS: their
// centipawn losses measure recall of a line you are trying to memorise, and
// averaging them into an accuracy would answer "how well do you remember the
// Italian" with a number that reads as "how well do you play chess". Those are
// different questions and the app is careful about the difference everywhere
// else — see `domain/rating.ts`, and `storedPhase`, which exists so that only
// free play feeds the rating estimate. So: Play and Review, which are games.
//
// ---------------------------------------------------------------------------
// THE OPPONENT'S COLUMN IS OFTEN EMPTY, AND THAT IS NOT A BUG.
//
// Scoring their move needs an evaluation before AND after it, measured the same
// way. In a live game the app has the eval after OUR move (from `scoreMove`,
// local engine, 300ms) and the eval at our next turn (from `analysePosition`,
// which prefers Lichess's deep cloud cache) — two different budgets. Take the
// difference and you get a number dominated by the depth gap rather than by
// their move, which is precisely the mistake `engine/score.ts` was written to
// stop; it is how a poor game once came out at 1639.
//
// So a live game passes `theirs` empty and this says "not scored", which is
// true. Review has a full analysis of both sides and passes both. Anyone
// tempted to fill the gap by subtracting the two evals we happen to have should
// read `engine/score.ts` first.
// ---------------------------------------------------------------------------

import {
	distribution,
	accuracyPercent,
	QUALITY_COLOUR,
	QUALITY_LABEL,
	QUALITY_ORDER,
	type Quality,
} from '../domain/review';
import { Note } from '../ui/primitives';
import { color, space, text } from '../ui/theme';

const INK = color.ink;
const INK_2 = color.ink2;

export function GameStats({
	ours,
	theirs = [],
	tally,
	/** Overridden by a screen where the game is still going on. */
	title = 'How it was played',
	region = 'game-stats',
}: {
	/** Centipawns our moves gave up. One entry per move that was measured. */
	ours: number[];
	/** The same for theirs, when anything measured them. See the header. */
	theirs?: number[];
	/** Chances they offered and the ones that went by. Review only. */
	tally?: { offered: number; missed: number };
	title?: string;
	region?: string;
}) {
	return (
		<div data-region={region}>
			<h3 style={{ marginTop: 0, fontSize: text.heading }}>{title}</h3>
			{!ours.length && !theirs.length ? (
				<p style={{ fontSize: text.body, color: INK_2, margin: 0 }}>
					Nothing here has been evaluated yet, so there is nothing to score.
				</p>
			) : (
				<>
					<Scoreline
						ours={accuracyPercent(ours)}
						theirs={accuracyPercent(theirs)}
						ourMoves={ours.length}
						theirMoves={theirs.length}
					/>
					<QualityTable
						ours={distribution(ours)}
						theirs={distribution(theirs)}
						ourTotal={ours.length}
						theirTotal={theirs.length}
						/*
						 * A COLUMN OF ZEROES IS NOT DATA.
						 *
						 * With nothing scored on their side every cell reads 0 with a
						 * bar of width 0, which invites the reading "they played no
						 * blunders" — a claim, where the truth is that nobody looked.
						 * The accuracy line above still says "not scored", once, which
						 * is where that fact belongs.
						 */
						showTheirs={theirs.length > 0}
					/>
					{tally && tally.offered > 0 && (
						// The app's whole thesis, as one line: they went wrong this many
						// times, and this is how often it was taken.
						<Note style={{ marginTop: space.snug }}>
							They gave you {tally.offered} chance{tally.offered === 1 ? '' : 's'} to punish
							{tally.missed > 0 ? (
								<>
									{' '}
									— <strong>{tally.missed}</strong> went by. Importing a game turns those
									into cards in your Mistakes deck.
								</>
							) : (
								<> and you took every one.</>
							)}
						</Note>
					)}
				</>
			)}
		</div>
	);
}

/** The two accuracies, next to each other, because that is the comparison. */
function Scoreline({
	ours,
	theirs,
	ourMoves,
	theirMoves,
}: {
	ours: number | null;
	theirs: number | null;
	ourMoves: number;
	theirMoves: number;
}) {
	return (
		<div style={{ display: 'flex', gap: space.page, marginBottom: space.card }}>
			<Score label="You" value={ours} moves={ourMoves} strong />
			<Score label="Opponent" value={theirs} moves={theirMoves} />
		</div>
	);
}

function Score({
	label,
	value,
	moves,
	strong,
}: {
	label: string;
	value: number | null;
	moves: number;
	strong?: boolean;
}) {
	return (
		<div>
			<div style={{ fontSize: text.note, color: INK_2 }}>{label}</div>
			<div
				style={{
					fontSize: strong ? 30 : 24,
					fontWeight: 700,
					color: value === null ? INK_2 : INK,
					lineHeight: 1.1,
				}}
			>
				{value === null ? '—' : `${value}%`}
			</div>
			<div style={{ fontSize: text.note, color: INK_2 }}>
				{value === null ? 'not scored' : `${moves} ${moves === 1 ? 'move' : 'moves'}`}
			</div>
		</div>
	);
}

/**
 * The judgement counts for both players.
 *
 * A table rather than two sets of bars: the interesting reading is across a row
 * — three blunders to their one — and bars put that comparison in two different
 * places on the page.
 */
function QualityTable({
	ours,
	theirs,
	ourTotal,
	theirTotal,
	showTheirs,
}: {
	ours: Record<Quality, number>;
	theirs: Record<Quality, number>;
	ourTotal: number;
	theirTotal: number;
	showTheirs: boolean;
}) {
	const rows = QUALITY_ORDER.filter((q) => ours[q] || theirs[q]);
	if (!rows.length) return null;

	return (
		<table style={{ borderCollapse: 'collapse', fontSize: text.body }}>
			<thead>
				<tr style={{ color: INK_2, fontSize: text.note, textAlign: 'left' }}>
					<th style={{ fontWeight: 400, padding: '2px 10px 4px 0' }}>Move</th>
					<th style={{ fontWeight: 400, padding: `2px ${showTheirs ? 10 : 0}px 4px 0` }}>You</th>
					{showTheirs && (
						<th style={{ fontWeight: 400, padding: '2px 0 4px 0' }}>Opponent</th>
					)}
				</tr>
			</thead>
			<tbody>
				{rows.map((q) => (
					<tr key={q}>
						<td style={{ padding: '2px 10px 2px 0', color: QUALITY_COLOUR[q] }}>
							{QUALITY_LABEL[q]}
						</td>
						<Cell n={ours[q]} total={ourTotal} q={q} last={!showTheirs} />
						{showTheirs && <Cell n={theirs[q]} total={theirTotal} q={q} last />}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Cell({ n, total, q, last }: { n: number; total: number; q: Quality; last?: boolean }) {
	return (
		<td style={{ padding: `2px ${last ? 0 : 10}px 2px 0` }}>
			<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<span style={{ minWidth: 16, color: n ? INK : INK_2 }}>{n}</span>
				<span
					style={{
						height: 8,
						width: total ? `${Math.round((n / total) * 90)}px` : 0,
						background: QUALITY_COLOUR[q],
						borderRadius: 4,
						opacity: n ? 1 : 0,
					}}
				/>
			</span>
		</td>
	);
}

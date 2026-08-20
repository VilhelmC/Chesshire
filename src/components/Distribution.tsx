// What gets played here, as a list of bars.
//
// Frequency is the length of the bar because frequency is the point: this is a
// list of what you will actually meet. The score sits beside it as a number
// rather than as a second bar — two bars of different meanings in one row is
// read as one bar twice.

import { Move } from './Move';
import { sharePercent, movesToCover, type Distribution } from '../domain/distribution';
import { color, space, radius, text } from '../ui/theme';
import { Note } from '../ui/primitives';

export function DistributionList({
	distribution,
	mover,
	limit = 8,
}: {
	distribution: Distribution;
	mover: 'w' | 'b';
	limit?: number;
}) {
	const { moves, total } = distribution;
	if (!moves.length) {
		return <Note>No games from this position at your rating band.</Note>;
	}

	const shown = moves.slice(0, limit);
	const hidden = moves.length - shown.length;
	const cover = movesToCover(distribution, 0.9);

	return (
		<div>
			<Note style={{ marginBottom: space.snug }}>
				{total.toLocaleString()} games at your band. {cover} move{cover === 1 ? '' : 's'} cover
				90% of them.
			</Note>

			<ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
				{shown.map((m) => (
					<li
						key={m.uci}
						style={{
							display: 'grid',
							gridTemplateColumns: 'minmax(54px, auto) 1fr minmax(58px, auto)',
							alignItems: 'center',
							gap: space.snug,
							padding: '3px 0',
							fontSize: text.note,
						}}
					>
						<Move san={m.san} colour={mover} size={13} bold />

						<div
							style={{
								height: 8,
								background: color.line,
								borderRadius: radius.pill,
								overflow: 'hidden',
							}}
							title={`${m.games.toLocaleString()} games`}
						>
							<div
								style={{
									width: `${Math.max(1, m.share * 100)}%`,
									height: '100%',
									background: color.accent,
								}}
							/>
						</div>

						<span
							style={{
								textAlign: 'right',
								color: color.ink2,
								fontVariantNumeric: 'tabular-nums',
								whiteSpace: 'nowrap',
							}}
						>
							{sharePercent(m.share)}
							{' · '}
							<span
								title="Expected score for the side to move — a win is 1, a draw a half"
								style={{ color: scoreColour(m.score) }}
							>
								{(m.score * 100).toFixed(0)}
							</span>
						</span>
					</li>
				))}
			</ol>

			{hidden > 0 && (
				// Never a silent truncation: a list that shows eight of thirty is
				// claiming the other twenty-two do not exist.
				<Note style={{ marginTop: space.tight }}>
					{hidden} rarer move{hidden === 1 ? '' : 's'} not shown.
				</Note>
			)}
		</div>
	);
}

/** Only the extremes get colour; everything near even stays quiet. */
function scoreColour(score: number): string {
	if (score >= 0.56) return color.good;
	if (score <= 0.44) return color.bad;
	return color.ink2;
}

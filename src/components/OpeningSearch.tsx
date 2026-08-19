// Pick an opening by name, and train from it.
//
// The tree made every position trainable; this makes them findable. Nobody
// thinks "the node after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6" — they think "the Two
// Knights", so that is what you type.
//
// Each result shows the line as well as the name, because the name is the thing
// you are trying to learn and seeing the moves beside it is how that happens.
// It also says who moves first from there: pinning is not a colour choice, and
// a root where the opponent moves first is perfectly valid, but it should not be
// a surprise.

import { useMemo, useState } from 'react';
import { searchOpenings, sideToMoveAfter, type Opening } from '../domain/openings';
import { MoveLine } from './Move';

const INK_2 = '#52514e';
const GRID = '#e6e5e2';

export function OpeningSearch({
	colour,
	onPick,
	placeholder = 'name, ECO code, or moves — e.g. scotch mieses, C45, e4 e5 Nf3',
}: {
	/** The side being practised, so the result can say who moves first. */
	colour: 'w' | 'b';
	onPick: (o: Opening) => void;
	placeholder?: string;
}) {
	const [q, setQ] = useState('');
	const { hits, total } = useMemo(() => searchOpenings(q, 25), [q]);

	return (
		<div>
			<input
				value={q}
				onChange={(e) => setQ(e.target.value)}
				placeholder={placeholder}
				aria-label="Search openings by name"
				// 16px stops mobile browsers zooming the page on focus.
				style={{ width: '100%', padding: '7px 8px', fontSize: 16, boxSizing: 'border-box' }}
			/>

			{q.trim().length >= 2 && !hits.length && (
				<p style={{ fontSize: 12, color: INK_2, margin: '6px 0 0' }}>
					Nothing matches &ldquo;{q}&rdquo;. Every word has to appear in the name — try fewer
					of them, or an ECO code like <code>C45</code>.
				</p>
			)}

			{total > hits.length && (
				// Say so. A truncated list that does not admit it is how you conclude
				// something is missing when it is three rows past the cut.
				<p style={{ fontSize: 11, color: INK_2, margin: '6px 0 0' }}>
					{total} matches — showing the closest {hits.length}. Add a word to narrow it.
				</p>
			)}

			{hits.length > 0 && (
				<ul
					data-role="opening-results"
					style={{
						listStyle: 'none',
						margin: '6px 0 0',
						padding: 0,
						maxHeight: 260,
						overflowY: 'auto',
						border: `1px solid ${GRID}`,
						borderRadius: 6,
					}}
				>
					{hits.map((o) => {
						const theirs = sideToMoveAfter(o.path) !== colour;
						return (
							<li key={`${o.eco} ${o.name}`} style={{ borderBottom: `1px solid ${GRID}` }}>
								<button
									onClick={() => {
										onPick(o);
										setQ('');
									}}
									style={{
										display: 'block',
										width: '100%',
										textAlign: 'left',
										border: 'none',
										background: 'none',
										padding: '6px 8px',
										cursor: 'pointer',
										font: 'inherit',
									}}
								>
									<div style={{ fontSize: 13, fontWeight: 600 }}>
										{o.name}{' '}
										<span style={{ fontWeight: 400, color: INK_2, fontSize: 11 }}>
											{o.eco}
										</span>
									</div>
									<div style={{ marginTop: 2 }}>
										<MoveLine sans={o.path} size={11} />
									</div>
									<div style={{ fontSize: 11, color: INK_2, marginTop: 2 }}>
										{theirs
											? 'They move first from here'
											: 'You move first from here'}
									</div>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

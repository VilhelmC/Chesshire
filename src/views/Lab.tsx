// The Lab — where a claim is shown its working.
//
// ---------------------------------------------------------------------------
// Everything else in this app presents conclusions. This presents the
// computation: every unit counted, how many moves away it is, what its route
// costs, whether it can legally move, every step of every exchange fold, and
// what the prize's escapes are worth.
//
// It exists because graph reasoning is easy to get subtly wrong in a way that
// still reads plausibly — my first exchange fold in domain/contest.ts backed the
// min-max up from the wrong side and confidently reported a free piece where the
// recapture wins. No test I would have thought to write catches that; setting
// the position up and reading the sequence does.
//
// So the rule for this screen: never print a verdict without the numbers that
// produced it, and never print the numbers without the assumptions they rest on.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { contest, type Contest, type Unit } from '../domain/contest';
import { INITIAL_FEN } from '../domain/chess';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';
import { Note, Section, inputStyle } from '../ui/primitives';

/**
 * Positions whose verdict is known by hand.
 *
 * The first two are the Chessable pin from EXPLOITABILITY.md §6 and its
 * counterfactual: identical pieces except for the queen behind the knight, and
 * opposite verdicts. If the Lab ever shows the same answer for both, something
 * is wrong that no amount of reading the code will reveal.
 */
const PRESETS: { name: string; fen: string; target: string; expect: string }[] = [
	{
		name: 'The pin — worth a tempo',
		fen: '3q2k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1',
		target: 'd5',
		expect: 'Not winnable now; winnable at k=1 once e2–e4 arrives, because the knight cannot leave.',
	},
	{
		name: 'The same pin, no queen behind',
		fen: '6k1/8/4p3/3n4/8/8/4P3/3R2K1 w - - 0 1',
		target: 'd5',
		expect: 'Never winnable: the knight simply steps away, so the rook’s tempo bought nothing.',
	},
	{
		name: 'Defended, but the defence cannot afford it',
		fen: '6k1/8/4p3/3n4/4P3/8/8/3R2K1 w - - 0 1',
		target: 'd5',
		expect: 'The knight is free: after exd5 the pawn declines to recapture.',
	},
	{ name: 'Starting position', fen: INITIAL_FEN, target: 'e4', expect: 'Nothing contested.' },
];

export function Lab() {
	const [fen, setFen] = useState(PRESETS[0].fen);
	const [target, setTarget] = useState(PRESETS[0].target);
	const [note, setNote] = useState(PRESETS[0].expect);
	const [row, setRow] = useState(0);

	const result = useMemo((): { c: Contest | null; error: string | null } => {
		try {
			return { c: contest(fen, target), error: null };
		} catch (e) {
			return { c: null, error: (e as Error).message };
		}
	}, [fen, target]);

	const c = result.c;

	// Every counted unit, drawn on the board. This is the fastest way to see a
	// wrong answer: a piece that should be in the fold and has no arrow.
	const arrows = useMemo(() => {
		if (!c) return [];
		const out: { orig: string; dest: string; brush: string }[] = [];
		const shown = c.rows[Math.min(row, c.rows.length - 1)];
		for (const u of shown.attackers) {
			out.push({ orig: u.from, dest: u.via ?? c.target, brush: 'blue' });
			if (u.via) out.push({ orig: u.via, dest: c.target, brush: 'paleBlue' });
		}
		for (const u of shown.defenders) {
			out.push({ orig: u.from, dest: u.via ?? c.target, brush: 'green' });
			if (u.via) out.push({ orig: u.via, dest: c.target, brush: 'paleGreen' });
		}
		return out;
	}, [c, row]);

	return (
		<div>
			<Note style={{ marginBottom: space.card }}>
				Working, not conclusions. Every number below is shown with the steps that
				produced it, so it can be checked against a board rather than believed. See
				EXPLOITABILITY.md for what the columns mean.
			</Note>

			<div style={{ display: 'flex', gap: space.snug, flexWrap: 'wrap', marginBottom: space.card }}>
				{PRESETS.map((p) => (
					<button
						key={p.name}
						onClick={() => {
							setFen(p.fen);
							setTarget(p.target);
							setNote(p.expect);
							setRow(0);
						}}
						style={{
							border: `1px solid ${fen === p.fen ? color.accent : color.line}`,
							background: fen === p.fen ? color.accentSoft : 'transparent',
							color: fen === p.fen ? color.accent : color.ink2,
							borderRadius: radius.pill,
							padding: '6px 12px',
							fontSize: text.note,
							minHeight: 32,
							cursor: 'pointer',
						}}
					>
						{p.name}
					</button>
				))}
			</div>

			{note && (
				<Note style={{ marginBottom: space.card }}>
					<strong>Expected by hand:</strong> {note}
				</Note>
			)}

			<div style={{ display: 'flex', gap: space.page, flexWrap: 'wrap', alignItems: 'flex-start' }}>
				<div>
					<Board
						fen={fen}
						size={380}
						arrows={arrows}
						onSelectSquare={(s) => {
							setTarget(s);
							setNote('');
							setRow(0);
						}}
					/>
					<Note style={{ marginTop: space.tight }}>
						Click any square to inspect the contest there. Blue = attackers, green =
						defenders; a pale arrow is the second leg of a route.
					</Note>

					<label
						style={{
							display: 'block',
							fontSize: text.note,
							color: color.ink2,
							marginTop: space.card,
						}}
					>
						Position (FEN)
					</label>
					<input
						value={fen}
						onChange={(e) => {
							setFen(e.target.value.trim());
							setNote('');
						}}
						spellCheck={false}
						style={{ ...inputStyle, fontFamily: mono, fontSize: 12 }}
					/>

					<label
						style={{
							display: 'block',
							fontSize: text.note,
							color: color.ink2,
							marginTop: space.snug,
						}}
					>
						Target square
					</label>
					<input
						value={target}
						onChange={(e) => setTarget(e.target.value.trim())}
						style={{ ...inputStyle, width: 80, fontFamily: mono }}
					/>
				</div>

				<div style={{ flex: 1, minWidth: 380 }}>
					{result.error && (
						<Note style={{ color: color.bad }}>Cannot read that: {result.error}</Note>
					)}
					{c && <ContestReport c={c} row={row} onRow={setRow} />}
				</div>
			</div>
		</div>
	);
}

function ContestReport({
	c,
	row,
	onRow,
}: {
	c: Contest;
	row: number;
	onRow: (r: number) => void;
}) {
	const shown = c.rows[Math.min(row, c.rows.length - 1)];

	return (
		<div>
			<h3 style={{ marginTop: 0 }}>
				{c.target}
				{c.prize ? (
					<span style={{ fontWeight: 400, color: color.ink2, fontSize: text.body }}>
						{' '}
						— {c.prize.colour} {c.prize.role} ({c.prize.value}), attacked by {c.attacker}
					</span>
				) : (
					<span style={{ fontWeight: 400, color: color.ink2, fontSize: text.body }}>
						{' '}
						— empty square. Contests for empty squares are not modelled yet.
					</span>
				)}
			</h3>

			<div
				style={{
					padding: space.snug,
					borderRadius: radius.panel,
					background: c.winnableAt === null ? color.badSoft : color.goodSoft,
					border: `1px solid ${c.winnableAt === null ? color.bad : color.good}`,
					fontSize: text.body,
					marginBottom: space.card,
				}}
			>
				{c.winnableAt === null ? (
					<>
						<strong>Not winnable</strong> within {c.rows.length - 1} tempi
						{c.escapeCost !== null && c.escapeCost <= 0
							? ' — and the prize can leave for nothing, so time spent here is wasted.'
							: ' — the fold never pays.'}
					</>
				) : (
					<>
						<strong>Winnable at k = {c.winnableAt}</strong> — costs {c.winnableAt} tempo
						{c.winnableAt === 1 ? '' : 's'} of build-up, and the prize cannot leave
						cheaply
						{c.escapeCost !== null ? ` (best escape costs ${c.escapeCost})` : ' (nowhere to go)'}
						.
					</>
				)}
			</div>

			<h4 style={{ margin: `0 0 ${space.tight}px` }}>Build-up</h4>
			<table style={{ borderCollapse: 'collapse', fontSize: text.body, marginBottom: space.card }}>
				<thead>
					<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
						{['k', 'attackers', 'defenders', 'fold', 'spent', 'net', 'can it run?'].map((h) => (
							<th key={h} style={{ fontWeight: 400, padding: '2px 12px 4px 0' }}>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{c.rows.map((r, i) => (
						<tr
							key={r.k}
							onClick={() => onRow(i)}
							style={{
								cursor: 'pointer',
								background: i === row ? color.accentSoft : 'transparent',
							}}
						>
							<td style={cell}>{r.k}</td>
							<td style={cell}>{r.attackers.map(nameOf).join(' ') || '—'}</td>
							<td style={cell}>{r.defenders.map(nameOf).join(' ') || '—'}</td>
							<td style={cell}>{r.fold.value}</td>
							<td style={cell}>{r.spent}</td>
							<td style={{ ...cell, fontWeight: 700, color: r.net > 0 ? color.good : color.ink }}>
								{r.net}
							</td>
							{/* The column the motif vocabulary hides. A fold that pays
								is worth nothing if the prize walks away while you are
								building up — which is exactly what a pin prevents. */}
							<td style={cell}>
								{r.k === 0
									? 'no time'
									: c.escapeCost === null
										? 'nowhere'
										: c.escapeCost <= 0
											? 'yes, free'
											: `costs ${c.escapeCost}`}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<h4 style={{ margin: `0 0 ${space.tight}px` }}>The fold at k = {shown.k}</h4>
			{shown.fold.steps.length === 0 ? (
				<Note style={{ marginBottom: space.card }}>Nothing to capture.</Note>
			) : (
				<table style={{ borderCollapse: 'collapse', fontSize: text.body, marginBottom: space.card }}>
					<thead>
						<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
							{['#', 'side', 'takes with', 'captures', 'gain if taken', 'played?'].map((h) => (
								<th key={h} style={{ fontWeight: 400, padding: '2px 12px 4px 0' }}>
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{shown.fold.steps.map((s, i) => (
							<tr key={i} style={{ opacity: s.happens ? 1 : 0.45 }}>
								<td style={cell}>{i + 1}</td>
								<td style={cell}>{s.colour}</td>
								<td style={cell}>
									{s.role} {s.from}
								</td>
								<td style={cell}>{s.captured}</td>
								<td style={cell}>{s.gain}</td>
								<td style={cell}>{s.happens ? 'yes' : 'declines'}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<h4 style={{ margin: `0 0 ${space.tight}px` }}>Units, and when they arrive</h4>
			<UnitTable units={[...shown.attackers, ...shown.defenders]} attacker={c.attacker} />

			<h4 style={{ margin: `${space.card}px 0 ${space.tight}px` }}>Can the prize leave?</h4>
			{!c.escapes.length ? (
				<Note>Nowhere to go.</Note>
			) : (
				<table style={{ borderCollapse: 'collapse', fontSize: text.body }}>
					<thead>
						<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
							{['to', 'costs there', 'exposes behind', 'total'].map((h) => (
								<th key={h} style={{ fontWeight: 400, padding: '2px 12px 4px 0' }}>
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{c.escapes.slice(0, 8).map((e) => (
							<tr key={e.to}>
								<td style={cell}>{e.to}</td>
								<td style={cell}>{e.cost}</td>
								<td style={cell}>{e.exposes}</td>
								<td style={{ ...cell, fontWeight: 700 }}>{e.total}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<Section title="What this table is assuming" note="Each one has a direction of error.">
				<ul style={{ margin: 0, paddingLeft: 18, fontSize: text.note, color: color.ink2 }}>
					{c.caveats.map((x) => (
						<li key={x} style={{ marginBottom: 3 }}>
							{x}
						</li>
					))}
				</ul>
			</Section>
		</div>
	);
}

function UnitTable({ units, attacker }: { units: Unit[]; attacker: string }) {
	if (!units.length) return <Note>None.</Note>;
	return (
		<table style={{ borderCollapse: 'collapse', fontSize: text.body }}>
			<thead>
				<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
					{['role', 'from', 'side', 'arrives in', 'via', 'route cost', 'can move'].map((h) => (
						<th key={h} style={{ fontWeight: 400, padding: '2px 12px 4px 0' }}>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{units.map((u) => (
					<tr key={`${u.colour}${u.from}`}>
						<td style={cell}>{u.role}</td>
						<td style={cell}>{u.from}</td>
						<td style={cell}>{u.colour === attacker ? 'attacker' : 'defender'}</td>
						<td style={cell}>{u.arrival}</td>
						<td style={cell}>{u.via ?? '—'}</td>
						<td style={cell}>{u.routeCost}</td>
						<td style={{ ...cell, color: u.available ? color.ink : color.bad }}>
							{u.available ? 'yes' : (u.note ?? 'no')}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function nameOf(u: Unit): string {
	const letter = { pawn: 'P', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' }[u.role];
	return u.arrival === 0 ? `${letter}${u.from}` : `${letter}${u.from}→${u.via}`;
}

const cell: React.CSSProperties = {
	padding: '3px 12px 3px 0',
	fontFamily: mono,
	fontSize: 13,
	minHeight: TOUCH,
};

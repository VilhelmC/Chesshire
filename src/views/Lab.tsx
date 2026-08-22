// The Lab — where a claim is shown its working.
//
// ---------------------------------------------------------------------------
// Everything else in this app presents conclusions. This presents the
// computation: every unit counted, how many moves away it is, what its route
// costs, whether it can legally move, what it owes elsewhere, every step of
// every exchange fold, and what each of the defender's replies concedes.
//
// It exists because graph reasoning is easy to get subtly wrong in a way that
// still reads plausibly, and because I have now been wrong about this material
// several times in a row — each time with code that agreed with my derivation.
// Two things follow, and they are the rules of this screen:
//
//   never print a verdict without the numbers that produced it, and
//   never print the numbers without the assumptions they rest on.
//
// The positions come from labPresets.ts, whose answers were set by Stockfish
// rather than by me, and each one shows the engine's verdict next to mine. When
// they disagree, mine is wrong, and it says so on the screen rather than in a
// conversation three days later.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../components/Board';
import { contest, type Contest, type Unit } from '../domain/contest';
import { PRESETS } from './labPresets';
import { flipTurn, readable, turnOf } from './labEdit';
import { EvalBar } from '../components/EvalBar';
import { Toolbar } from '../components/Toolbar';
import { engine } from '../engine/stockfish';
import type { Api } from 'chessground/api';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';
import { Note, Section, inputStyle } from '../ui/primitives';
import type { Role, Color } from 'chessops/types';

// `piece` is chessground's own element, not a React one, so the type has to be
// declared before TSX will accept it. Using it means the tray shows the SAME
// pieces as the board rather than an approximation of them.
declare module 'react' {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace JSX {
		interface IntrinsicElements {
			piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
		}
	}
}

/** Verdicts that are not a number get their own colour: neither good nor bad. */
const VERDICT_COLOUR = {
	winnable: color.good,
	'not-winnable': color.bad,
	entangled: color.warn,
	unresolved: color.warn,
} as const;

const ROLES: Role[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const BOARD = 380;
const BAR = 22;

export function Lab() {
	const [preset, setPreset] = useState(PRESETS[0]);
	const [fen, setFen] = useState(PRESETS[0].fen);
	const [target, setTarget] = useState(PRESETS[0].target);
	const [row, setRow] = useState(0);
	const [copied, setCopied] = useState(false);
	const board = useRef<Api | null>(null);

	/** Stockfish's own answer for whatever is on the board right now. */
	const [live, setLive] = useState<{ cp: number; best: string; depth: number } | null>(null);
	const [asking, setAsking] = useState(false);
	const [showBest, setShowBest] = useState(false);
	const [showOptions, setShowOptions] = useState(false);

	const problem = readable(fen);
	const turn = turnOf(fen);

	function load(p: (typeof PRESETS)[number]) {
		setPreset(p);
		setFen(p.fen);
		setTarget(p.target);
		setRow(0);
		setLive(null);
		setShowBest(false);
		setShowOptions(false);
	}

	// A new position invalidates the engine's answer. Leaving a stale number on
	// screen next to a fresh verdict is worse than showing none.
	useEffect(() => {
		setLive(null);
		setShowBest(false);
	}, [fen]);

	/** Ask the engine about this exact position — the referee, on demand. */
	async function ask() {
		setAsking(true);
		try {
			const r = await engine.analyse(fen, 16, 1, 1200);
			const l = r.lines[0];
			if (l) setLive({ cp: l.cp, best: l.pv[0] ?? '', depth: l.depth });
		} catch {
			/* the engine not loading is visible as no answer */
		} finally {
			setAsking(false);
		}
	}

	const result = useMemo((): { c: Contest | null; error: string | null } => {
		if (problem) return { c: null, error: problem };
		try {
			return { c: contest(fen, target), error: null };
		} catch (e) {
			return { c: null, error: (e as Error).message };
		}
	}, [fen, target, problem]);

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

	const overlay = useMemo(() => {
		const out: { orig: string; dest: string; brush: string; label?: string }[] = [];
		if (showBest && live && live.best.length >= 4) {
			out.push({ orig: live.best.slice(0, 2), dest: live.best.slice(2, 4), brush: 'q0' });
		}
		if (showOptions && c?.race.line.length) {
			// The race, drawn: our moves in one colour, theirs in the other.
			c.race.line.forEach((m, i) => {
				out.push({
					orig: m.slice(0, 2),
					dest: m.slice(2, 4),
					brush: i % 2 === 0 ? 'q1' : 'q3',
					label: String(i + 1),
				});
			});
		}
		return out;
	}, [showBest, showOptions, live, c]);

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
						onClick={() => load(p)}
						style={{
							border: `1px solid ${p.fen === fen ? color.accent : color.line}`,
							background: p.fen === fen ? color.accentSoft : 'transparent',
							color: p.fen === fen ? color.accent : color.ink2,
							borderRadius: radius.pill,
							padding: '6px 12px',
							fontSize: text.note,
							minHeight: 32,
							cursor: 'pointer',
						}}
					>
						#{p.n} {p.name}
					</button>
				))}
			</div>

			{preset.fen === fen && (
				<div
					style={{
						fontSize: text.note,
						color: color.ink2,
						marginBottom: space.card,
						maxWidth: 900,
					}}
				>
					<div>
						<strong>#{preset.n} {preset.name}.</strong> {preset.expect}
					</div>
					{preset.engine && (
						// The referee's answer, on screen next to mine. If the two
						// disagree the screen says so, rather than the disagreement
						// surfacing in a conversation days later.
						<div style={{ marginTop: 2 }}>
							<strong>Recorded engine answer:</strong> {preset.engine} —{' '}
							{preset.claim === 'wins' ? 'material is winnable here' : 'nothing to win here'}
						</div>
					)}
				</div>
			)}

			<div style={{ display: 'flex', gap: space.page, flexWrap: 'wrap', alignItems: 'flex-start' }}>
				<div>
					{/* Black's tray sits above the board and White's below, each on
						the side that side plays from — so a piece is picked up from
						where its army lives rather than from a mixed row where the
						colours have to be read. */}
					<Tray colour="black" api={board} width={BOARD} inset={BAR + space.snug} />

					<div style={{ display: 'flex', gap: space.snug, alignItems: 'flex-start' }}>
						{/* The same evaluation bar the rest of the app uses, from the
							same engine, so the Lab reads like the trainer. */}
						<EvalBar
							cp={live ? (turn === 'white' ? live.cp : -live.cp) : null}
							ourColour="w"
							height={BOARD}
							width={BAR}
						/>
						<Board
							fen={fen}
							size={BOARD}
							orientation={turn === 'white' ? 'white' : 'black'}
							arrows={[...arrows, ...overlay]}
							editable
							apiRef={(api) => {
								board.current = api;
							}}
							onEdit={(boardFen) => setFen(`${boardFen} ${turn === 'white' ? 'w' : 'b'} - - 0 1`)}
							onSelectSquare={(sq) => {
								setTarget(sq);
								setRow(0);
							}}
						/>
					</div>

					<Tray colour="white" api={board} width={BOARD} inset={BAR + space.snug} />

					<div
						style={{
							display: 'flex',
							gap: space.tight,
							alignItems: 'center',
							flexWrap: 'wrap',
							marginTop: space.snug,
						}}
					>
						{/* One control, not two. Whose move it is decides the answer,
							and the side to move is always at the bottom — so flipping
							the board and flipping the turn are the same act. */}
						<button
							onClick={() => setFen(flipTurn(fen))}
							title="Flip: the side to move is always at the bottom"
							style={{ ...chip, display: 'flex', alignItems: 'center', gap: 6 }}
						>
							<span
								style={{
									width: 12,
									height: 12,
									borderRadius: '50%',
									border: `1px solid ${color.ink2}`,
									background: turn === 'white' ? '#fff' : '#222',
								}}
							/>
							{turn === 'white' ? 'White' : 'Black'} to move — flip
						</button>

						<Toolbar
							actions={[
								{
									id: 'ask',
									title: 'Ask Stockfish about this exact position',
									icon: 'stats',
									onClick: () => void ask(),
									disabled: asking || !!problem,
									accent: !!live,
								},
								{
									id: 'reveal',
									title: 'Show the engine’s move',
									icon: 'reveal',
									onClick: () => setShowBest((v) => !v),
									disabled: !live,
									accent: showBest,
								},
								{
									id: 'options',
									title: 'Show the race — our moves and theirs, in order',
									icon: 'options',
									onClick: () => setShowOptions((v) => !v),
									disabled: !c?.race.line.length,
									accent: showOptions,
								},
								{
									id: 'share',
									title: 'Copy this position as a FEN',
									icon: 'share',
									onClick: async () => {
										try {
											await navigator.clipboard.writeText(fen);
											setCopied(true);
											setTimeout(() => setCopied(false), 1500);
										} catch {
											/* a refused clipboard is not worth a dialog */
										}
									},
									accent: copied,
								},
							]}
						/>
					</div>

					{live && (
						<Note style={{ marginTop: space.tight }}>
							<strong>Stockfish, depth {live.depth}:</strong>{' '}
							{live.cp >= 0 ? '+' : ''}
							{(live.cp / 100).toFixed(2)} for {turn}
							{live.best ? `, best ${live.best.slice(0, 2)}–${live.best.slice(2, 4)}` : ''}
							{c && (
								<>
									{' · '}
									{agrees(c.race.value, live.cp)
										? 'agrees with the count'
										: '⚠ disagrees with the count below — the count is the one to distrust'}
								</>
							)}
						</Note>
					)}

					<Note style={{ marginTop: space.tight }}>
						Drag pieces to rearrange, drag one off the board to remove it, or drag a
						new one from the trays. Click a square to inspect the contest there.
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
						onChange={(e) => setFen(e.target.value.trim())}
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
					background: color.surface,
					// Longhand only. Mixing `borderLeft` with `borderLeftWidth`
					// makes React warn — and it is right to: the shorthand resets
					// the properties the longhand just set, so which one wins
					// depends on the order the style object happens to be applied.
					borderStyle: 'solid',
					borderWidth: 1,
					borderColor: color.line,
					borderLeftWidth: 4,
					borderLeftColor: VERDICT_COLOUR[c.verdict.kind],
					fontSize: text.body,
					marginBottom: space.card,
				}}
			>
				<strong style={{ color: VERDICT_COLOUR[c.verdict.kind] }}>
					{
						{
							winnable: 'Winnable',
							'not-winnable': 'Not winnable',
							entangled: 'Entangled',
							unresolved: 'Needs calculation',
						}[c.verdict.kind]
					}
					{c.verdict.at !== undefined ? ` at k = ${c.verdict.at}` : ''}
				</strong>{' '}
				<span style={{ color: color.ink }}>{c.verdict.why}</span>
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
							<td style={cell}>
								{r.defenders.length
									? r.defenders
											.map((u) =>
												r.critical.some((x) => x.unit === u)
													? `${nameOf(u)}*`
													: nameOf(u),
											)
											.join(' ')
									: '—'}
							</td>
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

			{shown.play && (
				<>
					<h4 style={{ margin: `0 0 ${space.tight}px` }}>
						If we play {shown.play.move.from}–{shown.play.move.to}, their best answers
					</h4>
					<table
						style={{ borderCollapse: 'collapse', fontSize: text.body, marginBottom: space.card }}
					>
						<thead>
							<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
								{['their move', 'we then win', 'they win back', 'net', ''].map((h) => (
									<th key={h} style={{ fontWeight: 400, padding: '2px 12px 4px 0' }}>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{[shown.play.defence].filter(Boolean).map((d) => (
								<tr key={`${d!.from}${d!.to}`}>
									<td style={cell}>
										{d!.from}–{d!.to}
										{d!.check ? '+' : ''}
									</td>
									<td style={cell}>{d!.concedes}</td>
									<td style={cell}>{d!.counter}</td>
									<td style={{ ...cell, fontWeight: 700 }}>{d!.net}</td>
									<td style={{ ...cell, color: color.ink2 }}>
										their best defence
									</td>
								</tr>
							))}
						</tbody>
					</table>
					<Note style={{ marginBottom: space.card }}>
						Every legal reply is tried, not only the ones that add a defender —
						moving the prize, breaking the pin, blocking and checking are all just
						replies. Ranked by <em>net</em>, because a defence that gives material
						back with interest is not a bad defence.
					</Note>
				</>
			)}

			<h4 style={{ margin: `0 0 ${space.tight}px` }}>The exchange count at k = {shown.k}</h4>
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
							{['to', 'costs there', 'exposes behind', 'threatens', 'total'].map((h) => (
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
								{/* What the piece threatens from where it lands, after
									their best single repair. Without this column an
									escape-with-a-fork reads as a pin. */}
								<td style={{ ...cell, color: e.counter > 0 ? color.good : color.ink2 }}>
									{e.counter > 0 ? e.counter : '—'}
								</td>
								<td style={{ ...cell, fontWeight: 700 }}>
									{e.resolved ? e.total : 'a sequence'}
								</td>
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
					{['role', 'from', 'side', 'arrives in', 'via', 'route cost', 'can move', 'owes elsewhere'].map((h) => (
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
						{/* What joining here would abandon — the whole content of
							"overloaded", as a number rather than a name. */}
						<td style={{ ...cell, color: u.duty > 0 ? color.warn : color.ink2 }}>
							{u.duty > 0 ? `${u.duty} at ${u.dutyAt}` : '—'}
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

/**
 * A row of pieces to drag onto the board.
 *
 * Drag rather than click-then-click: chessground has `dragNewPiece` for exactly
 * this, so the piece follows the pointer and lands where it is dropped. The
 * click-to-place version this replaces put pieces a square out whenever the
 * layout had shifted, because it was reading a cached rectangle.
 */
function Tray({
	colour,
	api,
	width,
	inset,
}: {
	colour: Color;
	api: React.MutableRefObject<Api | null>;
	/** Matches the board, so the row sits under it rather than beside it. */
	width: number;
	/** Left padding equal to the evaluation bar, so the two edges line up. */
	inset: number;
}) {
	return (
		// `cg-wrap` is chessground's own class, and the pieces inside it pick up
		// the same sprite sheet the board uses. Unicode glyphs were tried first
		// and are the wrong tool twice over: ♙ and ♟ are an outline and a solid,
		// not a white and a black, so they invert with the theme — and forcing a
		// fill and a stroke on top produced a black king that reads as white.
		// `cg-wrap` is here only so the piece sprites resolve — chessground's rules
		// are all scoped under it. It also brings that class's own geometry, which
		// is what pushed the row past the board's right edge, so the width is
		// stated explicitly and the class sits on an inner span that carries no
		// layout of its own.
		<div
			style={{
				display: 'flex',
				paddingLeft: inset,
				width: width + inset,
				boxSizing: 'border-box',
			}}
		>
			<div
				className="cg-wrap"
				style={{
					display: 'flex',
					gap: space.tight,
					padding: `${space.tight}px 0`,
					width,
					height: 'auto',
					boxSizing: 'border-box',
					// Eight squares of board, six pieces of tray: spread them over
					// the same span rather than centring in a wider box.
					justifyContent: 'space-between',
					position: 'relative',
				}}
			>
			{ROLES.map((role) => (
				<span
					key={role}
					title={`Drag a ${colour} ${role} onto the board`}
					// mousedown/touchstart, NOT pointerdown, and no preventDefault:
					// chessground tracks a drag with document-level `mousemove` and
					// `mouseup` listeners, and calling preventDefault on a pointer
					// event suppresses the compatibility mouse events those depend
					// on. The tray looked right and dropped nothing.
					onMouseDown={(e) => {
						api.current?.dragNewPiece({ role, color: colour }, e.nativeEvent, true);
					}}
					onTouchStart={(e) => {
						api.current?.dragNewPiece({ role, color: colour }, e.nativeEvent, true);
					}}
					style={{
						width: 38,
						height: 38,
						position: 'relative',
						cursor: 'grab',
						borderRadius: radius.small,
						border: `1px solid ${color.line}`,
						background: color.surface,
						touchAction: 'none',
					}}
				>
					<piece
						className={`${colour} ${role}`}
						style={{
							// Width and height must be stated, not implied by `inset`:
							// chessground's own rule sizes a piece as 12.5% of a board,
							// and a rule that sets width beats an inline `inset` that
							// does not. That is why the first version rendered each
							// piece as a speck in the corner of its button.
							position: 'absolute',
							left: 0,
							top: 0,
							width: '100%',
							height: '100%',
							backgroundSize: 'contain',
							backgroundRepeat: 'no-repeat',
							backgroundPosition: 'center',
							pointerEvents: 'none',
						}}
					/>
				</span>
				))}
			</div>
		</div>
	);
}

/** Do the two answers point the same way? Sizes differ; signs should not. */
function agrees(mine: number, engineCp: number): boolean {
	if (mine > 0) return engineCp > 100;
	return engineCp <= 150;
}

const chip: React.CSSProperties = {
	border: `1px solid ${color.line}`,
	background: color.surface,
	color: color.ink2,
	borderRadius: radius.pill,
	padding: '4px 10px',
	minHeight: 32,
	fontSize: text.note,
	cursor: 'pointer',
};

const cell: React.CSSProperties = {
	padding: '3px 12px 3px 0',
	fontFamily: mono,
	fontSize: 13,
	minHeight: TOUCH,
};

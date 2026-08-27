// What the CURRENT stack believes, on the screen where it is being checked.
//
// ---------------------------------------------------------------------------
// Will:
//
//   "I don't need a cases writeup — I need it in the UI so I can see if graphical
//    annotation is correct and can register my comments directly per move."
//
// `LedgerPanel` shows `ledger.ts` and `cover.ts` — M1 and M2, which M7 is meant
// to delete. Everything since has been in `complex → gamma → traverse → choose`,
// and none of it has ever been on screen.
//
// SIX CORRECTIONS, all of them Will reading yMTAV:
//
//   1. THE NUMBER IS A DELTA, IN THE SOLVER'S SIGN. It showed the traversal's
//      value, which is material from WHITE's fixed reference (AMEND-0) — so
//      Black losing a rook read as "6.00" and five of the moves read as "1.00"
//      with no stated origin. Will: "the score should be −5 since player material
//      lost is negative value." The reference is right for a minimax and wrong
//      for a person, so the panel converts: mover's sign, and the change from
//      where the position already stands.
//
//   2. EVERYTHING IN THE TOTAL IS IN THE COLUMN. "All future value goes in the
//      sum." The row now reads `now + what changes hands = after`, so a number
//      with no visible source is a bug in the ledger rather than a gap here.
//
//   3. `c3:500w` IS NOT NOTATION. The claimant's initial looked like a unit —
//      "w is not a valid chess currency". What changes hands is a PIECE, so the
//      column shows the piece, signed.
//
//   4. A PIECE'S COLOUR IS NOT THEME-RELATIVE. The first fix drew white men in
//      `color.page` and black in `color.ink` — tokens that SWAP between themes,
//      so in dark mode every man was inverted. Will: "white can't be a claimant
//      of a white rook … the glyph colour is wrong or the data." It was the
//      glyph. These are literal now, each with the opposite outline.
//
//   5. THE LEDGER HOLDS BOTH SIDES' CLAIMS, and it looked like one side's. A row
//      names three different men — the PRIZE at stake, the CLAIMANT who wins it,
//      and the TRAVELLER who has to go somewhere. yMTAV's c5 row is White
//      claiming Black's rook by playing ♖d3–c3, and `square` is where the prize
//      stands, not where the traveller lands. Both now have their own column and
//      the destination is named.
//
//   6. THIS PANEL IS NOT THE ONLY OPINION ON SCREEN. The Lab's headline is the
//      DEPTH SEARCH's verdict and says "found it" on positions where the complex
//      never named the move. Two systems disagreeing with nothing saying they are
//      two systems. The verdict line says whose verdict it is.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { Chess } from 'chessops/chess';
import type { Color, Role, Square } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import { blockedBy, complex, isLive, isMateWeight, material, type Obligation } from '../domain/complex';
import { choose, type Priced } from '../domain/choose';
import { sites, priced as pricedSites, type Site } from '../domain/cluster';
import { stateOf } from '../domain/state';
import { V } from '../domain/exchange';
import { MATE, MATE_STEP } from '../domain/complex';
import { color, space, text, mono } from '../ui/theme';
import { Section } from '../ui/primitives';

/** The arrival horizon the gate runs at. Changing it changes every number here. */
const ARRIVALS = 3;

/**
 * One glyph set, coloured — never two sets distinguished by fill.
 *
 * The outline symbols are unreadable as "white" on a dark ground, where they are
 * drawn in light ink and so look exactly like the filled ones. Filling both and
 * colouring them means the distinction survives whatever palette is in force,
 * which is the same reason `theme.ts` insists on var() tokens.
 */
const MAN: Record<Role, string> = { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' };

function Man({ role, side, title }: { role: Role; side: Color; title?: string }) {
	return (
		<span
			title={title ?? `${side} ${role}`}
			style={{
				// LITERAL, NOT TOKENS, AND ON ITS OWN SQUARE.
				//
				// `color.page` and `color.ink` swap between themes, so keying a piece to
				// them inverts every man in dark mode — the first bug. Making them
				// literal fixed the inversion and left a second one: a #141414 man on a
				// near-black panel is visible only by its halo, and a halo is exactly
				// what the app's other glyph set uses for the OPPOSITE colour.
				//
				// So the man stands on a square, at a fixed board colour. That is how it
				// is legible on the board itself, and nothing in the theme can reach it.
				color: side === 'white' ? '#ffffff' : '#101010',
				background: '#b6a98f',
				borderRadius: 2,
				padding: '0 2px',
				fontSize: '1.05em',
				lineHeight: 1,
			}}
		>
			{MAN[role]}
		</span>
	);
}

const sq = (s: Square) => makeSquare(s);
/** Pawns, signed and explicit. A bare "1" was the first thing Will could not place. */
/** How many of the claimant's moves away the mate is. `MATE - k·STEP`, read back. */
const mateIn = (w: number) => Math.max(1, Math.round((MATE - Math.abs(w)) / MATE_STEP));

/**
 * Pawns, signed — or a mate, said as a mate.
 *
 * The weight of a king row is `MATE - k·STEP` so that a mate in one can outrank a
 * mate in three. Printing that is nine digits of nothing; `#2` is the distance the
 * number exists to carry, and the sign says whose.
 */
const signed = (n: number) => {
	if (!Number.isFinite(n)) return n > 0 ? '+∞' : '−∞';
	if (isMateWeight(n)) return `${n > 0 ? '+' : '−'}#${mateIn(n)}`;
	return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n / 100).toFixed(2)}`;
};
const plain = (n: number) => {
	if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
	if (isMateWeight(n)) return `#${mateIn(n)}`;
	return (n / 100).toFixed(2);
};

export type Verdict = 'found' | 'tied' | 'mispriced' | 'blind';

const SAYS: Record<Verdict, { word: string; hue: string; note: string }> = {
	found: { word: 'found it', hue: color.good, note: 'the answer priced strictly above everything else' },
	tied: { word: 'no opinion', hue: color.warn, note: 'the answer is at the top, and so is something else' },
	mispriced: { word: 'mispriced', hue: color.bad, note: 'the answer was named and something else was paid more' },
	blind: { word: 'never named it', hue: color.bad, note: 'the answer is not in the option set — no pricing could reach it' },
};

type Reading = {
	key: string;
	verdict: Verdict;
	/** The side being asked to find a move. Every number below is in its sign. */
	me: Color;
	rows: Obligation[];
	/** Per row, the men standing in its way. Empty means it is live. */
	blocked: Map<Obligation, Square[]>;
	sites: Site[];
	committed: Map<Square, number>;
	options: Priced[];
	best: Priced[];
	answer: Priced | undefined;
	/** Material as it already stands, mover's sign. The `now` of the sum. */
	now: number;
	/** The material difference, as men, so `now` has a visible origin. */
	edge: { role: Role; side: Color }[];
	legal: number;
};

const sqIndex = (s: string): Square => ('abcdefgh'.indexOf(s[0]) + 8 * (Number(s[1]) - 1)) as Square;

function read(pos: Chess, played: string, key: string): Reading {
	const opts = { arrivalHorizon: ARRIVALS };
	const c = complex(pos, opts);
	const { best, all } = choose(pos, opts);
	const want = { from: sqIndex(played.slice(0, 2)), to: sqIndex(played.slice(2, 4)) };
	const answer = all.find((o) => o.from === want.from && o.to === want.to);
	const hit = best.some((o) => o.from === want.from && o.to === want.to);
	const st = stateOf(pos.board);
	const me = pos.turn;
	// AMEND-0's fixed reference is White's, because a minimax needs one number
	// both players can compare. A reader needs their own side's.
	const mine = (whiteRef: number) => (me === 'white' ? whiteRef : -whiteRef);
	let legal = 0;
	for (const f of pos.board[me]) legal += [...pos.dests(f)].length;
	// WHERE THE MATERIAL NUMBER COMES FROM. "-1.00" on every quiet move was the
	// second thing Will could not place: it is the pawn Black is already down, and
	// a total nobody can decompose is indistinguishable from a total that is wrong.
	const count = (c: Color) => {
		const m: Partial<Record<Role, number>> = {};
		for (const s of pos.board[c]) {
			const p = pos.board.get(s);
			if (p && p.role !== 'king') m[p.role] = (m[p.role] ?? 0) + 1;
		}
		return m;
	};
	const w = count('white');
	const b = count('black');
	const edge: { role: Role; side: Color }[] = [];
	for (const role of ['queen', 'rook', 'bishop', 'knight', 'pawn'] as Role[]) {
		const d = (w[role] ?? 0) - (b[role] ?? 0);
		for (let i = 0; i < Math.abs(d); i++) edge.push({ role, side: d > 0 ? 'white' : 'black' });
	}
	return {
		key,
		verdict: !answer ? 'blind' : !hit ? 'mispriced' : best.length > 1 ? 'tied' : 'found',
		me,
		rows: [...c.obligations].sort(
			(a, b) =>
				Number(isLive(b, c.board)) - Number(isLive(a, c.board)) || b.weight - a.weight || a.deadline - b.deadline,
		),
		blocked: new Map(c.obligations.map((r) => [r, blockedBy(r, c.board)])),
		sites: sites(st).sort((a, b) => b.value - a.value),
		committed: pricedSites(st, me),
		options: [...all].sort((a, b) => mine(b.value) - mine(a.value)),
		best,
		answer,
		now: mine(material(pos.board)),
		edge,
		legal,
	};
}

export type Shape = { orig: string; dest?: string; brush: string; label?: string };

/**
 * One row, drawn.
 *
 *   the square at stake      a ring, orange for what I owe and blue for what I am owed
 *   who plays → where        an arrow, so the claim reads as a move rather than a fact
 *
 * `badge` is the weight in pawns and the deadline, which is what `graphShapes`
 * already puts on the M2 layer — the vocabulary is worth keeping identical
 * between the two while both exist.
 */
function shapesOf(o: Obligation, me: Color): Shape[] {
	const mine = o.claimant === me;
	const brush = mine ? 'gCovBlock' : 'gOwed';
	const out: Shape[] = [
		{
			orig: sq(o.square),
			brush,
			label: `${isMateWeight(o.weight) ? `#${mateIn(o.weight)}` : (o.weight / 100).toFixed(0)}/${o.deadline}`,
		},
	];
	if (o.from !== undefined) {
		const to = o.via !== undefined ? o.via : o.square;
		if (o.from !== to) out.push({ orig: sq(o.from), dest: sq(to), brush });
	}
	return out;
}

/**
 * THE LINE BEHIND A NUMBER, DRAWN.
 *
 * Will: "If I click or hover an item it would be useful if the line was explained
 * and shown graphically with arrows so I can see the calculation for 'mate in 2',
 * or the exchange moves that lead to piece captures."
 *
 * The traversal already produces one — `Outcome.schedule` is every commitment it
 * made, in rounds, with the piece and where it goes. It has never been on screen,
 * so a value could be disagreed with but not inspected, which is most of why
 * reading these by hand has been slow.
 *
 * Drawn as the move itself in the accent, then each commitment as an arrow
 * numbered by its round and coloured by whose it is — amber for the claims
 * against the side to move, blue for its own. The square the claim is about gets
 * a ring, so a capture reads as "this man, by this move, on this round".
 */
function lineOf(o: Priced, me: Color): Shape[] {
	// THE MOVE ITSELF HAS TO BE FINDABLE. Will: "the actual move's arrow is not
	// shown specifically amongst everything." It was one orange arrow among a dozen
	// amber and blue ones. Now it is the loudest brush on the board and both its
	// squares are ringed, so the eye lands on it before the consequences.
	const out: Shape[] = [
		{ orig: sq(o.from), brush: 'gTwoJobs' },
		{ orig: sq(o.to), brush: 'gTwoJobs' },
		{ orig: sq(o.from), dest: sq(o.to), brush: 'gTwoJobs', label: 'move' },
	];
	const seen = new Set<string>();
	for (const step of [...o.outcome.schedule].sort((a, b) => a.round - b.round)) {
		const mine = step.side === me;
		const brush = mine ? 'gCovBlock' : 'gOwed';
		const k = `${step.piece}>${step.to}`;
		if (seen.has(k)) continue;
		seen.add(k);
		// THE LABEL IS THE COST IN TEMPI, not the round index.
		//
		// It used to be `round`, which is zero-based, so a king walking five squares
		// was drawn with a "0" on it. Will: "the white king is annotated as
		// preventing black promotion by going to a1 with an arrow also marked '0'
		// although its distance 5 with no blocking." A journey labelled zero reads as
		// something that has already happened.
		out.push({ orig: sq(step.piece), dest: sq(step.to), brush, label: `${step.cost}` });
	}
	for (const row of o.outcome.collected) {
		out.push({
			orig: sq(row.square),
			brush: row.claimant === me ? 'gCovBlock' : 'gUncovered',
			label: isMateWeight(row.weight) ? `#${mateIn(row.weight)}` : String(Math.round(row.weight / 100)),
		});
	}
	return out;
}

/** The same line, as a sentence, for readers who want it in words. */
function sayLine(o: Priced, me: Color): string {
	const parts: string[] = [];
	for (const step of [...o.outcome.schedule].sort((a, b) => a.round - b.round))
		parts.push(
			`${step.round + 1}. ${step.side === me ? 'you' : 'they'} ${sq(step.piece)}→${sq(step.to)}${
				step.cost > 1 ? ` (${step.cost} moves)` : ''
			}`,
		);
	const got = o.outcome.collected.map((r) =>
		isMateWeight(r.weight) ? `mate in ${mateIn(r.weight)}` : `${sq(r.square)} falls`,
	);
	if (!parts.length && !got.length) return 'nothing is collected and nothing is scheduled — the position holds';
	return [parts.join(' · '), got.length ? `→ ${got.join(', ')}` : ''].filter(Boolean).join('  ');
}

export function ComplexPanel({
	pos,
	played,
	plyKey,
	onShapes,
}: {
	pos: Chess;
	played: string;
	plyKey: string;
	/** Published to the Lab, which owns the board. Empty clears the overlay. */
	onShapes?: (s: Shape[]) => void;
}) {
	const [r, setR] = useState<Reading | null>(null);
	const [tab, setTab] = useState<'options' | 'ledger' | 'sites'>('options');
	const [hover, setHover] = useState<number | null>(null);
	const [line, setLine] = useState<Priced | null>(null);

	useEffect(() => {
		let alive = true;
		setR(null);
		const t = setTimeout(() => {
			let next: Reading | null = null;
			try {
				next = read(pos, played, plyKey);
			} catch {
				next = null;
			}
			if (alive) setR(next);
		}, 0);
		return () => {
			alive = false;
			clearTimeout(t);
		};
	}, [pos, played, plyKey]);

	// The ledger tab draws every row; hovering one narrows to it. Any other tab
	// leaves the board to whatever the Lab's own overlay selector says.
	useEffect(() => {
		if (!onShapes) return;
		if (!r || r.key !== plyKey) {
			onShapes([]);
			return;
		}
		// An option being hovered wins the board: it is a question about one move,
		// and the ledger's picture is about the position.
		if (line) {
			onShapes(lineOf(line, r.me));
			return;
		}
		if (tab !== 'ledger') {
			onShapes([]);
			return;
		}
		const rows = hover !== null && r.rows[hover] ? [r.rows[hover]] : r.rows;
		onShapes(rows.flatMap((o) => shapesOf(o, r.me)));
	}, [r, plyKey, tab, hover, line, onShapes]);

	if (!r || r.key !== plyKey)
		return (
			<Section title="The complex">
				<div style={{ fontSize: text.note, color: color.ink3 }}>reading the graph…</div>
			</Section>
		);

	const says = SAYS[r.verdict];

	return (
		<Section
			title="The complex"
			note={
				<>
					§1's ledger, §6's exchanges and the option set <code>choose()</code> prices — arrival horizon {ARRIVALS}. Every number
					is from <strong>{r.me}</strong>'s side, the one being asked to move.
				</>
			}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: space.gap,
					flexWrap: 'wrap',
					padding: `${space.snug}px ${space.card}px`,
					background: color.surface,
					borderRadius: 8,
					marginBottom: space.snug,
				}}
			>
				{/*
				  * WHOSE VERDICT. The Lab's own headline above this panel is the DEPTH
				  * SEARCH's, and on yMTAV it says "found it — values it at mate" while
				  * this says "never named it". Both are true of different systems, and
				  * nothing on screen said so. So this one is labelled, every time.
				  */}
				<span style={{ fontSize: text.note, color: color.ink3, whiteSpace: 'nowrap' }}>the complex:</span>
				<strong style={{ color: says.hue, fontSize: text.body }}>{says.word}</strong>
				<span style={{ fontSize: text.note, color: color.ink2 }}>— {says.note}</span>
				<span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: text.note, color: color.ink2, whiteSpace: 'nowrap' }}>
					{r.options.length} of {r.legal} legal moves named
				</span>
			</div>

			{/* The material number, decomposed into the men that produce it. */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: space.snug,
					flexWrap: 'wrap',
					fontSize: text.note,
					fontFamily: mono,
					color: color.ink2,
					marginBottom: space.snug,
				}}
			>
				<span>material</span>
				<strong style={{ color: r.now > 0 ? color.good : r.now < 0 ? color.bad : color.ink2 }}>{signed(r.now)}</strong>
				<span>=</span>
				{r.edge.length ? (
					r.edge.map((m, i) => (
						<span key={i} title={`${m.side} ${m.role} up`}>
							<Man role={m.role} side={m.side} />
						</span>
					))
				) : (
					<span>level</span>
				)}
				<span style={{ color: color.ink3 }}>
					{r.edge.length ? `(${r.edge[0].side} is up, from ${r.me}'s side)` : ''}
				</span>
			</div>

			<div style={{ display: 'flex', gap: space.tight, marginBottom: space.snug }}>
				{(['options', 'ledger', 'sites'] as const).map((k) => (
					<button
						key={k}
						onClick={() => setTab(k)}
						style={{
							fontSize: text.note,
							padding: '3px 10px',
							borderRadius: 999,
							border: `1px solid ${tab === k ? color.accent : color.line}`,
							background: tab === k ? color.accentSoft : 'transparent',
							color: tab === k ? color.accent : color.ink2,
							cursor: 'pointer',
						}}
					>
						{k === 'options'
							? `options (${r.options.length})`
							: k === 'ledger'
								? `ledger (${r.rows.filter((x) => !(r.blocked.get(x) ?? []).length).length}/${r.rows.length})`
								: `sites (${r.sites.length})`}
					</button>
				))}
			</div>

			{tab === 'options' && <Options r={r} pos={pos} played={played} onLine={setLine} line={line} />}
			{tab === 'ledger' && <Ledger r={r} pos={pos} onHover={setHover} />}
			{tab === 'sites' && <Sites r={r} pos={pos} />}
		</Section>
	);
}

/**
 * Every edit the graph named, priced as a sum the reader can check.
 *
 *     now  +  what changes hands  =  after       Δ = after − now
 *
 * `Δ` is the headline because it is the question actually being asked: what does
 * this move win or lose me, against standing still. The two other columns are
 * there so a Δ can be traced to the rows that produced it — a number whose parts
 * are not on the row is a defect in the ledger, and this panel exists to make
 * that visible rather than to tidy it away.
 */
function Options({
	r,
	pos,
	played,
	onLine,
	line,
}: {
	r: Reading;
	pos: Chess;
	played: string;
	onLine: (o: Priced | null) => void;
	line: Priced | null;
}) {
	const mine = (whiteRef: number) => (r.me === 'white' ? whiteRef : -whiteRef);
	return (
		<div style={{ overflowX: 'auto' }}>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
				Δ is what the move changes against standing still · ✓ chosen · ★ the puzzle's move · <em>hover a row to see its line
				on the board</em>
				<br />
				{/*
				  * A WEIGHT IS THE NET OF AN EXCHANGE, NOT THE PRIZE — and the column
				  * used to show only the prize beside it. So "wins a rook" sat next to
				  * 1.70 and read as nonsense; it is a rook won and a bishop given, and
				  * the bishop was nowhere on screen. Will: "a rook is not worth 1.70???"
				  * Quite. Both numbers are shown now: what is taken, then what is left
				  * after the recapture.
				  */}
				Δ = what this move captures, plus the nets of every row it collects. A piece shows{' '}
				<span style={{ color: color.ink3 }}>gross</span>→<strong>net</strong> — what is taken, then what survives the
				recapture.
			</div>
			{/* The hovered line in words, so the arrows have a caption. */}
			<div
				style={{
					// FIXED, NOT MINIMUM. The caption wraps to two lines on a long line and
					// the whole table jumped under the cursor as it did. Will: "there needs
					// to be a fixed vertical distance above the options list, so it doesn't
					// move when the text is rendered above."
					height: 56,
					overflow: 'hidden',
					fontSize: text.note,
					fontFamily: mono,
					color: line ? color.ink : color.ink3,
					marginBottom: space.tight,
				}}
			>
				{line ? `${sq(line.from)}${sq(line.to)}:  ${sayLine(line, r.me)}` : ' '}
			</div>
			<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}> </th>
						<th style={th}>move</th>
						<th style={{ ...th, textAlign: 'right' }}>Δ</th>
						<th style={th}>changes hands</th>
						<th style={th}>named as</th>
					</tr>
				</thead>
				<tbody>
					{r.options.map((o) => {
						const u = `${sq(o.from)}${sq(o.to)}`;
						const isAnswer = o === r.answer;
						const chosen = r.best.includes(o);
						const after = mine(o.value);
						const delta = after - r.now;
						const p = pos.board.get(o.from);
						const taken = pos.board.get(o.to);
						return (
							<tr
								key={u}
								onMouseEnter={() => onLine(o)}
								onMouseLeave={() => onLine(null)}
								style={{
									background: line === o ? color.accentSoft : isAnswer ? color.accentSoft : undefined,
									outline: line === o ? `1px solid ${color.accent}` : undefined,
									cursor: 'default',
								}}
							>
								<td style={{ ...td, color: color.ink2 }}>
									{chosen ? '✓' : ''}
									{isAnswer ? '★' : ''}
								</td>
								<td style={{ ...td, fontWeight: chosen || isAnswer ? 600 : 400 }}>
									{p && <Man role={p.role} side={p.color} />} {u}
								</td>
								<td
									style={{
										...td,
										textAlign: 'right',
										fontWeight: 600,
										color: delta > 0 ? color.good : delta < 0 ? color.bad : color.ink2,
									}}
								>
									{signed(delta)}
								</td>
								<td style={td}>
									{/*
									  * WHAT THE MOVE ITSELF TAKES comes first, because it is the
									  * first term of the sum and it was missing entirely. `f1f6`
									  * in `1lR5W` reads −2.30 = +1.00 (the pawn it captures)
									  * − 5.00 (the rook it loses there) + 1.70 (the rook it wins
									  * on e8), and only the last two were on screen. Will: "the
									  * decompositions still read incorrect."
									  */}
									{taken && (
										<span style={{ marginRight: 10, color: color.good, whiteSpace: 'nowrap' }}>
											+<Man role={taken.role} side={taken.color} />
											<span style={{ color: color.ink3 }}>{sq(o.to)}</span>{' '}
											<strong>{(V[taken.role] / 100).toFixed(2)}</strong>
										</span>
									)}
									<Hands rows={o.outcome.collected} me={r.me} />
								</td>
								<td style={{ ...td, color: color.ink3 }}>{o.why}</td>
							</tr>
						);
					})}
					{!r.answer && (
						// The answer ALWAYS gets a row, even when the graph never named it.
						// That absence is the finding, not a gap in the table.
						<tr style={{ background: color.badSoft, color: color.bad, fontWeight: 600 }}>
							<td style={td}>★</td>
							<td style={td}>{played}</td>
							<td style={td} colSpan={3}>
								not in the option set — Γ named no row this move discharges
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * What a move actually wins or loses, as men.
 *
 * A collected row is an obligation nobody covered in time, so the piece standing
 * on its square changes hands. Signed by whether it is mine going or theirs
 * coming — which is the whole of what the claimant field meant, said in a way
 * that does not read as a currency.
 */
function Hands({ rows, me }: { rows: Obligation[]; me: Color }) {
	if (!rows.length) return <span style={{ color: color.ink3 }}>—</span>;
	return (
		<>
			{rows.slice(0, 5).map((x, i) => {
				// The claimant is who WINS the man standing there, so the man belongs to
				// the other one. When I collect, it is their piece coming to me.
				const mine = x.claimant === me;
				const owner: Color = mine ? (me === 'white' ? 'black' : 'white') : me;
				const gross = x.role ? V[x.role] : 0;
				const net = x.weight;
				return (
					<span key={i} style={{ marginRight: 10, color: mine ? color.good : color.bad, whiteSpace: 'nowrap' }}>
						{mine ? '+' : '−'}
						{x.role ? <Man role={x.role} side={owner} /> : '?'}
						<span style={{ color: color.ink3 }}>{sq(x.square)}</span>
						{isMateWeight(net) ? (
							<strong> mate in {mateIn(net)}</strong>
						) : (
							<>
								{' '}
								<span style={{ color: color.ink3 }}>{(gross / 100).toFixed(2)}</span>
								{net !== gross && (
									<>
										<span style={{ color: color.ink3 }}>→</span>
										<strong>{(net / 100).toFixed(2)}</strong>
									</>
								)}
							</>
						)}
					</span>
				);
			})}
			{rows.length > 5 && <span style={{ color: color.ink3 }}>+{rows.length - 5} more</span>}
		</>
	);
}

/**
 * §1's rows: what is claimed, by whom, worth what, by when.
 *
 * FOUR COLUMNS THAT WERE ONE. The first version drew the piece standing on the
 * row's square next to the claimant's name, and the a6 row of yMTAV — Black
 * claiming White's a-pawn by Rc5–a5 — could only be read as "a black pawn
 * arriving on a6". Three different men are implicated in that row and it showed
 * one glyph. So: the PRIZE is what is at stake, the CLAIMANT is who wins it, and
 * the TRAVELLER is the piece that has to go somewhere for it to happen.
 */
function Ledger({ r, pos, onHover }: { r: Reading; pos: Chess; onHover?: (i: number | null) => void }) {
	return (
		<div style={{ overflowX: 'auto' }}>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
				each row reads left to right — <em>White wins ♜ on c5 by playing ♖d3 to c3, in 2</em>. Both sides' claims are
				here; worth is signed for {r.me}, so negative is owed. <strong>Faint rows are LATENT</strong> — the claim is
				registered and a man is standing in its way, which the column names.
			</div>
			<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}>who</th>
						<th style={th}>wins</th>
						<th style={th}>on</th>
						<th style={th}>by playing</th>
						<th style={th}>to</th>
						<th style={{ ...th, textAlign: 'right' }}>in</th>
						<th style={{ ...th, textAlign: 'right' }}>worth</th>
						<th style={th}>kind</th>
						<th style={th}>or</th>
					</tr>
				</thead>
				<tbody>
					{r.rows.map((o, i) => {
						const standing = pos.board.get(o.square);
						const traveller = o.from !== undefined ? pos.board.get(o.from) : undefined;
						const mine = o.claimant === r.me;
						const w = mine ? o.weight : -o.weight;
						const dest =
							o.via !== undefined ? sq(o.via) : o.kind === 'promotion' || o.from === undefined ? '—' : sq(o.square);
						const stops = r.blocked.get(o) ?? [];
						const latent = stops.length > 0;
						return (
							<tr
								key={i}
								onMouseEnter={() => onHover?.(i)}
								onMouseLeave={() => onHover?.(null)}
								style={{ cursor: 'default', opacity: latent ? 0.45 : 1 }}
							>
								<td style={{ ...td, color: color.ink2 }}>{o.claimant}</td>
								<td style={td}>
									{standing ? (
										<Man role={standing.role} side={standing.color} />
									) : o.kind === 'promotion' && traveller ? (
										// A promotion row sits on an EMPTY square: the prize is the new
										// queen, and the man at stake is the pawn that becomes her.
										<span>
											<Man role={traveller.role} side={traveller.color} />
											<span style={{ color: color.ink3 }}>→</span>
											<Man role="queen" side={traveller.color} />
										</span>
									) : (
										<span style={{ color: color.ink3 }}>·</span>
									)}
								</td>
								<td style={td}>{sq(o.square)}</td>
								<td style={{ ...td, color: color.ink2 }}>
									{traveller && <Man role={traveller.role} side={traveller.color} />}{' '}
									{o.from !== undefined ? sq(o.from) : '—'}
								</td>
								<td style={{ ...td, color: color.ink2 }}>{dest}</td>
								<td style={{ ...td, textAlign: 'right', color: color.ink2 }}>{o.deadline}</td>
								<td style={{ ...td, textAlign: 'right', fontWeight: 600, color: w > 0 ? color.good : color.bad }}>
									{signed(w)}
								</td>
								<td style={{ ...td, color: color.ink3 }}>
									{o.kind}
									{/*
									  * A CONTINGENT ROW IS NOT MERELY A BLOCKED ONE, and the ledger has
									  * to say which it is looking at. A latent row is a claim that
									  * would price if its route cleared; a contingent row is a RAY that
									  * has been registered and deliberately kept out of the recurrence
									  * — no price depends on it, by construction. Reading them as the
									  * same thing would make a row that cannot fire look like one that
									  * failed to.
									  */}
									{latent && (
										<span style={{ color: color.warn }}>
											{o.contingent ? ' · contingent on' : ' · blocked by'} {stops.map(sq).join(' ')}
										</span>
									)}
								</td>
								{/*
								  * The routes the row did NOT keep. Will: "both rooks can go to two
								  * squares where they would be captured, but instead there is only
								  * one per rook." Both exist; the row keeps the fastest and this
								  * column says what it passed over.
								  */}
								<td style={{ ...td, color: color.ink3 }}>
									{o.alts?.length ? o.alts.map((a) => `${sq(a.from)}→${sq(a.via)}`).join(' ') : ''}
								</td>
							</tr>
						);
					})}
					{!r.rows.length && (
						<tr>
							<td style={td} colSpan={8}>
								nothing live — every row is blocked or unenabled
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * §6's exchanges, naive against committed.
 *
 * Naive SEE assumes every defender is free to defend; the committed value is what
 * the square is worth once the pieces that cannot be in two places have been
 * allocated. A row where they differ is a coupling doing work.
 */
function Sites({ r, pos }: { r: Reading; pos: Chess }) {
	return (
		<div style={{ overflowX: 'auto' }}>
			<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}>at stake</th>
						<th style={th}>square</th>
						<th style={th}>taker</th>
						<th style={{ ...th, textAlign: 'right' }}>naive</th>
						<th style={{ ...th, textAlign: 'right' }}>§6</th>
						<th style={th}>attackers</th>
						<th style={th}>defenders</th>
					</tr>
				</thead>
				<tbody>
					{r.sites.map((s) => {
						const c = r.committed.get(s.square) ?? s.value;
						const moved = c !== s.value;
						const standing = pos.board.get(s.square);
						return (
							<tr key={s.square}>
								<td style={td}>{standing && <Man role={standing.role} side={standing.color} />}</td>
								<td style={td}>{sq(s.square)}</td>
								<td style={{ ...td, color: color.ink2 }}>{s.taker}</td>
								<td style={{ ...td, textAlign: 'right', color: color.ink2 }}>{plain(s.value)}</td>
								<td
									style={{
										...td,
										textAlign: 'right',
										color: moved ? color.accent : color.ink2,
										fontWeight: moved ? 600 : 400,
									}}
								>
									{plain(c)}
								</td>
								<td style={{ ...td, color: color.ink3 }}>{s.attackers.map(sq).join(' ') || '—'}</td>
								<td style={{ ...td, color: color.ink3 }}>{s.defenders.map(sq).join(' ') || '—'}</td>
							</tr>
						);
					})}
					{!r.sites.length && (
						<tr>
							<td style={td} colSpan={7}>
								no square on the board has an enemy bearing on it
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

const th: React.CSSProperties = { fontWeight: 400, padding: '2px 12px 4px 0', textAlign: 'left', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '3px 12px 3px 0', whiteSpace: 'nowrap' };

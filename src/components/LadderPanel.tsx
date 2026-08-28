// The ladder, on screen — and the half of it that no engine prints.
//
// ---------------------------------------------------------------------------
// WHAT THIS PANEL IS FOR.
//
// `ComplexPanel` showed a priced option set: thirty moves, each with a number.
// That is what an engine shows, and Will's objection to it is the reason this
// stack was rebuilt:
//
//   "Conceptually it is a sequential proof by exclusion that no higher value
//    tactic exists."
//
// A proof by exclusion has a SHAPE, and the shape is the product. Mate: no.
// A queen: no, and here is the reply that holds it. A rook: no, likewise. A
// pawn: YES, and here are all the ways. The number at the end is the least
// interesting line on the screen; every NO above it is the answer to "why not
// more", which is the question a trainer's user actually has and which a
// centipawn score cannot answer at all.
//
// So the rungs are the primary view, in descending order, each with its verdict
// and its exclusion. The moves table — the whole of what the old panel was — is
// demoted to a third tab, because a ranked list of moves is what you look at
// when you have stopped believing the proof.
//
// ---------------------------------------------------------------------------
// THREE THINGS THIS PANEL MUST NOT DO, all of them mistakes already made once.
//
//   1. NOT SPEAK FOR TWO SYSTEMS AT ONCE. The Lab's own headline is the depth
//      search's verdict. This one says whose verdict it is, every time.
//   2. NOT REPORT A WITNESS AS A COUNT. The engine's `via` names ONE surviving
//      reply, because df-pn stops at the first — so the mate rung's "ways out"
//      column reads `≥1` until someone clicks and pays for the enumeration. The
//      version that printed the witness list's length said "1 reply survives"
//      about a position with twenty-nine, which is the exact failure mode this
//      whole stack was built to stop: a certificate that is really a guess.
//   3. NOT PRINT A FORCED NUMBER AND AN UNFORCED ONE IN THE SAME TYPEFACE. The
//      bottom rung is an opinion — the best exchange on the board — and every
//      rung above it is a certificate. `forced` is the loudest word here.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import type { Chess } from 'chessops/chess';
import type { Color, NormalMove, Role } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import {
	ladderReport,
	mateTree,
	survivingReplies,
	type Attempt,
	type LadderReport,
	type ProofNode,
} from '../domain/ladder';
import { V } from '../domain/exchange';
import { color, space, text, mono } from '../ui/theme';
import { Section } from '../ui/primitives';
import type { Shape } from './Board';

/** The ply budget the rungs run at. Every YES and every NO below is under it. */
const DEPTH = 3;

const MAN: Record<Role, string> = { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' };

/**
 * A man, on his own square, at a fixed board colour.
 *
 * Lifted from `ComplexPanel` unchanged, including the reason: `color.page` and
 * `color.ink` SWAP between themes, so keying a piece to them inverts every man in
 * dark mode. These are literal, and nothing in the theme can reach them.
 */
function Man({ role, side }: { role: Role; side: Color }) {
	return (
		<span
			title={`${side} ${role}`}
			style={{
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

const sq = (s: number) => makeSquare(s);
const UCI: Record<string, string> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
/** UCI spells a knight `n`. Taking the first letter of the role spells it `k`. */
const uci = (m: NormalMove) => sq(m.from) + sq(m.to) + (m.promotion ? UCI[m.promotion] : '');

const pawns = (n: number) => {
	if (!Number.isFinite(n)) return n > 0 ? '+∞' : '−∞';
	return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n / 100).toFixed(2)}`;
};

/** What a rung ASKED for, said the way it was asked. */
const asked = (rung: 'mate' | number) => (rung === 'mate' ? 'mate' : `+${(rung / 100).toFixed(2)}`);

/**
 * The name of the thing a material rung is about.
 *
 * A rung is a bound from `rungs()` — the value of some enemy man, plus the
 * promotion allowance on the last rank. Printing "330" asks the reader to convert;
 * printing "a bishop" is what the rung MEANS, and the whole point of a ladder that
 * descends by piece is that its steps have names.
 */
function rungName(rung: 'mate' | number): string {
	if (rung === 'mate') return 'the king';
	const named: [number, string][] = [
		[V.queen, 'a queen'],
		[V.rook, 'a rook'],
		[V.bishop, 'a bishop'],
		[V.knight, 'a knight'],
		[V.pawn, 'a pawn'],
	];
	for (const [v, n] of named) if (rung === v) return n;
	// A promoting target: the man plus the queen he becomes.
	for (const [v, n] of named) if (rung === v + V.queen - V.pawn) return `${n}, promoting`;
	return `${(rung / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// SHAPES
//
// One vocabulary across all three tabs, so an arrow means the same thing wherever
// the cursor is: GOLD is the move we are asking about, GREEN is the defender
// getting away with it, RED is mate on the board.
// ---------------------------------------------------------------------------

const ours = (m: NormalMove, label?: string): Shape[] => [
	{ orig: sq(m.from), brush: 'gTwoJobs' },
	{ orig: sq(m.from), dest: sq(m.to), brush: 'gTwoJobs', label },
];
const theirs = (m: NormalMove, label?: string): Shape[] => [
	{ orig: sq(m.from), dest: sq(m.to), brush: 'gCovEvade', label },
];
const mates = (m: NormalMove): Shape[] => [{ orig: sq(m.from), dest: sq(m.to), brush: 'gUncovered', label: '#' }];

/**
 * One attempt, drawn: our move, and what the defender has against it.
 *
 * When the enumeration has been paid for, EVERY surviving reply goes on the board
 * at once — a refutation is not a line, it is the set of resources they still
 * have, and seven ways out should look like seven ways out. When it has not, one
 * witness arrow goes on, and it is labelled `one of` so the board is not making a
 * completeness claim the data cannot support.
 */
function missShapes(a: Attempt): Shape[] {
	const out = ours(a.move, 'tried');
	if (a.survivors) for (const s of a.survivors) out.push(...theirs(s));
	else if (a.witness) out.push(...theirs(a.witness, 'one of'));
	else if (a.held) out.push(...theirs(a.held, a.value !== undefined ? pawns(a.value) : undefined));
	return out;
}

export function LadderPanel({
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
	const [report, setReport] = useState<{ key: string; r: LadderReport } | null>(null);
	const [tab, setTab] = useState<'ladder' | 'proof' | 'moves'>('ladder');
	/** Which rung the proof tab is about. Index into `r.rungs`. */
	const [rung, setRung] = useState(0);
	const [hover, setHover] = useState<Shape[] | null>(null);

	// The ladder is a search, and a search on the render path freezes the panel.
	// Deferred by a tick so the "running" state paints first — the same shape as
	// `ComplexPanel`'s, and for the same reason.
	useEffect(() => {
		let alive = true;
		setReport(null);
		setRung(0);
		const t = setTimeout(() => {
			let next: LadderReport | null = null;
			try {
				next = ladderReport(pos, DEPTH);
			} catch {
				next = null;
			}
			if (alive && next) setReport({ key: plyKey, r: next });
		}, 0);
		return () => {
			alive = false;
			clearTimeout(t);
		};
	}, [pos, plyKey]);

	useEffect(() => {
		if (!onShapes) return;
		onShapes(hover ?? []);
	}, [hover, onShapes]);

	// Clear the board when the position moves out from under us.
	useEffect(() => setHover(null), [plyKey]);

	if (!report || report.key !== plyKey)
		return (
			<Section title="The ladder">
				<div style={{ fontSize: text.note, color: color.ink3 }}>
					running the rungs at depth {DEPTH} — descending by value, stopping at the first that answers…
				</div>
			</Section>
		);

	const r = report.r;
	const me = pos.turn;
	const wanted = played.slice(0, 4);
	const hit = r.moves.some((m) => uci(m).slice(0, 4) === wanted);

	return (
		<Section
			title="The ladder"
			note={
				<>
					A proof by exclusion, run at depth {DEPTH}: each rung asks whether something of that value can be FORCED, and
					the first YES is the answer. Every NO above it is why not more. Numbers are from <strong>{me}</strong>'s side.
				</>
			}
		>
			<Headline r={r} hit={hit} played={played} />

			<div style={{ display: 'flex', gap: space.tight, marginBottom: space.snug }}>
				{(['ladder', 'proof', 'moves'] as const).map((k) => (
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
						{k === 'ladder'
							? `ladder (${r.rungs.length})`
							: k === 'proof'
								? 'proof'
								: `moves (${r.rungs[r.rungs.length - 1]?.attempts.length ?? 0})`}
					</button>
				))}
			</div>

			{tab === 'ladder' && (
				<Rungs
					r={r}
					pos={pos}
					onHover={setHover}
					onOpen={(i) => {
						setRung(i);
						setTab('proof');
					}}
				/>
			)}
			{tab === 'proof' && <Proof r={r} pos={pos} rung={rung} setRung={setRung} onHover={setHover} />}
			{tab === 'moves' && <Moves r={r} pos={pos} played={played} onHover={setHover} />}
		</Section>
	);
}

/**
 * The verdict, and whose it is.
 *
 * `forced` is the word that carries the whole distinction between this stack and
 * an engine, so it is stated in words rather than implied by a number: a proved
 * rung says "forced — here is the certificate", the bottom rung says "best
 * exchange — not forced", and the two are never the same colour.
 */
function Headline({ r, hit, played }: { r: LadderReport; hit: boolean; played: string }) {
	const word = r.value === 'mate' ? 'MATE' : r.value === null ? 'nothing' : pawns(r.value);
	const hue = r.forced ? color.good : color.warn;
	return (
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
			<span style={{ fontSize: text.note, color: color.ink3, whiteSpace: 'nowrap' }}>the ladder:</span>
			<strong style={{ color: hue, fontSize: text.body, fontFamily: mono }}>{word}</strong>
			<span style={{ fontSize: text.note, color: r.forced ? color.good : color.warn }}>
				{r.forced ? 'forced — proved, with every higher rung excluded' : 'best exchange — an opinion, not a proof'}
			</span>
			<span style={{ fontSize: text.note, color: color.ink2 }}>
				via {r.moves.slice(0, 4).map(uci).join(' ') || '—'}
				{r.moves.length > 4 ? ` +${r.moves.length - 4}` : ''}
				{r.moves.length > 1 ? ' (a dual)' : ''}
			</span>
			<span
				style={{
					marginLeft: 'auto',
					fontFamily: mono,
					fontSize: text.note,
					color: hit ? color.good : color.bad,
					whiteSpace: 'nowrap',
				}}
				title="the puzzle's move"
			>
				★ {played} {hit ? 'in the answer set' : 'not in the answer set'}
			</span>
			<span style={{ fontFamily: mono, fontSize: text.note, color: color.ink3, whiteSpace: 'nowrap' }}>
				{r.nodes} nodes
			</span>
		</div>
	);
}

/**
 * THE LADDER ITSELF — the view this panel exists for.
 *
 * One row per rung, in descending order, reading as a sentence:
 *
 *     a rook?   NO    ♗c5 came closest, held to +1.00 by ♚a2
 *     a pawn?   YES   ♖b2, ♖b3
 *
 * The exclusion column is the product. A rung with a blank there is a rung that
 * was refuted without a reason, which would be a defect in the domain rather than
 * a gap here — so it says so in as many words instead of rendering empty.
 */
function Rungs({
	r,
	pos,
	onHover,
	onOpen,
}: {
	r: LadderReport;
	pos: Chess;
	onHover: (s: Shape[] | null) => void;
	onOpen: (i: number) => void;
}) {
	return (
		<div style={{ overflowX: 'auto' }}>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
				rungs descend by value and the first YES ends the ladder — so every row above it is a REFUTATION, and the last
				column is what did the refuting. <em>Hover a row to draw it; click to open its proof.</em>
			</div>
			<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}>can I win…</th>
						<th style={th}> </th>
						<th style={th}>worth</th>
						<th style={th}>answer</th>
						<th style={th}>why not</th>
					</tr>
				</thead>
				<tbody>
					{r.rungs.map((x, i) => {
						const miss = x.miss;
						const near = x.attempts[0];
						return (
							<tr
								key={i}
								onMouseEnter={() => onHover(near ? missShapes(near) : x.moves.flatMap((m) => ours(m)))}
								onMouseLeave={() => onHover(null)}
								onClick={() => onOpen(i)}
								style={{ cursor: 'pointer', background: x.proved ? color.accentSoft : undefined }}
							>
								<td style={{ ...td, color: color.ink }}>{rungName(x.rung)}</td>
								<td style={{ ...td, fontWeight: 700, color: x.proved ? color.good : color.bad }}>
									{x.proved ? 'YES' : 'no'}
								</td>
								<td style={{ ...td, textAlign: 'right', color: color.ink3 }}>{asked(x.rung)}</td>
								<td style={td}>
									{x.proved ? (
										<strong>{x.moves.map(uci).join(' ')}</strong>
									) : (
										<span style={{ color: color.ink3 }}>none</span>
									)}
								</td>
								<td style={{ ...td, color: color.ink2 }}>
									{x.proved ? (
										''
									) : miss ? (
										<Why pos={pos} miss={miss} rung={x.rung} tried={x.attempts.length} near={near} />
									) : (
										<span style={{ color: color.warn }}>
											refuted with no nearest attempt — the domain gave no reason
										</span>
									)}
								</td>
							</tr>
						);
					})}
					{/*
					  * THE BOTTOM RUNG IS A ROW, NOT AN ABSENCE. When nothing above answered,
					  * the ladder falls through to the best exchange on the board — and that
					  * fall-through is a finding, so it gets a line of its own rather than
					  * being inferred from a table that simply ends.
					  */}
					{!r.forced && (
						<tr style={{ background: color.warnSoft }}>
							<td style={{ ...td, color: color.ink }}>anything at all</td>
							<td style={{ ...td, fontWeight: 700, color: color.warn }}>—</td>
							<td style={{ ...td, textAlign: 'right', color: color.ink3 }}>
								{typeof r.value === 'number' ? pawns(r.value) : ''}
							</td>
							<td style={td}>{r.moves.slice(0, 3).map(uci).join(' ')}</td>
							<td style={{ ...td, color: color.warn }}>
								nothing is forced here — this is the best immediate exchange, which is an opinion
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * The exclusion, as a sentence with men in it.
 *
 * THE MATE RUNG DOES NOT SAY "CAME CLOSEST", and the material rungs do.
 *
 * That asymmetry is not a style choice. A material rung scores every move, so
 * "closest" is a fact about the numbers. The mate rung has no such measure: the
 * search stops at the first surviving reply, so every refuted move looks
 * identically refuted, and the only cheap ordering is the generator's. Calling
 * one of them "closest" would be dressing up an array index. So the mate rung
 * reports what it actually knows — how many moves were tried, that all of them
 * were answered, and one worked example.
 */
function Why({
	pos,
	miss,
	rung,
	tried,
	near,
}: {
	pos: Chess;
	miss: NonNullable<LadderReport['rungs'][number]['miss']>;
	rung: 'mate' | number;
	tried: number;
	near?: Attempt;
}) {
	const p = pos.board.get(miss.move.from);
	if (rung === 'mate')
		return (
			<>
				all <span style={{ color: color.ink }}>{tried}</span> moves answered — e.g. {p && <Man role={p.role} side={p.color} />}{' '}
				<strong>{uci(miss.move)}</strong>
				{miss.held ? (
					<>
						{' '}
						meets <strong>{uci(miss.held)}</strong>
					</>
				) : (
					''
				)}
				{near && !near.witness ? <span style={{ color: color.warn }}> (unresolved at this depth)</span> : ''}
			</>
		);
	return (
		<>
			{p && <Man role={p.role} side={p.color} />} <strong>{uci(miss.move)}</strong> came closest, held to{' '}
			<strong style={{ color: miss.value > 0 ? color.good : color.bad }}>{pawns(miss.value)}</strong>
			{miss.held ? (
				<>
					{' '}
					by <strong>{uci(miss.held)}</strong>
				</>
			) : (
				''
			)}
		</>
	);
}

/**
 * THE CERTIFICATE, expanded.
 *
 * For a proved mate rung: our move, EVERY reply, and our answer to each — not a
 * principal variation. A PV shows one line and asks the reader to take the rest on
 * trust; a mate is only a mate if every reply is answered, so every reply is here.
 *
 * For a refuted rung: every move we tried, with what the defender had. The mate
 * rung shows ONE witness per move for free, and the complete list of surviving
 * replies for whichever move the reader clicks — because the enumeration is a
 * solve per legal reply, and doing thirty of those on the chance that someone
 * looks is how a panel becomes unusable. Clicking is the reader saying the price
 * is worth paying for THIS move.
 */
function Proof({
	r,
	pos,
	rung,
	setRung,
	onHover,
}: {
	r: LadderReport;
	pos: Chess;
	rung: number;
	setRung: (i: number) => void;
	onHover: (s: Shape[] | null) => void;
}) {
	const x = r.rungs[Math.min(rung, r.rungs.length - 1)];
	const attacker = pos.turn;
	/** Moves whose full survivor list the reader has asked for, by UCI. */
	const [opened, setOpened] = useState<Record<string, NormalMove[]>>({});
	useEffect(() => setOpened({}), [pos, rung]);
	// The tree is expensive and only exists for a proved mate. Built here rather
	// than in the report so a panel that never opens this tab never pays for it.
	const tree = useMemo(
		() => (x && x.rung === 'mate' && x.proved && x.moves[0] ? mateTree(pos, x.moves[0], attacker, DEPTH) : null),
		[x, pos, attacker],
	);
	if (!x) return null;
	return (
		<div style={{ overflowX: 'auto' }}>
			<div style={{ display: 'flex', gap: space.tight, marginBottom: space.tight, flexWrap: 'wrap' }}>
				{r.rungs.map((y, i) => (
					<button
						key={i}
						onClick={() => setRung(i)}
						style={{
							fontSize: text.note,
							fontFamily: mono,
							padding: '2px 8px',
							borderRadius: 4,
							border: `1px solid ${i === rung ? color.accent : color.line}`,
							background: 'transparent',
							color: y.proved ? color.good : color.ink2,
							cursor: 'pointer',
						}}
					>
						{asked(y.rung)} {y.proved ? '✓' : '✗'}
					</button>
				))}
			</div>

			{x.proved && x.rung === 'mate' && tree && (
				<>
					<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
						every reply is listed, because a mate that answers only the reply we expected is not a mate.
					</div>
					<Tree node={tree} pos={pos} depth={0} onHover={onHover} />
				</>
			)}

			{x.proved && x.rung !== 'mate' && (
				<div style={{ fontSize: text.note, fontFamily: mono, color: color.ink2 }}>
					{/*
					  * A MATERIAL RUNG'S PROOF IS ONE PLY WIDE, and saying so is more honest
					  * than drawing a tree that has no branches. `guarantees` is a minimum
					  * over the defender's replies — the certificate is "every reply they
					  * have leaves at least this", and the reply that leaves exactly this is
					  * the one worth showing.
					  */}
					the proof is a minimum over every reply: whatever they play, at least{' '}
					<strong style={{ color: color.good }}>{asked(x.rung)}</strong> is left. The moves tab lists each of ours with
					the reply that holds it lowest.
				</div>
			)}

			{!x.proved && (
				<>
					<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
						{x.rung === 'mate' ? (
							<>
								every move we have, and one reply that answers it. <strong>One</strong> — the search stops at the
								first, so the count is not a count. <em>Click a row to enumerate every reply that survives it</em>{' '}
								(a search per reply, so it is asked for rather than assumed). Hover to draw.
							</>
						) : (
							<>
								best first. The right-hand column is the reply that holds the swing down — the minimum is over
								ALL replies, so this is the one that achieves it. <em>Hover a row to draw it.</em>
							</>
						)}
					</div>
					<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
						<thead>
							<tr style={{ color: color.ink2 }}>
								<th style={th}>we try</th>
								<th style={{ ...th, textAlign: 'right' }}>{x.rung === 'mate' ? 'ways out' : 'held to'}</th>
								<th style={th}>they answer</th>
							</tr>
						</thead>
						<tbody>
							{x.attempts.slice(0, 24).map((a, i) => {
								const p = pos.board.get(a.move.from);
								const u = uci(a.move);
								const full = opened[u];
								const shown: Attempt = full ? { ...a, survivors: full } : a;
								return (
									<tr
										key={i}
										onMouseEnter={() => onHover(missShapes(shown))}
										onMouseLeave={() => onHover(null)}
										onClick={() => {
											if (x.rung !== 'mate' || full) return;
											setOpened((o) => ({ ...o, [u]: survivingReplies(pos, a.move, attacker, DEPTH) }));
										}}
										style={{ cursor: x.rung === 'mate' && !full ? 'pointer' : 'default' }}
									>
										<td style={td}>
											{p && <Man role={p.role} side={p.color} />} {u}
										</td>
										<td style={{ ...td, textAlign: 'right', color: full ? color.ink : color.ink3 }}>
											{/*
											  * A WITNESS IS NOT A COUNT. Until the enumeration is paid for
											  * this column says "≥1", which is the whole of what the search
											  * established. The version that printed `survivors.length` here
											  * printed 1 for a position with twenty-nine ways out.
											  */}
											{x.rung === 'mate'
												? full
													? full.length
													: a.witness
														? '≥1'
														: '?'
												: a.value !== undefined
													? pawns(a.value)
													: ''}
										</td>
										<td style={{ ...td, color: color.ink3 }}>
											{full
												? full.slice(0, 10).map(uci).join(' ') + (full.length > 10 ? ` +${full.length - 10}` : '')
												: a.witness
													? `${uci(a.witness)} …`
													: a.held
														? uci(a.held)
														: '—'}
										</td>
									</tr>
								);
							})}
							{x.attempts.length > 24 && (
								<tr>
									<td style={{ ...td, color: color.ink3 }} colSpan={3}>
										+{x.attempts.length - 24} further attempts, all refuted
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}

/** The mate tree, indented. Ours in gold, theirs plain, mate in red. */
function Tree({
	node,
	pos,
	depth,
	onHover,
}: {
	node: ProofNode;
	pos: Chess;
	depth: number;
	onHover: (s: Shape[] | null) => void;
}) {
	const mine = depth % 2 === 0;
	return (
		<div style={{ marginLeft: depth ? 16 : 0, fontFamily: mono, fontSize: text.note }}>
			<span
				onMouseEnter={() => onHover(node.mate ? mates(node.move) : mine ? ours(node.move) : theirs(node.move))}
				onMouseLeave={() => onHover(null)}
				style={{
					color: node.mate ? color.bad : mine ? color.ink : color.ink2,
					fontWeight: mine ? 600 : 400,
					cursor: 'default',
				}}
			>
				{uci(node.move)}
				{node.mate ? '#' : ''}
			</span>
			{!node.mate && !node.kids.length && !mine && (
				// A reply with no answer under it is the tree failing to close, and that
				// is a finding about the depth rather than a rendering gap.
				<span style={{ color: color.warn }}> — no answer found within depth {DEPTH}</span>
			)}
			{node.kids.map((k, i) => (
				<Tree key={i} node={k} pos={pos} depth={depth + 1} onHover={onHover} />
			))}
		</div>
	);
}

/**
 * The ranked options — what the old panel was, kept as a third tab.
 *
 * It is here because a proof that disagrees with the reader has to be checkable
 * against the alternatives, not because a ranked list is the answer. `Δ` is what
 * the move GUARANTEES against standing still — a minimum over the defender's
 * replies, not an evaluation — and `held by` is the reply that enforces it.
 */
function Moves({
	r,
	pos,
	played,
	onHover,
}: {
	r: LadderReport;
	pos: Chess;
	played: string;
	onHover: (s: Shape[] | null) => void;
}) {
	const last = r.rungs[r.rungs.length - 1];
	const rows = last?.attempts ?? [];
	const chosen = new Set(r.moves.map(uci));
	const want = played.slice(0, 4);
	const named = rows.some((a) => uci(a.move).slice(0, 4) === want);
	return (
		<div style={{ overflowX: 'auto' }}>
			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight, fontFamily: mono }}>
				Δ is what the move <strong>guarantees</strong> against standing still — the MINIMUM over every reply, not an
				evaluation. ✓ chosen · ★ the puzzle's move. <em>Hover a row to draw it.</em>
			</div>
			<table style={{ borderCollapse: 'collapse', fontSize: text.note, fontFamily: mono, minWidth: '100%' }}>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}> </th>
						<th style={th}>move</th>
						<th style={{ ...th, textAlign: 'right' }}>Δ</th>
						<th style={th}>held by</th>
						<th style={th}>takes</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((a, i) => {
						const u = uci(a.move);
						const p = pos.board.get(a.move.from);
						const taken = pos.board.get(a.move.to);
						const isAnswer = u.slice(0, 4) === want;
						const pick = chosen.has(u);
						const d = a.value;
						return (
							<tr
								key={i}
								onMouseEnter={() => onHover(missShapes(a))}
								onMouseLeave={() => onHover(null)}
								style={{ background: isAnswer ? color.accentSoft : undefined, cursor: 'default' }}
							>
								<td style={{ ...td, color: color.ink2 }}>
									{pick ? '✓' : ''}
									{isAnswer ? '★' : ''}
								</td>
								<td style={{ ...td, fontWeight: pick || isAnswer ? 600 : 400 }}>
									{p && <Man role={p.role} side={p.color} />} {u}
								</td>
								<td
									style={{
										...td,
										textAlign: 'right',
										fontWeight: 600,
										color: d === undefined ? color.ink3 : d > 0 ? color.good : d < 0 ? color.bad : color.ink2,
									}}
								>
									{d === undefined ? '' : pawns(d)}
								</td>
								<td style={{ ...td, color: color.ink3 }}>{a.held ? uci(a.held) : a.survivors ? '' : '—'}</td>
								<td style={td}>
									{taken ? (
										<span style={{ color: color.good }}>
											<Man role={taken.role} side={taken.color} /> {(V[taken.role] / 100).toFixed(2)}
										</span>
									) : (
										<span style={{ color: color.ink3 }}>—</span>
									)}
								</td>
							</tr>
						);
					})}
					{!named && (
						// The puzzle's move ALWAYS gets a row. Its absence is the finding.
						<tr style={{ background: color.badSoft, color: color.bad, fontWeight: 600 }}>
							<td style={td}>★</td>
							<td style={td}>{played}</td>
							<td style={td} colSpan={3}>
								not among the moves scored at this rung
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

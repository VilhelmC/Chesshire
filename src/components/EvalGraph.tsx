// The evaluation through a game, with enough on it to be read.
//
// ---------------------------------------------------------------------------
// Will, on the version this replaces:
//
//   "evaluation graph in review, should probably fit available space
//    horizontally? Also needs at least labelled vertical axis … I don't quite
//    understand the evaluation graph since it is missing legend? How does user
//    tell opponent and own mistakes / blunders / inaccuracies apart if every
//    point of the graph is a full ply (your and opponent move)? Wouldn't it
//    make more sense to alternate so it is always clear which point on the
//    graph belongs to which player? So a point on the graph is a half ply?"
//
// THE LAST QUESTION HAS A SURPRISING ANSWER: it already was a half ply. One
// point per ply, alternating sides, exactly as asked for. The graph just had no
// way of saying so — no axis, no labels, no legend — so the only honest reading
// available was the one Will made. A chart that is right and unreadable is
// wrong, and the fault is entirely the chart's.
//
// So the fix is not the data, it is everything around it:
//
//   * THE MOVE NUMBER ALONG THE BOTTOM, with a faint band per move. A band is
//     two plies wide, so which half of a band a point sits in IS whose move it
//     was — the alternation made visible instead of asserted.
//   * A LABELLED VERTICAL AXIS in pawns, the unit the numbers are quoted in
//     everywhere else in the app. Without it the line's height meant nothing at
//     all: a dip could be a tenth of a pawn or a queen.
//   * A LEGEND for the dots, because they carry a second story — a judgement on
//     the move that reached each point, and a ring where the opponent handed
//     something over. That vocabulary was documented in a source comment, which
//     is not where a reader is.
//   * THE FULL WIDTH, measured rather than the hardcoded 360 that left half the
//     column empty on a desktop and overflowed a narrow phone.
//
// ---------------------------------------------------------------------------
// AND A GAP IS DRAWN AS A GAP.
//
// The old path ran `L` from each measured ply to the next, so a game measured
// to ply eight and then abandoned drew a confident straight line across fifty
// plies nobody had looked at. That is not a missing feature, it is the chart
// stating something false — and it is exactly what made "many of my games are
// incompletely scored" hard to notice. The line now breaks, and the unmeasured
// stretch is shaded and named. See `domain/scored.ts` for why the gaps are
// there in the first place.
// ---------------------------------------------------------------------------

import { signed, type Annotation } from '../domain/annotate';
import { winPercent } from '../domain/accuracy';
import { QUALITY_COLOUR, QUALITY_LABEL, type Quality } from '../domain/review';
import { useMeasure } from './useViewport';
import { color, text } from '../ui/theme';

/** Judgements bad enough that the graph should point at them. */
export const WORTH_MARKING = new Set<Quality>(['inaccuracy', 'mistake', 'blunder']);

/*
 * THE VERTICAL SCALE IS WIN CHANCE, LABELLED IN PAWNS.
 *
 * A linear centipawn axis wide enough to hold a lost queen leaves the whole of
 * a normal game — which lives inside ±1 pawn — as a flat line along the middle.
 * The old chart clamped at ±6 pawns linearly and that is exactly how it read:
 * nothing happening, then a cliff.
 *
 * So height is `winPercent`, which is the currency the app already judges moves
 * in — `winDrop` decides what becomes a flashcard — and it gives the small
 * swings the room they deserve while still fitting the big ones on the page.
 * The LABELS stay in pawns, because that is the unit every other number in the
 * app is quoted in; they simply sit where their win chance puts them.
 */
const RULES = [6, 3, 1, -1, -3, -6];

/*
 * Tall enough for the pawn labels to sit apart.
 *
 * At 120 the ±1 rules crowded the zero line into an unreadable stack of three
 * — which is the height at which an axis stops being an axis.
 */
const H = 150;
/** Room for the pawn labels on the left and the move numbers underneath. */
const AXIS_W = 26;
const AXIS_H = 16;
const PAD = 6;
/** Narrower than this and the axis labels cost more than they explain. */
const MIN_W = 220;

export function EvalGraph({
	evals,
	notes,
	ply,
	plies,
	onSelect,
}: {
	/** Our point of view, indexed by ply count. Null where nothing measured it. */
	evals: (number | null)[];
	notes: Annotation[];
	ply: number;
	plies: number;
	onSelect: (p: number) => void;
}) {
	const [ref, available] = useMeasure<HTMLDivElement>();
	const W = Math.max(MIN_W, available || 360);
	const plot = { x: AXIS_W, y: PAD, w: W - AXIS_W - PAD, h: H - AXIS_H - PAD * 2 };

	const xOf = (i: number) => plot.x + (plies ? (i / plies) * plot.w : plot.w / 2);
	// `winPercent` runs 0 to 100 with 50 at level, so the centre line is level
	// and the curve does the compressing.
	const yOf = (cp: number) => plot.y + plot.h * (1 - winPercent(cp) / 100);

	const pts: { x: number; y: number; p: number; cp: number }[] = [];
	for (let i = 0; i <= plies; i++) {
		const cp = evals[i];
		if (cp === null || cp === undefined) continue;
		pts.push({ x: xOf(i), y: yOf(cp), p: i, cp });
	}

	/*
	 * RUNS OF CONSECUTIVE PLIES, so the line can break where the measuring did.
	 * One `M` per run rather than one `L` per point — see the header.
	 */
	const runs: (typeof pts)[] = [];
	for (const pt of pts) {
		const open = runs[runs.length - 1];
		if (open && open[open.length - 1].p === pt.p - 1) open.push(pt);
		else runs.push([pt]);
	}

	const here = pts.find((pt) => pt.p === ply);

	return (
		<div ref={ref} data-region="eval-graph" style={{ width: '100%' }}>
			{pts.length < 2 ? (
				<p style={{ fontSize: text.note, color: color.ink2, margin: 0 }}>
					Not enough evaluations recorded to draw a graph.
				</p>
			) : (
				<svg
					width="100%"
					height={H}
					viewBox={`0 0 ${W} ${H}`}
					role="img"
					aria-label="Evaluation through the game, one point per ply"
					style={{ display: 'block', overflow: 'visible' }}
				>
					{/* One faint band per MOVE — two plies wide, so which half of a band
						a point sits in says whose move it was. */}
					{bands(plies).map((b) => (
						<rect
							key={b.move}
							x={xOf(b.from)}
							y={plot.y}
							width={Math.max(0, xOf(b.to) - xOf(b.from))}
							height={plot.h}
							fill={color.ink}
							opacity={b.move % 2 ? 0 : 0.035}
						/>
					))}

					{/*
					  * The stretches nobody measured, named rather than drawn through.
					  *
					  * Painted OVER the move bands and with a hard edge where the
					  * measuring stopped: at a tint faint enough not to shout, the
					  * shading was indistinguishable from the banding underneath it,
					  * which is the one reading it must not have.
					  */}
					{gaps(evals, plies).map((g) => (
						<g key={g.from}>
							<rect
								x={xOf(g.from)}
								y={plot.y}
								width={Math.max(1, xOf(g.to) - xOf(g.from))}
								height={plot.h}
								fill={color.page}
								opacity={0.85}
							/>
							<rect
								x={xOf(g.from)}
								y={plot.y}
								width={Math.max(1, xOf(g.to) - xOf(g.from))}
								height={plot.h}
								fill={color.warn}
								opacity={0.14}
							>
								<title>plies {g.from + 1}–{g.to}: not evaluated</title>
							</rect>
							<line
								x1={xOf(g.from)}
								x2={xOf(g.from)}
								y1={plot.y}
								y2={plot.y + plot.h}
								stroke={color.warn}
								strokeWidth={1}
								strokeDasharray="3 2"
							/>
						</g>
					))}

					{RULES.map((pawns) => (
						<g key={pawns}>
							<line
								x1={plot.x}
								x2={plot.x + plot.w}
								y1={yOf(pawns * 100)}
								y2={yOf(pawns * 100)}
								stroke={color.line}
								strokeWidth={1}
								strokeDasharray="2 3"
							/>
							<text
								x={plot.x - 4}
								y={yOf(pawns * 100) + 3}
								fontSize={9}
								fill={color.ink3}
								textAnchor="end"
							>
								{pawns > 0 ? `+${pawns}` : `−${Math.abs(pawns)}`}
							</text>
						</g>
					))}

					{/* Zero is the thing being read against, so it is a real line. */}
					<line
						x1={plot.x}
						x2={plot.x + plot.w}
						y1={yOf(0)}
						y2={yOf(0)}
						stroke={color.ink3}
						strokeWidth={1}
					/>
					<text x={plot.x - 4} y={yOf(0) + 3} fontSize={9} fill={color.ink2} textAnchor="end">
						0
					</text>

					{runs.map((run) => (
						<path
							key={run[0].p}
							d={run.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')}
							fill="none"
							stroke={color.accent}
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
					))}

					{ticks(plies).map((t) => (
						<text
							key={t.move}
							x={xOf(t.at)}
							y={H - 4}
							fontSize={9}
							fill={color.ink3}
							textAnchor="middle"
						>
							{t.move}
						</text>
					))}

					{pts.map((pt) => {
						const n = notes[pt.p - 1];
						const marked = n?.quality && WORTH_MARKING.has(n.quality);
						const current = pt.p === ply;
						return (
							<circle
								key={pt.p}
								cx={pt.x}
								cy={pt.y}
								r={current ? 5 : marked || n?.opportunity ? 4 : 2.5}
								fill={
									current
										? color.accent
										: marked
											? QUALITY_COLOUR[n!.quality as Quality]
											: color.surface
								}
								stroke={n?.opportunity ? color.good : color.accent}
								strokeWidth={n?.opportunity ? 2.5 : 1.5}
								style={{ cursor: 'pointer' }}
								onClick={() => onSelect(pt.p)}
							>
								<title>
									{moveLabel(pt.p)}
									{n ? ` — ${n.side === 'us' ? 'you' : 'them'}` : ''}: {signed(pt.cp)}
									{n?.quality && WORTH_MARKING.has(n.quality)
										? ` — ${QUALITY_LABEL[n.quality].toLowerCase()}`
										: ''}
									{n?.opportunity ? ' — chance to punish' : ''}
									{n?.missedPunish ? ' — chance missed' : ''}
								</title>
							</circle>
						);
					})}

					{here && (
						<text
							x={Math.min(plot.x + plot.w - 26, here.x + 7)}
							y={here.y < plot.y + plot.h / 2 ? here.y + 14 : here.y - 7}
							fontSize={11}
							fill={color.ink}
						>
							{signed(here.cp)}
						</text>
					)}
				</svg>
			)}

			<Legend hasGaps={gaps(evals, plies).length > 0} />
		</div>
	);
}

/**
 * What the marks mean.
 *
 * The dots were carrying three separate claims — a judgement, a chance offered,
 * and where you are looking — and the only place any of that was written down
 * was a comment in the source, which is not where a reader is.
 */
function Legend({ hasGaps }: { hasGaps: boolean }) {
	return (
		<div
			style={{
				display: 'flex',
				flexWrap: 'wrap',
				gap: 12,
				marginTop: 6,
				fontSize: text.note,
				color: color.ink2,
				alignItems: 'center',
			}}
		>
			<span>One point per ply — bands are whole moves, yours and theirs.</span>
			{(['inaccuracy', 'mistake', 'blunder'] as Quality[]).map((q) => (
				<Key key={q} label={QUALITY_LABEL[q].toLowerCase()} fill={QUALITY_COLOUR[q]} />
			))}
			<Key label="chance to punish" fill={color.surface} ring={color.good} />
			{hasGaps && <Key label="not evaluated" block={color.warn} />}
		</div>
	);
}

function Key({
	label,
	fill,
	ring,
	block,
}: {
	label: string;
	fill?: string;
	ring?: string;
	block?: string;
}) {
	return (
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
			{block ? (
				<span
					style={{
						width: 10,
						height: 10,
						background: block,
						opacity: 0.25,
						borderRadius: 2,
						display: 'inline-block',
					}}
				/>
			) : (
				<svg width="10" height="10" aria-hidden>
					<circle
						cx={5}
						cy={5}
						r={3.5}
						fill={fill}
						stroke={ring ?? fill}
						strokeWidth={ring ? 2 : 1}
					/>
				</svg>
			)}
			{label}
		</span>
	);
}

/** One band per move: plies 2n−1 and 2n, as a half-open range of ply indices. */
export function bands(plies: number): { move: number; from: number; to: number }[] {
	const out: { move: number; from: number; to: number }[] = [];
	for (let from = 0; from < plies; from += 2) {
		out.push({ move: from / 2 + 1, from, to: Math.min(plies, from + 2) });
	}
	return out;
}

/**
 * Which move numbers to print, so the labels never collide.
 *
 * A 120-ply game cannot show sixty numbers in 300px, so it shows every fifth or
 * every tenth. Chosen from the game's length rather than from the measured
 * width because a label that appears and disappears as a panel resizes is worse
 * than one that is simply sparse.
 */
export function ticks(plies: number): { move: number; at: number }[] {
	const moves = Math.ceil(plies / 2);
	if (moves <= 0) return [];
	const every = moves <= 12 ? 2 : moves <= 30 ? 5 : moves <= 60 ? 10 : 20;
	const out: { move: number; at: number }[] = [];
	for (let m = every; m <= moves; m += every) out.push({ move: m, at: Math.min(plies, m * 2) });
	return out;
}

/**
 * Stretches of plies with no evaluation, as half-open ranges.
 *
 * Ply 0 is the starting position, which is never a measurement and never a gap
 * — `annotate` supplies the known starting value. So the scan begins at 1.
 */
export function gaps(
	evals: readonly (number | null)[],
	plies: number,
): { from: number; to: number }[] {
	const out: { from: number; to: number }[] = [];
	let open: number | null = null;
	for (let i = 1; i <= plies; i++) {
		const missing = evals[i] === null || evals[i] === undefined;
		if (missing && open === null) open = i - 1;
		if (!missing && open !== null) {
			out.push({ from: open, to: i - 1 });
			open = null;
		}
	}
	if (open !== null) out.push({ from: open, to: plies });
	return out;
}

/** "12." or "12…", which is how the rest of the app names a half move. */
function moveLabel(ply: number): string {
	if (ply <= 0) return 'start';
	return `move ${Math.floor((ply - 1) / 2) + 1}${ply % 2 === 0 ? '…' : '.'}`;
}

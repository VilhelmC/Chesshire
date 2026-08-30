// "Why is this move worse than that one?" — and then the same question again,
// from wherever the answer stopped making sense.
//
// ---------------------------------------------------------------------------
// THE RECURSION IS THE DESIGN, and it is what makes the whole thing affordable.
//
// Will: "if user at some point in stepping through doesn't understand a move they
// can click the Explain button '?' and start a new explanation from there with
// its own line to step through etc. So user can recursively ask questions exactly
// where they feel they need more help seeing what's happening."
//
// Three consequences, all good:
//
//   * NO ESSAY. An explanation is small and shallow. Depth comes from the reader
//     asking again, not from us guessing how much they need.
//   * NO PER-PLY EVALUATION. The line is shown and walked; a position nobody
//     queries costs nothing. (And inside a PV the evaluation is flat anyway —
//     see `domain/trace.ts`.)
//   * COST IS BOUNDED BY CURIOSITY rather than by position complexity.
//
// The stack is the breadcrumb. Nodes are cached on `(fen, move)`, so going back
// is free and asking the same thing twice costs one lookup.
//
// ---------------------------------------------------------------------------
// TRUE OR SILENT.
//
// Everything rendered here is either an engine score, a material count off a
// board, or a fixed sentence keyed on `Because` — which is a union whose
// positional case carries no number, by construction. There is deliberately no
// branch that computes a value for display; if `domain/explain.ts` did not
// establish it, this file cannot show it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { scoreMoves } from '../engine/compare';
import {
	explain,
	DEFAULT_SEVERITY,
	type Explanation,
	type Severity,
	type Because,
} from '../domain/explain';
import type { Line } from '../domain/line';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';

/** One question: a position, a move, and what to weigh it against. */
export type Ask = { fen: string; uci: string; alternatives?: string[] };

/**
 * One move's evaluation, as the engine states it.
 *
 * Mate is not a centipawn quantity, so it is never printed as one — the same
 * refusal `lossText` makes about differences, applied to the value itself.
 */
const show = (o: { cp: number; mate: number | null }): string =>
	o.mate !== null ? `#${Math.abs(o.mate)}${o.mate < 0 ? ' against' : ''}` : pawns(o.cp);

const pawns = (cp: number) => `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;

/**
 * The verdict in words.
 *
 * A fixed template per `Because` variant and nothing else — no interpolation of
 * anything the domain did not hand over. The `positional` case in particular
 * takes no number, because there is no honest one to give.
 */
function sentence(x: Explanation): string {
	const v = x.verdict;
	if (v.kind === 'best') return 'This is the best move here.';
	if (v.kind === 'equal') return `As good as ${x.best?.san ?? 'the best move'}.`;

	const gap = v.comparable ? ` (${pawns(v.loss)})` : '';
	const lead = `${v.kind === 'inaccuracy' ? 'An inaccuracy' : v.kind === 'mistake' ? 'A mistake' : 'A blunder'}${gap}.`;
	const b: Because | undefined = v.because;
	if (!b) return lead;

	switch (b.kind) {
		case 'mateAgainst':
			return b.bestAlso
				? `${lead} It walks into mate in ${b.in} — though ${x.best?.san} is mated in ${b.bestAlso} too, so the position is lost either way.`
				: `${lead} It walks into mate in ${b.in}.`;
		case 'missedMate':
			return `${lead} ${x.best?.san} mates in ${b.in}; this does not mate at all.`;
		case 'slowerMate':
			// Never "this does not mate" when it does.
			return `${lead} This mates in ${b.ours}, but ${x.best?.san} mates in ${b.best}.`;
		case 'material':
			return b.event === 'promoted'
				? `${lead} In this line they promote${b.piece ? ` to a ${b.piece}` : ''} — ${pawns(b.net)} over the line.`
				: `${lead} In this line your ${b.piece ?? 'material'} goes — ${pawns(b.net)} over the line.`;
		case 'positional':
			// The whole point. No number, ever.
			return `${lead} Material stays level — the difference is positional.`;
	}
}

const TONE: Record<Explanation['verdict']['kind'], string> = {
	best: color.good,
	equal: color.good,
	inaccuracy: color.warn,
	mistake: color.warn,
	blunder: color.bad,
};

export function ExplainPanel({
	fen,
	uci,
	alternatives,
	onShowLine,
	onClose,
	depth = 12,
	severity = DEFAULT_SEVERITY,
}: Ask & {
	/**
	 * Put a line in the move list that is already on screen.
	 *
	 * The panel used to drive the board itself, through a stepper of its own.
	 * There is one move list now and a line borrows it.
	 */
	onShowLine?: (line: Line, label: string, onAsk?: (ply: number) => void) => void;
	onClose?: () => void;
	depth?: number;
	severity?: Severity;
}) {
	const [stack, setStack] = useState<Ask[]>([{ fen, uci, alternatives }]);
	const [x, setX] = useState<Explanation | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Ply being viewed; −1 is the position before the line starts. */
	/** Explanations already computed, so going back and re-asking are free. */
	const cache = useRef(new Map<string, Explanation>());

	// A new question from the host resets the whole conversation.
	useEffect(() => setStack([{ fen, uci, alternatives }]), [fen, uci, alternatives?.join(' ')]);

	const top = stack[stack.length - 1];
	const key = `${top.fen}|${top.uci}`;

	useEffect(() => {
		let live = true;
		const hit = cache.current.get(key);
		if (hit) {
			setX(hit);
			return;
		}
		setX(null);
		setBusy(true);
		setError(null);
		void (async () => {
			try {
				const options = await scoreMoves(top.fen, [top.uci, ...(top.alternatives ?? [])], { depth });
				const next = explain(top.fen, top.uci, options, severity);
				cache.current.set(key, next);
				if (live) setX(next);
			} catch (e) {
				if (live) setError((e as Error).message);
			} finally {
				if (live) setBusy(false);
			}
		})();
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, depth]);

	// THE BOARD IS DRIVEN BY `LineStepper` NOW, not from here.
	//
	// This used to keep its own `at`, its own effect and its own row of chips —
	// the same job the line under the board was already doing, in a second
	// implementation that had drifted apart from it. Will: "Why does it look
	// different from how the line is displayed under the board (shouldn't we be
	// reusing the same layout components for consistency?)". Quite so.

	/** Ask about a different move in the SAME position — "why not that one". */


	/**
	 * Ask about a move inside the line — the recursion.
	 *
	 * Pushes onto the stack, so the breadcrumb grows and the reader can walk back.
	 * The ply index comes from the move list, which is now where the `?` lives.
	 */
	const drill = (ply: number) => {
		if (!x) return;
		const step = x.line.steps[ply];
		if (!step) return;
		setStack((s) => [...s, { fen: step.from, uci: step.uci }]);
	};

	return (
		<div
			data-region="explain-panel"
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				background: color.surface,
			}}
		>
			{/* The breadcrumb IS the stack. Clicking a crumb pops back to it. */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 4,
					flexWrap: 'wrap',
					fontSize: text.note,
					marginBottom: space.tight,
					minHeight: 20,
				}}
			>
				{stack.map((a, i) => (
					<span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
						{i > 0 && <span style={{ color: color.ink3 }}>▸</span>}
						<button
							onClick={() => setStack((s) => s.slice(0, i + 1))}
							disabled={i === stack.length - 1}
							style={{
								border: 'none',
								background: 'none',
								padding: 0,
								fontFamily: mono,
								fontSize: text.note,
								color: i === stack.length - 1 ? color.ink : color.accent,
								cursor: i === stack.length - 1 ? 'default' : 'pointer',
							}}
						>
							{a.uci}
						</button>
					</span>
				))}
				{onClose && (
					<button
						onClick={onClose}
						style={{
							marginLeft: 'auto',
							border: 'none',
							background: 'none',
							color: color.ink2,
							fontSize: text.note,
							cursor: 'pointer',
							minHeight: TOUCH,
						}}
					>
						Close
					</button>
				)}
			</div>

			{error && <div style={{ fontSize: text.note, color: color.bad }}>{error}</div>}
			{busy && !x && (
				<div style={{ fontSize: text.note, color: color.ink3 }}>
					scoring {1 + (top.alternatives?.length ?? 0)} moves at depth {depth}…
				</div>
			)}

			{x && (
				<>
					<div style={{ fontSize: text.body, color: TONE[x.verdict.kind], marginBottom: space.snug }}>
						<strong style={{ fontFamily: mono }}>{x.san}</strong> — {sentence(x)}
					</div>

					{/*
					  * TWO NUMBERS, AND WHY THERE ARE TWO.
					  *
					  * Will: "I still don't understand why the explain panel is
					  * 'comparing' against the other best moves? What is the point of
					  * that? The eval score is not a comparison score, it is an absolute
					  * score for the line implied by that single move. So why are we
					  * comparing?"
					  *
					  * The eval is absolute and he is right about that. But a VERDICT is
					  * not: "a blunder" cannot be read off one number, because −4.29 after
					  * your move is a disaster in an equal position and unremarkable in a
					  * lost one. What separates those is what the position was worth
					  * BEFORE — which is the value of its best move.
					  *
					  * So there is exactly one comparison and it is the one the grade
					  * rests on. The panel used to show a table of four alternatives,
					  * which was answering a different question — "what else could I play"
					  * — and that question belongs to the move table under the board,
					  * where every move already has an eval and a `?`.
					  */}
					{x.self && (
						<div
							data-region="explain-numbers"
							style={{
								display: 'flex',
								gap: space.card,
								flexWrap: 'wrap',
								fontSize: text.note,
								marginBottom: space.snug,
							}}
						>
							<span>
								after <strong style={{ fontFamily: mono }}>{x.san}</strong>:{' '}
								<strong style={{ fontFamily: mono }}>{show(x.self)}</strong>
							</span>
							{x.best && x.best.uci !== x.uci && (
								<span style={{ color: color.ink2 }}>
									best here was <strong style={{ fontFamily: mono }}>{x.best.san}</strong>:{' '}
									<strong style={{ fontFamily: mono }}>{show(x.best)}</strong>
									{/* The one place a difference is honest to print. */}
									{x.verdict.comparable && (
										<> — a gap of {pawns(Math.abs(x.verdict.loss))}</>
									)}
								</span>
							)}
						</div>
					)}

					{/*
					  * THE LINE GOES INTO THE MOVE LIST THAT IS ALREADY ON SCREEN.
					  *
					  * Will: "There is always just one move list and the explainer just
					  * injects the temporary sequence." So this panel no longer renders a
					  * stepper of its own — it hands the line to the host, which puts it
					  * in the list under the board with a cursor, and the step buttons
					  * that are already there drive it.
					  */}
					{onShowLine && x.line.steps.length > 0 && (
						<button
							onClick={() =>
								onShowLine(
									x.line,
									`the engine's line from ${x.san}`,
									(ply) => drill(ply),
								)
							}
							style={{
								border: `1px solid ${color.line}`,
								borderRadius: radius.small,
								background: 'transparent',
								color: color.ink,
								padding: '3px 9px',
								fontSize: text.note,
								cursor: 'pointer',
								minHeight: TOUCH,
							}}
						>
							Walk the line in the move list ({x.line.steps.length}{' '}
							{x.line.steps.length === 1 ? 'move' : 'moves'})
						</button>
					)}

				</>
			)}
		</div>
	);
}


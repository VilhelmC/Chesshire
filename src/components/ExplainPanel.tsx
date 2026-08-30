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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scoreMoves } from '../engine/compare';
import {
	explain,
	shortlist,
	DEFAULT_SEVERITY,
	type Explanation,
	type Severity,
	type Because,
} from '../domain/explain';
import { LineStepper } from './LineStepper';
import type { BoardOverride } from './LineStepper';
import { MoveTable } from './MoveTable';
import { mergeMoves, type MoveSource } from '../domain/moveTable';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';

/**
 * The explainer's table has one source, so its filter chips would be a row of
 * one button that does nothing. Frozen empty — `MoveTable` reads that as "show
 * everything" and renders no chips.
 */
const NO_FILTER: ReadonlySet<MoveSource> = new Set<MoveSource>();

/** One question: a position, a move, and what to weigh it against. */
export type Ask = { fen: string; uci: string; alternatives?: string[] };

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
	onBoard,
	onClose,
	depth = 12,
	severity = DEFAULT_SEVERITY,
}: Ask & {
	/** Hand the board what to display, or null to give it back. */
	onBoard: (o: BoardOverride) => void;
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
	const swap = useCallback((next: string) => {
		setStack((s) => [...s.slice(0, -1), { ...s[s.length - 1], uci: next }]);
	}, []);

	/** Ask about the move played AT this ply, from the position before it. */
	const drill = useCallback(
		(ply: number) => {
			if (!x) return;
			const step = x.line.steps[ply];
			if (!step) return;
			setStack((s) => [...s, { fen: step.from, uci: step.uci }]);
		},
		[x],
	);

	const options = useMemo(() => (x ? shortlist(x.options, x.uci) : []), [x]);

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
					  * WHAT THESE OPTIONS ARE, said rather than left to be inferred.
					  *
					  * Will: "Why does the explain panel contain multiple move options?
					  * It's not clear to me how the panel is organized. If there are
					  * multiple options, it must be made clear to user why there are
					  * options. Are they the best options?"
					  *
					  * They are the comparison set — the moves the verdict above was
					  * reached BY. "A blunder" is not a property of a move, it is a
					  * comparison, and a reader who cannot see what it was compared with
					  * has been given a grade and no working. So the caption names them,
					  * and the marked row is the move being explained.
					  *
					  * And it is the SAME TABLE Train and the Lab use. Will: "why does the
					  * explain panel use a different UI than the move list that already
					  * exists in train?" No reason that survived being asked.
					  */}
					<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight }}>
						{x.self
							? `${x.san} against the ${options.length - 1} best alternative${options.length === 2 ? '' : 's'} here — this is what the verdict above compares it with. Ask about any of them instead.`
							: 'The engine’s best moves here.'}
					</div>
					<MoveTable
						rows={mergeMoves({ engine: options.map((o) => ({ uci: o.uci, san: o.san, cp: o.cp, loss: o.loss, grade: 0 })) })}
						mover={x.fen.split(' ')[1] === 'b' ? 'b' : 'w'}
						on={NO_FILTER}
						onToggle={() => {}}
						onAsk={(uci) => uci !== x.uci && swap(uci)}
						marked={x.uci}
						region="explain-options"
					/>

					{/*
					  * THE LINE, walked with the same widget the board uses.
					  *
					  * The only thing the explainer adds is the `?` per ply — the recursion
					  * — and the material swing as a mark. Everything else, including the
					  * Start/◀/▶ buttons this panel never had, comes from `LineStepper`.
					  */}
					<LineStepper
						line={x.line}
						/*
						  * ONE CAPTION. This said the same sentence twice for a while — the
						  * stepper's label and a line under it — which is what happens when a
						  * block is replaced rather than absorbed.
						  *
						  * The line's TAIL IS NOT EVIDENCE: a PV can be truncated by a
						  * transposition-table hit, and nothing beyond the first move or two is
						  * reliable. So an incomplete line says so, and the only number
						  * attached is the material the TRACE independently supports.
						  */
						label={
							(x.line.complete
								? `the engine's line from ${x.san} — walk it, or ask about any move in it`
								: `the engine's line from ${x.san}, as far as it replays`) +
							(x.trace.net !== 0 ? ` · ${pawns(x.trace.net)} over the line` : '')
						}
						onBoard={onBoard}
						onAsk={(_s, i) => drill(i)}
						mark={(i) => {
							const t = x.trace.steps[i];
							if (t?.delta) return { text: pawns(t.delta), tone: t.delta > 0 ? 'good' : 'bad' };
							// A forcing move is where the line is being driven, and it is what a
							// reader stepping through wants to find. Marked, not described.
							return t?.forcing ? { text: '!', tone: 'warn' } : undefined;
						}}
						region="explain-line"
					/>

				</>
			)}
		</div>
	);
}


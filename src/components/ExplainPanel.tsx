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
import { stepAt, arrowFor } from '../domain/line';
import type { BoardOverride } from './LinePlayer';
import { Move } from './Move';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';

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
	const [at, setAt] = useState(-1);
	/** Explanations already computed, so going back and re-asking are free. */
	const cache = useRef(new Map<string, Explanation>());

	// A new question from the host resets the whole conversation.
	useEffect(() => setStack([{ fen, uci, alternatives }]), [fen, uci, alternatives?.join(' ')]);

	const top = stack[stack.length - 1];
	const key = `${top.fen}|${top.uci}`;

	useEffect(() => {
		let live = true;
		setAt(-1);
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

	// Drive the board: the position at the current ply, with the next move drawn.
	useEffect(() => {
		if (!x) return;
		const { fen: shown, lastMove } = stepAt(x.line, at);
		onBoard({ fen: shown, lastMove, arrows: arrowFor(x.line, at) });
		// Giving the board back on unmount matters more than it looks: an override
		// left behind freezes the host on a position from an explanation.
		return () => onBoard(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [x, at]);

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

					{/* The comparison set, on one scale. Click one to ask about it instead. */}
					<div style={{ display: 'flex', gap: space.tight, flexWrap: 'wrap', marginBottom: space.snug }}>
						{options.map((o) => (
							<button
								key={o.uci}
								onClick={() => swap(o.uci)}
								disabled={o.uci === x.uci}
								title={o.uci === x.uci ? 'the move being explained' : `explain ${o.san} instead`}
								style={{
									border: `1px solid ${o.uci === x.uci ? color.accent : color.line}`,
									background: o.uci === x.uci ? color.accentSoft : 'transparent',
									borderRadius: radius.small,
									padding: '2px 7px',
									cursor: o.uci === x.uci ? 'default' : 'pointer',
									fontSize: 13,
								}}
							>
								<Move san={o.san} colour={x.fen.split(' ')[1] === 'b' ? 'b' : 'w'} size={13} />{' '}
								<span style={{ fontFamily: mono, color: color.ink2 }}>
									{o.mate !== null ? `#${Math.abs(o.mate)}${o.mate < 0 ? '↓' : ''}` : pawns(o.cp)}
								</span>
							</button>
						))}
					</div>

					{/* The line, walkable, with a "?" on every ply. */}
					<div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
						<Chip label="start" on={at === -1} onClick={() => setAt(-1)} />
						{x.line.steps.map((s, i) => {
							const t = x.trace.steps[i];
							return (
								<span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
									<Chip
										label={
											<>
												<Move san={s.san} colour={s.colour} size={13} />
												{t?.delta ? (
													<span
														style={{
															fontFamily: mono,
															fontSize: 10,
															marginLeft: 3,
															color: t.delta > 0 ? color.good : color.bad,
														}}
													>
														{pawns(t.delta)}
													</span>
												) : null}
											</>
										}
										on={at === i}
										onClick={() => setAt(i)}
										/* A forcing move is where the line is being driven, and it is what a
										   reader stepping through wants to find. Marked rather than described. */
										accent={t?.forcing ? color.warn : undefined}
									/>
									<button
										onClick={() => drill(i)}
										title={`Why ${s.san}?`}
										style={{
											border: 'none',
											background: 'none',
											color: color.accent,
											cursor: 'pointer',
											fontSize: 12,
											padding: '0 2px',
										}}
									>
										?
									</button>
								</span>
							);
						})}
					</div>

					<div style={{ fontSize: text.note, color: color.ink3, fontFamily: mono, marginTop: space.tight }}>
						{/*
						  * The line's TAIL IS NOT EVIDENCE. A PV can be truncated by a
						  * transposition-table hit, and nothing beyond the first move or two is
						  * reliable — so it is offered to walk, and no claim is made about it
						  * that the material trace does not independently support.
						  */}
						{x.line.complete
							? 'the engine’s line — walk it, or ask about any move in it'
							: 'the engine’s line, as far as it replays'}
						{x.trace.net !== 0 && ` · ${pawns(x.trace.net)} over the line`}
					</div>
				</>
			)}
		</div>
	);
}

function Chip({
	label,
	on,
	onClick,
	accent,
}: {
	label: React.ReactNode;
	on: boolean;
	onClick: () => void;
	accent?: string;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				border: `1px solid ${on ? color.accent : (accent ?? 'transparent')}`,
				background: on ? color.accentSoft : 'transparent',
				borderRadius: radius.small,
				padding: '2px 5px',
				cursor: 'pointer',
				fontSize: 13,
				display: 'inline-flex',
				alignItems: 'center',
			}}
		>
			{label}
		</button>
	);
}

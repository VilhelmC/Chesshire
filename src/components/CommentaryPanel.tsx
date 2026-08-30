// What somebody wrote about this position.
//
// ---------------------------------------------------------------------------
// THIS IS A DIFFERENT KIND OF CLAIM AND IT LOOKS LIKE ONE.
//
// `ExplainPanel`'s rule is that everything it renders is an engine score, a
// material count off a board, or a fixed sentence keyed on `Because` — "if
// `domain/explain.ts` did not establish it, this file cannot show it." That
// guarantee is worth keeping, and prose written by a stranger is none of those
// three things.
//
// So the commentary is not folded into the verdict, not merged into a sentence
// the app is asserting, and not paraphrased. It sits in its own panel, quoted,
// under a byline, with a link to the page and to whoever wrote it. The reader
// should never be in doubt about which of the two things on their screen the
// app is standing behind.
//
// CC BY-SA 4.0, which asks for attribution and a link, and gets both. Nothing
// is bundled: the text is fetched and cached, so the licence sits on data the
// reader's browser retrieved, and this repo's GPL never has to be reconciled
// with it.
// ---------------------------------------------------------------------------

import { proseOf, paragraphFor } from '../domain/commentary';
import type { Commentary as CommentaryText } from '../data/commentary';
import { color, space, radius, text, mono, TOUCH } from '../ui/theme';

/**
 * The door and the room behind it, so a host adds commentary in one line.
 *
 * Three views need this and the last week has been spent making three views
 * stop each having their own version of everything. The button and the panel
 * travel together because the rule binding them — no button unless the register
 * says there is a page — is the whole design and is not something a host should
 * be able to get wrong.
 */
export function Commentary({
	state,
	region,
}: {
	state: {
		available: boolean;
		open: boolean;
		setOpen: (open: boolean) => void;
		text: CommentaryText | null;
		busy: boolean;
		error: string | null;
		highlight: string | undefined;
	};
	region?: string;
}) {
	if (!state.available) return null;
	return state.open ? (
		<CommentaryPanel
			commentary={state.text}
			busy={state.busy}
			error={state.error}
			highlight={state.highlight}
			onClose={() => state.setOpen(false)}
			region={region}
		/>
	) : (
		<button
			onClick={() => state.setOpen(true)}
			title="What Chess Opening Theory, a Wikibook, says about this position"
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.small,
				background: 'transparent',
				color: color.ink,
				padding: '3px 9px',
				fontSize: text.note,
				cursor: 'pointer',
				minHeight: TOUCH,
				marginTop: space.snug,
			}}
		>
			What the book says
		</button>
	);
}

export function CommentaryPanel({
	commentary,
	busy,
	error,
	onClose,
	/** The move being explained, if this was opened from one. Highlighted, never extracted. */
	highlight,
	region = 'commentary',
}: {
	commentary: CommentaryText | null;
	busy: boolean;
	error: string | null;
	onClose: () => void;
	highlight?: string;
	region?: string;
}) {
	const prose = commentary ? proseOf(commentary.extract) : '';
	const marked = commentary && highlight ? paragraphFor(commentary.extract, highlight) : null;

	return (
		<div
			data-region={region}
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				background: color.surface,
				marginTop: space.snug,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: space.snug,
					fontSize: text.note,
					color: color.ink2,
					marginBottom: space.tight,
				}}
			>
				<span>
					from <strong>Chess Opening Theory</strong>, a Wikibook
				</span>
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
			</div>

			{busy && <div style={{ fontSize: text.note, color: color.ink3 }}>fetching…</div>}
			{error && <div style={{ fontSize: text.note, color: color.bad }}>{error}</div>}

			{!busy && !error && !commentary && (
				// The register said there was a page and the page turned out to be a
				// heading with nothing under it. Say so — the alternative is an empty
				// panel, which reads as a bug rather than as an answer.
				<div style={{ fontSize: text.note, color: color.ink2 }}>
					There is a page for this position, but it has not been written yet.
				</div>
			)}

			{commentary && (
				<>
					<div
						data-region={`${region}-prose`}
						style={{ fontSize: text.body, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
					>
						{prose.split(/\n+/).map((para, i) => {
							const isMarked = marked !== null && para.trim() === marked;
							return (
								<p
									key={i}
									style={{
										margin: `0 0 ${space.snug}px`,
										// The move's own paragraph is TINTED, not isolated. A
										// paragraph picked by a string match and shown alone is a
										// claim that it is about that move; shown in place, a bad
										// match is visible for what it is.
										background: isMarked ? color.accentSoft : undefined,
										borderRadius: isMarked ? radius.small : undefined,
										padding: isMarked ? '2px 6px' : undefined,
									}}
								>
									{para}
								</p>
							);
						})}
					</div>

					<div style={{ fontSize: text.note, color: color.ink3, marginTop: space.tight }}>
						<a
							href={commentary.url}
							target="_blank"
							rel="noreferrer"
							style={{ color: color.accent, fontFamily: mono }}
						>
							{commentary.page}
						</a>{' '}
						· by its Wikibooks contributors, under{' '}
						<a
							href="https://creativecommons.org/licenses/by-sa/4.0/"
							target="_blank"
							rel="noreferrer"
							style={{ color: color.ink2 }}
						>
							CC BY-SA 4.0
						</a>
					</div>
				</>
			)}
		</div>
	);
}

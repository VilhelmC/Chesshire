// Getting a position out of the app.
//
// Was one button that copied PGN, sitting apart from the control strip. Sharing
// is a control like any other, so it belongs in the strip with the rest — and
// once it is a single icon there is room for the other three things people
// actually want to do with a position, which a button labelled "Copy PGN"
// could not offer.
//
// The four are deliberately not a list of every export format anyone has ever
// wanted. They are the ones that go somewhere: a PGN to paste into a board, a
// FEN for a single position, an analysis link, and the platform's own share
// sheet where it exists.

import { useEffect, useRef, useState } from 'react';
import { Panel, Note } from '../ui/primitives';
import { toPgn } from '../engine/session';
import { color, space, radius } from '../ui/theme';

export type ShareItem = {
	id: string;
	label: string;
	note?: string;
	/** Text to copy, or a URL to open. */
	value: string;
	kind: 'copy' | 'open';
};

export function ShareMenu({
	items,
	onClose,
	/**
	 * The control that opens this, so a second press closes it.
	 *
	 * `mousedown` fires before `click`. Without this, pressing the share button
	 * again would run the outside-click handler (closing the menu) and then the
	 * button's own toggle (reopening it) — the menu would flicker and stay, and
	 * the button would look broken in a way that is very hard to see.
	 */
	toggle = '[data-action="share"]',
}: {
	items: ShareItem[];
	onClose: () => void;
	toggle?: string;
}) {
	const [done, setDone] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	/*
	 * A MENU THAT WILL NOT CLOSE IS WORSE THAN NO MENU.
	 *
	 * Will: "unfocusing (interacting with something else) should also close the
	 * share options — that way we don't need a close button on the share
	 * options."
	 *
	 * Escape, a click outside and a second press of the toggle: three ways out,
	 * all of them ones people already have. `pointerdown` rather than
	 * `mousedown` so a touch counts — on a phone there is no mouse event until
	 * the tap completes, which left the menu open behind whatever was tapped.
	 * And `focusin`, so tabbing away closes it too: a keyboard user
	 * "interacting with something else" never generates a pointer event at all.
	 */
	useEffect(() => {
		const outside = (target: EventTarget | null) => {
			const node = target as Node | null;
			if (ref.current && node && ref.current.contains(node)) return false;
			// The toggle is outside the menu but must not count as outside it.
			const el = node instanceof Element ? node : null;
			return !el?.closest(toggle);
		};
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		const onDown = (e: Event) => outside(e.target) && onClose();
		document.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onDown);
		document.addEventListener('focusin', onDown);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('focusin', onDown);
		};
	}, [onClose, toggle]);

	async function act(item: ShareItem) {
		if (item.kind === 'open') {
			window.open(item.value, '_blank', 'noopener');
			return;
		}
		try {
			await navigator.clipboard.writeText(item.value);
			setDone(item.id);
			setTimeout(() => setDone(null), 1800);
		} catch {
			// Clipboard access can be refused outright. Saying so beats a button
			// that silently did nothing and looked like it worked.
			setDone('failed');
			setTimeout(() => setDone(null), 3000);
		}
	}

	return (
		<div ref={ref} style={{ marginTop: space.snug }}>
			<Panel>
				<div style={{ display: 'grid', gap: space.tight }}>
					{items.map((item) => (
						<button
							key={item.id}
							onClick={() => void act(item)}
							style={{
								textAlign: 'left',
								border: `1px solid ${color.line}`,
								background: color.page,
								color: color.ink,
								borderRadius: radius.small,
								padding: space.snug,
								cursor: 'pointer',
								minHeight: 40,
							}}
						>
							<div style={{ fontSize: 14 }}>
								{item.label}
								{done === item.id && <span style={{ color: color.good }}> — copied</span>}
							</div>
							{item.note && <Note>{item.note}</Note>}
						</button>
					))}
				</div>

				{done === 'failed' && (
					<Note style={{ color: color.bad, marginTop: space.snug }}>
						The browser refused clipboard access.
					</Note>
				)}

			</Panel>
		</div>
	);
}

/**
 * The platform share sheet, where there is one.
 *
 * Only offered when it exists — a button that does nothing on desktop is worse
 * than an absent one, and `navigator.share` is missing on most desktop browsers.
 */
/**
 * The four things to offer for a position, from the game it is in.
 *
 * Here rather than at each call site because there are two now — the trainer and
 * the Play tab — and a list of export formats is exactly the kind of thing that
 * ends up differing by one entry between two screens for no reason anybody
 * decided. The decision about WHICH four is in this file's header; this is the
 * decision applied.
 */
export function shareItemsFor(state: { fen: string; opening: { name: string } | null } & Parameters<typeof toPgn>[0]): ShareItem[] {
	const pgn = toPgn(state, state.opening ? [state.opening.name] : []);
	return [
		{
			id: 'pgn',
			label: 'Copy PGN',
			note: 'The whole game, for pasting into a board or an analysis tool.',
			kind: 'copy',
			value: pgn,
		},
		{ id: 'fen', label: 'Copy FEN', note: 'Just this position.', kind: 'copy', value: state.fen },
		{
			id: 'lichess',
			label: 'Analyse on Lichess',
			note: 'Opens this position in their analysis board.',
			kind: 'open',
			value: `https://lichess.org/analysis/${state.fen.replace(/ /g, '_')}`,
		},
		...(canShareNatively()
			? [
					{
						id: 'native',
						label: 'Share\u2026',
						note: 'Your device\u2019s own share sheet.',
						kind: 'copy' as const,
						value: pgn,
					},
				]
			: []),
	];
}

export function canShareNatively(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareNatively(title: string, text: string): Promise<void> {
	try {
		await navigator.share({ title, text });
	} catch {
		/* the user dismissed the sheet, which is not an error */
	}
}

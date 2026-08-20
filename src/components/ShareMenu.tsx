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
import { Panel, Button, Note } from '../ui/primitives';
import { color, space, radius } from '../ui/theme';

export type ShareItem = {
	id: string;
	label: string;
	note?: string;
	/** Text to copy, or a URL to open. */
	value: string;
	kind: 'copy' | 'open';
};

export function ShareMenu({ items, onClose }: { items: ShareItem[]; onClose: () => void }) {
	const [done, setDone] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);

	// A menu that will not close is worse than no menu. Escape and a click
	// outside are the two ways everyone already knows.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('mousedown', onDown);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('mousedown', onDown);
		};
	}, [onClose]);

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

				<div style={{ marginTop: space.snug }}>
					<Button kind="quiet" onClick={onClose}>
						Close
					</Button>
				</div>
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

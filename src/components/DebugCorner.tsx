// Development-only handle for capturing app state.
//
// Was a button on the Mistakes tab, which is not where a bug necessarily
// happens. It now sits in the corner of every screen, so whatever is wrong can
// be captured where it is wrong rather than after navigating away from it.
//
// Dev only: `import.meta.env.DEV` is a compile-time constant, so this whole
// component is dropped from a production build rather than merely hidden.

import { useState } from 'react';
import { dump } from '../data/debug';

export function DebugCorner() {
	const [state, setState] = useState<'idle' | 'copying' | 'done' | 'failed'>('idle');
	if (!import.meta.env.DEV) return null;

	async function copy() {
		setState('copying');
		try {
			await dump();
			setState('done');
		} catch {
			// dump() falls back to logging, so this only means the clipboard
			// refused — worth saying, since the user is waiting for a paste.
			setState('failed');
		}
		setTimeout(() => setState('idle'), 2500);
	}

	const text =
		state === 'copying'
			? 'Copying…'
			: state === 'done'
				? 'Copied ✓'
				: state === 'failed'
					? 'See console'
					: 'Copy debug state';

	return (
		<button
			onClick={() => void copy()}
			title="Copies the app's actual state — board, deck, database counts — to the clipboard. Development builds only; the Lichess token is never included."
			style={{
				position: 'fixed',
				right: 12,
				bottom: 12,
				zIndex: 9999,
				fontSize: 11,
				padding: '5px 9px',
				borderRadius: 6,
				border: '1px solid #d5d4d0',
				background: state === 'done' ? '#e8f5e9' : '#ffffff',
				color: '#52514e',
				cursor: 'pointer',
				boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
				// Never in the way of the thing being debugged.
				opacity: 0.75,
			}}
			onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
			onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.75')}
		>
			{text}
		</button>
	);
}

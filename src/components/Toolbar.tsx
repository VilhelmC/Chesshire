// Playback controls.
//
// Icons in a fixed-width row rather than buttons labelled with sentences: text
// buttons resized as the run changed and the whole strip shifted under the
// cursor, so you could click the wrong thing by standing still.
//
// On touch that reasoning breaks down. An icon's meaning lived entirely in its
// `title`, and a `title` needs hover — on a phone it is simply invisible, so
// the strip becomes eight unlabelled glyphs you have to learn by pressing them
// and seeing what happens. `labelled` adds a one-word caption under each icon.
// The captions are FIXED words, not the sentences that used to shift the strip,
// so the layout still holds still.

export type ToolbarAction = {
	id: string;
	/** The full sentence, on hover and for screen readers. */
	title: string;
	icon:
		| 'first'
		| 'back'
		| 'forward'
		| 'branch'
		| 'mistake'
		| 'reveal'
		| 'playon'
		| 'options'
		| 'resign';
	onClick: () => void;
	disabled?: boolean;
	accent?: boolean;
};

/** One fixed word per control, for when there is no hover to reveal the title. */
const CAPTION: Record<ToolbarAction['icon'], string> = {
	first: 'restart',
	back: 'back',
	forward: 'forward',
	branch: 'retry',
	mistake: 'mistake',
	reveal: 'show',
	playon: 'play on',
	options: 'options',
	resign: 'resign',
};

export function Toolbar({
	actions,
	labelled = false,
}: {
	actions: ToolbarAction[];
	/** Caption each icon. On by default nowhere; set when the pointer cannot hover. */
	labelled?: boolean;
}) {
	return (
		<div
			style={{
				// Fills the row rather than leaving a ragged edge: fixed-width buttons
				// on a 393px screen wrap after six and leave a third of the last row
				// empty. `flex: 1` with a minimum keeps them evenly sized and evenly
				// spread at any width, and they still do not resize as the run
				// changes, which is what the fixed widths were protecting.
				display: 'flex',
				gap: labelled ? 6 : 4,
				alignItems: 'flex-start',
				flexWrap: 'wrap',
				width: labelled ? '100%' : undefined,
			}}
		>
			{actions.map((a) => (
				<button
					key={a.id}
					title={a.title}
					aria-label={a.title}
					onClick={a.onClick}
					disabled={a.disabled}
					style={{
						// 44px is the smallest target a finger hits reliably.
						...(labelled
							? { flex: '1 1 52px', minWidth: 52, maxWidth: 90 }
							: { width: 40 }),
						height: labelled ? 50 : 36,
						display: 'inline-flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: 2,
						border: '1px solid #ddd',
						borderRadius: 6,
						background: a.accent ? '#e3f2fd' : '#fff',
						cursor: a.disabled ? 'default' : 'pointer',
						opacity: a.disabled ? 0.35 : 1,
						padding: 0,
						// Stops a double-tap being read as a zoom gesture.
						touchAction: 'manipulation',
					}}
				>
					<Icon name={a.icon} />
					{labelled && (
						<span style={{ fontSize: 9, color: '#52514e', lineHeight: 1 }}>
							{CAPTION[a.icon]}
						</span>
					)}
				</button>
			))}
		</div>
	);
}

function Icon({ name }: { name: ToolbarAction['icon'] }) {
	const s = { stroke: '#333', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
	switch (name) {
		case 'first':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M18 6 10 12l8 6z" fill="#333" stroke="none" />
					<line x1="6" y1="5" x2="6" y2="19" />
				</svg>
			);
		case 'back':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M16 5 8 12l8 7z" fill="#333" stroke="none" />
				</svg>
			);
		case 'forward':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M8 5l8 7-8 7z" fill="#333" stroke="none" />
				</svg>
			);
		case 'branch':
			// Two paths diverging from one — the position where their choice forks.
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M7 20V12c0-2 2-3 4-4l4-2" />
					<path d="M7 12c0 2 2 3 4 4l4 2" />
					<circle cx="7" cy="20" r="1.8" fill="#333" stroke="none" />
					<circle cx="16" cy="5" r="1.8" fill="#333" stroke="none" />
					<circle cx="16" cy="19" r="1.8" fill="#333" stroke="none" />
				</svg>
			);
		case 'mistake':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<circle cx="12" cy="12" r="8" />
					<line x1="9" y1="9" x2="15" y2="15" />
					<line x1="15" y1="9" x2="9" y2="15" />
				</svg>
			);
		case 'reveal':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />
					<circle cx="12" cy="12" r="2.5" />
				</svg>
			);
		case 'resign':
			// A flag: the universal "I stop here".
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<line x1="6" y1="3" x2="6" y2="21" />
					<path d="M6 4h11l-2.5 4L17 12H6z" fill="#333" stroke="none" />
				</svg>
			);
		case 'options':
			// Three arrows of decreasing weight — the ramp the board draws.
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<line x1="4" y1="7" x2="18" y2="7" strokeWidth="3.2" />
					<line x1="4" y1="12" x2="15" y2="12" strokeWidth="2" />
					<line x1="4" y1="17" x2="12" y2="17" strokeWidth="1.2" />
				</svg>
			);
		case 'playon':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<circle cx="12" cy="12" r="8" />
					<path d="M10 8.5l5 3.5-5 3.5z" fill="#333" stroke="none" />
				</svg>
			);
	}
}

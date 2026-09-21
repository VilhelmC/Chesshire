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

import { useMeasure } from './useViewport';
import { ACTIVE, color, radius } from '../ui/theme';

export type ToolbarAction = {
	id: string;
	/** The full sentence, on hover and for screen readers. */
	title: string;
	icon:
		| 'first'
		| 'back'
		| 'forward'
		| 'branch'
		| 'reveal'
		| 'playon'
		| 'skip'
		| 'options'
		| 'share'
		| 'stats'
		| 'resign';
	onClick: () => void;
	disabled?: boolean;
	accent?: boolean;
	/**
	 * Override the icon's fixed caption.
	 *
	 * Normally one icon means one word — that is what keeps the strip from
	 * moving. But a control whose MEANING shifts with the situation has to be
	 * able to say so: the same button is "free play" from a live position and
	 * "play on" once the line has ended, and calling it one of those everywhere
	 * is wrong half the time. Still a fixed word per press, so the layout still
	 * holds still.
	 */
	caption?: string;
};

/*
 * `mistake` USED TO BE HERE, and is gone.
 *
 * It went with the button it drew — Will: "maybe we don't need a 'replay same
 * mistake' button since user can just step backwards?" Deleted rather than left
 * available, because an icon nothing draws is a vocabulary entry a reader has to
 * check before concluding it is unused.
 *
 * `stats` was deleted alongside it, when the three filter buttons collapsed into
 * the move table, and it is BACK — for a different control. It used to fetch the
 * explorer's numbers for this position; it now shows how the game has been
 * played, which is `components/GameStats`. The name survived the change of
 * meaning because it is the honest word for both, but nothing else about the old
 * button did.
 */

/** One fixed word per control, for when there is no hover to reveal the title. */
const CAPTION: Record<ToolbarAction['icon'], string> = {
	first: 'restart',
	back: 'back',
	forward: 'forward',
	/*
	 * NOT "retry".
	 *
	 * Will: "Train: 'Retry' button is bad naming." It is: nothing is retried.
	 * The position is put back and the OPPONENT is made to choose again, which
	 * is the opposite of a retry — you are not repeating your own move, you are
	 * being handed a different problem from the same starting point.
	 */
	branch: 'new reply',
	reveal: 'show moves',
	playon: 'play on',
	skip: 'skip',
	options: 'options',
	share: 'share',
	stats: 'scoring',
	resign: 'resign',
};

/** Smallest control a finger hits reliably enough to keep captions readable. */
const MIN_CELL = 52;
const GAP = 6;

/**
 * How many columns to use, so that the rows come out EVEN.
 *
 * Nine controls at a usable touch size do not fit across a 393px phone — that
 * is arithmetic, not a layout bug, and pretending otherwise means either
 * finger-missing 36px buttons or hiding controls behind a menu you have to know
 * about first. So it wraps; the fix is that it wraps *evenly*.
 *
 * Plain flex-wrap fills the first row and strands the remainder: six buttons,
 * then three, with a third of the last row empty. Balancing the count across the
 * rows it is going to take anyway gives 5 and 4 in aligned columns, which is
 * what "spills over" was really objecting to.
 */
export function columnsFor(count: number, width: number): number {
	if (!count) return 1;
	const fit = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
	const cols = Math.min(count, fit);
	const rows = Math.ceil(count / cols);
	return Math.ceil(count / rows);
}

export function Toolbar({
	actions,
	labelled = false,
}: {
	actions: ToolbarAction[];
	/** Caption each icon. On by default nowhere; set when the pointer cannot hover. */
	labelled?: boolean;
}) {
	const [ref, width] = useMeasure<HTMLDivElement>();
	const cols = columnsFor(actions.length, width ?? 0);

	return (
		<div
			ref={ref}
			style={
				labelled
					? {
							// A grid, not wrapped flex: every cell is the same width and
							// the columns line up between rows.
							display: 'grid',
							gridTemplateColumns: `repeat(${cols}, 1fr)`,
							gap: GAP,
							width: '100%',
						}
					: {
							display: 'flex',
							gap: 4,
							alignItems: 'flex-start',
							flexWrap: 'wrap',
						}
			}
		>
			{actions.map((a) => (
				<button
					key={a.id}
					/*
					 * A HANDLE FOR THE THING A CONTROL OPENS.
					 *
					 * A pop-over that closes on an outside press has to be able to
					 * recognise its own toggle: `pointerdown` fires before `click`, so
					 * pressing the open button again would close the panel and then
					 * immediately reopen it — a flicker that leaves the menu up and the
					 * button looking broken in a way that is very hard to see.
					 *
					 * Emitted for every action rather than just `share`, because the
					 * next pop-over will need it too and a one-off attribute is how the
					 * last several one-offs started.
					 */
					data-action={a.id}
					title={a.title}
					aria-label={a.title}
					onClick={a.onClick}
					disabled={a.disabled}
					style={{
						// The grid gives the width; only the desktop row needs one here.
						...(labelled ? { width: '100%' } : { width: 40 }),
						height: labelled ? 50 : 36,
						display: 'inline-flex',
						flexDirection: 'column',
						alignItems: 'center',
						justifyContent: 'center',
						gap: 2,
						/*
						  * ON LOOKS ON.
						  *
						  * Will: "the light blue shade for the toggled buttons is very
						  * difficult to see." It was `#e3f2fd` on `#fff` — a four-percent
						  * difference in lightness, carrying the entire answer to "is this
						  * switched on", and in dark mode it sat on a light island where it
						  * read as nothing at all.
						  *
						  * A state worth showing gets more than a tint. This inverts:
						  * accent ground, white ink, accent border. The icons take
						  * `currentColor` now, so they invert with it rather than staying
						  * dark on a dark ground.
						  */
						border: `1px solid ${a.accent ? ACTIVE.border : color.line}`,
						borderRadius: radius.small,
						background: a.accent ? ACTIVE.background : color.surface,
						color: a.accent ? ACTIVE.color : color.ink,
						boxShadow: a.accent ? ACTIVE.boxShadow : 'none',
						cursor: a.disabled ? 'default' : 'pointer',
						opacity: a.disabled ? 0.35 : 1,
						padding: 0,
						// Stops a double-tap being read as a zoom gesture.
						touchAction: 'manipulation',
					}}
				>
					<Icon name={a.icon} />
					{labelled && (
						<span
							style={{
								fontSize: 9,
								// Inherits on an active button, so the caption inverts too.
								color: a.accent ? 'inherit' : color.ink2,
								lineHeight: 1,
							}}
						>
							{a.caption ?? CAPTION[a.icon]}
						</span>
					)}
				</button>
			))}
		</div>
	);
}

function Icon({ name }: { name: ToolbarAction['icon'] }) {
	const s = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
	switch (name) {
		case 'first':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M18 6 10 12l8 6z" fill="currentColor" stroke="none" />
					<line x1="6" y1="5" x2="6" y2="19" />
				</svg>
			);
		case 'back':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M16 5 8 12l8 7z" fill="currentColor" stroke="none" />
				</svg>
			);
		case 'forward':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M8 5l8 7-8 7z" fill="currentColor" stroke="none" />
				</svg>
			);
		case 'stats':
			/*
			 * THREE BARS OF DIFFERENT HEIGHTS, which is what the panel is: counts
			 * per verdict with a bar beside each. Drawn as strokes rather than
			 * filled rectangles so it stays legible at 18px next to `reveal`'s eye
			 * and `share`'s dots, neither of which has any solid mass.
			 */
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<line x1="5" y1="19" x2="5" y2="11" />
					<line x1="12" y1="19" x2="12" y2="5" />
					<line x1="19" y1="19" x2="19" y2="14" />
				</svg>
			);
		case 'branch':
			/*
			 * A DIE, BECAUSE THE ACTION IS A RE-ROLL.
			 *
			 * Will: "'Same position — different reply' — maybe there is a better
			 * icon for this?"
			 *
			 * It was a fork: two paths diverging from a point. Accurate about the
			 * TREE and wrong about the act — a fork says "here are your options",
			 * which is what the move table does, and at 18px it was three dots and
			 * two curves that read as a share glyph. It also sat next to `share`,
			 * which is genuinely three dots and two lines.
			 *
			 * What this button does is put the position back and make the opponent
			 * CHOOSE AGAIN, at random, weighted by how often people play each reply
			 * — that is literally a dice roll, and the app's own "mistake rate"
			 * setting is the loaded die. A die is unlike anything else in the strip
			 * at any size, and it says "same position, different draw" without
			 * having to be learned.
			 */
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<rect x="4" y="4" width="16" height="16" rx="3.5" />
					<circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
					<circle cx="15" cy="9" r="1.5" fill="currentColor" stroke="none" />
					<circle cx="9" cy="15" r="1.5" fill="currentColor" stroke="none" />
					<circle cx="15" cy="15" r="1.5" fill="currentColor" stroke="none" />
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
					<path d="M6 4h11l-2.5 4L17 12H6z" fill="currentColor" stroke="none" />
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
		case 'share':
			// Three nodes joined — the share glyph almost every platform uses, so
			// it needs no learning.
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<circle cx="18" cy="5" r="2.6" />
					<circle cx="6" cy="12" r="2.6" />
					<circle cx="18" cy="19" r="2.6" />
					<line x1="8.3" y1="10.8" x2="15.7" y2="6.2" />
					<line x1="8.3" y1="13.2" x2="15.7" y2="17.8" />
				</svg>
			);
		case 'skip':
			/*
			 * PAST THIS ONE, TO THE NEXT.
			 *
			 * Will: "in Mistakes there is a 'skip' button, that has the same icon
			 * as 'free play' button in Train."
			 *
			 * It borrowed `playon` — a play triangle in a circle — because skipping
			 * had no icon of its own. Captioning it "skip" fixed the word and left
			 * the picture saying something else, and now that Mistakes has a real
			 * free-play button the two would have sat in the same strip wearing the
			 * same face.
			 *
			 * Two chevrons and a bar: the "next track" glyph, which means exactly
			 * this everywhere it appears and is distinct from the single triangle
			 * of `playon` at any size.
			 */
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<path d="M5 6l6 6-6 6z" fill="currentColor" stroke="none" />
					<path d="M12 6l6 6-6 6z" fill="currentColor" stroke="none" />
					<line x1="20" y1="5" x2="20" y2="19" />
				</svg>
			);
		case 'playon':
			return (
				<svg width="18" height="18" viewBox="0 0 24 24" {...s}>
					<circle cx="12" cy="12" r="8" />
					<path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
				</svg>
			);
	}
}

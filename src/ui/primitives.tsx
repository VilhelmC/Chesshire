// The handful of shapes every screen is built from.
//
// Small on purpose. Six components cover almost everything the app does, and a
// seventh would mostly be one of these six with a different opinion. Anything
// genuinely one-off should stay one-off rather than becoming a primitive with a
// pile of props — a component with eight boolean flags is a stylesheet wearing
// a costume.

import { useState } from 'react';
import { ACTIVE, color, space, radius, text, TOUCH, sans } from './theme';

// ---------------------------------------------------------------------------

/**
 * A titled region of a screen.
 *
 * The `note` is part of the primitive rather than left to each caller, because
 * an explanation belongs immediately under the thing it explains and every
 * screen that improvised its own put it somewhere slightly different.
 */
export function Section({
	title,
	note,
	actions,
	children,
	region,
}: {
	title?: string;
	note?: React.ReactNode;
	/** Controls belonging to the section as a whole, aligned with its title. */
	actions?: React.ReactNode;
	children: React.ReactNode;
	/**
	 * A stable name for this block, emitted as `data-region`.
	 *
	 * See `docs/REGIONS.md`. Will: *"can we make sure containers and divs are
	 * named so it's actually possible to refer to them"* — the immediate cause
	 * being that neither of us could point at a part of the Lab without
	 * describing where it sat on the screen.
	 */
	region?: string;
}) {
	return (
		<section data-region={region} style={{ marginBottom: space.section }}>
			{(title || actions) && (
				<div
					style={{
						display: 'flex',
						alignItems: 'baseline',
						gap: space.gap,
						flexWrap: 'wrap',
						marginBottom: note ? space.tight : space.snug,
					}}
				>
					{title && (
						<h2
							style={{
								margin: 0,
								fontSize: text.heading,
								fontWeight: 600,
								color: color.ink,
								flex: '1 1 auto',
							}}
						>
							{title}
						</h2>
					)}
					{actions}
				</div>
			)}
			{note && <Note style={{ marginBottom: space.snug }}>{note}</Note>}
			{children}
		</section>
	);
}

/** A bordered group, so a set of controls reads as one object. */
export function Panel({
	children,
	tone = 'plain',
	style,
}: {
	children: React.ReactNode;
	/** Panels are neutral unless they are reporting something. */
	tone?: 'plain' | 'good' | 'warn' | 'bad' | 'accent';
	style?: React.CSSProperties;
}) {
	const tones = {
		plain: { border: color.line, background: color.surface },
		good: { border: color.good, background: color.goodSoft },
		warn: { border: color.warn, background: color.warnSoft },
		bad: { border: color.bad, background: color.badSoft },
		accent: { border: color.accent, background: color.accentSoft },
	} as const;
	const t = tones[tone];

	return (
		<div
			style={{
				border: `1px solid ${t.border}`,
				background: t.background,
				borderRadius: radius.panel,
				padding: space.card,
				fontSize: text.body,
				color: color.ink,
				...style,
			}}
		>
			{children}
		</div>
	);
}

/** Secondary text. Explanations, counts, anything that is not the answer. */
export function Note({
	children,
	style,
}: {
	children: React.ReactNode;
	style?: React.CSSProperties;
}) {
	return (
		<p style={{ margin: 0, fontSize: text.note, color: color.ink2, lineHeight: 1.5, ...style }}>
			{children}
		</p>
	);
}

/**
 * A labelled control.
 *
 * The label is a real `<label>` wrapping its input, so tapping the words moves
 * focus — on a phone that roughly doubles the size of every target in a form
 * for no layout cost.
 */
export function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<label style={{ display: 'block', marginBottom: space.snug }}>
			<span
				style={{
					display: 'block',
					fontSize: text.note,
					color: color.ink2,
					marginBottom: space.hair,
				}}
			>
				{label}
			</span>
			{children}
			{hint && <Note style={{ marginTop: space.hair }}>{hint}</Note>}
		</label>
	);
}

export type ButtonKind = 'primary' | 'normal' | 'quiet' | 'danger';

export function Button({
	kind = 'normal',
	onClick,
	disabled,
	title,
	full,
	children,
}: {
	kind?: ButtonKind;
	onClick?: () => void;
	disabled?: boolean;
	title?: string;
	full?: boolean;
	children: React.ReactNode;
}) {
	const kinds: Record<ButtonKind, React.CSSProperties> = {
		// White text ON the accent is fine — that pairing is fixed in both
		// palettes. A white BACKGROUND is not: it was invisible against a dark
		// page, which is the whole class of bug that hardcoded surfaces cause.
		// `onAccent`, not `#fff`: the dark palette's accent is light enough that
		// white on it measures about 2.4:1. Only the theme knows which way round
		// that goes, which is exactly what the token is for.
		primary: {
			background: color.accent,
			color: color.onAccent,
			border: `1px solid ${color.accent}`,
		},
		normal: { background: color.page, color: color.ink, border: `1px solid ${color.line}` },
		quiet: { background: 'transparent', color: color.ink2, border: '1px solid transparent' },
		danger: { background: color.page, color: color.bad, border: `1px solid ${color.bad}` },
	};

	return (
		<button
			onClick={onClick}
			disabled={disabled}
			title={title}
			style={{
				...kinds[kind],
				borderRadius: radius.small,
				padding: `${space.snug}px ${space.card}px`,
				minHeight: TOUCH,
				width: full ? '100%' : undefined,
				fontSize: text.body,
				fontFamily: sans,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.45 : 1,
				// Stops a double-tap being read as a zoom gesture.
				touchAction: 'manipulation',
			}}
		>
			{children}
		</button>
	);
}

/**
 * A small on/off tag.
 *
 * ---------------------------------------------------------------------------
 * The move table's source filters, the deck's category filters and the
 * repertoire's pills were three hand-rolled versions of this, and only one of
 * them had been through the "on looks on" pass — so on the same screen a
 * switched-on filter inverted and a switched-on category was a four-percent
 * pale blue wash. Whichever you learned first taught you the wrong rule for the
 * other.
 *
 * Multi-select, unlike `Segmented`: each chip is its own yes or no. The visual
 * language is the same on purpose, because pressing them feels the same; what
 * differs is only whether the others switch off.
 */
export function Chip({
	on,
	onClick,
	disabled,
	title,
	children,
}: {
	on: boolean;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			aria-pressed={on}
			onClick={onClick}
			disabled={disabled}
			title={title}
			style={{
				...(on
					? ACTIVE
					: {
							background: 'transparent',
							color: color.ink,
							border: `1px solid ${color.line}`,
						}),
				borderRadius: radius.small,
				padding: `${space.hair}px ${space.snug}px`,
				fontSize: text.note,
				fontFamily: sans,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.45 : 1,
				touchAction: 'manipulation',
			}}
		>
			{children}
		</button>
	);
}

/**
 * A row of mutually exclusive choices.
 *
 * ---------------------------------------------------------------------------
 * Will: "many different button styles in Progress, Settings, Mistakes, Train —
 * I think we need to unify button styles… Each component needs consistent
 * styling across app."
 *
 * Most of that sprawl is this shape: three or four options where exactly one is
 * chosen, improvised separately on each screen as radio buttons here, a row of
 * bordered buttons there, and a native `<select>` somewhere else. One of them
 * is the answer, and it is this one — because unlike a `<select>` it shows all
 * the options at once, which is what you want when there are four of them and
 * the choice changes what the screen is about.
 *
 * `ACTIVE` does the "on" state, so this cannot drift from the toolbar and the
 * filter chips the way the old tints did.
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	label,
}: {
	options: readonly { id: T; label: string; title?: string }[];
	value: T;
	onChange: (id: T) => void;
	/** Names the group for a screen reader; not drawn. */
	label?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			style={{ display: 'inline-flex', flexWrap: 'wrap', gap: space.tight }}
		>
			{options.map((o) => {
				const on = o.id === value;
				return (
					<button
						key={o.id}
						role="radio"
						aria-checked={on}
						title={o.title}
						onClick={() => onChange(o.id)}
						style={{
							...(on
								? ACTIVE
								: {
										background: color.surface,
										color: color.ink2,
										border: `1px solid ${color.line}`,
									}),
							borderRadius: radius.pill,
							padding: `${space.tight}px ${space.gap}px`,
							fontSize: text.note,
							fontFamily: sans,
							fontWeight: on ? 600 : 400,
							cursor: 'pointer',
							touchAction: 'manipulation',
						}}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

/**
 * On or off, drawn as a switch.
 *
 * ---------------------------------------------------------------------------
 * Will: "the training repertoire should have normal toggle buttons instead of
 * the labelled buttons."
 *
 * The repertoire list had a button whose CAPTION was its state — it said
 * "training" when on and "off" when off — which is the pattern that makes
 * everyone hesitate: a button that says "off" might be reporting that it is
 * off, or offering to turn it off, and there is no way to tell by looking. A
 * switch has a position rather than a word, so there is nothing to read
 * two ways.
 *
 * A real `<input type="checkbox">` underneath, visually hidden: keyboard,
 * screen readers and form semantics all come for free, and the drawn part is
 * only paint.
 */
export function Toggle({
	on,
	onChange,
	label,
	disabled,
}: {
	on: boolean;
	onChange: (on: boolean) => void;
	/** Read out beside the switch; the caller draws its own visible text. */
	label: string;
	disabled?: boolean;
}) {
	const W = 34;
	const H = 20;
	const KNOB = H - 6;
	return (
		<label
			title={label}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				flexShrink: 0,
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.45 : 1,
				// The switch is small; the TARGET is not.
				minWidth: TOUCH,
				minHeight: TOUCH,
				justifyContent: 'center',
			}}
		>
			<input
				type="checkbox"
				checked={on}
				disabled={disabled}
				aria-label={label}
				onChange={(e) => onChange(e.target.checked)}
				style={{
					position: 'absolute',
					width: 1,
					height: 1,
					opacity: 0,
					margin: 0,
					pointerEvents: 'none',
				}}
			/>
			<span
				aria-hidden
				style={{
					display: 'inline-block',
					position: 'relative',
					width: W,
					height: H,
					borderRadius: radius.pill,
					background: on ? color.accent : color.line,
					border: `1px solid ${on ? color.accent : color.line}`,
					transition: 'background 120ms linear',
				}}
			>
				<span
					style={{
						position: 'absolute',
						top: 2,
						left: on ? W - KNOB - 4 : 2,
						width: KNOB,
						height: KNOB,
						borderRadius: radius.pill,
						// The knob is the one thing that must read against BOTH the
						// accent and the hairline grey, so it is the surface colour in
						// both themes rather than a fixed white.
						background: color.surface,
						boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
						transition: 'left 120ms ease',
					}}
				/>
			</span>
		</label>
	);
}

/** A native dropdown, styled like every other input in the app. */
export function Select<T extends string>({
	value,
	onChange,
	options,
	label,
	width,
}: {
	value: T;
	onChange: (v: T) => void;
	options: readonly { id: T; label: string }[];
	label?: string;
	width?: number | string;
}) {
	return (
		<select
			aria-label={label}
			value={value}
			onChange={(e) => onChange(e.target.value as T)}
			style={{ ...inputStyle, width: width ?? 'auto' }}
		>
			{options.map((o) => (
				<option key={o.id} value={o.id}>
					{o.label}
				</option>
			))}
		</select>
	);
}

/**
 * Something folded away until asked for.
 *
 * A native `<details>` rather than state and a chevron: it is keyboard
 * accessible, findable by the browser's own in-page search even while closed,
 * and it cannot get stuck in a state React forgot about.
 */
export function Disclosure({
	summary,
	note,
	open = false,
	children,
}: {
	summary: string;
	note?: string;
	open?: boolean;
	children: React.ReactNode;
}) {
	return (
		<details
			open={open}
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				marginBottom: space.snug,
				background: color.page,
			}}
		>
			<summary
				style={{
					cursor: 'pointer',
					fontSize: text.body,
					color: color.ink,
					minHeight: TOUCH - space.snug * 2,
					display: 'flex',
					alignItems: 'center',
					padding: space.tight,
				}}
			>
				{summary}
			</summary>
			{note && <Note style={{ margin: `${space.tight}px ${space.tight}px ${space.snug}px` }}>{note}</Note>}
			<div style={{ padding: space.tight }}>{children}</div>
		</details>
	);
}

/** One number and what it means. */
export function Stat({
	label,
	value,
	tone,
	note,
}: {
	label: string;
	value: React.ReactNode;
	tone?: string;
	note?: string;
}) {
	return (
		<div
			style={{
				border: `1px solid ${color.line}`,
				borderRadius: radius.panel,
				padding: space.snug,
				background: color.surface,
			}}
		>
			<div style={{ fontSize: text.note, color: color.ink2 }}>{label}</div>
			<div
				style={{
					fontSize: text.title,
					fontWeight: 600,
					color: tone ?? color.ink,
					fontVariantNumeric: 'tabular-nums',
					lineHeight: 1.2,
				}}
			>
				{value}
			</div>
			{note && <Note>{note}</Note>}
		</div>
	);
}

/** Stats side by side, wrapping rather than shrinking below legibility. */
export function StatRow({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
				gap: space.snug,
				marginBottom: space.snug,
			}}
		>
			{children}
		</div>
	);
}

/**
 * A row of controls that stays on one line until it genuinely cannot.
 */
export function Row({
	children,
	gap = space.snug,
	align = 'center',
}: {
	children: React.ReactNode;
	gap?: number;
	align?: React.CSSProperties['alignItems'];
}) {
	return (
		<div style={{ display: 'flex', gap, alignItems: align, flexWrap: 'wrap' }}>{children}</div>
	);
}

/** Shared input styling, so a text box is the same box everywhere. */
export const inputStyle: React.CSSProperties = {
	// 16px, because anything smaller makes iOS Safari zoom the page on focus.
	fontSize: 16,
	fontFamily: sans,
	padding: `${space.snug}px ${space.gap}px`,
	borderRadius: radius.small,
	border: `1px solid ${color.line}`,
	background: color.page,
	color: color.ink,
	minHeight: TOUCH,
	width: '100%',
	boxSizing: 'border-box',
};

/**
 * A message where content would be.
 *
 * Empty states are where an app most often lies by omission — a blank panel
 * reads as "nothing to report" when the truth is usually "nothing yet, and
 * here is what would fill it".
 */
export function Empty({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				border: `1px dashed ${color.line}`,
				borderRadius: radius.panel,
				padding: space.section,
				textAlign: 'center',
				fontSize: text.body,
				color: color.ink2,
			}}
		>
			{children}
		</div>
	);
}

/** A collapsed/expanded pair used where `<details>` would break the layout. */
export function useToggle(initial = false) {
	const [on, setOn] = useState(initial);
	return [on, () => setOn((v) => !v), setOn] as const;
}

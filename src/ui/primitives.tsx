// The handful of shapes every screen is built from.
//
// Small on purpose. Six components cover almost everything the app does, and a
// seventh would mostly be one of these six with a different opinion. Anything
// genuinely one-off should stay one-off rather than becoming a primitive with a
// pile of props — a component with eight boolean flags is a stylesheet wearing
// a costume.

import { useState } from 'react';
import { color, space, radius, text, TOUCH, sans } from './theme';

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
}: {
	title?: string;
	note?: React.ReactNode;
	/** Controls belonging to the section as a whole, aligned with its title. */
	actions?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section style={{ marginBottom: space.section }}>
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
		primary: { background: color.accent, color: '#fff', border: `1px solid ${color.accent}` },
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

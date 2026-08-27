// "The engine is working."
//
// Three pulsing dots rather than the word "thinking…". Two reasons, and the
// second is the one that matters:
//
//   * Text of changing width moves whatever sits beside it. That is the same
//     complaint that turned the control strip into fixed-size icon buttons.
//   * A still label cannot distinguish "working" from "stuck". Motion can: if
//     the dots are moving, the app is alive. During a deep search that is the
//     only signal there is.
//
// `label` is still rendered for screen readers, and the animation is dropped
// entirely under `prefers-reduced-motion` (see index.css).

export function Thinking({
	label = 'Thinking',
	show = true,
	size = 6,
}: {
	label?: string;
	show?: boolean;
	size?: number;
}) {
	return (
		<span
			role="status"
			aria-live="polite"
			aria-label={show ? label : ''}
			title={show ? label : ''}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: size / 2,
				// Reserved whether or not it is showing, so nothing shifts when the
				// engine starts or stops.
				minWidth: size * 5,
				height: size * 2,
				opacity: show ? 1 : 0,
				transition: 'opacity 120ms linear',
			}}
		>
			{[0, 1, 2].map((i) => (
				<span
					key={i}
					className="schackal-dot"
					style={{
						width: size,
						height: size,
						borderRadius: '50%',
						background: '#1565c0',
						display: 'inline-block',
						// LONGHAND ONLY, NEVER THE SHORTHAND BESIDE IT.
						//
						// This was `animation: '…'` plus `animationDelay`, and React warns on
						// every rerender that changes one: "Updating a style property during
						// rerender (animation) when a conflicting property is set
						// (animationDelay) can lead to styling bugs." It is not a false alarm
						// — the shorthand RESETS `animation-delay` to zero, so whichever of
						// the two React happens to write last decides whether the three dots
						// are staggered or move as one. It looked right only because the
						// write order happened to be stable until `show` started toggling.
						animationName: show ? 'schackal-pulse' : 'none',
						animationDuration: '1.1s',
						animationTimingFunction: 'ease-in-out',
						animationIterationCount: 'infinite',
						// Staggered, so the group reads as one travelling wave.
						animationDelay: `${i * 0.16}s`,
					}}
				/>
			))}
		</span>
	);
}

/**
 * A thin indeterminate bar, for work that occupies a whole panel rather than
 * sitting beside a control — the game import, the drill sweep.
 */
export function ThinkingBar({ show = true, width }: { show?: boolean; width?: number | string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			style={{
				width: width ?? '100%',
				height: 3,
				borderRadius: 2,
				background: '#e6e5e2',
				overflow: 'hidden',
				opacity: show ? 1 : 0,
				transition: 'opacity 120ms linear',
			}}
		>
			<div
				className="schackal-sweep"
				style={{
					width: '33%',
					height: '100%',
					background: '#1565c0',
					borderRadius: 2,
					// Longhand here too. Nothing sets a delay beside it today, but a
					// shorthand that silently zeroes every other `animation-*` is a trap
					// for whoever adds one.
					animationName: show ? 'schackal-sweep' : 'none',
					animationDuration: '1.2s',
					animationTimingFunction: 'ease-in-out',
					animationIterationCount: 'infinite',
				}}
			/>
		</div>
	);
}

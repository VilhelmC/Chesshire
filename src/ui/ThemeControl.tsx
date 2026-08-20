// Light, dark, or follow the system.
//
// A three-way segmented control rather than a switch, because "follow the
// system" is a real answer and a two-state toggle cannot express it — the usual
// workaround, a toggle that silently stops following once you touch it, hides
// the most useful setting behind an interaction nobody knows to avoid.

import { useTheme, type ThemeChoice } from './useTheme';
import { color, radius, text, TOUCH } from './theme';

const OPTIONS: { id: ThemeChoice; label: string }[] = [
	{ id: 'system', label: 'System' },
	{ id: 'light', label: 'Light' },
	{ id: 'dark', label: 'Dark' },
];

export function ThemeControl() {
	const [choice, choose] = useTheme();

	return (
		<div
			role="radiogroup"
			aria-label="Appearance"
			style={{
				display: 'inline-flex',
				border: `1px solid ${color.line}`,
				borderRadius: radius.small,
				overflow: 'hidden',
			}}
		>
			{OPTIONS.map((o) => {
				const active = choice === o.id;
				return (
					<button
						key={o.id}
						role="radio"
						aria-checked={active}
						onClick={() => choose(o.id)}
						style={{
							border: 'none',
							borderRight: o.id === 'dark' ? 'none' : `1px solid ${color.line}`,
							background: active ? color.accent : color.page,
							color: active ? '#fff' : color.ink2,
							fontSize: text.body,
							fontWeight: active ? 600 : 400,
							padding: '0 14px',
							minHeight: TOUCH,
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

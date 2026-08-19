// Licence and source link.
//
// GPL §6 requires the corresponding source to accompany the object code. A
// public repository satisfies that, but someone who arrives at the deployed URL
// never sees the README — so the offer has to travel with the thing being
// distributed rather than with the thing the author happens to be looking at.
//
// Also the one place the app states, in the app, that it sends positions to
// Lichess. That belongs where a new visitor can find it before they type a
// token in, not only in a spec file they will never open.

import { useViewport } from './useViewport';

export const SOURCE_URL = 'https://github.com/VilhelmC/Schackal';

export function Footer() {
	const vp = useViewport();

	return (
		<footer
			style={{
				marginTop: 32,
				paddingTop: 12,
				borderTop: '1px solid #eee',
				fontSize: 12,
				opacity: 0.65,
				lineHeight: 1.6,
				display: 'flex',
				flexWrap: 'wrap',
				gap: vp.phone ? 6 : 12,
			}}
		>
			<span>
				Schackal — free software under{' '}
				<a href={`${SOURCE_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
					GPL-3.0-or-later
				</a>
				, with no warranty.
			</span>
			<span>
				<a href={SOURCE_URL} target="_blank" rel="noreferrer">
					Source
				</a>
			</span>
			<span>
				Opening statistics and evaluations from{' '}
				<a href="https://lichess.org" target="_blank" rel="noreferrer">
					Lichess
				</a>
				. Everything else stays in this browser.
			</span>
		</footer>
	);
}

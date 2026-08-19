// Install and update prompts.
//
// Two states, one strip, and nothing at all the rest of the time. An install
// button that is permanently present after you have installed is a control
// that lies about what it does.

import { useEffect, useState } from 'react';
import { pwaState, subscribePWA, applyUpdate, promptInstall, type PWAState } from '../registerSW';
import { useViewport } from './useViewport';

export function usePWA(): PWAState {
	const [s, setS] = useState(pwaState);
	useEffect(() => subscribePWA(setS), []);
	return s;
}

export function InstallBar() {
	const s = usePWA();
	const vp = useViewport();
	const [dismissed, setDismissed] = useState(false);

	if (s.updateReady) {
		return (
			<Strip tone="#1565c0">
				<Message>A new version is ready.</Message>
				<Action onClick={applyUpdate}>Reload to update</Action>
			</Strip>
		);
	}

	if (!s.canInstall || dismissed) return null;

	return (
		<Strip tone="#2e7d32">
			<Message>
				{vp.phone
					? 'Add Schackal to your home screen.'
					: 'Install Schackal to open it without the browser.'}
			</Message>
			<Action onClick={() => void promptInstall()}>Install</Action>
			<Action onClick={() => setDismissed(true)} quiet>
				Not now
			</Action>
		</Strip>
	);
}

function Strip({ tone, children }: { tone: string; children: React.ReactNode }) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				flexWrap: 'wrap',
				gap: 8,
				padding: '8px 12px',
				marginBottom: 12,
				borderRadius: 8,
				border: `1px solid ${tone}`,
				background: `${tone}10`,
				fontSize: 14,
			}}
		>
			{children}
		</div>
	);
}

/** Takes the slack, so the buttons sit together at the end of the strip. */
function Message({ children }: { children: React.ReactNode }) {
	return <span style={{ flex: '1 1 auto' }}>{children}</span>;
}

function Action({
	onClick,
	quiet,
	children,
}: {
	onClick: () => void;
	quiet?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				padding: '6px 12px',
				borderRadius: 6,
				border: '1px solid #ccc',
				background: quiet ? 'transparent' : '#fff',
				cursor: 'pointer',
				fontSize: 14,
				// Touch targets below about 40px are missed often enough to be
				// noticed as the app being unresponsive rather than the finger.
				minHeight: 40,
			}}
		>
			{children}
		</button>
	);
}

// What is running, and whether it is the newest there is.
//
// ---------------------------------------------------------------------------
// Will: "where can I see the version stamp? Maybe there should be version and
// last updated info somewhere? Like the bottom of the settings tab."
//
// A version string on its own would be a fact with no question attached. The
// question it exists to answer came earlier, about a phone: "still really slow
// on my phone. How do I know if the saved page / app updated?" — and a build
// number only answers that if you happen to know which number is current,
// which on a phone you do not.
//
// So this shows the stamp AND settles the doubt: it asks the service worker
// whether the server has anything newer, says what came back, and offers the
// reload when there is. Three lines the reader can act on rather than one they
// have to interpret.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { ago, buildInfo, on } from '../buildInfo';
import { applyUpdate, checkForUpdate, pwaState, subscribePWA, type PWAState } from '../registerSW';
import { Button, Note } from '../ui/primitives';
import { color, space, text } from '../ui/theme';

/** What the last manual check found. Null before anything has been asked. */
type Checked = null | 'checking' | 'current' | 'update' | 'offline' | 'unsupported';

export function BuildStamp() {
	const b = buildInfo();
	const [pwa, setPwa] = useState<PWAState>(pwaState);
	const [checked, setChecked] = useState<Checked>(null);

	useEffect(() => subscribePWA(setPwa), []);

	// A waiting worker found by the hourly check is the same news as one found by
	// pressing the button, and should read the same way.
	const updateReady = pwa.updateReady || checked === 'update';

	async function check() {
		setChecked('checking');
		const r = await checkForUpdate();
		setChecked(r);
	}

	return (
		<div data-region="build-stamp" style={{ fontSize: text.note, color: color.ink2 }}>
			<div style={{ fontVariantNumeric: 'tabular-nums' }}>
				<strong style={{ color: color.ink }}>Chesshire v{b.version}</strong>
				{b.commit && (
					<>
						{' · '}
						<code style={{ fontFamily: 'ui-monospace, monospace' }}>
							{b.commit}
							{/* A build from a dirty tree corresponds to no commit at all.
								Naming one anyway would be the most misleading kind of
								accurate, so it says so instead. */}
							{b.dirty && '+dirty'}
						</code>
					</>
				)}
			</div>

			{/*
			  * BUILT and LOADED, together, because it is the GAP between them that
			  * answers the question. A build from last week loaded a minute ago is a
			  * stale install; the same build loaded last week is simply a week old.
			  * Either number alone leaves you unable to tell those apart.
			  */}
			<div>
				{b.builtAt ? (
					<>
						Built {on(b.builtAt)} <span style={{ opacity: 0.7 }}>({ago(b.builtAt)})</span>
					</>
				) : (
					'Built from an unknown source — no repository was available.'
				)}
			</div>
			<div>
				This page loaded <span style={{ opacity: 0.7 }}>{ago(b.loadedAt)}</span>
			</div>

			<div
				style={{
					marginTop: space.snug,
					display: 'flex',
					gap: space.snug,
					alignItems: 'center',
					flexWrap: 'wrap',
				}}
			>
				{updateReady ? (
					<Button kind="primary" onClick={applyUpdate}>
						Reload to update
					</Button>
				) : (
					<Button onClick={() => void check()} disabled={checked === 'checking'}>
						{checked === 'checking' ? 'Checking…' : 'Check for updates'}
					</Button>
				)}
				<span>{verdict(checked, updateReady)}</span>
			</div>

			{!pwa.ready && pwa.reason && (
				<Note style={{ marginTop: space.tight }}>
					{/* Without a worker there is no cached shell, so there is also
						nothing to be stale — worth saying, because "check for updates"
						doing nothing otherwise reads as a broken button. */}
					{pwa.reason} Nothing is cached, so a refresh always gets the newest
					build.
				</Note>
			)}
		</div>
	);
}

function verdict(checked: Checked, updateReady: boolean): string {
	if (updateReady) return 'A newer build is downloaded and waiting.';
	switch (checked) {
		case 'checking':
			return 'Asking the server…';
		case 'current':
			return 'This is the newest build.';
		case 'offline':
			return 'Could not reach the server. Still on the build above.';
		case 'unsupported':
			return 'No service worker here, so nothing is cached.';
		default:
			return '';
	}
}

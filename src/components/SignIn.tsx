// Sign in with Lichess.
//
// The app needs a Lichess token to work at all — every explorer endpoint is 401
// anonymously — and until now getting one meant leaving the app and coming back
// with a pasted string. This is that, as a button.
//
// It is careful to say what it is NOT. "Sign in" invites the assumption that
// there is now an account holding your data; there is not, and someone who
// believes there is will eventually lose a deck to a reinstall. The one line
// under the button is doing real work.

import { useEffect, useState } from 'react';
import { beginSignIn, signedInAs, hasToken, signOut } from '../data/lichessAuth';

const INK_2 = '#52514e';

export function SignIn({ onChange }: { onChange?: () => void }) {
	const [user, setUser] = useState<string | null>(signedInAs());
	const [token, setTok] = useState(hasToken());
	const [busy, setBusy] = useState(false);

	// The token can be set from elsewhere — the paste field below the probe —
	// so this panel re-reads rather than assuming it is the only writer.
	useEffect(() => {
		const t = setInterval(() => {
			setUser(signedInAs());
			setTok(hasToken());
		}, 1000);
		return () => clearInterval(t);
	}, []);

	const refresh = () => {
		setUser(signedInAs());
		setTok(hasToken());
		onChange?.();
	};

	return (
		<section
			style={{
				border: '1px solid #ddd',
				borderRadius: 8,
				padding: 12,
				marginBottom: 16,
			}}
		>
			{user ? (
				<Row
					text={
						<>
							Signed in as <strong>{user}</strong>.
						</>
					}
					action={
						<button
							onClick={() => {
								signOut();
								refresh();
							}}
							style={{ minHeight: 40, padding: '6px 12px' }}
						>
							Sign out
						</button>
					}
				/>
			) : token ? (
				<Row
					text="A token is saved, pasted by hand. That works — signing in properly also fills in your username for game import."
					action={
						<button
							onClick={() => void start(setBusy)}
							disabled={busy}
							style={{ minHeight: 40, padding: '6px 12px' }}
						>
							{busy ? 'Redirecting…' : 'Sign in with Lichess'}
						</button>
					}
				/>
			) : (
				<Row
					text={
						<>
							<strong>Sign in with Lichess to start.</strong> The opening explorer refuses
							anonymous requests, so without this the Train tab has no book to check you
							against.
						</>
					}
					action={
						<button
							onClick={() => void start(setBusy)}
							disabled={busy}
							style={{
								padding: '8px 14px',
								fontSize: 15,
								borderRadius: 6,
								border: '1px solid #1565c0',
								background: '#1565c0',
								color: '#fff',
								cursor: 'pointer',
								minHeight: 40,
							}}
						>
							{busy ? 'Redirecting…' : 'Sign in with Lichess'}
						</button>
					}
				/>
			)}

			<p style={{ fontSize: 12, color: INK_2, margin: '8px 0 0' }}>
				{/* Both halves matter. The first is why the consent screen will look
					unusually empty; the second is the thing people will otherwise
					assume, and be wrong about, until a reinstall teaches them. */}
				No permissions are requested — the app cannot play, message or change anything on your
				account. Signing in does <strong>not</strong> sync your data: your deck and progress stay
				in this browser on this device. Use Export below to carry them elsewhere.
			</p>
		</section>
	);
}

async function start(setBusy: (b: boolean) => void) {
	setBusy(true);
	try {
		await beginSignIn();
	} catch (e) {
		setBusy(false);
		alert(`Could not start sign-in: ${(e as Error).message}`);
	}
}

/** Explanation on the left taking the slack, the one control on the right. */
function Row({ text, action }: { text: React.ReactNode; action: React.ReactNode }) {
	return (
		<div
			style={{
				display: 'flex',
				gap: 10,
				alignItems: 'center',
				flexWrap: 'wrap',
				fontSize: 14,
			}}
		>
			<span style={{ flex: '1 1 240px' }}>{text}</span>
			{action}
		</div>
	);
}

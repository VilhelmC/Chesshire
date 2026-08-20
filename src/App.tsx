import { useEffect, useState } from 'react';
import { Build } from './views/Build';
import { Coverage } from './views/Coverage';
import { Drills } from './views/Drills';
import { Train } from './views/Train';
import { Progress } from './views/Progress';
import { Review } from './views/Review';
import { Quiz } from './views/Quiz';
import type { TrainHandoff } from './views/Train';
import { DebugCorner } from './components/DebugCorner';
import { InstallBar } from './components/InstallBar';
import { Footer } from './components/Footer';
import { completeSignIn, hasToken, type SignInResult } from './data/lichessAuth';
import { startBackgroundImport } from './data/autoImport';
import { useViewport } from './components/useViewport';

type Tab = 'train' | 'quiz' | 'review' | 'progress' | 'coverage' | 'drills' | 'checks';

export default function App() {
	const [tab, setTab] = useState<Tab>('train');
	const vp = useViewport();
	/** A position handed from Review to Train, so a game can be played on from there. */
	const [handoff, setHandoff] = useState<TrainHandoff>(null);

	// The return leg of a Lichess sign-in, if that is what this page load is.
	// Announced rather than left silent: the user pressed a button, went to
	// another site, and came back — with nothing to show for it, a failure is
	// indistinguishable from the button not having worked.
	// `none` is filtered out at the point it is stored, so the banner's type
	// says only what the banner can actually be.
	const [signIn, setSignIn] = useState<Exclude<SignInResult, { status: 'none' }> | null>(null);
	useEffect(() => {
		if (consumed) return;
		consumed = true;
		void completeSignIn().then((r) => {
			if (r.status !== 'none') setSignIn(r);
		});
	}, []);

	// Game history is the one thing in this app that cannot be caught up on
	// later — see data/autoImport.ts. Started here rather than from any one tab,
	// because it should not depend on which screen someone happens to open.
	useEffect(() => startBackgroundImport(), []);

	return (
		<div
			style={{
				fontFamily: 'system-ui, -apple-system, sans-serif',
				maxWidth: 1180,
				margin: '0 auto',
				padding: vp.phone ? 12 : 24,
			}}
		>
			{/* On a short screen — a phone held sideways — the title is 50px of the
				393 available, spent on something you already know. The tabs still
				say where you are. */}
			{vp.height > 520 && (
				<header style={{ marginBottom: vp.phone ? 10 : 16 }}>
					<h1 style={{ margin: 0, fontSize: vp.phone ? 24 : undefined }}>Schackal</h1>
					{/* The tagline is the first thing to go when the screen is the
						scarce resource. */}
					{!vp.phone && (
						<p style={{ margin: '4px 0 0', opacity: 0.6 }}>
							Offbook trainer — drills what happens when the book runs out.
						</p>
					)}
				</header>
			)}

			{/* Above the tabs rather than below: it is about the app itself, not
				about whichever tab you happen to be on. */}
			<InstallBar />

			{signIn && (
				<div
					style={{
						padding: '8px 12px',
						marginBottom: 12,
						borderRadius: 8,
						fontSize: 14,
						border: `1px solid ${signIn.status === 'ok' ? '#2e7d32' : '#c62828'}`,
						background: signIn.status === 'ok' ? '#2e7d3210' : '#c6282810',
					}}
				>
					{signIn.status === 'ok'
						? `Signed in to Lichess${signIn.username ? ` as ${signIn.username}` : ''}.`
						: `Sign-in failed: ${signIn.reason}`}{' '}
					<button onClick={() => setSignIn(null)} style={{ fontSize: 12, marginLeft: 6 }}>
						dismiss
					</button>
				</div>
			)}

			{/* A new user has no token, and without one Train cannot check a single
				move. Sending them to the tab that fixes it is better than letting
				them meet a 401 first. */}
			{!hasToken() && tab === 'train' && (
				<div
					style={{
						padding: '8px 12px',
						marginBottom: 12,
						borderRadius: 8,
						fontSize: 14,
						border: '1px solid #1565c0',
						background: '#1565c010',
					}}
				>
					Training needs a Lichess sign-in — the opening explorer refuses anonymous requests.{' '}
					<button onClick={() => setTab('checks')} style={{ fontSize: 13, marginLeft: 6 }}>
						Set it up
					</button>
				</div>
			)}

			{/* Seven tabs do not fit on a phone. Scrolled rather than collapsed into
				a menu: every destination stays visible by swiping, and nothing is
				hidden behind a control you have to know about first. */}
			<nav
				style={{
					display: 'flex',
					gap: 4,
					borderBottom: '1px solid #ddd',
					marginBottom: vp.phone ? 14 : 20,
					overflowX: 'auto',
					WebkitOverflowScrolling: 'touch',
					scrollbarWidth: 'none',
				}}
			>
				<TabButton active={tab === 'train'} onClick={() => setTab('train')}>
					Train
				</TabButton>
				<TabButton active={tab === 'quiz'} onClick={() => setTab('quiz')}>
					Mistakes
				</TabButton>
				<TabButton active={tab === 'review'} onClick={() => setTab('review')}>
					Review
				</TabButton>
				<TabButton active={tab === 'progress'} onClick={() => setTab('progress')}>
					Progress
				</TabButton>
				<TabButton active={tab === 'coverage'} onClick={() => setTab('coverage')}>
					Analysis
				</TabButton>
				<TabButton active={tab === 'drills'} onClick={() => setTab('drills')}>
					Drill research
				</TabButton>
				<TabButton active={tab === 'checks'} onClick={() => setTab('checks')}>
					Checks &amp; token
				</TabButton>
			</nav>

			{tab === 'train' && <Train handoff={handoff} onHandoffUsed={() => setHandoff(null)} />}
			{tab === 'quiz' && <Quiz />}
			{tab === 'review' && (
				<Review
					onPlayFrom={(h) => {
						setHandoff(h);
						setTab('train');
					}}
				/>
			)}
			{tab === 'progress' && <Progress />}
			{tab === 'coverage' && <Coverage />}
			{tab === 'drills' && <Drills />}
			{tab === 'checks' && <Build />}

			<Footer />

			<DebugCorner />
		</div>
	);
}

/**
 * Module-level, not a ref: StrictMode mounts App twice in development and the
 * authorization code is single-use. The second attempt would report a failure
 * for a sign-in that had already succeeded.
 */
let consumed = false;

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			onClick={onClick}
			style={{
				borderTopStyle: 'none',
				borderRightStyle: 'none',
				borderLeftStyle: 'none',
				borderBottomStyle: 'solid',
				borderBottomWidth: 2,
				borderBottomColor: active ? '#1565c0' : 'transparent',
				background: 'none',
				padding: '10px 12px',
				fontSize: 15,
				whiteSpace: 'nowrap',
				flexShrink: 0,
				touchAction: 'manipulation',
				fontWeight: active ? 600 : 400,
				cursor: 'pointer',
				color: active ? '#1565c0' : '#444',
			}}
		>
			{children}
		</button>
	);
}

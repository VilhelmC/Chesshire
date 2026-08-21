import { useEffect, useState } from 'react';
import { Settings } from './views/Settings';
import { Train } from './views/Train';
import { Progress } from './views/Progress';
import { Review } from './views/Review';
import { Quiz } from './views/Quiz';
import { Lab } from './views/Lab';
import type { TrainHandoff } from './views/Train';
import { DebugCorner } from './components/DebugCorner';
import { BugReport } from './components/BugReport';
import { InstallBar } from './components/InstallBar';
import { Footer } from './components/Footer';
import { completeSignIn, type SignInResult } from './data/lichessAuth';
import { startBackgroundImport } from './data/autoImport';
import { useViewport } from './components/useViewport';
import { color, sans } from './ui/theme';
import { Mark } from './ui/Mark';

/**
 * Five destinations, down from seven.
 *
 * The three that went — the dependency checks, the coverage audit and the
 * punishment generator — were instruments for building the app rather than
 * places to train, and their own headings said so ("M0", "M2 audit"). They now
 * live folded shut inside Settings. A tab bar should describe what the app is
 * for, not the order in which it was assembled.
 *
 * The Lab is a sixth on a desktop and absent on a phone. It is not a feature: it
 * is where an experiment can be looked at rather than believed, showing the
 * working of computations the rest of the app only reports the conclusions of —
 * see views/Lab.tsx. It stays at the top level rather than folded into Settings
 * with the audit tools because it is used while deciding what the app should
 * say, and something you have to go and find is something you stop checking.
 *
 * Review earns its own place. It was folded into Progress on the theory that
 * looking at one game is something you do BECAUSE of a number — but the games
 * are the app's own record of what you have played, and "let me look at that
 * game from this morning" is a reason to open the app, not a footnote to a
 * chart. Hidden behind a button, it read as absent.
 */
type Tab = 'train' | 'quiz' | 'review' | 'progress' | 'lab' | 'settings';

export default function App() {
	const [tab, setTab] = useState<Tab>('train');
	const vp = useViewport();
	/** A position handed from Review to Train, so a game can be played on from there. */
	const [handoff, setHandoff] = useState<TrainHandoff>(null);
	/** Bumped when games are imported, so the deck reloads. */
	const [dataVersion, setDataVersion] = useState(0);

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
				fontFamily: sans,
				maxWidth: 1180,
				margin: '0 auto',
				padding: vp.phone ? 12 : 24,
			}}
		>
			{/* On a short screen — a phone held sideways — the title is 50px of the
				393 available, spent on something you already know. The tabs still
				say where you are. */}
			{vp.height > 520 && (
				<header
					style={{
						marginBottom: vp.phone ? 10 : 16,
						display: 'flex',
						alignItems: 'center',
						gap: vp.phone ? 10 : 14,
					}}
				>
					{/* Inline rather than an <img>: the mark has to invert with the
						theme, including a manual override, which no image can see.
						Same drawing the home-screen icons come from. */}
					<Mark size={vp.phone ? 34 : 46} />
					<div>
					<h1 style={{ margin: 0, fontSize: vp.phone ? 24 : undefined }}>Chesshire</h1>
					{/* The tagline is the first thing to go when the screen is the
						scarce resource. */}
					{!vp.phone && (
						<p style={{ margin: '4px 0 0', opacity: 0.6 }}>
							Offbook trainer — drills what happens when the book runs out.
						</p>
					)}
					</div>
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
						// Tokens, not concatenated hex: `${color.bad}10` cannot work
						// once the colours are var() references. That is what the
						// *Soft tokens exist for.
						border: `1px solid ${signIn.status === 'ok' ? color.good : color.bad}`,
						background: signIn.status === 'ok' ? color.goodSoft : color.badSoft,
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

			{/* Five, and measured: the row is 320px wide at a 360px viewport and
				353 at 393, so nothing needs swiping on any current phone. Below
				360 it scrolls, which is the right failure — a destination you have
				to swipe to find is one you forget exists, which is exactly what
				happened to Review while it was a button inside Progress. */}
			<nav
				style={{
					display: 'flex',
					gap: 4,
					borderBottom: `1px solid ${color.line}`,
					marginBottom: vp.phone ? 14 : 20,
					overflowX: 'auto',
					WebkitOverflowScrolling: 'touch',
					scrollbarWidth: 'none',
				}}
			>
				<TabButton compact={vp.phone} active={tab === 'train'} onClick={() => setTab('train')}>
					Train
				</TabButton>
				<TabButton compact={vp.phone} active={tab === 'quiz'} onClick={() => setTab('quiz')}>
					Mistakes
				</TabButton>
				<TabButton compact={vp.phone} active={tab === 'review'} onClick={() => setTab('review')}>
					Review
				</TabButton>
				<TabButton compact={vp.phone} active={tab === 'progress'} onClick={() => setTab('progress')}>
					Progress
				</TabButton>
				{/* Not on a phone. Six labels no longer cross a 360px screen, and
					the Lab is unusable there anyway — it is six tables and a FEN
					field. Absent where it cannot work beats present and broken. */}
				{!vp.phone && (
					<TabButton active={tab === 'lab'} onClick={() => setTab('lab')}>
						Lab
					</TabButton>
				)}
				<TabButton compact={vp.phone} active={tab === 'settings'} onClick={() => setTab('settings')}>
					Settings
				</TabButton>
			</nav>

			{tab === 'train' && (
				<Train
					handoff={handoff}
					onHandoffUsed={() => setHandoff(null)}
					onNeedsToken={() => setTab('settings')}
				/>
			)}
			{tab === 'quiz' && <Quiz key={dataVersion} onOpenSettings={() => setTab('settings')} />}

			{tab === 'review' && (
				<Review
					key={dataVersion}
					onPlayFrom={(h) => {
						setHandoff(h);
						setTab('train');
					}}
				/>
			)}

			{/* Progress keeps its way in, but as a shortcut to a tab that exists
				rather than as the only door to a hidden screen. */}
			{tab === 'progress' && <Progress onOpenReview={() => setTab('review')} />}

			{tab === 'lab' && <Lab />}

			{tab === 'settings' && <Settings onImported={() => setDataVersion((v) => v + 1)} />}

			<Footer />

			<BugReport />

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
	compact,
	children,
}: {
	active: boolean;
	onClick: () => void;
	/** Five labels have to cross a 360px screen without a swipe. */
	compact?: boolean;
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
				padding: compact ? '10px 6px' : '10px 12px',
				fontSize: compact ? 14 : 15,
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

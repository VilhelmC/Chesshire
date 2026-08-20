import { useEffect, useState } from 'react';
import { Settings } from './views/Settings';
import { Train } from './views/Train';
import { Progress } from './views/Progress';
import { Review } from './views/Review';
import { Quiz } from './views/Quiz';
import type { TrainHandoff } from './views/Train';
import { DebugCorner } from './components/DebugCorner';
import { InstallBar } from './components/InstallBar';
import { Footer } from './components/Footer';
import { completeSignIn, type SignInResult } from './data/lichessAuth';
import { startBackgroundImport } from './data/autoImport';
import { useViewport } from './components/useViewport';
import { color } from './ui/theme';
import { assetUrl } from './base';

/**
 * Four destinations, down from seven.
 *
 * The three that went — the dependency checks, the coverage audit and the
 * punishment generator — were instruments for building the app rather than
 * places to train, and their own headings said so ("M0", "M2 audit"). They now
 * live folded shut inside Settings. A tab bar should describe what the app is
 * for, not the order in which it was assembled.
 *
 * Review is not a peer of Progress; it is a drill-down of it. Looking at one
 * session in detail is what you do BECAUSE of something Progress told you, so
 * it is reached from there rather than from the top level.
 */
type Tab = 'train' | 'quiz' | 'progress' | 'settings';

export default function App() {
	const [tab, setTab] = useState<Tab>('train');
	const vp = useViewport();
	/** A position handed from Review to Train, so a game can be played on from there. */
	const [handoff, setHandoff] = useState<TrainHandoff>(null);
	/** Progress drilled into one session. */
	const [reviewing, setReviewing] = useState(false);
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
				<header
					style={{
						marginBottom: vp.phone ? 10 : 16,
						display: 'flex',
						alignItems: 'center',
						gap: vp.phone ? 10 : 14,
					}}
				>
					{/* The mark, at the size it was drawn to survive. It is the same
						file the home-screen icon is generated from, so the thing you
						tap and the thing you land on agree. */}
					<img
						src={assetUrl('icon.svg')}
						alt=""
						width={vp.phone ? 34 : 46}
						height={vp.phone ? 34 : 46}
						style={{ borderRadius: 8, flexShrink: 0 }}
					/>
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

			{/* Four now fit across a phone without scrolling, which is the point:
				a destination you have to swipe to find is one you forget exists.
				Kept scrollable anyway, for the narrowest screens and the longest
				translations. */}
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
				<TabButton active={tab === 'train'} onClick={() => setTab('train')}>
					Train
				</TabButton>
				<TabButton active={tab === 'quiz'} onClick={() => setTab('quiz')}>
					Mistakes
				</TabButton>
				<TabButton
					active={tab === 'progress'}
					onClick={() => {
						setTab('progress');
						setReviewing(false);
					}}
				>
					Progress
				</TabButton>
				<TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
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

			{tab === 'progress' &&
				(reviewing ? (
					<>
						<button
							onClick={() => setReviewing(false)}
							style={{
								border: 'none',
								background: 'none',
								color: '#1565c0',
								fontSize: 14,
								padding: '8px 0',
								cursor: 'pointer',
								minHeight: 40,
							}}
						>
							← Back to progress
						</button>
						<Review
							onPlayFrom={(h) => {
								setHandoff(h);
								setTab('train');
							}}
						/>
					</>
				) : (
					<Progress onOpenReview={() => setReviewing(true)} />
				))}

			{tab === 'settings' && <Settings onImported={() => setDataVersion((v) => v + 1)} />}

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

import { useState } from 'react';
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
import { useViewport } from './components/useViewport';

type Tab = 'train' | 'quiz' | 'review' | 'progress' | 'coverage' | 'drills' | 'checks';

export default function App() {
	const [tab, setTab] = useState<Tab>('train');
	const vp = useViewport();
	/** A position handed from Review to Train, so a game can be played on from there. */
	const [handoff, setHandoff] = useState<TrainHandoff>(null);

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

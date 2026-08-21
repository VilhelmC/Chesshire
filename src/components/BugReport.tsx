// "Something is wrong here" — from wherever you are.
//
// Sits in the corner beside the debug handle, on every tab, because the moment
// you notice something is the moment the state that explains it still exists.
// Navigating to a settings page to report a bug loses the position you were
// looking at, which is usually the report.

import { useState } from 'react';
import { gatherState, issueUrl, asText, type Report } from '../data/report';
import { Panel, Button, Note, Field, inputStyle } from '../ui/primitives';
import { color, space, radius, text, TOUCH } from '../ui/theme';

export function BugReport() {
	const [open, setOpen] = useState(false);
	const [summary, setSummary] = useState('');
	const [detail, setDetail] = useState('');
	const [state, setState] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	async function start() {
		setOpen(true);
		// Captured on OPEN, not on send: by the time the form is filled in, a
		// background import may have finished or a timer moved something. The
		// state that matters is the state at the moment you noticed.
		setState(await gatherState());
	}

	if (!open) {
		return (
			<button
				onClick={() => void start()}
				title="Report something wrong, with the app's current state attached"
				style={{
					position: 'fixed',
					right: 10,
					bottom: 10,
					zIndex: 40,
					minHeight: TOUCH,
					padding: `0 ${space.card}px`,
					borderRadius: radius.pill,
					border: `1px solid ${color.line}`,
					background: color.surface,
					color: color.ink2,
					fontSize: text.note,
					cursor: 'pointer',
					opacity: 0.8,
				}}
			>
				Report a problem
			</button>
		);
	}

	const report: Report = { summary, detail, state: state ?? 'collecting…' };
	const { url, trimmed } = issueUrl(report);

	/**
	 * Open the issue form, having first put the state where the body says it is.
	 *
	 * The clipboard write has to happen in the click, not after the navigation:
	 * a browser only grants clipboard access from a user gesture, and once the
	 * new tab has focus this one no longer has one to spend.
	 */
	async function openIssue() {
		if (trimmed) {
			try {
				await navigator.clipboard.writeText(report.state);
				setCopied(true);
				setTimeout(() => setCopied(false), 4000);
			} catch {
				// Refused or unavailable. The issue is still worth opening; the
				// body will ask for a dump the user has to fetch themselves, and
				// the note below says how.
			}
		}
		window.open(url, '_blank', 'noopener');
	}

	return (
		<div
			style={{
				position: 'fixed',
				right: 10,
				bottom: 10,
				zIndex: 40,
				width: 'min(420px, calc(100vw - 20px))',
				maxHeight: 'calc(100vh - 20px)',
				overflowY: 'auto',
			}}
		>
			<Panel>
				<Field label="What went wrong?">
					<input
						value={summary}
						onChange={(e) => setSummary(e.target.value)}
						placeholder="One line"
						style={inputStyle}
					/>
				</Field>
				<Field
					label="What were you doing?"
					hint="What you expected, and what happened instead."
				>
					<textarea
						value={detail}
						onChange={(e) => setDetail(e.target.value)}
						rows={4}
						style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
					/>
				</Field>

				<Note style={{ marginBottom: space.snug }}>
					{/* Both halves are the point: what is attached, and what is not. */}
					The app&apos;s current state goes with the report — the position, the run, the
					board&apos;s own view of itself, and how much is stored. Your Lichess token is
					never included, only its length.
					{trimmed && (
						<>
							{' '}
							<strong>The dump is too large for a link and has been shortened;</strong> the
							copy option below carries all of it.
						</>
					)}
				</Note>

				<div style={{ display: 'flex', gap: space.snug, flexWrap: 'wrap' }}>
					<Button kind="primary" onClick={() => void openIssue()} disabled={!state}>
						Open an issue
					</Button>
					<Button
						onClick={async () => {
							await navigator.clipboard.writeText(asText(report));
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
						disabled={!state}
					>
						{copied ? 'Copied' : 'Copy instead'}
					</Button>
					<Button kind="quiet" onClick={() => setOpen(false)}>
						Cancel
					</Button>
				</div>

				<Note style={{ marginTop: space.snug }}>
					An issue is public. If this one should not be, copy it and send it privately.
					{copied && trimmed && (
						<>
							{' '}
							<strong>State copied — paste it into the issue.</strong>
						</>
					)}
				</Note>
			</Panel>
		</div>
	);
}

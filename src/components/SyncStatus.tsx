// Whether new games are arriving, and when the last ones did.
//
// The background import is deliberately quiet, and quiet is one keystroke from
// broken: an import that has silently failed for three weeks looks exactly like
// an import that has found nothing new. The difference matters more here than
// almost anywhere else in the app, because the transfer measurement's whole
// value rests on history continuing to accumulate.
//
// So the last successful sync is shown as a date, not as "up to date".

import { useEffect, useState } from 'react';
import { subscribeSync, syncState, runBackgroundImport, type SyncState } from '../data/autoImport';

const INK_2 = '#52514e';

export function SyncStatus() {
	const [s, setS] = useState<SyncState>(syncState);
	useEffect(() => subscribeSync(setS), []);

	return (
		<p style={{ fontSize: 12, color: INK_2, margin: '0 0 10px' }}>
			{s.running ? (
				<>Importing… {s.note}</>
			) : s.error ? (
				<span style={{ color: '#c62828' }}>Last import failed: {s.error}</span>
			) : s.lastSuccessAt ? (
				<>Games last imported {describeWhen(s.lastSuccessAt)}.</>
			) : (
				<>No automatic import has run yet on this device.</>
			)}{' '}
			<button
				onClick={() => void runBackgroundImport({ force: true })}
				disabled={s.running}
				style={{
					fontSize: 11,
					padding: '2px 6px',
					marginLeft: 4,
					cursor: s.running ? 'default' : 'pointer',
				}}
			>
				{s.running ? 'running' : 'check now'}
			</button>
		</p>
	);
}

/** A date once it is more than a day old — "2 days ago" stops being useful fast. */
function describeWhen(t: number): string {
	const hours = (Date.now() - t) / 3_600_000;
	if (hours < 1) return 'in the last hour';
	if (hours < 24) return `${Math.floor(hours)} hours ago`;
	const days = Math.floor(hours / 24);
	if (days <= 3) return `${days} day${days === 1 ? '' : 's'} ago`;
	return `on ${new Date(t).toISOString().slice(0, 10)}`;
}

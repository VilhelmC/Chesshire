// Backup, restore, and whether the browser is allowed to throw your data away.
//
// The counts are shown before you download and after you import, because a
// backup you have not verified is a belief rather than a backup — and the thing
// this replaces was a button that would have handed back an empty file.

import { useEffect, useState } from 'react';
import {
	makeBackup,
	countsOf,
	parseBackup,
	restoreBackup,
	requestPersistence,
	BackupError,
	type BackupCounts,
	type RestoreResult,
	type StorageStatus,
} from '../data/backup';
import { color } from '../ui/theme';

const INK_2 = color.ink2;
const GRID = color.line;
const GOOD = color.good;
const BAD = '#c62828';

export function DataPanel() {
	const [counts, setCounts] = useState<BackupCounts | null>(null);
	const [storage, setStorage] = useState<StorageStatus | null>(null);
	const [restored, setRestored] = useState<RestoreResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [replacePractice, setReplacePractice] = useState(false);
	const [busy, setBusy] = useState(false);

	async function refresh() {
		setCounts(countsOf(await makeBackup()));
	}

	useEffect(() => {
		void refresh();
		void requestPersistence().then(setStorage);
	}, []);

	async function download() {
		setBusy(true);
		try {
			const b = await makeBackup();
			const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `schackal-${new Date(b.exportedAt).toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(url);
			setCounts(countsOf(b));
		} finally {
			setBusy(false);
		}
	}

	async function onFile(file: File) {
		setBusy(true);
		setError(null);
		setRestored(null);
		try {
			const result = await restoreBackup(parseBackup(await file.text()), { replacePractice });
			setRestored(result);
			await refresh();
		} catch (e) {
			setError(e instanceof BackupError ? e.message : (e as Error).message);
		} finally {
			setBusy(false);
		}
	}

	const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

	return (
		<section style={{ borderTop: `1px solid ${GRID}`, paddingTop: 16, marginTop: 16 }}>
			<p style={{ fontSize: 13, color: INK_2, marginTop: 0, maxWidth: 580 }}>
				Everything lives in this browser. Nothing is sent anywhere, and there is no account to
				recover from — so the backup is the only copy that survives a cleared browser or a new
				machine.
			</p>

			{storage && (
				<p style={{ fontSize: 13, margin: '8px 0' }}>
					<strong style={{ color: storage.persisted ? GOOD : BAD }}>
						{storage.persisted ? 'Storage is persistent' : 'Storage is evictable'}
					</strong>{' '}
					<span style={{ color: INK_2 }}>
						{storage.persisted
							? '— the browser has agreed not to clear it under storage pressure.'
							: storage.supported
								? '— the browser may delete this data when short of space. It usually grants persistence once a site has been used a few times, or if you install it. Keep a backup either way.'
								: '— this browser does not support the request.'}
						{storage.usageBytes !== null &&
							` Using ${(storage.usageBytes / 1e6).toFixed(1)} MB.`}
					</span>
				</p>
			)}

			{counts && (
				<table style={{ fontSize: 13, borderCollapse: 'collapse', margin: '10px 0' }}>
					<tbody>
						{Object.entries(counts).map(([name, n]) => (
							<tr key={name}>
								<td style={{ paddingRight: 14, color: INK_2 }}>{name}</td>
								<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<button onClick={() => void download()} disabled={busy || !total}>
					Download backup
				</button>
				<label style={{ fontSize: 13 }}>
					<input
						type="file"
						accept="application/json,.json"
						style={{ display: 'none' }}
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) void onFile(f);
							e.target.value = '';
						}}
					/>
					<span
						role="button"
						style={{
							border: `1px solid ${GRID}`,
							borderRadius: 6,
							padding: '5px 9px',
							cursor: 'pointer',
							background: '#fff',
						}}
					>
						Restore from file…
					</span>
				</label>
				<label style={{ fontSize: 12, color: INK_2 }}>
					<input
						type="checkbox"
						checked={replacePractice}
						onChange={(e) => setReplacePractice(e.target.checked)}
					/>{' '}
					also take its practice settings
				</label>
			</div>

			<p style={{ fontSize: 12, color: INK_2, maxWidth: 580 }}>
				Restoring <strong>merges</strong> rather than replaces, so importing onto a device you
				have used since the export keeps both. Where the two disagree about how well you know
				something, the less flattering one wins — a card retired on one device and still owed on
				the other is still owed. Running the same restore twice changes nothing the second time.
			</p>
			<p style={{ fontSize: 12, color: INK_2, maxWidth: 580 }}>
				The file excludes the position and evaluation caches, which are free to rebuild, the
				game in progress, and your Lichess token, which is a credential rather than data.
			</p>

			{error && (
				<p style={{ fontSize: 13, color: BAD }}>
					<strong>Not imported.</strong> {error}
				</p>
			)}

			{restored && (
				<div style={{ fontSize: 13, marginTop: 8 }}>
					<strong style={{ color: GOOD }}>
						Merged: {restored.report.added} new rows, {restored.report.reconciled} reconciled.
					</strong>
					<ul style={{ margin: '4px 0 0', paddingLeft: 18, color: INK_2 }}>
						{Object.entries(restored.perTable)
							.filter(([, r]) => r.added || r.reconciled)
							.map(([name, r]) => (
								<li key={name}>
									{name}: +{r.added}
									{r.reconciled ? `, ${r.reconciled} reconciled` : ''}
								</li>
							))}
					</ul>
				</div>
			)}
		</section>
	);
}

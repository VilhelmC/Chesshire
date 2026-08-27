// A file on disk that the app keeps up to date, without asking twice.
//
// ---------------------------------------------------------------------------
// Will, describing how this was solved elsewhere: "The annotations panel uses the
// File System Access API — specifically window.showSaveFilePicker(). On the first
// 'Save', it prompts you to pick/create a file and returns a FileSystemFileHandle.
// I keep that handle in a module variable, so every later save just does
// handle.createWritable() → write(markdown) → close() silently — no re-prompt …
// You save the file into the project folder I have access to, and I read it with
// a normal file Read. That's the whole trick."
//
// Which is the right shape, and the download it replaces was the weak part of the
// loop: a file in ~/Downloads is not a file in the repo, and every note cost a
// drag.
//
// Two things here go beyond keeping the handle in a module variable:
//
//   * The handle is stored in IndexedDB, not just in memory. Handles are
//     structured-cloneable, so it survives a reload and the picker is a
//     once-ever event rather than a once-per-session one. `localStorage` cannot
//     hold one — it stringifies, and a handle stringifies to "[object Object]".
//   * Permission is re-checked before every write. A restored handle comes back
//     with its permission in `prompt` state, and asking for it requires a user
//     gesture — so a write that needs re-granting reports that rather than
//     failing silently, and the caller can put it behind a button.
//
// The API is Chromium-only and needs a secure context (https or localhost).
// Firefox and Safari get the download instead, which is why `downloadAs` stays.
// ---------------------------------------------------------------------------

import { db } from './db';

/** Only the parts of the File System Access API this file uses. */
type Writable = { write: (data: string) => Promise<void>; close: () => Promise<void> };
type FileHandle = {
	name: string;
	createWritable: () => Promise<Writable>;
	queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
	requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};
type PickerWindow = Window & {
	showSaveFilePicker?: (opts: {
		suggestedName?: string;
		types?: { description: string; accept: Record<string, string[]> }[];
	}) => Promise<FileHandle>;
};

export type LinkState =
	| { kind: 'unsupported' }
	| { kind: 'unlinked' }
	| { kind: 'linked'; name: string }
	| { kind: 'needs-permission'; name: string };

/** In memory for the session; in IndexedDB so the next session inherits it. */
let handle: FileHandle | null = null;

export const canLink = (): boolean =>
	typeof window !== 'undefined' && typeof (window as PickerWindow).showSaveFilePicker === 'function';

async function remember(h: FileHandle | null): Promise<void> {
	handle = h;
	if (h) await db.handles.put({ id: 'labNotes', handle: h });
	else await db.handles.delete('labNotes');
}

/** Bring back the handle a previous session linked, if there is one. */
export async function restoreLink(): Promise<LinkState> {
	if (!canLink()) return { kind: 'unsupported' };
	if (!handle) {
		const row = await db.handles.get('labNotes').catch(() => undefined);
		handle = (row?.handle as FileHandle | undefined) ?? null;
	}
	if (!handle) return { kind: 'unlinked' };
	const state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
	return state === 'granted'
		? { kind: 'linked', name: handle.name }
		: { kind: 'needs-permission', name: handle.name };
}

/**
 * Ask once for a file to keep updated. Must be called from a click.
 *
 * Returns `unlinked` when the picker is dismissed, which is a normal outcome and
 * not an error — the notes are already saved in the browser either way.
 */
export async function linkFile(suggestedName: string): Promise<LinkState> {
	const picker = (window as PickerWindow).showSaveFilePicker;
	if (!picker) return { kind: 'unsupported' };
	try {
		const h = await picker({
			suggestedName,
			types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
		});
		await remember(h);
		return { kind: 'linked', name: h.name };
	} catch {
		return handle ? { kind: 'linked', name: handle.name } : { kind: 'unlinked' };
	}
}

/** Forget the file. The notes themselves are untouched. */
export async function unlink(): Promise<void> {
	await remember(null);
}

/**
 * Write the whole file, every time.
 *
 * Overwrite rather than append: the document is a projection of the notes, so a
 * partial file is a wrong file. `interactive` may only be true inside a click —
 * it is what allows the permission prompt when a restored handle needs
 * re-granting.
 */
export async function writeLinked(text: string, interactive = false): Promise<LinkState> {
	if (!handle) return canLink() ? { kind: 'unlinked' } : { kind: 'unsupported' };
	let state = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
	if (state !== 'granted' && interactive) {
		state = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
	}
	if (state !== 'granted') return { kind: 'needs-permission', name: handle.name };
	const w = await handle.createWritable();
	await w.write(text);
	await w.close();
	return { kind: 'linked', name: handle.name };
}

/** The fallback everywhere the picker does not exist. */
export function downloadAs(name: string, text: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	URL.revokeObjectURL(url);
}

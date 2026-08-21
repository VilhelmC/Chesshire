// Sending a bug report from inside the app.
//
// ---------------------------------------------------------------------------
// There is no server to send one to, and adding one to collect bug reports
// would be a strange first reason to abandon being local-first.
//
// GitHub issues are already a public, writable, readable endpoint, and the
// repository already exists. `github.com/<owner>/<repo>/issues/new` accepts a
// pre-filled title and body as query parameters, so the app can compose the
// whole report and hand it to the browser. The person reviewing it reads it
// where they already read everything else about this project.
//
// WHAT GOES IN, AND WHAT MUST NOT
//
// The state dump is what makes a report actionable — the position, the run, the
// engine's own view of the board, the counts. It is also the thing most likely
// to carry something private, so the token is never included; `collect()` in
// data/debug.ts reports only its LENGTH, and this adds nothing beyond it.
//
// HOW LONG A LINK MAY BE
//
// The first version budgeted 7000 characters, which is roughly what a browser
// will carry. It failed in the one case that matters: a person who is not
// signed in to GitHub. Then the link is not fetched at all — it becomes the
// `return_to` parameter of a login URL, doubling in length and passing through
// a redirect chain that gives up. What the user sees is a sign-in page followed
// by "Server Error", with no way to tell that their report was the cause.
//
// So the budget is what survives being embedded in a login redirect, not what a
// browser will accept. The state dump does not fit in that, and pretending
// otherwise is what broke it — it goes to the clipboard instead, and the issue
// body says, in the place where it would have been, that it is on the clipboard
// and asks for it to be pasted. A short link that works beats a complete one
// that does not arrive.
// ---------------------------------------------------------------------------

import { collect } from './debug';
import { SOURCE_URL } from '../components/Footer';

/**
 * Budget for the whole issue URL.
 *
 * Sized to survive `github.com/login?return_to=<this, encoded>` — the signed-out
 * path, where the link is carried as a parameter of another link and re-encoded
 * on the way. That round trip is where 7000 characters died.
 */
export const MAX_URL = 1500;

export type Report = {
	summary: string;
	detail: string;
	/** The full state dump, already stringified. */
	state: string;
};

/** Everything the app knows about itself right now. */
export async function gatherState(): Promise<string> {
	try {
		return JSON.stringify(await collect(), null, '\t');
	} catch (e) {
		return `could not collect state: ${(e as Error).message}`;
	}
}

/**
 * The issue body.
 *
 * `trimmed` means the state dump did not fit and the body asks for it to be
 * pasted instead. The caller has to put it on the clipboard and say so — a body
 * that references a clipboard nobody filled is worse than no body at all.
 */
export function composeBody(r: Report, budget = MAX_URL): { body: string; trimmed: boolean } {
	const description = r.detail.trim() || '_No description given._';

	// The state dump is the most useful part of a report and the least likely to
	// fit. Rather than truncate it into something that looks complete, the body
	// says where the whole thing is and asks for it.
	const paste = [
		'---',
		'',
		'<!-- The app state was copied to your clipboard when this link opened.',
		'     Paste it below — it is what makes this report reproducible. -->',
		'',
		'```json',
		'',
		'```',
	].join('\n');

	const withState = [
		description,
		'',
		'---',
		'',
		'<details><summary>App state</summary>',
		'',
		'```json',
		r.state,
		'```',
		'',
		'</details>',
	].join('\n');

	// Inline it only if the whole thing genuinely fits. No trimming: a dump cut
	// at an arbitrary character is not JSON, and a report that looks whole and
	// is not costs more than an obviously partial one.
	if (encodeURIComponent(withState).length <= budget) {
		return { body: withState, trimmed: false };
	}

	return { body: [description, '', paste].join('\n'), trimmed: true };
}

/** The URL that opens a pre-filled GitHub issue. */
export function issueUrl(r: Report, budget = MAX_URL): { url: string; trimmed: boolean } {
	const { body, trimmed } = composeBody(r, budget);
	const url = new URL(`${SOURCE_URL}/issues/new`);
	url.searchParams.set('title', r.summary.trim() || 'Bug report');
	url.searchParams.set('body', body);
	// No `labels` parameter. GitHub rejects it from anyone without triage rights
	// on the repository, and a rejected parameter is another way this link can
	// end at an error page instead of a form. Labelling is a maintainer's job and
	// takes one click at the other end.
	return { url: url.href, trimmed };
}

/**
 * The whole report as text, for when the URL route is not wanted.
 *
 * Kept because a GitHub issue is public and not everything belongs in one — and
 * because a person without a GitHub account should still be able to send this
 * to someone.
 */
export function asText(r: Report): string {
	return [
		`Chesshire bug report: ${r.summary || '(no summary)'}`,
		'',
		r.detail || '(no description)',
		'',
		'--- state ---',
		r.state,
	].join('\n');
}

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
// A URL has a practical length limit — browsers and servers both give up
// somewhere past ~8000 characters, and GitHub is stricter than most. So the
// dump is trimmed to fit, and **the report says when it was trimmed**, because
// a truncated diagnostic that looks complete is worse than an obviously partial
// one.
// ---------------------------------------------------------------------------

import { collect } from './debug';
import { SOURCE_URL } from '../components/Footer';

/** Past this a browser or GitHub may silently refuse the navigation. */
export const MAX_URL = 7000;

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
 * The issue body, trimmed to fit a URL.
 *
 * Returns the body and whether anything was cut, so the caller can say so
 * rather than let a partial dump pass for a whole one.
 */
export function composeBody(r: Report, budget = MAX_URL): { body: string; trimmed: boolean } {
	const head = [
		r.detail.trim() || '_No description given._',
		'',
		'---',
		'',
		'<details><summary>App state</summary>',
		'',
		'```json',
	].join('\n');

	const tail = ['```', '', '</details>'].join('\n');

	// Everything except the dump, plus the encoding overhead — JSON is mostly
	// safe characters but quotes and newlines each cost three.
	const fixed = encodeURIComponent(head + tail).length;
	const room = Math.max(0, budget - fixed);

	// Encoded length is roughly 1.6x raw for this kind of content; measure
	// rather than assume, by trimming until it fits.
	let state = r.state;
	let trimmed = false;
	while (state.length > 0 && encodeURIComponent(state).length > room) {
		state = state.slice(0, Math.floor(state.length * 0.9));
		trimmed = true;
	}

	if (trimmed) {
		state += '\n\n… TRUNCATED to fit a URL. Ask for the full dump via schackal.dump().';
	}

	return { body: head + '\n' + state + '\n' + tail, trimmed };
}

/** The URL that opens a pre-filled GitHub issue. */
export function issueUrl(r: Report, budget = MAX_URL): { url: string; trimmed: boolean } {
	const { body, trimmed } = composeBody(r, budget);
	const url = new URL(`${SOURCE_URL}/issues/new`);
	url.searchParams.set('title', r.summary.trim() || 'Bug report');
	url.searchParams.set('body', body);
	url.searchParams.set('labels', 'from-app');
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

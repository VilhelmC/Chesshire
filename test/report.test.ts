// A bug report has to survive being put in a URL.
//
// Two failures worth preventing, and the second one actually happened:
//
//  * A state dump silently cut to fit a query string, arriving as a
//    complete-looking diagnostic missing the part that explained the bug.
//  * A link too long to survive the SIGNED-OUT path. GitHub carries an
//    unauthenticated visitor's destination as `login?return_to=<url>`, so the
//    whole thing is embedded and re-encoded inside another URL; at 7000
//    characters that chain ended at "Server Error" — a sign-in page and then a
//    dead end, with nothing to suggest the report was the cause.
//
// So the size test here is not "will a browser accept it" but "will it still be
// there after being wrapped in a login redirect".

import { describe, it, expect } from 'vitest';
import { composeBody, issueUrl, asText, MAX_URL } from '../src/data/report';

const report = (state: string) => ({
	summary: 'Board will not accept a move',
	detail: 'Tried to play Nf3 on the Mistakes tab, nothing happened.',
	state,
});

describe('composeBody', () => {
	it('keeps a small dump whole and says so by not saying anything', () => {
		const { body, trimmed } = composeBody(report('{"a":1}'));
		expect(trimmed).toBe(false);
		expect(body).toContain('{"a":1}');
		expect(body).not.toContain('TRUNCATED');
	});

	it('includes what the person actually wrote', () => {
		const { body } = composeBody(report('{}'));
		expect(body).toContain('Tried to play Nf3');
	});

	it('does not leave the description blank when there is none', () => {
		const { body } = composeBody({ summary: 'x', detail: '   ', state: '{}' });
		expect(body).toContain('No description given');
	});

	it('leaves a large dump out entirely rather than cutting it', () => {
		// A dump sliced at an arbitrary character is not JSON and cannot be read
		// back. Half a diagnostic that parses as nothing is not half as useful.
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { body, trimmed } = composeBody(report(huge));
		expect(trimmed).toBe(true);
		expect(body).not.toContain('xxxxx');
	});

	it('asks for the dump in the place it would have been', () => {
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { body } = composeBody(report(huge));
		expect(body).toContain('clipboard');
		// An empty fenced block, so there is somewhere obvious to paste into.
		expect(body).toContain('```json');
	});

	it('keeps what the person wrote even when the state cannot come along', () => {
		// The description is the irreplaceable half: the state can be asked for
		// again, and what they were doing cannot.
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		expect(composeBody(report(huge)).body).toContain('Tried to play Nf3');
	});

	it('stays inside the budget whatever the dump was', () => {
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { body } = composeBody(report(huge));
		expect(encodeURIComponent(body).length).toBeLessThanOrEqual(MAX_URL);
	});
});

describe('issueUrl', () => {
	it('points at the project and pre-fills the title', () => {
		const { url } = issueUrl(report('{}'));
		expect(url).toContain('/issues/new');
		// Read the parameters back rather than searching the raw string:
		// URLSearchParams encodes a space as '+', which decodeURIComponent does
		// not reverse. Parsing it the way the receiving end will is the check
		// that actually means something.
		expect(new URL(url).searchParams.get('title')).toBe('Board will not accept a move');
	});

	it('gives an untitled report a title anyway', () => {
		const { url } = issueUrl({ summary: '', detail: 'x', state: '{}' });
		expect(new URL(url).searchParams.get('title')).toBe('Bug report');
	});

	it('asks for no labels', () => {
		// GitHub refuses a `labels` parameter from anyone without triage rights,
		// which is one more way this link can land on an error page instead of a
		// form. Labelling costs the maintainer one click at the other end.
		expect(issueUrl(report('{}')).url).not.toContain('labels=');
	});

	it('survives being wrapped in a sign-in redirect', () => {
		// The actual failure. A signed-out visitor never fetches this URL: it
		// becomes a parameter of github.com/login, encoded again on the way in.
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { url, trimmed } = issueUrl(report(huge));
		expect(trimmed).toBe(true);

		const viaLogin = `https://github.com/login?return_to=${encodeURIComponent(url)}`;
		// 8000 is where browsers and proxies start giving up; the whole point of
		// the smaller budget is that the wrapped form is still nowhere near it.
		expect(viaLogin.length).toBeLessThan(4000);
	});

	it('keeps a short report whole even after wrapping', () => {
		const { url, trimmed } = issueUrl(report('{"engine":"ready"}'));
		expect(trimmed).toBe(false);
		expect(new URL(url).searchParams.get('body')).toContain('"engine":"ready"');
	});
});

describe('asText', () => {
	it('carries the whole dump, untrimmed', () => {
		// The copy route exists precisely so the full state can travel when the
		// URL route cannot carry it.
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		expect(asText(report(huge)).length).toBeGreaterThan(50_000);
	});

	it('is readable without any of the app around it', () => {
		const t = asText(report('{"a":1}'));
		expect(t).toContain('Chesshire bug report');
		expect(t).toContain('--- state ---');
	});
});

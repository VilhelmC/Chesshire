// A bug report has to survive being put in a URL.
//
// The failure worth preventing: a state dump silently cut to fit a query
// string, arriving as a complete-looking diagnostic that is missing the part
// that explained the bug. A truncated report that says it is truncated is
// useful; one that does not is worse than none.

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

	it('trims a large dump AND says that it did', () => {
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { body, trimmed } = composeBody(report(huge));
		expect(trimmed).toBe(true);
		expect(body).toContain('TRUNCATED');
	});

	it('trims to something that actually fits', () => {
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { body } = composeBody(report(huge));
		// The whole point of trimming. A body that still exceeds the budget
		// would be trimmed and broken.
		expect(encodeURIComponent(body).length).toBeLessThanOrEqual(MAX_URL * 1.2);
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

	it('labels it so app reports are findable', () => {
		expect(issueUrl(report('{}')).url).toContain('labels=from-app');
	});

	it('produces a URL a browser will accept', () => {
		const huge = JSON.stringify({ pad: 'x'.repeat(50_000) });
		const { url, trimmed } = issueUrl(report(huge));
		expect(trimmed).toBe(true);
		// Generous ceiling: the practical limit is somewhere past 8000 and
		// varies, so this checks the trimming worked at all rather than pinning
		// a number nobody can verify.
		expect(url.length).toBeLessThan(12_000);
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

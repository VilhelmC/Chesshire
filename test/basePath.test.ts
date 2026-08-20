// Every URL to one of our own files has to survive being served from a subpath.
//
// This is the test that would have caught the bug: the Stockfish worker was
// loaded from '/engine/stockfish-18-lite-single.js', which is correct at the
// origin root and one directory too high on GitHub Pages. The worker 404'd, so
// it never answered, so the app timed out waiting for `uciok` — and a timeout
// reads as "the engine is broken" rather than "the file is not there", which is
// why it cost an evening rather than a minute.
//
// The rule is mechanical, so it can be enforced mechanically: no root-absolute
// path to our own assets anywhere in src/. Build them with assetUrl().

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assetUrl } from '../src/base';

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.tsx?$/.test(p)) out.push(p);
	}
	return out;
}

describe('assetUrl', () => {
	it('joins onto the base without doubling the slash', () => {
		// BASE_URL is '/' under test, which is the case that hides the bug — so
		// the shape is asserted rather than the exact string.
		expect(assetUrl('engine/x.js')).toMatch(/^\/(.*\/)?engine\/x\.js$/);
		expect(assetUrl('engine/x.js')).not.toContain('//');
	});

	it('tolerates a leading slash rather than producing a broken URL', () => {
		expect(assetUrl('/engine/x.js')).toBe(assetUrl('engine/x.js'));
	});
});

describe('no root-absolute asset paths in src', () => {
	const OWN_ASSET_DIRS = ['engine', 'assets', 'icons', 'img', 'fonts'];

	it('never hardcodes a path that breaks under a subpath deploy', () => {
		const offenders: string[] = [];
		for (const file of walk(join(__dirname, '..', 'src'))) {
			// base.ts documents the very strings it exists to replace.
			if (file.endsWith(`${join('src', 'base.ts')}`)) continue;
			const text = readFileSync(file, 'utf8');
			text.split('\n').forEach((line, i) => {
				// Comments explain the rule; they are not code.
				if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
				for (const dir of OWN_ASSET_DIRS) {
					if (new RegExp(`['"\`]/${dir}/`).test(line)) {
						offenders.push(`${file}:${i + 1}: ${line.trim()}`);
					}
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});

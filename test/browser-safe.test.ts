// Nothing that ships to the browser may reach for Node.
//
// ---------------------------------------------------------------------------
// `chain.ts` read its two tuning knobs from `process.env`, so I could sweep them
// from the shell without editing the file. That is fine in a harness and fatal
// in a tab: `process` does not exist in a browser, the module throws while it is
// being evaluated, and the whole view goes white. It reached Will.
//
// It also got past the browser check, for a separate reason worth recording —
// the check listened for console messages, and an exception thrown during module
// evaluation is not a console message. Both holes are closed: this test, and a
// `pageerror` listener in scripts/lab-check.mjs.
//
// The rule is simply that src/ is browser code. Harnesses live in scripts/ and
// may use whatever Node offers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...sources(path));
		else if (/\.tsx?$/.test(name)) out.push(path);
	}
	return out;
}

/** Globals that exist in Node and not in a browser. */
const NODE_ONLY = [
	/\bprocess\s*\./,
	/\brequire\s*\(/,
	/\b__dirname\b/,
	/\bBuffer\s*\./,
	/from\s+['"]node:/,
];

describe('browser safety', () => {
	const files = sources('src');

	it('finds the source tree', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('reaches for nothing that only exists in Node', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			for (const pattern of NODE_ONLY) {
				const m = pattern.exec(text);
				if (!m) continue;
				// `import.meta.env` is Vite's own and is fine; so is a comment.
				const line = text.slice(0, m.index).split('\n').length;
				const source = text.split('\n')[line - 1] ?? '';
				if (/^\s*(\/\/|\*|\/\*)/.test(source)) continue;
				offenders.push(`${file}:${line}  ${source.trim()}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});

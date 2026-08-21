// Nothing may shadow the tree the build actually reads.
//
// ---------------------------------------------------------------------------
// A whole round of work was written to `<repo>/app/src/...` while the app lives
// at `<repo>/src/...`. Every file was correct, the tests passed, the build was
// green — in a copy of the tree that nothing compiles. From the outside the
// symptom was that the feature simply was not there, twice, with no error
// anywhere to explain why.
//
// The class of bug is a SHADOW TREE: a second copy of a source path that reads
// as the real one. It cannot be caught by anything that only looks at files it
// was pointed at, because the mistake is which files you point at. So this
// walks the repository instead and refuses any directory holding a path that
// duplicates one under src/ or test/.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');

/** Directories with their own reason to hold source-shaped paths. */
const IGNORED = new Set([
	'node_modules',
	'dist',
	'.git',
	'.github',
	'_to_delete',
	'public',
	'coverage',
	'src',
	'test',
	'scripts',
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === 'node_modules' || entry === '.git') continue;
			walk(full, out);
		} else {
			out.push(full);
		}
	}
	return out;
}

/** Every path under `dir` that also exists, at the same suffix, in the real tree. */
export function shadowed(root: string, dir: string): string[] {
	const base = join(root, dir);
	if (!existsSync(base)) return [];
	return walk(base)
		.map((f) => relative(base, f))
		// A copy is only a shadow if the real thing is there to be shadowed.
		.filter((rel) => existsSync(join(root, rel)))
		.map((rel) => `${dir}${sep}${rel}`);
}

describe('repository layout', () => {
	it('has no directory shadowing the source tree', () => {
		const suspects = readdirSync(ROOT).filter(
			(e) => !IGNORED.has(e) && statSync(join(ROOT, e)).isDirectory(),
		);

		const found = suspects.flatMap((d) => shadowed(ROOT, d));

		// The message is the point: this failure has to name the copies, because
		// the confusing part is not that they are wrong but that they look right.
		expect(
			found,
			found.length
				? `These files duplicate paths in the real tree and nothing builds them:\n  ${found.join('\n  ')}`
				: '',
		).toEqual([]);
	});

	it('detects a shadow tree when there is one', () => {
		// The guard above passes on a clean checkout, which proves nothing on its
		// own — a regression test is worth what its failure demonstrates. So the
		// bug is reconstructed here against a fixture: `app/src/App.tsx` next to a
		// real `src/App.tsx` is exactly what happened.
		const fixture = join(__dirname, 'fixtures', 'shadow');
		expect(shadowed(fixture, 'app')).toEqual([join('app', 'src', 'App.tsx')]);
	});

	it('does not call a file a shadow when nothing is being shadowed', () => {
		const fixture = join(__dirname, 'fixtures', 'shadow');
		// `app/src/Only.tsx` has no counterpart in the real tree, so it is just a
		// file in a directory — not evidence of a misplaced write.
		expect(shadowed(fixture, 'other')).toEqual([]);
	});
});

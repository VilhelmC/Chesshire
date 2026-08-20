// Filenames that only work on one operating system.
//
// ---------------------------------------------------------------------------
// This exists because of a bug the build container structurally cannot catch.
//
// `src/ui/Mark.tsx` and `src/ui/mark.ts` are two different files on Linux and
// the same file on Windows and macOS. Everything typechecked, built and passed
// here; the same commit failed immediately on the machine the repo lives on,
// with an error about a filename differing "only in casing".
//
// The general shape is worth naming: **a development environment that differs
// from the target in a systematic way will never report the bugs that live in
// the difference.** No amount of testing on Linux finds this one. So it is
// checked as a property of the tree instead.
//
// The same reasoning covers the other filename rules Windows enforces and Linux
// does not — reserved device names, trailing dots, characters that are legal in
// a POSIX path and rejected by NTFS.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', '.shots', 'coverage']);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (SKIP.has(entry)) continue;
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const files = walk(ROOT).map((p) => relative(ROOT, p));

describe('filenames work on a case-insensitive filesystem', () => {
	it('has no two paths differing only in case', () => {
		const seen = new Map<string, string>();
		const clashes: string[] = [];
		for (const f of files) {
			const key = f.toLowerCase();
			const first = seen.get(key);
			if (first && first !== f) clashes.push(`${first} vs ${f}`);
			else seen.set(key, f);
		}
		expect(clashes).toEqual([]);
	});

	it('has no two MODULES in a directory whose names differ only in case', () => {
		// The comparison that actually matters, and the one the first version of
		// this test got wrong. `mark.ts` and `Mark.tsx` are different strings even
		// lowercased, because the extensions differ — but TypeScript resolves
		// `./ui/Mark` against both, and on Windows they are one file. So the key
		// is the module name: the basename with any source extension removed.
		const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
		const byDir = new Map<string, Map<string, string>>();
		const clashes: string[] = [];

		for (const f of files) {
			if (!SOURCE.test(f)) continue;
			const parts = f.split(/[\\/]/);
			const base = parts.pop() as string;
			const dir = parts.join('/');
			const moduleName = base.replace(SOURCE, '').toLowerCase();

			const inDir = byDir.get(dir) ?? new Map<string, string>();
			const first = inDir.get(moduleName);
			if (first && first !== base) clashes.push(`${dir}/${first} vs ${dir}/${base}`);
			else inDir.set(moduleName, base);
			byDir.set(dir, inDir);
		}

		expect(clashes).toEqual([]);
	});

	it('avoids names Windows reserves for devices', () => {
		// CON, PRN, AUX, NUL, COM1-9, LPT1-9 — reserved with OR without an
		// extension, so `aux.ts` is as unusable as `aux`.
		const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
		const bad = files.filter((f) => reserved.test(f.split(/[\\/]/).pop() ?? ''));
		expect(bad).toEqual([]);
	});

	it('avoids characters that are illegal in a Windows path', () => {
		// Colons and pipes in particular are easy to produce from a script and
		// silently fine on Linux.
		const illegal = /[<>:"|?*]/;
		const bad = files.filter((f) => illegal.test(f.split(/[\\/]/).pop() ?? ''));
		expect(bad).toEqual([]);
	});

	it('has no name ending in a space or a dot', () => {
		const bad = files.filter((f) => /[ .]$/.test(f.split(/[\\/]/).pop() ?? ''));
		expect(bad).toEqual([]);
	});
});

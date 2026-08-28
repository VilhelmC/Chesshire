// Shared loader for the ladder probes.
//
// RECONSTRUCTED 2026-08-28. The originals lived in an ephemeral container that
// was reclaimed; every number in offbook/FINDING-*.md and CASES-*.md came from
// them. Each probe records the figure it produced, so a re-run that disagrees is
// a finding rather than a silent drift — which is exactly the confound that cost
// this project two wrong before/after comparisons already.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function load(exports_) {
	const d = mkdtempSync(join(tmpdir(), 'lp-'));
	const e = join(process.cwd(), `.probe-${process.pid}.ts`);
	writeFileSync(e, exports_);
	const o = join(d, 'b.mjs');
	await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
	const M = await import(o);
	unlinkSync(e);
	return M;
}
export const puzzles = (n) =>
	JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, n ?? undefined);
export const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
export const promo = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
export const mk = (u) => { const m = { from: idx(u), to: idx(u.slice(2)) }; if (u[4]) m.promotion = promo[u[4]]; return m; };
export const play = (p, u) => { const n = p.clone(); n.play(mk(u)); return n; };
export const other = (c) => (c === 'white' ? 'black' : 'white');
export const shifted = (b, f, t) => { const c = b.clone(); const pc = c.take(f); if (!pc) return c; c.take(t); c.set(t, pc); return c; };
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };

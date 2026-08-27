// WHY does the price move away from the solver? Reported by cause.
//
// `line-monotone.mjs` says 54.2% of same-turn pairs along a forced line move the
// price away from the solver. That is one percentage, and PLAN.md's measurement
// discipline says a percentage is not a finding.
//
// So: decompose it. The value is material plus what the obligations imply, and
// both sides of that are readable.
//
//   g = value - material          what the obligations add, at a position
//   realised = material_C - material_A     what actually changed hands
//
// A price that is right on a forced line predicts what then happens: g_A should
// be spent down as `realised` arrives, leaving V unchanged. Where V moves away,
// either g_A promised something that never came (OVER), or g_C found something
// that was there all along and was not seen at A (UNDER).
//
// Then attributed by row kind and by whose claim it was, with the SAME
// distribution over the pairs that held steady as a control — otherwise a kind
// that is simply common reads as a cause.
//
// Also measured directly: the named suspect. A side's claims each cost it
// `deadline` of its own moves to press, and those are the same moves it needs to
// answer what is claimed against it. Nothing bills it for them. If a side is
// routinely credited with more claims than it has tempi to press, the price
// over-predicts by construction and this will show it.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'pw-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { complex, material, isLive } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { gamma, tempiLeft } from './src/domain/gamma';
export { other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};
const W = (w) => (Number.isFinite(w) ? w : 10000);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

/** Weight of collected rows, split by kind and by whether the solver claims them. */
function split(t, solver) {
	const out = {};
	for (const r of t.collected) {
		const k = `${r.kind}/${r.claimant === solver ? 'solver' : 'opponent'}`;
		out[k] = (out[k] ?? 0) + W(r.weight);
	}
	return out;
}
const add = (into, from, s = 1) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + s * v; };

const away = {}, steady = {};
let nAway = 0, nSteady = 0, over = 0, under = 0, overW = 0, underW = 0;
// The suspect.
let sides = 0, overCommitted = 0, worstOver = 0;

for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	// Ply 1, not ply 0 — the corpus is in Lichess form. See `gate.mjs`.
	const solver = pos.turn === 'white' ? 'black' : 'white';
	const sign = solver === 'white' ? 1 : -1;
	const seq = [];
	let cur = pos;
	for (let i = 0; ; i++) {
		const c = M.complex(cur, OPTS);
		const t = M.traverse(c);
		seq.push({ pos: cur, c, t, v: t.value, m: M.material(cur.board) });
		if (i >= p.moves.length) break;
		let next; try { next = play(cur, p.moves[i]); } catch { break; }
		cur = next;
	}

	// The suspect, asked of every position of every line.
	for (const s of seq) {
		for (const side of ['white', 'black']) {
			const claims = s.c.obligations.filter((r) => r.claimant === side && M.isLive(r, s.c.board) && r.deadline > 1);
			if (!claims.length) continue;
			sides++;
			// Pressing them all costs this side the sum of their travel. It has at
			// most `max(deadline)` moves before the slowest is due.
			const need = claims.reduce((n, r) => n + (r.deadline - 1), 0);
			const have = Math.max(...claims.map((r) => r.deadline)) - (s.c.turn === side ? 0 : 1);
			if (need > have) { overCommitted++; worstOver = Math.max(worstOver, need - have); }
		}
	}

	for (let i = 1; i + 2 < seq.length; i += 2) {
		const A = seq[i], C = seq[i + 2];
		const delta = sign * (C.v - A.v);
		const gA = sign * (A.v - A.m), gC = sign * (C.v - C.m);
		if (delta < 0) {
			nAway++;
			add(away, split(A.t, solver));
			// Did A promise more than arrived, or did C discover something new?
			if (gA > gC) { over++; overW += gA - gC; } else { under++; underW += gC - gA; }
		} else {
			nSteady++;
			add(steady, split(A.t, solver));
		}
	}
}

const pc = (x, n) => (n ? `${((100 * x) / n).toFixed(1)}%` : '—');
console.log(`\n${nAway + nSteady} same-turn pairs${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
console.log(`  moved away : ${nAway} (${pc(nAway, nAway + nSteady)})    held or improved : ${nSteady}`);
console.log(`\n  Of the moves away:`);
console.log(`    A promised more than arrived (OVER)  : ${over} (${pc(over, nAway)})   mean ${over ? Math.round(overW / over) : 0}`);
console.log(`    C found what A had not seen (UNDER)  : ${under} (${pc(under, nAway)})   mean ${under ? Math.round(underW / under) : 0}`);

console.log(`\n  Collected weight per pair, by row kind — moved-away vs held, as a control:`);
const keys = [...new Set([...Object.keys(away), ...Object.keys(steady)])].sort();
console.log(`    ${'kind / whose claim'.padEnd(24)} ${'away'.padStart(10)} ${'held'.padStart(10)}   ratio`);
for (const k of keys) {
	const a = (away[k] ?? 0) / (nAway || 1);
	const s = (steady[k] ?? 0) / (nSteady || 1);
	console.log(`    ${k.padEnd(24)} ${a.toFixed(0).padStart(10)} ${s.toFixed(0).padStart(10)}   ${s ? (a / s).toFixed(2) : '∞'}`);
}

console.log(`\n  THE SUSPECT — a side credited with more claims than it has tempi to press:`);
console.log(`    side-positions with a slow claim : ${sides}`);
console.log(`    of those, over-committed         : ${overCommitted} (${pc(overCommitted, sides)})   worst shortfall ${worstOver} tempi\n`);

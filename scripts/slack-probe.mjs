// Is zugzwang a fact about SLACK rather than about coverage?
//
// §3.2 states it over Γ's coverage: covered now, uncovered after every move.
// Measured on the corpus's zugzwang puzzles that condition never fires, because
// coverage is a BOOLEAN and one tempo rarely flips it. This asks whether the
// margin behind the boolean does:
//
//     slack(e) = τ*(e) − min cost of a discharge
//     slack(position) = min over e
//
// A discharge that arrives exactly on the deadline has slack 0. Spending a
// tempo costs one. So "every move puts me under" is the same sentence as §3.2's
// and is stated over a number instead of a bit.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'sp-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma } from './src/domain/cover2';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

/** The tightest margin the owed side has, over its own obligations. */
function slack(pos, owed) {
	const g = M.gamma(pos, { owed });
	if (!g.E.length) return Infinity;
	let worst = Infinity;
	for (let i = 0; i < g.E.length; i++) {
		const best = g.edges.filter((x) => x.obligation === i).reduce((m, x) => Math.min(m, x.cost), Infinity);
		worst = Math.min(worst, g.tau[i] - best);
	}
	return worst;
}

function look(label, pos) {
	const me = pos.turn;
	const now = slack(pos, me);
	const rows = [];
	for (const from of pos.board[me]) for (const to of pos.dests(from)) {
		const n = pos.clone();
		try { n.play({ from, to }); } catch { continue; }
		rows.push({ mv: sq(from) + sq(to), s: slack(n, me) });
	}
	const keeps = rows.filter((r) => r.s >= 0);
	console.log(`\n=== ${label}  (${me} to move)`);
	console.log(`   slack now = ${now}   ·   ${rows.length} moves, ${keeps.length} keep slack >= 0`);
	if (rows.length <= 14) console.log('     ' + rows.map((r) => `${r.mv}:${r.s}`).join(' '));
	else console.log('     keeps: ' + keeps.map((r) => r.mv).join(' '));
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
for (const id of ['0rXdL', 'IbeVh', 'EV5It', 'iEtBY', 'ccbrf', '7eUC2']) {
	const p = P.find((x) => x.id === id);
	if (p) look(`${id}  ${p.fen}`, M.positionFromFen(p.fen));
}
look('textbook opposition', M.positionFromFen('8/8/8/3k4/8/3K4/3P4/8 b - - 0 1'));

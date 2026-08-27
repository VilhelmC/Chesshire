// What does the stack currently see in a zugzwang? Read before designing.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'zp-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { ledger, isLive, worst } from './src/domain/ledger2';
export { gamma, cover, concede, classify2, due } from './src/domain/cover2';
export { couplings, chains } from './src/domain/couple';
export { seeValue, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

function look(label, pos) {
	const b = pos.board;
	console.log(`\n=== ${label}  (${pos.turn} to move)`);
	for (const owed of ['white', 'black']) {
		const E = M.ledger(pos, owed);
		const live = E.filter((x) => M.isLive(x, b));
		console.log(`   ${owed} owes: ${live.length ? live.map((x) => `${x.kind[0]}:${sq(x.square)}=${x.weight}/τ${x.deadline}`).join(' ') : '—'}` +
			`${E.length > live.length ? `   (+${E.length - live.length} latent)` : ''}`);
		if (live.length) {
			const g = M.gamma(pos, { owed });
			console.log(`      Γ mode=${M.classify2(g, b, owed)} worst=${M.worst(E, b)}`);
		}
	}
	console.log(`   couplings: ${M.couplings(b).length}`);
	// What every legal move does to the mover's own ledger — the successor
	// condition §3.2 states, computed by brute force HERE ONLY, to find out what
	// the shape of the answer is before deciding how to compute it without one.
	const me = pos.turn;
	const rows = [];
	for (const from of b[me]) for (const to of pos.dests(from)) {
		const n = pos.clone();
		try { n.play({ from, to }); } catch { continue; }
		rows.push({ mv: sq(from) + sq(to), w: M.worst(M.ledger(n, me), n.board) });
	}
	const safe = rows.filter((r) => r.w === 0);
	console.log(`   ${rows.length} legal moves · ${safe.length} leave nothing owed · owed now = ${M.worst(M.ledger(pos, me), b)}`);
	if (rows.length && rows.length < 40) console.log('     ' + rows.map((r) => `${r.mv}:${r.w}`).join(' '));
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const play = (p, u) => { const n = p.clone();
	n.play({ from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) }); return n; };
for (const id of ['0rXdL', 'IbeVh', 'EV5It']) {
	const p = P.find((x) => x.id === id);
	look(`${id} start`, M.positionFromFen(p.fen));
}
// A textbook zugzwang: black must move and every move loses the pawn.
look('textbook: opposition, black to move', M.positionFromFen('8/8/8/3k4/8/3K4/3P4/8 b - - 0 1'));

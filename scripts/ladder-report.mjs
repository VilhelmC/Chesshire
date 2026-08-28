// #34's GATE — what the panel will say, in text, on the nine hand-read cases.
//
// The task's terms: "each must answer WHY NOT MORE." So this prints exactly what
// the LADDER tab renders — every rung, its verdict, and its exclusion — plus the
// PROOF tab's enumeration for the rung that answered and the one above it. If a
// row here reads as a bare number with no reason beside it, the panel will too.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const d = mkdtempSync(join(tmpdir(), 'lr-'));
const e = join(process.cwd(), '.lr-entry.ts');
writeFileSync(
	e,
	`export { ladderReport, mateTree, survivingReplies } from './src/domain/ladder';
export { positionFromFen } from './src/domain/chess';
export { V } from './src/domain/exchange';
export { makeSquare } from 'chessops/util';`,
);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);

const sq = M.makeSquare;
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const PR = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };
const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const mk = (u) => {
	const m = { from: idx(u), to: idx(u.slice(2)) };
	if (u[4]) m.promotion = PR[u[4]];
	return m;
};
const nm = (m) => sq(m.from) + sq(m.to) + (m.promotion ? UCI[m.promotion] : '');
const play = (p, m) => {
	const n = p.clone();
	n.play(m);
	return n;
};
const pawns = (n) => (Number.isFinite(n) ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n / 100).toFixed(2)}` : '+∞');
const asked = (r) => (r === 'mate' ? 'mate' : `+${(r / 100).toFixed(2)}`);
const NAMED = [
	[900, 'a queen'],
	[500, 'a rook'],
	[330, 'a bishop'],
	[320, 'a knight'],
	[100, 'a pawn'],
];
const rungName = (r) => {
	if (r === 'mate') return 'the king';
	for (const [v, n] of NAMED) if (r === v) return n;
	for (const [v, n] of NAMED) if (r === v + 800) return `${n}, promoting`;
	return String(r);
};

const WANT = process.argv.slice(2).length
	? process.argv.slice(2)
	: ['1lR5W', 'ohoTK', 'K0qzR', 'ydGWl', 'yMTAV', 'TVU0i', 'SPBfy', 'WiH2C', 'vJZmr'];
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));

for (const id of WANT) {
	const p = P.find((x) => x.id === id);
	if (!p) {
		console.log(`\n${id} — NOT IN CORPUS`);
		continue;
	}
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		console.log(`\n${id} — unparseable fen`);
		continue;
	}
	pos = play(pos, mk(p.moves[0]));
	const want = p.moves[1];
	const t0 = Date.now();
	const r = M.ladderReport(pos, 3);
	const ms = Date.now() - t0;
	const hit = r.moves.some((m) => nm(m).slice(0, 4) === want.slice(0, 4));

	console.log(`\n${'═'.repeat(78)}`);
	console.log(`${id}  (${p.rating})  ${p.themes.join(' ')}   want ${want}`);
	console.log(
		`  VERDICT  ${r.value === 'mate' ? 'MATE' : pawns(r.value)}  ${r.forced ? 'forced' : 'best exchange, NOT forced'}` +
			`  via ${r.moves.slice(0, 5).map(nm).join(' ')}${r.moves.length > 5 ? ` +${r.moves.length - 5}` : ''}` +
			`   ★ ${hit ? 'FOUND' : 'missed'}   ${r.nodes} nodes, ${ms}ms`,
	);
	console.log(`  ── the LADDER tab ${'─'.repeat(58)}`);
	for (const x of r.rungs) {
		const near = x.attempts[0];
		let why = '';
		if (!x.proved) {
			if (!x.miss) why = '⚠ refuted with NO nearest attempt — no reason given';
			else if (x.rung === 'mate')
				why =
					`all ${x.attempts.length} moves answered — e.g. ${nm(x.miss.move)}` +
					(x.miss.held ? ` meets ${nm(x.miss.held)}` : '') +
					(near && !near.witness ? ' (unresolved at this depth)' : ''); else
				why = `${nm(x.miss.move)} came closest, held to ${pawns(x.miss.value)}${x.miss.held ? ` by ${nm(x.miss.held)}` : ''}`;
		}
		console.log(
			`     ${rungName(x.rung).padEnd(18)} ${(x.proved ? 'YES' : 'no ').padEnd(4)} ${asked(x.rung).padStart(7)}  ` +
				`${x.proved ? x.moves.map(nm).join(' ') : why}`,
		);
	}
	if (!r.forced)
		console.log(
			`     ${'anything at all'.padEnd(18)} —     ${pawns(r.value).padStart(7)}  ` +
				`nothing forced — best immediate exchange: ${r.moves.slice(0, 3).map(nm).join(' ')}`,
		);

	// The PROOF tab, for the rung that answered — or for the top rung when none did.
	const shown = r.rungs.find((x) => x.proved) ?? r.rungs[0];
	console.log(`  ── the PROOF tab, rung ${asked(shown.rung)} ${'─'.repeat(45)}`);
	if (shown.proved && shown.rung === 'mate') {
		const tree = M.mateTree(pos, shown.moves[0], pos.turn, 3);
		const walk = (n, d) => {
			console.log(`     ${'  '.repeat(d)}${nm(n.move)}${n.mate ? '#' : ''}${!n.mate && !n.kids.length && d % 2 === 1 ? '   ⚠ no answer within depth' : ''}`);
			for (const k of n.kids) walk(k, d + 1);
		};
		walk(tree, 0);
	} else if (shown.proved) {
		console.log(`     a minimum over every reply: whatever they play, at least ${asked(shown.rung)} is left`);
		for (const a of shown.attempts.slice(0, 5))
			console.log(`       ${nm(a.move).padEnd(6)} ${pawns(a.value).padStart(7)}  held by ${a.held ? nm(a.held) : '—'}`);
	} else {
		for (const a of shown.attempts.slice(0, 8)) {
			// THE PANEL SHOWS `≥1` HERE AND ENUMERATES ON CLICK. The gate always
			// enumerates, because a gate exists to check the expensive claim.
			let right;
			if (shown.rung === 'mate') {
				if (a.proved) right = 'MATES';
				else if (!a.witness) right = '?  unresolved at this depth';
				else {
					const all = M.survivingReplies(pos, a.move, pos.turn, 3);
					right = `${String(all.length).padStart(2)} ways out: ${all.slice(0, 8).map(nm).join(' ')}${all.length > 8 ? ` +${all.length - 8}` : ''}`;
				}
			} else
				right =
					a.value !== undefined ? `${pawns(a.value).padStart(7)} held by ${a.held ? nm(a.held) : '—'}` : ' ? unresolved';
			console.log(`       ${nm(a.move).padEnd(6)} ${right}`);
		}
		if (shown.attempts.length > 8) console.log(`       +${shown.attempts.length - 8} further attempts, all refuted`);
	}
}

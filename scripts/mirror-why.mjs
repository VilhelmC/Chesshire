// Where exactly does the reflection break? Square by square.
//
// The reflection property has caught three order-dependent tie-breaks in this
// project and is catching a fourth. Guessing at which one is what cost the last
// two attempts; this asks the pricing directly.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'mi-'));
const e = join(process.cwd(), '.mir-entry.ts');
writeFileSync(e, `export { priced, clusters, sites } from './src/domain/cluster';
export { see } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare, parseSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
/** a1 <-> a8: reflect the rank, keep the file. Matches the FEN mirror below. */
const flipSq = (s) => (7 - (s >> 3)) * 8 + (s & 7);
const mirror = (fen) => {
	const [board, turn, ...rest] = fen.split(' ');
	const flipped = board
		.split('/')
		.reverse()
		.map((r) => r.replace(/[a-zA-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())))
		.join('/');
	return [flipped, turn === 'w' ? 'b' : 'w', '-', '-', ...rest.slice(2)].join(' ');
};

for (const fen of process.argv.slice(2)) {
	const a = M.positionFromFen(fen);
	const b = M.positionFromFen(mirror(fen));
	const pa = M.priced(a.board, a.turn);
	const pb = M.priced(b.board, b.turn);
	console.log(`\n${fen}`);
	let bad = 0;
	for (const [s, v] of pa) {
		const w = pb.get(flipSq(s));
		if (v !== w) {
			bad++;
			console.log(`  ${sq(s)} = ${v}   but mirrored ${sq(flipSq(s))} = ${w}`);
		}
	}
	for (const [s, v] of pb) if (!pa.has(flipSq(s))) { bad++; console.log(`  mirror has ${sq(s)} = ${v}, original has no site at ${sq(flipSq(s))}`); }
	console.log(bad ? `  ${bad} square(s) disagree` : '  pricing mirrors exactly');

	const ca = M.clusters(a.board), cb = M.clusters(b.board);
	console.log(`  clusters ${ca.length} vs ${cb.length}; sizes ${ca.map((c) => c.sites.length).join(',')} vs ${cb.map((c) => c.sites.length).join(',')}`);
	console.log(`  contested ${ca.map((c) => c.contested.length).join(',')} vs ${cb.map((c) => c.contested.length).join(',')}`);

	// Does `see` itself mirror — the VALUE and the LINE? Nothing has ever asked
	// about the line, and everything in cluster.ts now depends on it.
	let vBad = 0, lBad = 0;
	for (const s of M.sites(a.board)) {
		const ea = M.see(a.board, s.square, s.taker);
		const eb = M.see(b.board, flipSq(s.square), s.taker === 'white' ? 'black' : 'white');
		if (ea.value !== eb.value) { vBad++; console.log(`  see VALUE differs at ${sq(s.square)}: ${ea.value} vs ${eb.value}`); }
		const la = ea.steps.filter((x) => x.happens).map((x) => sq(x.from)).join('>');
		const lb = eb.steps.filter((x) => x.happens).map((x) => sq(flipSq(x.from))).join('>');
		if (la !== lb) { lBad++; if (lBad < 5) console.log(`  see LINE differs at ${sq(s.square)}: [${la}] vs [${lb}]`); }
	}
	console.log(`  see: ${vBad} value mismatches, ${lBad} line mismatches`);
}

// Are §6's four couplings the right four? Checkpoint B, asked of real positions
// before a line of couple.ts is written. PLAN.md rules 3 and 4.
//
// Nothing here is couple.ts. It reads the EXISTING index — graph, ledger, Γ —
// and asks whether the four kinds are visible in it at all. If a kind is not
// readable off the index it needs new machinery, and that is a fact about the
// theory worth knowing before the module exists.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'cp-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { build, on, isLive, blockedBy } from './src/domain/graph';
export { ledger, isLive as owedNow } from './src/domain/ledger2';
export { gamma, cover, concede, classify2, due } from './src/domain/cover2';
export { see, seeValue, capturersOn, V, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o);
unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

function look(label, pos) {
	const board = pos.board;
	const g = M.build(board);
	console.log(`\n================ ${label}`);

	// Every square where an exchange could happen, with its participants.
	const chains = [];
	for (const s of board.occupied) {
		const w = M.on(g, s, 'white'), b = M.on(g, s, 'black');
		if (!w.length || !b.length) continue;
		const owner = board.get(s).color;
		chains.push({ square: s, owner, attackers: owner === 'white' ? b : w, defenders: owner === 'white' ? w : b,
			see: M.seeValue(board, s, owner === 'white' ? 'black' : 'white') });
	}
	console.log('  chains:');
	for (const c of chains) console.log(`    ${sq(c.square)} (${board.get(c.square).role}, ${c.owner}) see=${c.see}` +
		`  att=[${c.attackers.map(sq)}] def=[${c.defenders.map(sq)}]`);

	// 1. contested defender — one piece with duties on two chains.
	const duty = new Map();
	for (const c of chains) for (const p of c.defenders) {
		if (!duty.has(p)) duty.set(p, []);
		duty.get(p).push(c.square);
	}
	const contestedDefenders = [...duty].filter(([, ss]) => ss.length > 1);
	console.log('  contested defenders:', contestedDefenders.length
		? contestedDefenders.map(([p, ss]) => `${sq(p)} guards ${ss.map(sq).join('+')}`).join(' | ') : '—');

	// 2. contested square — one square on two edges' needs.
	const onNeeds = new Map();
	for (const ed of g.edges) for (const n of ed.needs) {
		const k = String(n);
		if (!onNeeds.has(k)) onNeeds.set(k, []);
		onNeeds.get(k).push(ed);
	}
	const chainSquares = new Set(chains.map((c) => String(c.square)));
	const contestedSquares = [...onNeeds].filter(([, es]) => new Set(es.map((x) => String(x.to))).size > 1
		&& es.some((x) => chainSquares.has(String(x.to))));
	console.log('  contested squares:', contestedSquares.length
		? contestedSquares.slice(0, 6).map(([s, es]) => `${sq(+s)} gates ${[...new Set(es.map((x) => sq(x.to)))].join('/')}`).join(' | ') : '—');

	// 3. x-ray — a blocked edge whose blocker is itself a chain participant, so
	//    resolving that chain changes this edge's existence.
	const xrays = [];
	for (const ed of g.edges) {
		if (M.isLive(ed, board)) continue;
		for (const b of M.blockedBy(ed, board)) {
			if (chainSquares.has(String(b)) || chains.some((c) => c.attackers.includes(b) || c.defenders.includes(b)))
				xrays.push(`${sq(ed.from)}->${sq(ed.to)} through ${sq(b)}`);
		}
	}
	console.log('  x-rays onto live chains:', xrays.length ? [...new Set(xrays)].slice(0, 8).join(' | ') : '—');

	// 4. harvest parity — a function of chain LENGTHS, so print them.
	console.log('  chain lengths:', chains.map((c) => `${sq(c.square)}:${M.see(board, c.square, c.owner === 'white' ? 'black' : 'white').steps.length}`).join(' ') || '—');

	for (const owed of ['white', 'black']) {
		const gam = M.gamma(pos, { owed });
		if (!gam.E.length) continue;
		console.log(`  Γ(${owed}): ${gam.E.map((x, i) => `${sq(x.square)}=${x.weight}/τ*${gam.tau[i]}${gam.coverable[i] ? '' : '!'}`).join(' ')}` +
			`  mode=${M.classify2(gam, board, owed)}`);
	}
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
for (const id of ['Uqazm', 'KSeRW']) {
	const p = P.find((x) => x.id === id);
	let pos = M.positionFromFen(p.fen);
	// The solver's position: after the opponent's first move.
	pos = play(pos, p.moves[0]);
	look(`${id} — the solver to move`, pos);
}

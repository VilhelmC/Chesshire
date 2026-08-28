// AND-NODE BRANCHING: the number PNS lives or dies on.
// OR nodes (our moves) can be narrowed — we need only one to work, and the
// ladder's attack-surface filter cuts them to ~31%. AND nodes cannot: they pick,
// so every reply must be refuted. The only thing that narrows an AND node is the
// move being FORCING — a check leaves few legal replies.
import { readFileSync } from 'node:fs';
const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8'));
const { Chess } = await import('../node_modules/chessops/dist/esm/chess.js');
const { parseFen } = await import('../node_modules/chessops/dist/esm/fen.js');
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const mk = (u) => { const m = { from: idx(u), to: idx(u.slice(2)) };
	if (u[4]) m.promotion = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]]; return m; };
const nmoves = (p) => { let n = 0; for (const d of p.allDests().values()) n += d.size(); return n; };
const stat = (a) => { const b = [...a].sort((x, y) => x - y); const q = (f) => b[Math.min(b.length - 1, Math.floor(f * b.length))];
	return `mean ${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1)}  median ${q(0.5)}  p90 ${q(0.9)}  max ${b[b.length - 1]}`; };
for (const theme of ['mateIn1','mateIn2','mateIn3']) {
	const pool = P.filter((x) => x.themes.includes(theme)).slice(0, 200);
	const before = [], after = [], checks = [];
	for (const p of pool) {
		const s = parseFen(p.fen); if (s.isErr) continue;
		const pos = Chess.fromSetup(s.value); if (pos.isErr) continue;
		let g = pos.value; g.play(mk(p.moves[0]));
		before.push(nmoves(g));
		if (p.moves.length < 2) continue;
		const h = g.clone(); h.play(mk(p.moves[1]));
		after.push(nmoves(h));
		checks.push(h.isCheck() ? 1 : 0);
	}
	console.log(`${theme.padEnd(8)} our moves at the OR node: ${stat(before)}`);
	console.log(`${''.padEnd(8)} their replies after the answer (AND node): ${stat(after)}   answer gives check ${(100*checks.reduce((s,x)=>s+x,0)/checks.length).toFixed(0)}%`);
}

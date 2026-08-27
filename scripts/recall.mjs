// Does the structure contain the winning move at all?
//
// PLAN.md gates M7's deletion on "the ledger measures better on the same
// basis". Before ranking anything it is worth asking the prior question: is the
// puzzle's answer even IN the candidate set the new stack would consider? A
// ranker cannot rescue a move that was never a candidate, and the answer tells
// you whether the gap is in §1's table or in the machinery above it — which is
// where M5's tie measurement and M6's zugzwang gap both pointed.
//
// §9.2's table says what the attacker's moves are:
//
//   adds obligations    — a new attack edge onto something worth taking
//   removes cover edges — capture, block or deflect a defender
//
// Both are reverse lookups over structures that already exist, so the candidate
// set is built from them and from nothing else. No move list is filtered.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const d = mkdtempSync(join(tmpdir(), 'rc-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { gamma, bear } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { chains, couplings } from './src/domain/couple';
export { reach, distance } from './src/domain/reach';
export { V, other, seeValue } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const uci = (m) => sq(m.from) + sq(m.to);

/**
 * The attacker's candidate moves, by reverse lookup — §9.2, both rows.
 * Returns a Map from uci to the reason it is a candidate.
 */
function candidates(pos) {
	const me = pos.turn, them = M.other(me), board = pos.board;
	const out = new Map();
	const add = (from, to, why) => { const k = sq(from) + sq(to); if (!out.has(k)) out.set(k, why); };

	// --- Collect: take something the ledger says they owe.
	const theirs = M.ledger(pos, them).filter((x) => M.isLive(x, board));
	const owed = new Set(theirs.map((x) => x.square));
	for (const s of owed) for (const p of board[me]) {
		if (p === s) continue;
		if (M.distance(M.reach(board, p, { limit: 1 }), s) === 1) add(p, s, 'collect');
	}

	// --- Add an obligation: come to BEAR on an enemy piece worth taking.
	//
	// The move must CREATE or INCREASE the threat, not merely coexist with one.
	// The first version asked only whether the square was takeable afterwards,
	// which is true of every square that was already takeable — 19.5 candidates
	// a ply at 0.51x lift, worse than picking at random. A rule that fires on
	// what was already true is not a rule.
	const before = new Map();
	for (const t of board[them]) {
		const piece = board.get(t);
		if (!piece || piece.role === 'king') continue;
		before.set(t, M.seeValue(board, t, me));
	}
	for (const p of board[me]) {
		for (const [to, dist] of M.reach(board, p, { limit: 1 }).dist) {
			if (dist !== 1) continue;
			const moved = board.clone();
			const mine = moved.take(p);
			if (!mine) continue;
			moved.take(to);
			moved.set(to, mine);
			for (const [t, was] of before) {
				if (t === to) continue; // that is `collect`, not a new threat
				if (!moved.occupied.has(t)) continue;
				if (M.seeValue(moved, t, me) > was) { add(p, to, 'threaten'); break; }
			}
		}
	}

	// --- Remove a cover edge: take a defender.
	for (const c of M.chains(board)) {
		if (c.owner !== them) continue;
		for (const dfn of c.defenders) for (const p of board[me]) {
			if (p === dfn) continue;
			if (M.distance(M.reach(board, p, { limit: 1 }), dfn) === 1) add(p, dfn, 'remove-defender');
		}
	}

	// --- Deflect: ATTACK the piece that cannot be in two places, so it has to
	// choose. Landing on it is a capture — a different move, already covered by
	// `remove-defender` — and asking for it here meant this rule never fired at
	// all over 356 plies.
	for (const cp of M.couplings(board)) {
		if (cp.kind !== 'commitment') continue;
		if (board.get(cp.piece)?.color !== them) continue;
		for (const p of board[me]) {
			if (p === cp.piece) continue;
			if (M.bear(board, p, cp.piece, M.reach(board, p, { limit: 1 })) === 1) {
				for (const [to, dist] of M.reach(board, p, { limit: 1 }).dist) {
					if (dist !== 1) continue;
					const moved = board.clone();
					const mine = moved.take(p);
					if (!mine) continue;
					moved.take(to);
					moved.set(to, mine);
					if (M.seeValue(moved, cp.piece, me) > M.seeValue(board, cp.piece, me)) add(p, to, 'deflect');
				}
			}
		}
	}
	return out;
}

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

let plies = 0, hit = 0, legal = 0, chance = 0;
const why = {}, sizes = [];
const misses = [];
const missTheme = {}, hitTheme = {};
const RULES = ['collect', 'threaten', 'remove-defender', 'deflect'];
const perRule = Object.fromEntries(RULES.map((r) => [r, { size: 0, hit: 0, chance: 0 }]));
// Recall means nothing without the selectivity it was bought at. If the
// candidate set is 21 of 28 legal moves, hitting 75% of the time is what
// picking at random would do — so the expected-by-chance rate is accumulated
// alongside, and the LIFT is the number worth reporting. Rule 5.
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const want = p.moves[i].slice(0, 4);
			const cs = candidates(pos);
			sizes.push(cs.size);
			let n = 0; for (const from of pos.board[pos.turn]) for (const _ of pos.dests(from)) n++;
			legal += n;
			chance += n ? Math.min(1, cs.size / n) : 0;
			// Per rule, because "report by cause, never by a single percentage".
			// A rule that adds candidates without adding hits is not a weak rule,
			// it is noise, and the aggregate hides which one it is.
			for (const rule of RULES) {
				const sub = [...cs].filter(([, w]) => w === rule);
				perRule[rule].size += sub.length;
				perRule[rule].chance += n ? Math.min(1, sub.length / n) : 0;
				if (sub.some(([k]) => k === want)) perRule[rule].hit++;
			}
			if (cs.has(want)) {
				hit++;
				why[cs.get(want)] = (why[cs.get(want)] ?? 0) + 1;
				for (const t of p.themes) hitTheme[t] = (hitTheme[t] ?? 0) + 1;
			} else {
				for (const t of p.themes) missTheme[t] = (missTheme[t] ?? 0) + 1;
				if (misses.length < 10) misses.push(`${p.id} ${want} (${p.themes.join(',')})`);
			}
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
sizes.sort((a, b) => a - b);
console.log(`\n${P.length} puzzles · ${plies} solver plies\n`);
console.log(`  the puzzle's move is a candidate : ${hit} (${(100*hit/plies).toFixed(1)}%)`);
console.log(`  candidate set: median ${sizes[sizes.length>>1]}, max ${sizes[sizes.length-1]}, vs ${(legal/plies).toFixed(0)} legal moves on average`);
console.log(`  expected by chance at that size  : ${(100*chance/plies).toFixed(1)}%   ->  lift ${(hit/chance).toFixed(2)}x`);
console.log(`  found because:`, JSON.stringify(why));
console.log(`\n  each rule on its own:`);
console.log(`    rule              avg size   recall   by chance   lift`);
for (const r of RULES) {
	const { size, hit, chance: c } = perRule[r];
	console.log(`    ${r.padEnd(17)} ${(size/plies).toFixed(1).padStart(6)}   ${(100*hit/plies).toFixed(1).padStart(5)}%   ${(100*c/plies).toFixed(1).padStart(6)}%   ${c ? (hit/c).toFixed(2) : '—'}x`);
}
console.log(`\n  miss rate by theme (themes with >= 6 plies):`);
const themes = [...new Set([...Object.keys(hitTheme), ...Object.keys(missTheme)])];
const rows = themes.map((t) => {
	const h = hitTheme[t] ?? 0, m = missTheme[t] ?? 0;
	return { t, n: h + m, miss: (h + m) ? m / (h + m) : 0 };
}).filter((r) => r.n >= 6).sort((a, b) => b.miss - a.miss);
for (const r of rows) console.log(`    ${r.t.padEnd(18)} ${String(r.n).padStart(4)} plies   ${(100*r.miss).toFixed(0)}% missed`);
console.log(`\n  missed, first few:`);
for (const m of misses) console.log('   ', m);

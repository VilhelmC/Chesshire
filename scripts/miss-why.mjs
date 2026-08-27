// The gate's misses, decomposed.
//
// 48.9% outright, 15.2% of answers never offered. That leaves ~30% where the
// graph NAMED the answer and the price ranked something else above it. This asks
// what that failure looks like:
//
//   RANK      where the answer lands in the ordering. Second place everywhere is
//             a different problem from scattered.
//   GAP       how much the winner beats the answer by. A one-pawn gap is a
//             mispriced row; a queen's worth is a missing one.
//   WHO       is the answer priced too LOW, or the rival too HIGH? Settled
//             against what the line actually does: the answer's child is
//             compared with the position two plies further along the solution,
//             which is the same side to move and the same reference.
//   KIND      which row kinds the rival's child collects that the answer's does
//             not — the rows doing the wrong work.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const ARR = Number(process.argv[3] ?? 0);
const d = mkdtempSync(join(tmpdir(), 'mw-'));
const e = join(process.cwd(), '.miss-entry.ts');
writeFileSync(e, `export { complex, material } from './src/domain/complex';
export { traverse } from './src/domain/traverse';
export { choose } from './src/domain/choose';
export { positionFromFen } from './src/domain/chess';
export { makeFen } from 'chessops/fen';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);
const OPTS = ARR ? { arrivalHorizon: ARR } : {};

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const idx = (u) => 'abcdefgh'.indexOf(u[0]) + 8 * (+u[1] - 1);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: idx(u), to: idx(u.slice(2)) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

const ranks = [], gaps = [];
let missed = 0, tooLow = 0, tooHigh = 0, both = 0, neither = 0, noTruth = 0;
const kinds = {};
const cases = [];
for (const p of P) {
	const seq = [];
	{
		let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
		for (let i = 0; ; i++) {
			seq.push(pos);
			if (i >= p.moves.length) break;
			let next; try { next = play(pos, p.moves[i]); } catch { break; }
			pos = next;
		}
	}
	for (let i = 1; i < p.moves.length && i < seq.length; i += 2) {
		const pos = seq[i];
		const want = { from: idx(p.moves[i]), to: idx(p.moves[i].slice(2)) };
		const { best, all } = M.choose(pos, OPTS);
		if (!all.length) continue;
		const mine = all.find((x) => x.from === want.from && x.to === want.to);
		if (!mine) continue; // a recall failure, counted elsewhere
		if (best.some((x) => x.from === want.from && x.to === want.to)) continue;
		missed++;

		const sign = pos.turn === 'white' ? 1 : -1;
		const sorted = [...all].sort((a, b) => sign * (b.value - a.value));
		ranks.push(sorted.findIndex((x) => x === mine) + 1);
		const top = sorted[0];
		gaps.push(sign * (top.value - mine.value));

		// What the line actually produces, two plies on: same side to move.
		const truth = seq[i + 2] ? M.traverse(M.complex(seq[i + 2], OPTS)).value : null;
		if (truth === null) noTruth++;
		else {
			const answerLow = sign * (truth - mine.value) > 0; // the answer is worth more than priced
			const rivalHigh = sign * (top.value - truth) > 0; // the winner promises more than the line gives
			if (answerLow && rivalHigh) both++;
			else if (answerLow) tooLow++;
			else if (rivalHigh) tooHigh++;
			else neither++;
		}

		// Which rows the winner's child collects that the answer's child does not.
		const cw = {}, ca = {};
		for (const r of top.outcome.collected) cw[r.kind] = (cw[r.kind] ?? 0) + 1;
		for (const r of mine.outcome.collected) ca[r.kind] = (ca[r.kind] ?? 0) + 1;
		for (const k of new Set([...Object.keys(cw), ...Object.keys(ca)])) {
			kinds[k] = (kinds[k] ?? 0) + ((cw[k] ?? 0) - (ca[k] ?? 0));
		}
		if (cases.length < 6)
			cases.push(`${p.id} ply ${i}  wanted ${p.moves[i]} (=${mine.value}, rank ${ranks[ranks.length - 1]}/${all.length}), chose ${sq(top.from)}${sq(top.to)} (=${top.value}), line gives ${truth}\n      ${M.makeFen(pos.toSetup())}`);
	}
}
const pc = (x) => (missed ? `${((100 * x) / missed).toFixed(1)}%` : '—');
ranks.sort((a, b) => a - b); gaps.sort((a, b) => a - b);
console.log(`\n${missed} misses where the answer WAS offered${ARR ? `, arrival horizon ${ARR}` : ', arrivals off'}`);
console.log(`  answer's rank: median ${ranks[ranks.length >> 1]}  ·  2nd place ${pc(ranks.filter((r) => r === 2).length)}  ·  worse than 4th ${pc(ranks.filter((r) => r > 4).length)}`);
console.log(`  gap to the winner: median ${gaps[gaps.length >> 1]}  ·  under 100 ${pc(gaps.filter((g) => g < 100).length)}  ·  over 500 ${pc(gaps.filter((g) => g > 500).length)}`);
console.log(`\n  Against what the line actually gives two plies on:`);
console.log(`    the answer is priced too LOW        : ${tooLow} (${pc(tooLow)})`);
console.log(`    the winner is priced too HIGH       : ${tooHigh} (${pc(tooHigh)})`);
console.log(`    both                                : ${both} (${pc(both)})`);
console.log(`    neither — the line agrees with us   : ${neither} (${pc(neither)})`);
console.log(`    no continuation to check against    : ${noTruth}`);
console.log(`\n  Rows the winner's child collects, net of the answer's child (per miss):`);
for (const [k, v] of Object.entries(kinds).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])))
	console.log(`    ${k.padEnd(12)} ${(v / (missed || 1)).toFixed(2)}`);
console.log('');
for (const x of cases) console.log(`  ${x}\n`);

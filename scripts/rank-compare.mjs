// The gate for M7's deletion: does the new stack pick the move, on the same
// basis as the frozen baseline?
//
// "Compare against the frozen baseline on identical basis — per-ply, solver
// plies only, same corpus. Never across bases." So both are asked the same
// question: of the legal moves here, which does it put first, and is that the
// puzzle's answer?
//
// The new stack's score for a move is the formalism's own: play it, then ask
// what the OPPONENT concedes — §4's L(E) computed for them. Candidates come
// from scripts/recall.mjs's reverse lookup; the ranking is the deficiency test.
// A tie at the top counts as a miss, because a puzzle cannot have a tie.
import { writeFileSync, unlinkSync, mkdtempSync, readFileSync } from 'node:fs';
import { build as esb } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const N = Number(process.argv[2] ?? 150);
const DEFER = process.argv.includes('defer');
const INVADE = process.argv.includes('invade') || process.argv.includes('lex');
const LEX = process.argv.includes('lex');
const FORCE = process.argv.includes('force');
const d = mkdtempSync(join(tmpdir(), 'rk-'));
const e = join(process.cwd(), '.probe-entry.ts');
writeFileSync(e, `export { concedes } from './src/domain/concede2';
export { attacks as attacksOf } from 'chessops/attacks';
export { gamma, bear } from './src/domain/cover2';
export { ledger, isLive } from './src/domain/ledger2';
export { chains, couplings } from './src/domain/couple';
export { reach, distance } from './src/domain/reach';
export { V, other, seeValue } from './src/domain/exchange';
export { claims } from './src/domain/cover';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);
const o = join(d, 'b.mjs');
await esb({ entryPoints: [e], bundle: true, format: 'esm', outfile: o, platform: 'node', logLevel: 'silent' });
const M = await import(o); unlinkSync(e);
const sq = (s) => M.makeSquare(s);

const P = JSON.parse(readFileSync('src/data/labPuzzles.json', 'utf8')).slice(0, N);
const play = (p, u) => { const n = p.clone(); const pr = u[4] ? {q:'queen',r:'rook',b:'bishop',n:'knight'}[u[4]] : undefined;
	const mv = { from: 'abcdefgh'.indexOf(u[0]) + 8*(+u[1]-1), to: 'abcdefgh'.indexOf(u[2]) + 8*(+u[3]-1) };
	if (pr) mv.promotion = pr; n.play(mv); return n; };

/** Every legal move, so both detectors are asked about the same set. */
function legal(pos) {
	const out = [];
	for (const from of pos.board[pos.turn]) for (const to of pos.dests(from)) out.push({ from, to: Number(to) });
	return out;
}

/**
 * The invasion row §1's table names and nothing builds — measured here before
 * any module exists, because a row worth writing has to move a number first.
 *
 * An enemy piece arriving to bear on one of yours, where the exchange there is
 * won once it does AND the piece cannot simply walk away in the same tempi.
 * Without the second condition it fires on 99.4% of plies; with it, 51.1%,
 * median one row.
 */
function invasionOwed(board, owed, horizon = 3) {
	const taker = M.other(owed);
	let worstRow = 0;
	for (const t of board[owed]) {
		const prize = board.get(t);
		if (!prize || prize.role === 'king') continue;
		if (M.seeValue(board, t, taker) > 0) continue; // already an immediate row
		let arrives = 0;
		for (const p of board[taker]) {
			const r = M.reach(board, p, { limit: horizon });
			const k = M.bear(board, p, t, r);
			if (k < 1 || k > horizon) continue;
			for (const [to, dist] of r.dist) {
				if (dist !== k) continue;
				const b = board.clone();
				const pc = b.take(p);
				if (!pc) continue;
				b.take(to);
				b.set(to, pc);
				const q = b.get(to);
				if (!q || !M.attacksOf(q, to, b.occupied).has(t)) continue;
				const v = M.seeValue(b, t, taker);
				// Discounted for distance, exactly as a deferred row is: the same
				// 0.944 per ply CHECKPOINT-M2 measured.
				if (v > 0) arrives = Math.max(arrives, v * 0.944 ** k);
			}
			if (arrives) break;
		}
		if (!arrives) continue;
		// Can it just leave?
		let escapes = false;
		for (const [to, dist] of M.reach(board, t, { limit: 1 }).dist) {
			if (dist !== 1) continue;
			const b = board.clone();
			const pc = b.take(t);
			if (!pc) continue;
			b.take(to);
			b.set(to, pc);
			if (M.seeValue(b, to, taker) <= 0) { escapes = true; break; }
		}
		if (!escapes) worstRow = Math.max(worstRow, arrives);
	}
	return worstRow;
}

/** The new stack's score: what they concede once I have moved. */
function score(pos, m) {
	const taken = pos.board.get(m.to) ? M.V[pos.board.get(m.to).role] : 0;
	let next;
	try { next = pos.clone(); next.play({ from: m.from, to: m.to, promotion: (pos.board.get(m.from)?.role === 'pawn' && (m.to >> 3 === 0 || m.to >> 3 === 7)) ? 'queen' : undefined }); }
	catch { return -Infinity; }
	// They move next, so what they concede is what I win. My own exposure after
	// the move is the same number computed for me, one ply later — which is the
	// alternation §4 already unrolls, not a second search.
	const theirs = M.concedes(next, next.turn);
	const mine = M.concedes(next, M.other(next.turn));
	// Deferred rows are not in `loss` — §4's L(E) is a single-ply formula and
	// AMEND-2-ARRIVES §5 says so. But a move that creates a promotion three
	// tempi out scores exactly zero without them, and the confidence discount
	// exists for precisely this: price them at what they are worth given how far
	// off they are, rather than at face value or at nothing.
	const hanging = (pos2, owed) => {
		const g = M.gamma(pos2, { owed });
		let n = 0;
		for (let i = 0; i < g.E.length; i++) if (!g.coverable[i] && g.tau[i] > 1) n = Math.max(n, g.E[i].weight * g.E[i].confidence);
		return n;
	};
	const later = DEFER ? hanging(next, next.turn) - hanging(next, M.other(next.turn)) : 0;
	const invade = INVADE ? invasionOwed(next.board, next.turn) - invasionOwed(next.board, M.other(next.turn)) : 0;
	// LEXICOGRAPHIC when asked for, rather than summed.
	//
	// Summed, invasion cost 8.8 points of ceiling: it broke ties, and broke more
	// of them wrongly than rightly. A threat three moves away was competing on
	// equal terms with material in hand, because it borrowed the 0.944-per-ply
	// discount that CHECKPOINT-M2 measured for DISTANCES SURVIVING — not for
	// invasions succeeding. Those are different quantities and only one of them
	// has been measured.
	//
	// As a tie-break the claim is structural instead of numeric: a deferred
	// threat never outweighs material in hand, and only speaks when the material
	// is equal. No constant to tune.
	const primary = taken + theirs.loss - mine.loss + later;
	if (!FORCE) return LEX ? { primary, invade } : primary + invade;
	// FORCING as the tie-break — the thing the theory already had and the ranking
	// did not use.
	//
	// A tie in a puzzle is impossible by definition, so a tie is a symptom. On
	// 14CuA the solution is Qf5-d5+, scored 0 and tied with g2g4 because the
	// check is answerable at no cost. One ply says they are equal; they are not,
	// and §4.4, §6.4 and §9.3 all say why.
	//
	// The count is of moves that do not simply hang the moving piece — §1.7
	// acceptance applied to the option set. NOT Mob_rel: FORMALISM §6 defines
	// that as {m : L(E) <= 0} and warns the tactical layer must not consume it,
	// on pain of circularity. This uses SEE alone, and it runs only among moves
	// the tactical layer has already scored EQUAL. Strictly downstream, so
	// nothing feeds back.
	let n = 0;
	for (const f of next.board[next.turn]) for (const t of next.dests(f)) {
		const b = next.board.clone();
		const pc = b.take(f); if (!pc) continue;
		b.take(Number(t)); b.set(Number(t), pc);
		if (M.seeValue(b, Number(t), M.other(next.turn)) <= 0) n++;
	}
	return { primary: primary + invade, force: -n };
}

let plies = 0;
const box = { fresh: { right: 0, tie: 0, blind: 0, mute: 0, inTie: 0 }, stale: { right: 0, tie: 0 } };
for (const p of P) {
	let pos; try { pos = M.positionFromFen(p.fen); } catch { continue; }
	for (let i = 0; i < p.moves.length; i++) {
		if (i > 0 && i % 2 === 1) {
			plies++;
			const want = p.moves[i].slice(0, 4);
			const ms = legal(pos);

			// --- the new stack
			const raw = ms.map((m) => ({ uci: sq(m.from) + sq(m.to), v: score(pos, m) }));
			let scored, top, best;
			if (LEX || FORCE) {
				const key = FORCE ? 'force' : 'invade';
				const p1 = Math.max(...raw.map((s) => s.v.primary));
				const lead = raw.filter((s) => s.v.primary === p1);
				const p2 = Math.max(...lead.map((s) => s.v[key]));
				scored = lead.map((s) => ({ uci: s.uci, v: s.v[key] }));
				top = p2;
				best = scored.filter((s) => s.v === top);
			} else {
				scored = raw;
				top = Math.max(...raw.map((s) => s.v));
				best = scored.filter((s) => s.v === top);
			}
			if (best.length > 1) {
				box.fresh.tie++;
				// A tie is only actionable if you know what it is tied AT. Tied at
				// zero means the detector sees nothing at all here and the fix is a
				// row in §1's table; tied above zero means it sees something and
				// cannot discriminate, and the fix is upstream of the table.
				if (top === 0) box.fresh.blind++;
				else box.fresh.mute++;
				if (best.some((b) => b.uci === want)) box.fresh.inTie++;
			} else if (best[0].uci === want) box.fresh.right++;

			// --- the frozen baseline, same question
			let rows = [];
			try { rows = M.claims(pos); } catch { rows = []; }
			if (rows.length) {
				const t = Math.max(...rows.map((r) => r.value));
				const b = rows.filter((r) => r.value === t);
				if (b.length > 1) box.stale.tie++;
				else if (sq(b[0].move.from) + sq(b[0].move.to) === want) box.stale.right++;
			} else box.stale.tie++;
		}
		try { pos = play(pos, p.moves[i]); } catch { break; }
	}
}
const pc = (n) => `${n} (${(100 * n / plies).toFixed(1)}%)`;
console.log(`\n${P.length} puzzles · ${plies} solver plies · same corpus, same question` + (DEFER ? ' · deferred rows priced' : '') + (FORCE ? ' · forcing as tie-break' : LEX ? ' · invasion as tie-break' : INVADE ? ' · invasion summed' : '') + '\n');
console.log(`                       outright        tie at the top`);
console.log(`  new stack       ${pc(box.fresh.right).padEnd(16)} ${pc(box.fresh.tie)}`);
console.log(`  frozen baseline ${pc(box.stale.right).padEnd(16)} ${pc(box.stale.tie)}`);
console.log(`\n  what the new stack's ties are tied AT:`);
console.log(`    tied at zero — sees nothing here      ${pc(box.fresh.blind)}`);
console.log(`    tied above zero — sees, cannot choose ${pc(box.fresh.mute)}`);
console.log(`    ...and the answer was in the tie      ${pc(box.fresh.inTie)}`);
console.log(`\n  ceiling if every tie were broken correctly: ${((100*(box.fresh.right+box.fresh.inTie))/plies).toFixed(1)}%`);

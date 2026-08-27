// Reverse-engineer the puzzle: is every move in the chain an argmax?
//
// ---------------------------------------------------------------------------
// Will's diagnostic, and it is much better than scoring the first move:
//
//   "Our algorithm is only correct if at every step of the answer chain it can
//    detect why that move is argmax. So really we could start by reverse
//    engineering — test that the algorithm finds argmax for both players
//    backwards through each puzzle chain."
//
// Every ply of a Lichess solution is best play for whoever moves — the solver's
// moves by construction, the opponent's because they are engine-chosen defences.
// So one puzzle is not one test, it is N tests. And walking BACKWARDS localises
// the failure: the last move of a chain needs almost no depth to see, so if the
// algorithm cannot pick it, the fault is structural rather than a horizon. The
// smallest ply-from-end that fails is where the algorithm actually breaks.
//
// Depth is set adaptively to the plies remaining, which is why this runs in
// seconds where the forward test takes minutes.
//
// Usage: node scripts/chain.mjs [puzzles] [maxDepth] [themeFilter]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 400);
const MAXD = Number(process.argv[3] ?? 6);
const ONLY = process.argv[4] ?? null;
const FLIP = process.argv[5] === 'flip';
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));

/**
 * Adjudicate a "miss" with the engine.
 *
 * A material search and an engine do not answer the same question: near the end
 * of a chain the position is often already won, and the engine's move may be a
 * consolidating one worth no material at all. So before calling a disagreement a
 * defect, ask a referee whether the two moves actually differ in value.
 *
 * One process per move, one `go`, and the score read from the LAST info line.
 * The first version of this batched several `searchmoves` commands into one
 * process and matched `searchmoves` in the OUTPUT — which Stockfish never echoes,
 * so every score parsed as 0 and every disagreement came back "tie". A broken
 * referee that always agrees is worse than none.
 */
function evalMove(fen, mv, depth = 12) {
	if (!ENGINE) return Promise.resolve(null);
	return new Promise((resolve) => {
		const proc = spawn(ENGINE);
		let out = '';
		const timer = setTimeout(() => {
			proc.kill();
			resolve(null);
		}, 15_000);
		proc.stdout.on('data', (c) => {
			out += c.toString();
			if (!out.includes('bestmove')) return;
			clearTimeout(timer);
			proc.kill();
			let cp = null;
			for (const l of out.split('\n')) {
				const m = /score (cp|mate) (-?\d+)/.exec(l);
				if (m) cp = m[1] === 'mate' ? (Number(m[2]) > 0 ? 10000 : -10000) : Number(m[2]);
			}
			resolve(cp);
		});
		proc.stdin.write(`uci\nisready\nposition fen ${fen}\ngo depth ${depth} searchmoves ${mv}\n`);
	});
}

const dir = mkdtempSync(join(tmpdir(), 'chain-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves, obliging, allMoves } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, obliging, allMoves, positionFromFen, parseSquare, makeSquare } = await import(outfile);

const FILES = 'abcdefgh';
const LETTER = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
/** Board part of a FEN, plus side to move — enough for the engine. */
function fenOf(pos) {
	const rows = [];
	for (let r = 7; r >= 0; r--) {
		let row = '';
		let gap = 0;
		for (let f = 0; f < 8; f++) {
			const piece = pos.board.get(r * 8 + f);
			if (!piece) {
				gap++;
				continue;
			}
			if (gap) row += gap;
			gap = 0;
			const ch = LETTER[piece.role];
			row += piece.color === 'white' ? ch.toUpperCase() : ch;
		}
		if (gap) row += gap;
		rows.push(row);
	}
	return `${rows.join('/')} ${pos.turn === 'white' ? 'w' : 'b'} - - 0 1`;
}

const uci = (m) =>
	`${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? (m.promotion[0] === 'k' ? 'n' : m.promotion[0]) : ''}`;

function play(pos, u) {
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	const next = pos.clone();
	next.play(promo ? { from, to, promotion: promo } : { from, to });
	return next;
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');

// Buckets: by ply-from-end, and by whose move it is.
const byPly = new Map();
const byRole = { solver: { n: 0, ok: 0 }, opponent: { n: 0, ok: 0 } };
const firstFail = new Map(); // smallest failing ply-from-end, per puzzle
const examples = [];

let puzzles = 0;

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [, fen, movesStr, , , , , themesStr] = csv;
	const themes = (themesStr ?? '').split(' ').filter(Boolean);
	if (ONLY && !themes.includes(ONLY)) continue;

	const mv = movesStr.split(' ');
	if (mv.length < 2) continue;

	// Build every position along the chain.
	let pos;
	try {
		pos = positionFromFen(fen);
	} catch {
		continue;
	}
	const at = [];
	let ok = true;
	for (const u of mv) {
		at.push(pos);
		try {
			pos = play(pos, u);
		} catch {
			ok = false;
			break;
		}
	}
	if (!ok) continue;

	puzzles++;
	const n = mv.length;
	let smallestFail = null;

	// Backwards, skipping index 0 — that one is the blunder and is meant to be bad.
	for (let i = n - 1; i >= 1; i--) {
		const plyFromEnd = n - i; // 1 = the final move of the chain
		// Fixed depth. Scaling it to plies-remaining assumed the last move of a
		// chain needs no lookahead — but a chain ends when the position is decided,
		// not when the tactics stop, so its final move is often justified several
		// plies later. Adaptive depth dressed horizon failures up as structural ones.
		const depth = MAXD;
		// EXPERIMENT: on a ply where the mover is defending, hand "attacker" to the
		// other side so the defender's move list stays complete at depth.
		const defending = i % 2 === 0;
		const { scored } = scoreMoves(
			at[i],
			depth,
			undefined,
			FLIP && defending ? (at[i].turn === 'white' ? 'black' : 'white') : undefined,
		);
		if (!scored.length) continue;

		const top = scored[0].score;
		const played = scored.find((s) => uci(s.move) === mv[i]);
		const hit = played !== undefined && played.score === top;

		// The solver moves on odd indices (index 0 is the opponent's blunder).
		const role = i % 2 === 1 ? 'solver' : 'opponent';
		byRole[role].n++;
		if (hit) byRole[role].ok++;

		// Where does the played move RANK, not just "is it first"? If it is almost
		// always in the top few, the remaining problem is ranking precision among
		// moves the model scores as near-equal — a very different problem from not
		// seeing the tactic at all.
		const rank = scored.findIndex((x) => uci(x.move) === mv[i]) + 1;
		if (!byPly.has(plyFromEnd)) byPly.set(plyFromEnd, { n: 0, ok: 0, top3: 0, top5: 0, gap: 0 });
		const b = byPly.get(plyFromEnd);
		b.n++;
		if (hit) b.ok++;
		if (rank >= 1 && rank <= 3) b.top3++;
		if (rank >= 1 && rank <= 5) b.top5++;
		if (!hit) b.gap += top - (played?.score ?? 0);

		if (!hit) {
			smallestFail = plyFromEnd;
			if (plyFromEnd <= 2 && examples.length < 25) {
				examples.push({
					fen: at[i].toSetup ? undefined : undefined,
					posFen: fenOf(at[i]),
					ply: plyFromEnd,
					role,
					played: mv[i],
					playedScore: played?.score ?? 'n/a',
					mine: uci(scored[0].move),
					best: scored.slice(0, 3).map((s) => `${uci(s.move)}=${s.score}`).join(' '),
					obliging: obliging(at[i]).length,
					legal: allMoves(at[i]).length,
					themes: themes.join(' '),
				});
			}
		}
	}
	firstFail.set(puzzles, smallestFail);
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '—');

console.log(`\npuzzles: ${puzzles}   max depth: ${MAXD}\n`);
console.log('-- by ply from the end of the chain (1 = the last move played) --');
for (const k of [...byPly.keys()].sort((a, b) => a - b)) {
	const b = byPly.get(k);
	if (b.n < 10) continue;
	const avgGap = b.n - b.ok > 0 ? Math.round(b.gap / (b.n - b.ok)) : 0;
	console.log(
		`  ply -${String(k).padStart(2)}   n=${String(b.n).padStart(5)}   argmax ${pct(b.ok, b.n).padStart(4)}` +
			`   top3 ${pct(b.top3, b.n).padStart(4)}   top5 ${pct(b.top5, b.n).padStart(4)}` +
			(avgGap ? `   avg miss by ${avgGap}` : ''),
	);
}

console.log('\n-- by whose move it is --');
for (const [k, v] of Object.entries(byRole)) {
	console.log(`  ${k.padEnd(9)} n=${String(v.n).padStart(5)}   argmax ${pct(v.ok, v.n)}`);
}

const clean = [...firstFail.values()].filter((v) => v === null).length;
console.log(`\nchains correct at EVERY ply: ${clean}/${puzzles} = ${pct(clean, puzzles)}`);
const dist = new Map();
for (const v of firstFail.values()) if (v !== null) dist.set(v, (dist.get(v) ?? 0) + 1);
console.log('first break, by ply from end:');
for (const k of [...dist.keys()].sort((a, b) => a - b)) console.log(`  -${k}: ${dist.get(k)}`);

console.log('\n-- failures nearest the end, adjudicated --');
let ties = 0;
let real = 0;
for (const e of examples) {
	const a = await evalMove(e.posFen, e.played);
	const b = await evalMove(e.posFen, e.mine);
	const verdict =
		a === null || b === null ? '?' : Math.abs(a - b) <= 50 ? 'TIE — both fine' : b > a ? 'MINE BETTER' : 'REAL MISS';
	if (verdict.startsWith('TIE')) ties++;
	else if (verdict === 'REAL MISS') real++;
	console.log(`  ${e.posFen}`);
	console.log(
		`    ply -${e.ply} (${e.role})  played ${e.played}=${e.playedScore} [engine ${a}]  mine ${e.mine} [engine ${b}]  ${verdict}`,
	);
	console.log(`      obliging ${e.obliging}/${e.legal}   ${e.themes}`);
}
console.log(`\nof ${examples.length} near-end failures: ${ties} were ties, ${real} were real misses`);

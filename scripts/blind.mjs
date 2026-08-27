// What is the evaluation blind to?
//
// ---------------------------------------------------------------------------
// Failing to find the argmax means the evaluation is missing something. This
// collects real misses near the END of a chain — where depth cannot be the
// excuse — adjudicates each with the engine so ties are not counted as faults,
// and then asks a structural question of the move that was played:
//
//   what does this move DO that a material count cannot see?
//
// Each miss is tagged with features computed from the position, not guessed:
// does it check, capture, trap a piece, leave the opponent with an obligation
// they cannot cover, threaten mate. The tally over many misses is the list of
// things the evaluation does not account for.
//
// Usage: node scripts/blind.mjs [puzzles] [maxPlyFromEnd]
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT = Number(process.argv[2] ?? 300);
const MAXPLY = Number(process.argv[3] ?? 2);
const FIXED = Number(process.argv[4] ?? 6);
const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish'].find((p) => existsSync(p));

const dir = mkdtempSync(join(tmpdir(), 'blind-'));
const entry = join(dir, 'entry.ts');
writeFileSync(
	entry,
	`export { scoreMoves, allMoves, obliging } from ${JSON.stringify(join(process.cwd(), 'src/domain/resolve.ts'))};
	 export { cover, obligations, harvest } from ${JSON.stringify(join(process.cwd(), 'src/domain/tactics.ts'))};
	 export { see, V, other } from ${JSON.stringify(join(process.cwd(), 'src/domain/exchange.ts'))};
	 export { positionFromFen, parseSquare, makeSquare } from ${JSON.stringify(join(process.cwd(), 'src/domain/chess.ts'))};`,
);
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile, platform: 'node', logLevel: 'silent' });
const { scoreMoves, allMoves, cover, obligations, harvest, see, V, other, positionFromFen, parseSquare, makeSquare } =
	await import(outfile);

const LETTER = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
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

function toMove(u) {
	const from = parseSquare(u.slice(0, 2));
	const to = parseSquare(u.slice(2, 4));
	const promo = u[4] ? { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[u[4]] : undefined;
	return promo ? { from, to, promotion: promo } : { from, to };
}
const play = (pos, u) => {
	const n = pos.clone();
	n.play(toMove(u));
	return n;
};

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

// ---------------------------------------------------------------------------
// Structural features of a move — what it does, beyond what it takes.
// ---------------------------------------------------------------------------
function features(pos, u) {
	const before = pos;
	let after;
	try {
		after = play(pos, u);
	} catch {
		return ['illegal'];
	}
	const me = before.turn;
	const them = other(me);
	const tags = [];

	if (before.board.get(toMove(u).to) !== undefined) tags.push('capture');
	if (after.isCheck()) tags.push('check');
	if (toMove(u).promotion) tags.push('promotion');

	// Does it leave them with something they cannot cover? (FORMALISM §3.3)
	const v = cover(after);
	if (v.obligations.length && v.cover === null && Number.isFinite(v.concession) && v.concession > 0) {
		tags.push('leaves-uncoverable');
	}

	// Does it trap a piece — attacked, and every square it can reach is worse?
	// FORMALISM §3.4's `trapped`, which the material search cannot see until the
	// capture actually happens.
	const probe = after.clone();
	probe.turn = them;
	let trapped = false;
	for (const s of after.board[them]) {
		const piece = after.board.get(s);
		if (!piece || piece.role === 'king' || piece.role === 'pawn') continue;
		if (see(after.board, s, me).value <= 0) continue;
		let escape = false;
		let dests;
		try {
			dests = probe.dests(s);
		} catch {
			continue;
		}
		for (const to of dests) {
			const moved = probe.clone();
			try {
				moved.play({ from: s, to });
			} catch {
				continue;
			}
			if (see(moved.board, to, me).value < V[piece.role]) {
				escape = true;
				break;
			}
		}
		if (!escape) {
			trapped = true;
			break;
		}
	}
	if (trapped) tags.push('traps-a-piece');

	// Does it threaten mate next move?
	let mateThreat = false;
	const idle = after.clone();
	idle.turn = me;
	for (const m of allMoves(idle)) {
		const t = idle.clone();
		try {
			t.play(m);
		} catch {
			continue;
		}
		if (t.isCheckmate()) {
			mateThreat = true;
			break;
		}
	}
	if (mateThreat) tags.push('threatens-mate');

	// Does it threaten material — and does the threat SURVIVE their best reply?
	//
	// "Creates a threat" on its own is nearly tautological: most decent moves
	// threaten something. The discriminating question is whether they can answer
	// it. An unstoppable threat is material already won, which is exactly what a
	// material search scores at zero until the capture lands.
	const bare = harvest(idle).value;
	if (bare > 0) {
		let worst = bare;
		for (const r of allMoves(after)) {
			const t = after.clone();
			try {
				t.play(r);
			} catch {
				continue;
			}
			const back = t.clone();
			back.turn = me;
			const h = harvest(back).value;
			if (h < worst) worst = h;
			if (worst <= 0) break;
		}
		tags.push(worst > 0 ? `threat-unanswerable(${worst})` : 'threat-answerable');
	}

	return tags.length ? tags : ['quiet-nothing-obvious'];
}

const rows = readFileSync('data/puzzle_sample.csv', 'utf8').trim().split('\n');
const tally = new Map();
const discriminating = new Map();
const shown = [];
let puzzles = 0;
let misses = 0;
let ties = 0;

for (const line of rows) {
	if (puzzles >= LIMIT) break;
	const csv = line.split('|').slice(2).join('|').split(',');
	const [, fen, movesStr, , , , , themesStr] = csv;
	const mv = movesStr.split(' ');
	if (mv.length < 2) continue;

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
	for (let i = n - 1; i >= 1; i--) {
		const plyFromEnd = n - i;
		if (plyFromEnd > MAXPLY) break;
		// Fixed, NOT adaptive to ply-from-end. The first version scaled depth to
		// the plies remaining in the chain, on the assumption that the last move
		// needs no lookahead. That is false: a chain ends when the position is
		// decided, not when the tactics stop, and the final move is often justified
		// several plies past the end. Adaptive depth made horizon failures look
		// structural.
		const depth = FIXED;
		const { scored } = scoreMoves(at[i], depth);
		if (!scored.length) continue;
		const top = scored[0].score;
		const played = scored.find((s) => uci(s.move) === mv[i]);
		if (played && played.score === top) continue;

		const posFen = fenOf(at[i]);
		const a = await evalMove(posFen, mv[i]);
		const b = await evalMove(posFen, uci(scored[0].move));
		if (a === null || b === null || Math.abs(a - b) <= 50) {
			ties++;
			continue;
		}
		if (b > a) continue; // my move is genuinely better; the puzzle line is not unique here
		misses++;

		// Tag BOTH moves. A feature that fires on the played move and on mine
		// equally is not a blind spot — it is just a property of good moves.
		const tags = features(at[i], mv[i]);
		const mineTags = features(at[i], uci(scored[0].move));
		const norm = (t) => t.replace(/\(-?\d+\)/, '');
		const mineSet = new Set(mineTags.map(norm));
		for (const t of tags) {
			const k = norm(t);
			tally.set(k, (tally.get(k) ?? 0) + 1);
			if (!mineSet.has(k)) discriminating.set(k, (discriminating.get(k) ?? 0) + 1);
		}
		if (shown.length < 12) {
			shown.push({
				posFen,
				ply: plyFromEnd,
				played: mv[i],
				mineScore: top,
				playedScore: played?.score ?? 'n/a',
				mine: uci(scored[0].move),
				engineGap: a - b,
				tags: tags.join(' '),
			mineTags: mineTags.join(' '),
				themes: themesStr,
			});
		}
	}
}

console.log(`\npuzzles ${puzzles}   real misses within ${MAXPLY} plies of the end: ${misses}   (ties skipped: ${ties})\n`);
console.log('-- features of the PLAYED move --');
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${k.padEnd(26)} ${String(v).padStart(3)}  (${((v / misses) * 100).toFixed(0)}%)`);
}
console.log('\n-- DISCRIMINATING: present on the played move, absent on mine --');
for (const [k, v] of [...discriminating].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${k.padEnd(26)} ${String(v).padStart(3)}  (${((v / misses) * 100).toFixed(0)}% of misses)`);
}
console.log('\n-- examples --');
for (const e of shown) {
	console.log(`  ${e.posFen}`);
	console.log(
		`    ply -${e.ply}  played ${e.played} (mine scored it ${e.playedScore})  ` +
			`I chose ${e.mine}=${e.mineScore}  engine prefers played by ${e.engineGap}cp`,
	);
	console.log(`      played: ${e.tags}`);
	console.log(`      mine:   ${e.mineTags}`);
}

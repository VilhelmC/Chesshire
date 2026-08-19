// Build the bundled opening index.
//
// ---------------------------------------------------------------------------
// Source: the `chess-eco-codes` npm package (MIT, Kevin Ludwig), itself derived
// from the eco.pgn shipped with pgn-extract. It maps FEN -> {eco, name, moves}.
//
// We do not want the FENs: a position is recoverable from its moves, and the
// keys are two thirds of the file. What we want is the reverse direction —
// NAME -> moves — so you can type "scotch schmidt" and get a position to train
// from. So this strips it to `[eco, name, moves]` triples.
//
// Every entry is validated by replaying it. A name that maps to a move sequence
// that will not play is worse than a missing name: it would pin the trainer to a
// position that does not exist.
//
//   npm i -D chess-eco-codes && npm run openings
//
// Deliberately NOT a devDependency: it is needed once, to regenerate, and the
// output is committed. Same reasoning as playwright for scripts/board-check.mjs
// — a `npm i` should not pull hundreds of megabytes for tools most runs of this
// repo never touch.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';

const SRC = 'node_modules/chess-eco-codes/codes.json';
const OUT = 'src/data/openings.json';

const INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** SAN tokens from a PGN-ish move string, or null if it will not play. */
function sansOf(moves) {
	const tokens = moves
		.replace(/\d+\.(\.\.)?/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	const pos = Chess.fromSetup(parseFen(INITIAL).unwrap()).unwrap();
	const out = [];
	for (const t of tokens) {
		const move = parseSan(pos, t);
		if (!move) return null;
		pos.play(move);
		out.push(t);
	}
	return out.length ? out : null;
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

// Same name, several move orders: keep the shortest, which is the one a learner
// means by the name. The others are transpositions into it.
const byName = new Map();
let rejected = 0;

for (const { eco, name, moves } of Object.values(raw)) {
	const sans = sansOf(moves);
	if (!sans) {
		rejected++;
		continue;
	}
	const key = name.toLowerCase();
	const prev = byName.get(key);
	if (!prev || sans.length < prev.sans.length) byName.set(key, { eco, name, sans });
}

const list = [...byName.values()]
	.sort((a, b) => a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name))
	.map((o) => [o.eco, o.name, o.sans.join(' ')]);

writeFileSync(OUT, JSON.stringify(list));

console.log(
	`${list.length} openings written to ${OUT}` +
		` (${Object.keys(raw).length} source rows, ${rejected} unplayable, ` +
		`${Object.keys(raw).length - rejected - list.length} duplicate names dropped)`,
);

// WHICH CONDITION IS DOING THE WORK? — the pin detector, taken apart.
//
// ---------------------------------------------------------------------------
// `m5-gate.mjs` gave the first reading and it was not good. Against the forks
// detector's +50.5% LIFT on a 2.4% decoration rate, the best pin row managed
// +11.6% on 9.2%, and two rows came in at the base rate:
//
//     a pin created by the answer      LIFT +11.6%   decoration  9.2%
//     a RELATIVE pin only              LIFT  +1.5%   decoration  8.0%
//     a skewer                         LIFT  +1.0%   decoration  3.3%
//
// The gap between the first two rows is the finding to chase: the combined row
// is eight times the lift of the relative-only row, which says the signal is in
// the ABSOLUTE case and the value comparison is carrying almost nothing.
//
// The forks detector earned its numbers from three conditions, of which two were
// about worth and survival rather than geometry. The pin detector as written has
// essentially one condition — the ray — so the honest next step is to ask which
// of the analogous conditions, if any, pays.
//
// RULE 7: ablate before building the next mechanism. This is that, run before
// anything ships rather than after, because the first reading was weak enough
// that "does it ship at all" is still an open question.
//
// Every variant is a FILTER over the same collected pins. Nothing in
// `primitives/pin.ts` changes until this says which conditions to keep — a
// measurement that requires editing the thing being measured is not one.
// ---------------------------------------------------------------------------
import { load, puzzles, play, mean } from './_ladder-lib.mjs';

const N = Number(process.argv[2] ?? 1031);

const M = await load(`export { pinsCreated } from './src/domain/primitives/pin';
export { moves } from './src/domain/primitives/core';
export { seeValue, capturersOn, V, other } from './src/domain/exchange';
export { positionFromFen } from './src/domain/chess';
export { makeSquare } from 'chessops/util';`);

const UCI = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
const nm = (m) => M.makeSquare(m.from) + M.makeSquare(m.to) + (m.promotion ? UCI[m.promotion] : '');
const same = (m, uci) => nm(m).slice(0, 4) === uci.slice(0, 4);

const rows = [];
let done = 0;

for (const p of puzzles(N)) {
	let pos;
	try {
		pos = M.positionFromFen(p.fen);
	} catch {
		continue;
	}
	for (let i = 0; i < p.moves.length; i++) {
		if (i % 2 === 1) {
			const answer = p.moves[i];
			let made = [];
			try {
				const mv = M.moves(pos).find((m) => same(m, answer));
				if (mv) {
					const us = pos.turn;
					const them = M.other(us);
					const child = pos.clone();
					child.play(mv);
					made = M.pinsCreated(pos, mv).map((pin) => ({
						kind: pin.kind,
						stake: pin.stake === Infinity ? 1e9 : pin.stake,
						// CAN THE PINNER SIMPLY BE TAKEN? The fork detector's condition 2,
						// which was its single largest source of false positives. If it
						// applies here at all it should show up as lift.
						pinnerSafe: M.seeValue(child.board, pin.pinner, them) <= 0,
						// CAN WE PILE ON? A pinned man cannot run, so a second attacker
						// wins it. A pin nobody else can reach is geometry — the shield
						// sits there and nothing happens. This is the condition the fork
						// detector spends most of its work on, in the other direction.
						piled: M.capturersOn(child.board, pin.shield, us).length >= 2,
						// IS THE SHIELD WORTH ANYTHING? A pinned pawn is a fact about the
						// board and rarely a lesson.
						shieldValue: (() => {
							const s = child.board.get(pin.shield);
							return s ? M.V[s.role] : 0;
						})(),
					}));
				}
			} catch {
				/* an empty result is a legitimate reading */
			}
			rows.push({ id: p.id, rating: p.rating, themes: p.themes, left: p.moves.length - i, made });
		}
		try {
			pos = play(pos, p.moves[i]);
		} catch {
			break;
		}
	}
	if (++done % 200 === 0) process.stderr.write(`  ${done} puzzles, ${rows.length} plies\n`);
}

// ---------------------------------------------------------------------------
const ratingBucket = (r) => Math.min(6, Math.floor((r - 400) / 400));
const leftBucket = (l) => (l <= 1 ? 1 : l <= 3 ? 3 : l <= 5 ? 5 : 7);
const cellOf = (row) => `${ratingBucket(row.rating)}|${leftBucket(row.left)}`;

function score(name, theme, keep) {
	const fires = (r) => r.made.some(keep);
	const labelled = (r) => r.themes.includes(theme);
	const fired = rows.filter(fires);
	const has = rows.filter(labelled).length;
	const hit = fired.filter(labelled).length;
	const precision = fired.length ? hit / fired.length : 0;

	const cache = {};
	let num = 0;
	let den = 0;
	for (const r of fired) {
		const c = cellOf(r);
		if (!(c in cache)) {
			const cell = rows.filter((x) => cellOf(x) === c);
			cache[c] = cell.length >= 20 ? mean(cell.map((x) => (labelled(x) ? 1 : 0))) : null;
		}
		if (cache[c] !== null) {
			num += cache[c];
			den++;
		}
	}
	const expected = den ? num / den : null;
	const unl = rows.filter((r) => !labelled(r));
	const deco = unl.filter(fires).length / Math.max(1, unl.length);
	const lift = expected === null ? null : precision - expected;

	console.log(
		`  ${name.padEnd(38)} ${String(fired.length).padStart(5)} ${((100 * hit) / Math.max(1, has)).toFixed(1).padStart(6)}% ${(100 * precision).toFixed(1).padStart(7)}% ${
			lift === null ? '     —' : ((lift > 0 ? '+' : '') + (100 * lift).toFixed(1)).padStart(7)
		}% ${(100 * deco).toFixed(1).padStart(7)}%`,
	);
	return lift;
}

console.log(`\n  ${rows.length} solver plies from ${done} puzzles\n`);
console.log(`  ${'variant'.padEnd(38)} ${'fires'.padStart(5)} ${'recall'.padStart(7)} ${'prec'.padStart(7)} ${'LIFT'.padStart(8)} ${'deco'.padStart(8)}`);
console.log(`  ${'─'.repeat(38)} ───── ─────── ─────── ──────── ────────`);

const isPin = (x) => x.kind === 'absolute' || x.kind === 'relative';

console.log(`\n  against the \`pin\` theme:`);
score('geometry only (as built)', 'pin', isPin);
score('absolute only', 'pin', (x) => x.kind === 'absolute');
score('relative only', 'pin', (x) => x.kind === 'relative');
score('+ the pinner survives', 'pin', (x) => isPin(x) && x.pinnerSafe);
score('+ we can pile on the shield', 'pin', (x) => isPin(x) && x.piled);
score('+ the shield is a real piece', 'pin', (x) => isPin(x) && x.shieldValue >= 300);
score('+ pinner survives AND we pile on', 'pin', (x) => isPin(x) && x.pinnerSafe && x.piled);
score('+ all three', 'pin', (x) => isPin(x) && x.pinnerSafe && x.piled && x.shieldValue >= 300);
score('absolute + pile on', 'pin', (x) => x.kind === 'absolute' && x.piled);
score('absolute + pile on + real piece', 'pin', (x) => x.kind === 'absolute' && x.piled && x.shieldValue >= 300);

// IS THE RELATIVE PIN'S FAILURE THE CONCEPT, OR MY DEFINITION OF IT?
//
// "V[behind] > V[front]" fires on a pawn shielding a knight, which is not what
// anybody means by a relative pin. If the concept is sound and the definition is
// loose, the conditions should rescue it the way they rescue nothing else. If it
// stays at the base rate however it is narrowed, the concept does not survive.
console.log(`\n  the relative pin, narrowed every way available:`);
const rel = (x) => x.kind === 'relative';
score('relative, bare', 'pin', rel);
score('relative + pinner survives', 'pin', (x) => rel(x) && x.pinnerSafe);
score('relative + pile on', 'pin', (x) => rel(x) && x.piled);
score('relative + real piece', 'pin', (x) => rel(x) && x.shieldValue >= 300);
score('relative + all three', 'pin', (x) => rel(x) && x.pinnerSafe && x.piled && x.shieldValue >= 300);
score('relative + stake is a queen', 'pin', (x) => rel(x) && x.stake >= 900);

console.log(`\n  against the \`skewer\` theme:`);
score('geometry only (as built)', 'skewer', (x) => x.kind === 'skewer');
score('+ the pinner survives', 'skewer', (x) => x.kind === 'skewer' && x.pinnerSafe);
score('+ we can pile on the shield', 'skewer', (x) => x.kind === 'skewer' && x.piled);

// RULE 8: A SPLIT IS CONFOUNDED UNTIL A CONTROL SAYS OTHERWISE.
//
// +43.6% against `pin` is only a finding about pins if it is NOT +43.6% against
// everything. A detector that fires on the answers to hard puzzles would lift
// every theme at once, and would look exactly like this on one row.
console.log(`\n  the control: does the same row predict UNRELATED themes?`);
const abs = (x) => x.kind === 'absolute';
for (const t of ['fork', 'backRankMate', 'advancedPawn', 'sacrifice', 'skewer', 'discoveredAttack'])
	score(`absolute pin created  [vs ${t}]`, t, abs);

console.log(`\n  A condition earns its place by moving LIFT up or DECO down. One that`);
console.log(`  moves neither is deleted — Rule 9, and the reasoning kept in the file.\n`);
process.exit(0);

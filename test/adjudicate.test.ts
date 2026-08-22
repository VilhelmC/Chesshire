// The fixtures, checked against a real engine instead of against my reasoning.
//
// ---------------------------------------------------------------------------
// Every wrong answer this module has produced was one I had talked myself into.
// The exchange fold backed up from the wrong side; the defender was allowed to
// spend tempi only on co-operating; a "pin" was repaired by a check I had not
// looked for. In each case the code agreed with my derivation and both were
// wrong together.
//
// So the fixtures are adjudicated. Stockfish evaluates the position; the claim
// has to agree with it in DIRECTION and rough size. This cannot make the model
// right, but it makes it impossible for a fixture to be quietly wrong — which
// is the failure that wasted the last two rounds.
//
// Skipped when no engine binary is present, so the suite still runs on a
// machine that does not have one.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { contest, VALUE } from '../src/domain/contest';
import { positionFromFen, parseSquare } from '../src/domain/chess';
import type { Chess } from 'chessops/chess';
import type { Square } from 'chessops/types';
import { PRESETS } from '../src/views/labPresets';

const ENGINE = ['/usr/games/stockfish', '/usr/bin/stockfish', '/usr/local/bin/stockfish'].find(
	(p) => existsSync(p),
);

/**
 * Ask the engine, keeping stdin open until it answers.
 *
 * Piping every command at once and letting stdin close does NOT work: Stockfish
 * reads EOF as a quit, abandons the search and prints a bestmove from nothing.
 * It looks exactly like a completed search returning 0cp, which is how the first
 * version of this file "confirmed" every fixture at once.
 */
function ask(fen: string, depth = 16): Promise<{ cp: number; best: string; pv: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ENGINE as string);
		let out = '';
		const done = (e?: Error) => {
			proc.kill();
			if (e) return reject(e);
			let cp = 0;
			let pv = '';
			for (const line of out.split('\n')) {
				const m = /score (cp|mate) (-?\d+)/.exec(line);
				if (m) cp = m[1] === 'mate' ? (Number(m[2]) > 0 ? 10_000 : -10_000) : Number(m[2]);
				const p = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(line);
				if (p) pv = p[1].trim();
			}
			resolve({ cp, pv, best: /bestmove (\S+)/.exec(out)?.[1] ?? '' });
		};

		const timer = setTimeout(() => done(new Error('engine timed out')), 60_000);
		proc.stdout.on('data', (chunk: Buffer) => {
			out += chunk.toString();
			if (out.includes('bestmove')) {
				clearTimeout(timer);
				done();
			}
		});
		proc.on('error', (e) => {
			clearTimeout(timer);
			done(e as Error);
		});
		proc.stdin.write(`uci\nisready\nposition fen ${fen}\ngo depth ${depth}\n`);
	});
}

/**
 * Does the engine's own line win material AT THIS SQUARE?
 *
 * Walk the principal variation to the first capture that lands on the target,
 * take the material balance there, play out the exchange on that square, and
 * take it again. Only what happens on the square is counted — attributing a
 * bishop won two moves earlier to this square is precisely the error the whole
 * of `knot.ts` exists to avoid, and a referee that makes it cannot detect it.
 */
function pvWinsAt(fen: string, pv: string, target: string, plies = 4): boolean {
	if (!pv) return false;
	const moves = pv.split(/\s+/);
	let pos: Chess;
	try {
		pos = positionFromFen(fen);
	} catch {
		return false;
	}
	const mover = pos.turn;
	const balance = (p: Chess): number => {
		let w = 0;
		let b = 0;
		for (const s of p.board.occupied) {
			const piece = p.board.get(s);
			if (!piece || piece.role === 'king') continue;
			if (piece.color === 'white') w += VALUE[piece.role];
			else b += VALUE[piece.role];
		}
		return mover === 'white' ? w - b : b - w;
	};
	const play = (m: string): boolean => {
		const from = parseSquare(m.slice(0, 2));
		const to = parseSquare(m.slice(2, 4));
		if (from === undefined || to === undefined) return false;
		try {
			pos.play({ from, to });
			return true;
		} catch {
			return false;
		}
	};

	let i = 0;
	for (; i < moves.length && i < plies; i++) {
		const to = moves[i].slice(2, 4);
		if (to === target && pos.board.get(parseSquare(target) as Square) !== undefined) break;
		if (!play(moves[i])) return false;
	}
	if (i >= moves.length || i >= plies) return false;

	const before = balance(pos);
	if (!play(moves[i])) return false;
	for (i++; i < moves.length && moves[i].slice(2, 4) === target; i++) {
		if (!play(moves[i])) return false;
	}
	return balance(pos) - before >= 100;
}

/** Material the side to move nets over the first `plies` of the engine's line. */
function pvNets(fen: string, pv: string, plies: number): number {
	if (!pv) return 0;
	let pos: Chess;
	try {
		pos = positionFromFen(fen);
	} catch {
		return 0;
	}
	const mover = pos.turn;
	const balance = (p: Chess): number => {
		let w = 0;
		let b = 0;
		for (const s of p.board.occupied) {
			const piece = p.board.get(s);
			if (!piece || piece.role === 'king') continue;
			if (piece.color === 'white') w += VALUE[piece.role];
			else b += VALUE[piece.role];
		}
		return mover === 'white' ? w - b : b - w;
	};
	const before = balance(pos);
	for (const m of pv.split(/\s+/).slice(0, plies)) {
		const from = parseSquare(m.slice(0, 2));
		const to = parseSquare(m.slice(2, 4));
		if (from === undefined || to === undefined) break;
		try {
			pos.play({ from, to });
		} catch {
			break;
		}
	}
	return balance(pos) - before;
}

const suite = ENGINE ? describe : describe.skip;

suite('the Lab presets, adjudicated', () => {
	for (const preset of PRESETS) {
		if (!preset.claim) continue;

		it(`${preset.name}: the engine agrees with the claim`, async () => {
			const c = contest(preset.fen, preset.target);
			const { cp, pv, best } = await ask(preset.fen);

			// Adjudicated on the SQUARE, not on the position.
			//
			// This test used to compare the engine's whole-board evaluation with
			// the claim, on the reasoning that a sparse fixture is "about" one
			// contest. It is not, and the generator proved it: one preset has
			// White better by 285 centipawns for reasons that have nothing to do
			// with the square under test, and the old test called that a
			// disagreement. The engine's opinion about a square is expressed in
			// its own line — does it capture there, and does the material stay?
			// A claim that needs a preparing move gets a second route to
			// agreement, and it is not a loophole — it is the shape of the claim.
			// When the prize runs from a square it was shielding, the material
			// changes hands somewhere else: in preset #2 the engine plays the
			// algorithm's ♙e2–e4, the knight runs, and the QUEEN comes off on d8.
			// Requiring the capture to land on the target square would mark that
			// as a disagreement when the two agree completely, including on the
			// move.
			const rung = c.knot.rungs.find((r) => r.holds && r.move);
			const agreesOnPlan =
				!!rung?.move &&
				best === `${rung.move.from}${rung.move.to}` &&
				pvNets(preset.fen, pv, 4) >= 100;

			expect(
				pvWinsAt(preset.fen, pv, preset.target) || agreesOnPlan,
				`${preset.name}: I say ${c.verdict.kind} (${c.verdict.why}); engine ${cp}cp, pv ${pv}`,
			).toBe(preset.claim === 'wins');
		});

		it(`${preset.name}: my verdict matches the claim`, () => {
			const c = contest(preset.fen, preset.target);
			const won = c.verdict.kind === 'winnable';
			expect(
				won,
				`I say ${c.verdict.kind}: ${c.verdict.why}`,
			).toBe(preset.claim === 'wins');
		});
	}

	it('names the same move the engine plays, where it claims one', async () => {
		// A weaker check than it looks — the engine may prefer an unrelated
		// improvement — so it is only applied where the claim is a win, which is
		// where the two should coincide.
		for (const preset of PRESETS) {
			if (preset.claim !== 'wins') continue;
			const c = contest(preset.fen, preset.target);
			const rung = c.knot.rungs.find((r) => r.holds && r.move);
			const mine = c.verdict.at === 0 || !rung?.move ? null : `${rung.move.from}${rung.move.to}`;
			if (!mine) continue;
			expect((await ask(preset.fen)).best, `${preset.name}`).toBe(mine);
		}
	});
});

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
import { contest } from '../src/domain/contest';
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
function ask(fen: string, depth = 16): Promise<{ cp: number; best: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(ENGINE as string);
		let out = '';
		const done = (e?: Error) => {
			proc.kill();
			if (e) return reject(e);
			let cp = 0;
			for (const line of out.split('\n')) {
				const m = /score (cp|mate) (-?\d+)/.exec(line);
				if (m) cp = m[1] === 'mate' ? (Number(m[2]) > 0 ? 10_000 : -10_000) : Number(m[2]);
			}
			resolve({ cp, best: /bestmove (\S+)/.exec(out)?.[1] ?? '' });
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

const suite = ENGINE ? describe : describe.skip;

suite('the Lab presets, adjudicated', () => {
	for (const preset of PRESETS) {
		if (!preset.claim) continue;

		it(`${preset.name}: the engine agrees with the claim`, async () => {
			const c = contest(preset.fen, preset.target);
			const { cp: eval0 } = await ask(preset.fen);

			// The presets are sparse positions built around one contest, so the
			// engine's evaluation of the whole position IS an evaluation of the
			// claim. This would not hold on a real middlegame, which is why this
			// test covers fixtures and not games.
			if (preset.claim === 'wins') {
				expect(
					eval0,
					`${preset.name}: I say ${c.verdict.kind} (${c.verdict.why}), engine says ${eval0}cp`,
				).toBeGreaterThan(150);
			} else {
				expect(
					eval0,
					`${preset.name}: I say ${c.verdict.kind} (${c.verdict.why}), engine says ${eval0}cp`,
				).toBeLessThan(150);
			}
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
			const mine =
				c.verdict.at === 0
					? null
					: c.rows[1]?.play
						? `${c.rows[1].play.move.from}${c.rows[1].play.move.to}`
						: null;
			if (!mine) continue;
			expect((await ask(preset.fen)).best, `${preset.name}`).toBe(mine);
		}
	});
});

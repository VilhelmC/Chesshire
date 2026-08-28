import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExplorerResponse } from '../src/domain/types';

// ---------------------------------------------------------------------------
// A run plays the opening from move 1, and the book comes from the position
// rather than from a list of lines. These tests drive it from a synthetic book
// via SessionConfig.classify, which is the seam that keeps the run testable now
// that there is nothing hardcoded to test against.
// ---------------------------------------------------------------------------

const fetchExplorer = vi.fn<(fen: string) => Promise<ExplorerResponse>>();
const analysePosition = vi.fn<(fen: string) => Promise<unknown>>();

vi.mock('../src/data/explorer', () => ({ fetchExplorer: (f: string) => fetchExplorer(f) }));
vi.mock('../src/data/cloudEval', () => ({
	analysePosition: (f: string) => analysePosition(f),
	toColourPov: (cp: number, c: 'w' | 'b') => (c === 'w' ? cp : -cp),
}));

const { startRun, submitMove, resumeFrom, playFrom } = await import('../src/engine/session');
const { applySan, applyUci, INITIAL_FEN } = await import('../src/domain/chess');
const { DEFAULT_PRACTICE } = await import('../src/domain/practice');
const type_ = await import('../src/domain/book');

type BookMove = import('../src/domain/book').BookMove;

const board = (fen: string) => fen.split(' ')[0];
const EVALS: Record<string, { cp: number; pv: string }> = {};

beforeEach(() => {
	fetchExplorer.mockReset();
	analysePosition.mockReset();
	for (const k of Object.keys(EVALS)) delete EVALS[k];

	fetchExplorer.mockResolvedValue({ white: 0, draws: 0, black: 0, moves: [] });
	analysePosition.mockImplementation(async (fen: string) => {
		const e = EVALS[board(fen)];
		return { fen, depth: 30, pvs: [{ cpWhite: e?.cp ?? 20, pv: [e?.pv ?? firstLegal(fen)] }] };
	});
});

function firstLegal(fen: string): string {
	for (const c of ['g1f3', 'b1c3', 'd2d4', 'd7d5', 'g8f6', 'a2a3', 'a7a6']) {
		try {
			applyUci(fen, c);
			return c;
		} catch {
			/* next */
		}
	}
	return 'a2a3';
}

/** A book move from SAN, played in `fen`. */
function mv(
	fen: string,
	san: string,
	freq: number,
	verdict: BookMove['verdict'],
	name: string | null = null,
): BookMove {
	const { uci } = applySan(fen, san);
	const cpLoss = verdict === 'blunder' ? 300 : verdict === 'inaccuracy' ? 90 : 0;
	return { uci, san, freq, games: Math.round(freq * 1000), cpLoss, name, verdict };
}

/**
 * A book keyed by the moves played so far.
 *
 * `'e4 e5'` means "when the path is exactly e4 e5". Anything unlisted is a
 * position the explorer does not know, which the run must handle.
 */
function bookFrom(
	spec: Partial<Record<string, (fen: string) => BookMove[]>>,
	name = 'Test Opening',
) {
	return async (fen: string) => {
		const build = spec[pathKeyOf(fen)];
		return { moves: build ? build(fen) : [], name: build ? name : null, eco: 'C50' };
	};
}

/** Reconstruct "which node is this" from the FEN, for the synthetic book. */
const NODE = new Map<string, string>();
function pathKeyOf(fen: string): string {
	return NODE.get(board(fen)) ?? '?';
}
function register(path: string[]) {
	let fen = INITIAL_FEN;
	NODE.set(board(fen), '');
	const acc: string[] = [];
	for (const san of path) {
		fen = applySan(fen, san).fen;
		acc.push(san);
		NODE.set(board(fen), acc.join(' '));
	}
}

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'];

/** The Italian, branching at move 3 the way the real one does. */
function italianBook() {
	register(ITALIAN);
	register(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
	register(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nge7']);
	register(['e4', 'c5']);
	return bookFrom({
		'': (f) => [mv(f, 'e4', 0.55, 'main'), mv(f, 'd4', 0.3, 'book')],
		e4: (f) => [mv(f, 'e5', 0.4, 'main'), mv(f, 'c5', 0.35, 'book', 'Sicilian Defence')],
		'e4 e5': (f) => [mv(f, 'Nf3', 0.7, 'main'), mv(f, 'Nc3', 0.15, 'book')],
		'e4 e5 Nf3': (f) => [mv(f, 'Nc6', 0.75, 'main')],
		'e4 e5 Nf3 Nc6': (f) => [mv(f, 'Bc4', 0.4, 'main'), mv(f, 'Bb5', 0.35, 'book')],
		'e4 e5 Nf3 Nc6 Bc4': (f) => [
			mv(f, 'Nf6', 0.32, 'main', 'Two Knights Defence'),
			mv(f, 'Bc5', 0.28, 'book', 'Giuoco Piano'),
			mv(f, 'Be7', 0.06, 'book', 'Hungarian Defence'),
			mv(f, 'h6', 0.008, 'sound'),
			mv(f, 'Nge7', 0.05, 'blunder'),
		],
	});
}

const cfg = (over: Record<string, unknown> = {}) => ({
	practice: { ...DEFAULT_PRACTICE, deviationChance: 0 },
	rng: () => 0.5,
	classify: italianBook(),
	...over,
});

describe('a run without any hardcoded lines', () => {
	it('starts at move 1 with the whole opening in scope', async () => {
		const s = await startRun(cfg());
		expect(s.path).toEqual([]);
		expect(s.fen).toContain('rnbqkbnr/pppppppp');
		// Both first moves are real theory, so both are accepted.
		expect(s.expected.map((e) => e.san).sort()).toEqual(['d4', 'e4']);
	});

	it('names the opening from the position rather than being told it', async () => {
		let s = await startRun(cfg());
		s = (await submitMove(s, cfg(), applySan(s.fen, 'e4').uci)).state;
		expect(s.opening?.name).toBe('Test Opening');
	});

	it('accepts any sound book move under "book"', async () => {
		const c = cfg({ practice: { ...DEFAULT_PRACTICE, deviationChance: 0, strictness: 'book' } });
		let s = await startRun(c);
		for (const san of ['e4', 'Nf3', 'Bc4']) {
			s = (await submitMove(s, c, applySan(s.fen, san).uci)).state;
		}
		// Their reply landed us somewhere; the point is e4 and d4 were both fine.
		expect(s.path[0]).toBe('e4');
	});

	it('accepts exactly one move under "repertoire"', async () => {
		const c = cfg({
			practice: { ...DEFAULT_PRACTICE, deviationChance: 0, strictness: 'repertoire' },
		});
		const s = await startRun(c);
		expect(s.expected.map((e) => e.san)).toEqual(['e4']);

		const wrong = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		// The run does NOT advance — one move is the repertoire, and it is still
		// waiting for it.
		expect(wrong.correct).toBe(false);
		// But d4 is sound, and it must not be called a blunder. The engine rates it
		// level with e4, so it now comes back as a NOVELTY: off the repertoire, not
		// an error, and no mistake card. Will: "when user picks a move that is not
		// in the line options, but is higher rated than the line moves by Stockfish
		// it should not count as error."
		expect(wrong.novelty).toBeDefined();
		expect(wrong.message).toMatch(/not canon/i);
		// And it names what the repertoire actually is, which is the point of saying
		// anything at all.
		expect(wrong.message).toMatch(/e4/);
	});

	it('accepts a sound move whether or not anyone else plays it', async () => {
		// Frequency governs the OPPONENT — predicting them is a question about
		// what people play. Judging our own move is a question about what is
		// good, and the two were sharing one rule.
		const path = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
		let fen = INITIAL_FEN;
		for (const san of path) fen = applySan(fen, san).fen;

		const moves = italianMovesAt(fen);
		expect(type_.acceptable(moves, 'book').map((m) => m.san)).toContain('h6');
		expect(type_.acceptable(moves, 'free').map((m) => m.san)).toContain('h6');
	});

	it('still narrows to the main line under "repertoire"', async () => {
		// The mode that exists precisely to drill one line keeps doing that;
		// following it IS the exercise there.
		const path = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
		let fen = INITIAL_FEN;
		for (const san of path) fen = applySan(fen, san).fen;

		const moves = italianMovesAt(fen);
		expect(type_.acceptable(moves, 'repertoire').length).toBe(1);
	});

	it('never accepts a move that loses material, at any strictness', async () => {
		const path = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
		let fen = INITIAL_FEN;
		for (const san of path) fen = applySan(fen, san).fen;
		const moves = italianMovesAt(fen);
		for (const s of ['repertoire', 'book', 'free'] as const) {
			expect(type_.acceptable(moves, s).map((m) => m.san)).not.toContain('Nge7');
		}
	});

	it('ends the run honestly when the explorer runs out', async () => {
		const c = cfg({ classify: async () => ({ moves: [], name: null, eco: null }) });
		const s = await startRun(c);
		expect(s.finished).toBe('line-complete');
		expect(s.note).toMatch(/no games|out of book/i);
		expect(s.expected).toEqual([]);
	});
});

describe('a pinned root', () => {
	const root = { path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italian Game' };
	const pinned = (extra: Record<string, unknown> = {}) =>
		cfg({ practice: { ...DEFAULT_PRACTICE, deviationChance: 0, roots: [root], ...extra } });

	it('plays the moves that reach it, rather than asking for them again', async () => {
		const s = await startRun(pinned());
		expect(s.path.slice(0, 5)).toEqual(root.path);
		expect(s.path.length).toBeGreaterThanOrEqual(5);
	});

	it('starts every run from the same place', async () => {
		const a = await startRun(pinned());
		const b = await startRun(pinned());
		expect(a.path.slice(0, 5)).toEqual(b.path.slice(0, 5));
	});

	it('makes you play the approach yourself when asked to', async () => {
		// The moves that reach an opening are part of the opening.
		const c = pinned({ playFromStart: true });
		const s = await startRun(c);
		expect(s.path).toEqual([]);
		expect(s.expected.map((e) => e.san)).toEqual(['e4']);
	});

	it('still confines you to the pinned line while walking into it', async () => {
		const c = pinned({ playFromStart: true });
		const s = await startRun(c);
		// d4 is sound theory and normally accepted — but it leaves the filter.
		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.correct).toBe(false);
		expect(out.message).toMatch(/leaves Italian Game/i);
	});

	it('accepts either approach when two pinned openings still diverge', async () => {
		const scotch = { path: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], name: 'Scotch' };
		const c = cfg({
			practice: {
				...DEFAULT_PRACTICE,
				deviationChance: 0,
				roots: [root, scotch],
				playFromStart: true,
			},
		});
		let s = await startRun(c);
		s = (await submitMove(s, c, applySan(s.fen, 'e4').uci)).state;
		s = (await submitMove(s, c, applySan(s.fen, 'Nf3').uci)).state;
		// Both Bc4 and d4 lead somewhere pinned, so both must be on the table.
		expect(s.expected.map((e) => e.san).sort()).toEqual(['Bc4', 'd4']);
	});
});

describe('resuming from an earlier position', () => {
	const ITALIAN_PATH = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];

	it('carries on TRAINING, with a move to find', async () => {
		// The bug: playFrom always dropped into free play, so the trainer's own
		// "play from here" left `expected` empty and greyed out Show me with
		// nothing to show.
		const c = cfg();
		const s = await playFrom(ITALIAN_PATH, 4, 'w', c, 'book');
		expect(s.phase).toBe('book');
		expect(s.expected.length).toBeGreaterThan(0);
	});

	it('still drops into free play when that is what was asked for', async () => {
		// The review page's "play this out against the engine" is a different
		// request and must keep working.
		const c = cfg();
		const s = await playFrom(ITALIAN_PATH, 4, 'w', c);
		expect(s.phase).toBe('freeplay');
		expect(s.expected).toEqual([]);
	});

	it('replays only as far as asked', async () => {
		const c = cfg();
		const s = await playFrom(ITALIAN_PATH, 2, 'w', c, 'book');
		// Two of our plies, plus their reply.
		expect(s.path.slice(0, 2)).toEqual(['e4', 'e5']);
		expect(s.path.length).toBeGreaterThanOrEqual(2);
	});

	it('has the opponent answer from the book, not from the engine', async () => {
		const c = cfg();
		const s = await playFrom(['e4'], 1, 'w', c, 'book');
		// After 1.e4 the synthetic book offers e5 and c5; one of them was played.
		expect(['e5', 'c5']).toContain(s.path[1]);
		expect(s.lastOpponent?.kind).toBe('book');
	});
});

describe('the opponent', () => {
	it('replies with a move that is actually played here', async () => {
		const c = cfg();
		let s = await startRun(c);
		s = (await submitMove(s, c, applySan(s.fen, 'e4').uci)).state;
		expect(['e5', 'c5']).toContain(s.path[1]);
		expect(s.lastOpponent?.kind).toBe('book');
	});

	it('plays a mistake when the deviation rate says so, and only a real one', async () => {
		const c = cfg({
			practice: { ...DEFAULT_PRACTICE, deviationChance: 1 },
			rng: () => 0.5,
		});
		let s = await startRun(c);
		for (const san of ['e4', 'Nf3', 'Bc4']) {
			if (s.finished) break;
			const uci = applySan(s.fen, san).uci;
			s = (await submitMove(s, c, uci)).state;
		}
		// Nge7 is the only blunder in this book, so it is the only thing that can
		// have been offered as one.
		if (s.lastOpponent?.kind === 'mistake') {
			expect(s.lastOpponent.san).toBe('Nge7');
			expect(s.phase).toBe('punish');
		}
	});

	it('offers a different reply each time the same position is replayed', async () => {
		const c = cfg();
		let s = await startRun(c);
		s = (await submitMove(s, c, applySan(s.fen, 'e4').uci)).state;

		const seen = new Set<string>([s.path[1]]);
		let point = s.retryPoint;
		for (let i = 0; i < 3 && point; i++) {
			const again = await resumeFrom(point, c, s);
			seen.add(again.path[1]);
			point = again.retryPoint;
		}
		// Two replies exist here; both must have been shown rather than one twice.
		expect(seen.size).toBe(2);
	});

	it('accumulates what it has shown, so a third press cannot repeat the first', async () => {
		const c = cfg();
		let s = await startRun(c);
		s = (await submitMove(s, c, applySan(s.fen, 'e4').uci)).state;
		// The position BEFORE their reply is where the alternatives live.
		const beforeReply = s.retryPoint!.fen;
		const firstUci = applySan(beforeReply, s.path[1]).uci;

		const second = await resumeFrom(s.retryPoint!, c, s);
		expect(second.path[1]).not.toBe(s.path[1]);
		// The list carries BOTH replies now, so a third press cannot serve the
		// first one again — which a single remembered move would have allowed.
		expect(second.retryPoint?.avoid).toContain(firstUci);
		expect(second.retryPoint?.avoid?.length).toBe(2);
	});
});

/** The classified moves at the Italian's move-3 node, for the strictness tests. */
function italianMovesAt(fen: string): BookMove[] {
	return [
		mv(fen, 'Nf6', 0.32, 'main'),
		mv(fen, 'Bc5', 0.28, 'book'),
		mv(fen, 'Be7', 0.06, 'book'),
		mv(fen, 'h6', 0.008, 'sound'),
		mv(fen, 'Nge7', 0.05, 'blunder'),
	];
}

// ---------------------------------------------------------------------------
// OFF THE LINE AND NOT A MISTAKE.
//
// Will: "when user picks a move that is not in the line options, but is higher
// rated than the line moves by Stockfish it should not count as error. Message
// should be something like 'That move is better than line moves but not canon.'
// The card does not go into the opening mistakes bin."
//
// The rule is a comparison against the LINE MOVE at the same budget, not against
// `state.evalNow` — see engine/score.ts for why comparing a cached deep eval with
// a fresh shallow one measures the depth gap rather than the move. These drive
// the mocked engine directly, so the boundary is exact rather than approximate.
// ---------------------------------------------------------------------------
describe('a novelty — off the line, and the engine does not mind', () => {
	/** Set the evaluation the mocked engine reports for the position after `san`. */
	function evalAfter(fen: string, san: string, cp: number) {
		EVALS[board(applySan(fen, san).fen)] = { cp, pv: '' };
	}

	const strict = () =>
		cfg({ practice: { ...DEFAULT_PRACTICE, deviationChance: 0, strictness: 'repertoire' } });

	it('is not an error when the engine likes it more', async () => {
		const c = strict();
		const s = await startRun(c);
		expect(s.expected.map((e) => e.san)).toEqual(['e4']);
		evalAfter(s.fen, 'e4', 30);
		evalAfter(s.fen, 'd4', 90); // clearly better

		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.novelty?.edge).toBe(60);
		expect(out.cpLoss).toBe(0);
		expect(out.message).toMatch(/better than the line/i);
		expect(out.message).toMatch(/not canon/i);
		// THE POSITION DOES NOT MOVE. The drill is about learning this line, so it
		// waits for the line's move — that is what Will chose over playing on.
		expect(out.state).toBe(s);
		expect(out.state.path).toEqual([]);
	});

	it('is not an error when the engine calls it level', async () => {
		const c = strict();
		const s = await startRun(c);
		evalAfter(s.fen, 'e4', 30);
		evalAfter(s.fen, 'd4', 30);

		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.novelty).toBeDefined();
		// Worded differently from the "better" case, because claiming a move is
		// better when the engine called it level is a small lie that the user can
		// check.
		expect(out.message).toMatch(/as good as the line/i);
		expect(out.message).not.toMatch(/better than/i);
	});

	it('holds the boundary at the noise tolerance', async () => {
		// Ten centipawns is "at least as good, allowing for noise". Two different
		// positions at the same depth disagree by about this much for reasons that
		// have nothing to do with the moves, so a strict `>` would mark a move that
		// ties the line by two centipawns as a mistake.
		const c = strict();
		const s = await startRun(c);

		evalAfter(s.fen, 'e4', 100);
		evalAfter(s.fen, 'd4', 90); // exactly 10 behind — inside the tolerance
		expect((await submitMove(s, c, applySan(s.fen, 'd4').uci)).novelty).toBeDefined();

		evalAfter(s.fen, 'd4', 89); // one centipawn further — outside it
		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.novelty).toBeUndefined();
		expect(out.correct).toBe(false);
	});

	it('is still an error when the move actually costs something', async () => {
		const c = strict();
		const s = await startRun(c);
		evalAfter(s.fen, 'e4', 30);
		evalAfter(s.fen, 'd4', -300); // a real blunder

		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.novelty).toBeUndefined();
		expect(out.correct).toBe(false);
		// And the cost is measured against the LINE MOVE, at the same budget —
		// 30 − (−300) — rather than against whatever `evalNow` happened to hold.
		expect(out.cpLoss).toBe(330);
	});

	it('never fires while walking into a pinned root', async () => {
		// Pinning a root is the user saying "drill me on THIS opening". The moves
		// accepted on the way in are a filter they set, not a judgement about which
		// move is best — so an equally good move that leaves the subject is still
		// out of scope. Without this the rule waves through precisely the move that
		// abandons the drill.
		const root = { path: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italian Game' };
		const c = cfg({
			practice: { ...DEFAULT_PRACTICE, deviationChance: 0, roots: [root], playFromStart: true },
		});
		const s = await startRun(c);
		expect(s.expected.map((e) => e.san)).toEqual(['e4']);
		evalAfter(s.fen, 'e4', 30);
		evalAfter(s.fen, 'd4', 500); // far better, and still not the point

		const out = await submitMove(s, c, applySan(s.fen, 'd4').uci);
		expect(out.novelty).toBeUndefined();
		expect(out.correct).toBe(false);
		expect(out.message).toMatch(/leaves Italian Game/i);
	});
});

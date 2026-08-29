// The training-wheels menu's shapes — and the three overlays that must NOT be in it.
//
// The primitives have their own tests and their own gates. What is pinned here
// is the MENU: which overlays exist, that each draws the men it claims to, and
// that the three which failed their gates cannot be turned on. A menu is where an
// ungated feature gets in, because a checkbox looks like it costs nothing.
import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { parseSquare } from 'chessops/util';
import { WHEELS, wheelShapes, wheelNotes, type Wheel } from '../src/domain/wheels';

const at = (fen: string) => positionFromFen(fen);
const on = (...k: Wheel[]) => new Set<Wheel>(k);

/** ♘d5 forks ♜c8 and ♚g8 from e7. */
const FORK = '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1';
/** ♖d1 — ♞d5 — ♚d8. */
const PIN = '3k4/8/8/3n4/8/8/8/3RK3 b - - 0 1';
/** Back-rank mate with Ra8. */
const MATE = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';

describe('the menu', () => {
	it('offers exactly the five overlays that passed their gates', () => {
		// safe (referee, 0% false safe), mate (exact), forks (+50.5%), pins
		// (+43.6%), deficiency (0.87% falsified). Asserted as a whole list so that
		// adding a sixth is a deliberate act with a measurement attached.
		expect(WHEELS.map((w) => w.key)).toEqual(['safe', 'mate', 'forks', 'pins', 'deficient']);
	});

	it('has no row for the three that failed', () => {
		// The relative pin and the skewer sat at the base rate however they were
		// narrowed; overload's control theme outscored its gate theme. All three are
		// deleted, and a checkbox is exactly how one would quietly come back.
		const keys = WHEELS.map((w) => w.key).join(' ');
		for (const gone of ['relative', 'skewer', 'overload', 'deflection'])
			expect(keys).not.toContain(gone);
	});

	it('draws nothing at all when nothing is ticked', () => {
		expect(wheelShapes(at(FORK), on())).toEqual([]);
		expect(wheelNotes(at(FORK), on())).toEqual([]);
	});
});

describe('what each wheel draws', () => {
	it('mate: an arrow to the mating square', () => {
		expect(wheelShapes(at(MATE), on('mate'))).toEqual([{ orig: 'a1', dest: 'a8', brush: 'blue' }]);
		expect(wheelNotes(at(MATE), on('mate'))).toEqual(['a8 is mate']);
	});

	it('forks: the move, plus a ring on each man that is hit', () => {
		const s = wheelShapes(at(FORK), on('forks'));
		expect(s[0]).toEqual({ orig: 'd5', dest: 'e7', brush: 'yellow' });
		// A shape with no `dest` is a circle, which is how the targets are marked.
		expect(s.slice(1).map((x) => x.orig).sort()).toEqual(['c8', 'g8']);
		expect(s.slice(1).every((x) => x.dest === undefined)).toBe(true);
	});

	it('pins: the arrow runs pinner → king, and the ring goes on the shield', () => {
		// The arrow passes over the shield on its way, which is the picture. The
		// ring is on the shield because that is the man the sentence is about.
		const s = wheelShapes(at(PIN), on('pins'));
		expect(s).toEqual([
			{ orig: 'd1', dest: 'd8', brush: 'red' },
			{ orig: 'd5', brush: 'red' },
		]);
	});

	it('deficiency: circles only, because there is no move to draw', () => {
		// The one overlay that says DON'T. An arrow would suggest a move to make.
		const fen = 'r3k2r/pbpp2pp/1p2pq2/8/2Pn4/3B1N2/PP3PPP/R2Q1RK1 w kq - 0 12';
		const s = wheelShapes(at(fen), on('deficient'));
		expect(s.length).toBeGreaterThan(0);
		expect(s.every((x) => x.dest === undefined)).toBe(true);
		expect(s.map((x) => x.orig)).toContain('d4');
	});
});

describe('safe moves need a man', () => {
	it('draws nothing until one is clicked', () => {
		// 27 legal moves on average, a third of them safe: drawn all at once that is
		// nine arrows out of six men, which answers the question and shows nothing.
		expect(wheelShapes(at(FORK), on('safe'))).toEqual([]);
		expect(wheelShapes(at(FORK), on('safe'), null)).toEqual([]);
	});

	it('draws that man’s moves in two colours once it is', () => {
		// Both are drawn. "These are safe" is half a lesson, and a man with nowhere
		// safe to go should look alarming rather than blank.
		const s = wheelShapes(at(FORK), on('safe'), parseSquare('d5'));
		expect(s.length).toBeGreaterThan(0);
		expect(s.every((x) => x.orig === 'd5')).toBe(true);
		expect(new Set(s.map((x) => x.brush))).toEqual(new Set(['green', 'red']));
		// Nd5–c3 drops the knight; Nd5–e7 is the fork and holds.
		expect(s.find((x) => x.dest === 'c3')!.brush).toBe('red');
		expect(s.find((x) => x.dest === 'e7')!.brush).toBe('green');
	});

	it('ignores a focused man that is not ours to move', () => {
		// White to move, ♜c8 clicked. Drawing Black's options here would be
		// answering a question nobody asked.
		expect(wheelShapes(at(FORK), on('safe'), parseSquare('c8'))).toEqual([]);
	});
});

describe('several at once', () => {
	it('composes without either overlay losing anything', () => {
		const both = wheelShapes(at(FORK), on('forks', 'mate'));
		const forksOnly = wheelShapes(at(FORK), on('forks'));
		expect(both).toEqual(forksOnly); // no mate in this position
		expect(wheelShapes(at(MATE), on('forks', 'mate'))).toHaveLength(1);
	});
});

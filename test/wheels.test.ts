// The training-wheels menu's shapes — and the three overlays that must NOT be in it.
//
// The primitives have their own tests and their own gates. What is pinned here
// is the MENU: which overlays exist, that each draws the men it claims to, and
// that the three which failed their gates cannot be turned on. A menu is where an
// ungated feature gets in, because a checkbox looks like it costs nothing.
import { describe, it, expect } from 'vitest';
import { positionFromFen } from '../src/domain/chess';
import { makeSquare, parseSquare } from 'chessops/util';
import { WHEELS, wheelShapes, wheelNotes, mateLine, mateArrows, mateNotes, matesBothWays, nullMove, type Wheel } from '../src/domain/wheels';

const at = (fen: string) => positionFromFen(fen);
const on = (...k: Wheel[]) => new Set<Wheel>(k);

/** ♘d5 forks ♜c8 and ♚g8 from e7. */
const FORK = '2r3k1/5ppp/8/3N4/8/8/5PPP/6K1 w - - 0 1';
/** ♖d1 — ♞d5 — ♚d8. */
const PIN = '3k4/8/8/3n4/8/8/8/3RK3 b - - 0 1';
/** Back-rank mate with Ra8. */
const MATE = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
/** Two rooks against a bare king, with Rb8# on the board — mate in ONE. */
const LADDER = '7k/R7/1R6/8/8/8/8/6K1 w - - 0 1';
/** The same two rooks a rank lower: no mate in one, so the ladder has to walk. */
const WALK = '7k/8/8/8/8/8/1R6/R5K1 w - - 0 1';

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
	it('mate draws NOTHING on the synchronous path', () => {
		// The wheel used to be "mate in one" — an isCheckmate() test per move, and as
		// instant as the rest of the menu. It now draws the whole forced SEQUENCE,
		// which is a df-pn search: mean 80ms and up to 987ms (mate-line-cost.mjs).
		// So it is deliberately absent here, and the host runs it off the render
		// path. A test, because "the sync path stayed sync" is the property that
		// stops a slow search creeping back into a memo.
		expect(wheelShapes(at(MATE), on('mate'))).toEqual([]);
		expect(wheelNotes(at(MATE), on('mate'))).toEqual([]);
		expect(WHEELS.find((w) => w.key === 'mate')!.slow).toBe(true);
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
		expect(both).toEqual(forksOnly);
	});
});

describe('the mate line', () => {
	it('finds the mate in one and labels it as one move', () => {
		const line = mateLine(at(MATE));
		expect(line).not.toBeNull();
		expect(line!.map((m) => makeSquare(m.from) + makeSquare(m.to))).toEqual(['a1a8']);
		expect(mateNotes({ deliver: line, threat: null }, 'white', true)[0]).toContain('White mates in 1');
	});

	it('returns THE shortest mate, not the first one move ordering happens to find', () => {
		// The bug this pins. Searching straight to depth 5 and taking the first move
		// that proves a mate gave "Kf1 Kg8 Rf6 Kh8 Rf8#" here — a real forced mate,
		// five plies long, offered while Rb8# sits on the board. Every claim in it
		// was true and the overlay was still lying, because "the forced mate" and
		// "a forced mate" are different sentences.
		//
		// Which one came back depended on MOVE ORDERING, which must never be
		// load-bearing. Iterative deepening makes shortness a property of the
		// question instead.
		const line = mateLine(at(LADDER));
		expect(line!.map((m) => makeSquare(m.from) + makeSquare(m.to))).toEqual(['b6b8']);
	});

	it('walks a longer mate move by move when that is the shortest there is', () => {
		// The two rooks a rank apart: no mate in one, and the ladder walks the king
		// up the board — Ra7 Kg8 Rb8#. Verified before it was written down.
		const line = mateLine(at(WALK));
		expect(line).not.toBeNull();
		expect(line!.length).toBeGreaterThan(1);
		// Ours, theirs, ours … and it ends with our move.
		expect(line!.length % 2).toBe(1);
		expect(mateNotes({ deliver: line, threat: null }, 'white', true)[0]).toContain('one line of it');
	});

	it('numbers the arrows and alternates the brush', () => {
		// Eight unlabelled arrows are a tangle the reader has to re-derive the order
		// of, and "whose move is this" is the first question asked of any arrow.
		const line = mateLine(at(WALK))!;
		const arrows = mateArrows(line);
		expect(arrows.map((a) => a.label)).toEqual(line.map((_, i) => String(i + 1)));
		expect(arrows[0].brush).toBe('blue');
		if (arrows.length > 1) expect(arrows[1].brush).toBe('red');
	});

	it('returns null when there is no forced mate', () => {
		// A forced mate exists on 24.4% of plies in a corpus selected FOR tactics, so
		// null is the ordinary answer and must not be an error.
		expect(mateLine(at('6k1/5pp1/7p/8/8/8/5PPP/R5K1 w - - 0 1'))).toBeNull();
	});
});

describe('mate is asked for BOTH sides', () => {
	// Verified against the running code before being written down: a lone rook
	// cannot mate a king in the open, so the first three positions I reached for
	// were bad chess rather than a bad detector.
	/** ♚h8, ♜a2 against ♔g1 boxed in by its own ♙f2 ♙g2 ♙h2. Black plays ...Ra1#. */
	const THREATENED = '7k/8/8/8/8/8/r4PPP/6K1 w - - 0 1';
	/** The same rook already giving check on g2. */
	const IN_CHECK = '7k/8/8/8/8/8/6r1/6K1 w - - 0 1';

	it('reports the mate coming at you, not only the one you can play', () => {
		// Will: "you are applying the concept 'mate' asymmetrically, only when the
		// winner is the player to move. But mates should be shown for both players.
		// A player that might be mated has every reason to know."
		//
		// The old wheel searched White's mates here, found none, and said "no forced
		// mate" — true, and the least useful true thing available.
		const m = matesBothWays(at(THREATENED));
		expect(m.deliver).toBeNull();
		expect(m.threat!.map((x) => makeSquare(x.from) + makeSquare(x.to))).toEqual(['a2a1']);
		const notes = mateNotes(m, 'white', true);
		expect(notes[0]).toContain('no forced mate for White');
		expect(notes[1]).toContain('BLACK THREATENS MATE in 1');
	});

	it('does not invent a threat when the mover is in check', () => {
		// A side in check cannot pass, so "what would they do with a free move" is
		// not a question the position poses — and answering it anyway would be a
		// claim nothing established.
		const pos = at(IN_CHECK);
		expect(pos.isCheck()).toBe(true);
		expect(nullMove(pos)).toBeNull();
		expect(matesBothWays(pos).threat).toBeNull();
		expect(mateNotes(matesBothWays(pos), 'white', false)[1]).toContain('the threat is the check');
	});

	it('says so plainly when neither side has one', () => {
		const m = matesBothWays(at('6k1/5pp1/7p/8/8/8/5PPP/R5K1 w - - 0 1'));
		expect(m.deliver).toBeNull();
		expect(m.threat).toBeNull();
		expect(mateNotes(m, 'white', true)[1]).toContain('no mate threatened');
	});

	it('draws a threat on the warning ramp, never the same as a mate you can play', () => {
		// Two questions that must not look alike: "what can I play" and "what is
		// coming". Marked with a ! as well as recoloured, so the difference survives
		// a reader who cannot tell the two hues apart.
		const line = mateLine(at(MATE))!;
		expect(mateArrows(line)[0].brush).toBe('blue');
		expect(mateArrows(line, true)[0].brush).toBe('red');
		expect(mateArrows(line, true)[0].label).toBe('!1');
	});
});

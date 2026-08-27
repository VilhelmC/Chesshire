// The Lab — the detector, shown its working, on positions nobody chose.
//
// ---------------------------------------------------------------------------
// This screen exists to be distrusted. Every other tab presents a conclusion;
// this one presents the computation, on puzzles whose answers were set by
// Lichess rather than by me, and it shows the ones the detector gets WRONG as
// prominently as the ones it gets right.
//
// Three things on it are easy to misread, so they are named explicitly rather
// than left to be inferred:
//
//   * The RANKING is the detector's, and so are the values beside it. Nothing on
//     this screen is a Stockfish evaluation. Stockfish's opinion enters only
//     off-screen, in scripts/race-ablate.mjs, where it adjudicates disagreements.
//   * The MOVE MARKED in the ranking is the puzzle's — Lichess's answer — not the
//     detector's choice. The detector's choice is always the first row. When the
//     marked row is not the first row, that is precisely the failure being shown.
//   * Only the SOLVER's plies are counted. The opponent's replies in a Lichess
//     line are one engine's pick among moves that may lose equally, so the
//     detector preferring a different one is not evidence of anything.
//
// The annotation is computed live, by the same resolve.ts the app ships, one ply
// at a time — a whole chain at once used to lock the tab up for seconds.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Board } from '../components/Board';
import { scoreMoves, immediate, type Scored } from '../domain/resolve';
import { positionFromFen, parseSquare, makeSquare, fenOf } from '../domain/chess';
import { Toolbar } from '../components/Toolbar';
import { candidateMoves, brushForGrade, type Candidate } from '../engine/candidates';
import { explain, type Branch } from '../domain/chain';
import { narrate } from '../domain/narrate';
import { MoveList, type MoveChip } from '../components/MoveList';
import { useBoardSize } from '../components/BoardPanel';
import { loadNotes, saveNote, toMarkdown } from '../domain/labNotes';
import type { LabNote } from '../data/db';
import { canLink, downloadAs, linkFile, restoreLink, writeLinked, type LinkState } from '../data/fileLink';
import { makeSan } from 'chessops/san';
import type { Chess } from 'chessops/chess';
import type { NormalMove, Role, Color } from 'chessops/types';
import { color, space, radius, text, mono } from '../ui/theme';
import { Note, Section } from '../ui/primitives';
import PUZZLES from '../data/labPuzzles.json';
import LEDGER from '../data/ledgerBuckets.json';
import { recall, remember } from '../data/viewState';
import { LedgerPanel } from '../components/LedgerPanel';
import { ComplexPanel, type Shape as ComplexShape } from '../components/ComplexPanel';
import { build as buildGraph } from '../domain/graph';
import { shapesFor, describe as readGraph, explainCover, explainCouplings, LAYERS, type Layer } from '../domain/graphShapes';
import { gamma, concede, classify2 } from '../domain/cover2';

/** Per-ply result, precomputed: hit, ties at the top, legal moves, is-solver. */
export type PlyFlags = {
	h: number;
	t: number;
	l: number;
	s: number;
	/** The puzzle's move came first after the coercion tie-break. */
	f: number;
	/** The move the detector would play here, so both choices can be shown. */
	b: string | null;
};

export type Puzzle = {
	id: string;
	fen: string;
	moves: string[];
	rating: number;
	themes: string[];
	/** Every SOLVER ply hit. Opponent plies are not counted — see the header. */
	clean: boolean;
	/**
	 * Every solver ply hit, AND the hit meant something.
	 *
	 * `clean` alone flatters the detector: if eleven moves all score zero then the
	 * puzzle's answer is "among the best" and nothing has been discriminated. That
	 * vacuous pass is the exact failure mode this screen is meant to expose, so it
	 * is tracked separately and shown separately.
	 */
	sharp: boolean;
	/**
	 * Every solver ply hit, and where material tied, the answer was also the most
	 * coercive move.
	 *
	 * NOT counted as solved. Will: "A move should not be played because it offers
	 * coercion, but it should be explored because it offers coercion." Coercion
	 * ordering the tie set is a reason to look first, and reporting it as a find
	 * would be the same category error in the interface that the tie-break made in
	 * the evaluation. It is shown because it says something real about the
	 * position, and it is kept out of the success column.
	 */
	firm: boolean;
	firstMiss: number;
	plies: PlyFlags[];
};

const ALL = PUZZLES as Puzzle[];
const DEPTH = 4;

/**
 * Node ceiling for one ply's ranking.
 *
 * The default is 400k per root move, which is right for a harness and wrong for
 * a tab: a dense middlegame took eight seconds, during which the Lab is simply
 * frozen. The generator uses the same number, so the flags it ships and the
 * annotation computed here cannot drift apart — which is what `test/lab.test.ts`
 * checks.
 */
const BUDGET = 100_000;

const GLYPH: Record<Role, string> = {
	pawn: '♙',
	knight: '♘',
	bishop: '♗',
	rook: '♖',
	queen: '♕',
	king: '♔',
};
const DARK: Record<Role, string> = {
	pawn: '♟',
	knight: '♞',
	bishop: '♝',
	rook: '♜',
	queen: '♛',
	king: '♚',
};

const uci = (m: NormalMove) =>
	`${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? (m.promotion[0] === 'k' ? 'n' : m.promotion[0]) : ''}`;

function toMove(u: string): NormalMove {
	const from = parseSquare(u.slice(0, 2)) as number;
	const to = parseSquare(u.slice(2, 4)) as number;
	const promo = u[4]
		? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as Record<string, Role>)[u[4]]
		: undefined;
	return (promo ? { from, to, promotion: promo } : { from, to }) as NormalMove;
}

function play(pos: Chess, u: string): Chess {
	const n = pos.clone();
	n.play(toMove(u));
	return n;
}

/** A move as a person reads it: with the piece on it. */
function figurine(pos: Chess, u: string): string {
	const m = toMove(u);
	const piece = pos.board.get(m.from);
	if (!piece) return u;
	const takes = pos.board.get(m.to) !== undefined && pos.board.get(m.to)?.color !== piece.color;
	const set = piece.color === 'white' ? GLYPH : DARK;
	// The promotion piece has to be on the move: queening and taking a knight are
	// the same two squares, and the ranking shows both.
	const becomes = m.promotion ? `=${set[m.promotion as Role]}` : '';
	return `${set[piece.role]}${makeSquare(m.from)}${takes ? '×' : '–'}${makeSquare(m.to)}${becomes}`;
}

/** Centipawns as something a person can picture. */
function material(cp: number): string {
	if (!Number.isFinite(cp)) return cp > 0 ? 'mate' : 'mated';
	const n = Math.abs(cp);
	if (n === 0) return 'nothing';
	const name =
		n >= 850 && n <= 950
			? 'a queen'
			: n >= 470 && n <= 530
				? 'a rook'
				: n >= 300 && n <= 350
					? 'a piece'
					: n >= 160 && n <= 200
						? 'the exchange'
						: n === 100
							? 'a pawn'
							: `${(n / 100).toFixed(1)} pawns`;
	return cp < 0 ? `minus ${name}` : name;
}

const side = (c: Color) => (c === 'white' ? 'White' : 'Black');

/**
 * What Stockfish makes of one move, or a word saying it did not look at it.
 *
 * A blank cell would read as "zero" or as "the engine agrees"; neither is true.
 * Outside the top dozen is itself a judgement, and is written as one.
 */
function engineCp(rows: Candidate[], move: string): string {
	const hit = rows.find((c) => c.uci === move);
	return hit ? cp(hit.cp) : 'not in its top 12';
}

/** Engine centipawns, from the mover's point of view, signed. */
const cp = (n: number) => (Math.abs(n) >= 9000 ? (n > 0 ? 'mate' : 'mated') : `${n > 0 ? '+' : ''}${(n / 100).toFixed(2)}`);

type Verdict = 'blunder' | 'found' | 'coerced' | 'tied' | 'missed';

/** The cheap half: positions and moves, no evaluation. */
export type Step = {
	pos: Chess;
	played: string;
	playedText: string;
	mover: Color;
	/** False for the opponent's replies, which are shown but not counted. */
	solver: boolean;
	/** From the precomputed table, so the whole chain can be coloured at once. */
	verdict: Verdict;
	/** What the detector would play here, when that is not the puzzle's move. */
	detectorText: string | null;
};

/** The expensive half, computed only for the ply being looked at. */
export type Detail = {
	playedScore: number | null;
	playedRank: number | null;
	best: Scored[];
	bestText: string;
	rank: Scored[];
	ties: number;
	legal: number;
	verdict: Verdict;
	/** True when the search never scored the puzzle's move at all. */
	unranked: boolean;
	line: string[];
};

function verdictOf(f: PlyFlags | undefined): Verdict {
	if (!f) return 'missed';
	if (!f.h) return 'missed';
	if (f.t <= 2 || f.l <= 1) return 'found';
	return f.f ? 'coerced' : 'tied';
}

/** Walk the chain. No scoring here — this runs on every render. */
export function chainOf(p: Puzzle): Step[] {
	let pos: Chess;
	try {
		pos = positionFromFen(p.fen);
	} catch {
		return [];
	}
	const out: Step[] = [];
	for (let i = 0; i < p.moves.length; i++) {
		const here = pos;
		const u = p.moves[i];
		const best = i === 0 ? null : (p.plies?.[i - 1]?.b ?? null);
		out.push({
			pos: here,
			played: u,
			playedText: figurine(here, u),
			mover: here.turn,
			solver: i > 0 && i % 2 === 1,
			verdict: i === 0 ? 'blunder' : verdictOf(p.plies?.[i - 1]),
			detectorText: best && best !== u ? figurine(here, best) : null,
		});
		try {
			pos = play(here, u);
		} catch {
			break;
		}
	}
	return out;
}

/** Ask the detector about one position. This is the part that costs. */
export function detailOf(step: Step): Detail {
	const { scored } = scoreMoves(step.pos, DEPTH, BUDGET);
	const top = scored.length ? scored[0].score : 0;
	const played = scored.find((s) => uci(s.move) === step.played);
	const bestSet = scored.filter((s) => s.score === top);
	const hit = played !== undefined && played.score === top;
	const at = scored.findIndex((s) => uci(s.move) === step.played);
	// Show the head of the ranking — and, when the puzzle's move is nowhere near
	// the top, show it anyway. A table that silently omits the answer is the one
	// thing this screen must not do.
	const head = scored.slice(0, 4);
	return {
		playedScore: played?.score ?? null,
		playedRank: at >= 0 ? at + 1 : null,
		best: bestSet,
		bestText: bestSet
			.slice(0, 3)
			.map((s) => figurine(step.pos, uci(s.move)))
			.join(' / '),
		// The puzzle's move ALWAYS gets a row. If the search did not rank it at all
		// — which happens when the move list it built does not contain it — the row
		// says so, because a table that quietly drops the answer is the one thing
		// this screen must not do.
		rank: at >= 0 ? (at >= head.length ? [...head, scored[at]] : head) : head,
		unranked: at < 0,
		ties: bestSet.length,
		legal: scored.length,
		verdict: !hit
			? 'missed'
			: bestSet.length <= 2 || scored.length <= 1
				? 'found'
				: uci(scored[0].move) === step.played
					? 'coerced'
					: 'tied',
		line: (bestSet[0]?.line ?? []).map((m, j, arr) => {
			let q = step.pos;
			for (let k = 0; k < j; k++) q = play(q, uci(arr[k]));
			return figurine(q, uci(m));
		}),
	};
}

const THEMES = [...new Set(ALL.flatMap((p) => p.themes))].sort();

type Only =
	| 'any'
	| 'sharp'
	| 'coerced'
	| 'tied'
	| 'failed'
	// How the CURRENT stack fails a solver ply, from `scripts/lab-buckets.mjs`.
	// The five above are the depth search's verdict and are kept only until it is
	// deleted. `blind` and `wrong` are the diagnosis: a move that was never named
	// cannot be fixed by pricing, and a move that was named and outbid can.
	| 'blind'
	| 'noOpinion'
	| 'wrong'
	| 'mate';

/** puzzle id -> ply -> bucket, for every ply the ledger does NOT get sole-top. */
const BUCKETS = LEDGER as Record<string, Record<string, string>>;
/** Values are `bucket` or `bucket:mateK`, so this matches on either half. */
const anyPly = (id: string, bucket: string) =>
	Object.values(BUCKETS[id] ?? {}).some((b) => b === bucket || b.split(':').includes(bucket) || b.startsWith(bucket));

/** The three outcomes worth telling apart, plus everything. */
const KEEP: Record<Only, (p: Puzzle) => boolean> = {
	any: () => true,
	sharp: (p) => p.sharp,
	coerced: (p) => p.firm && !p.sharp,
	tied: (p) => p.clean && !p.firm,
	failed: (p) => !p.clean,
	blind: (p) => anyPly(p.id, 'blind'),
	noOpinion: (p) => anyPly(p.id, 'tied'),
	wrong: (p) => anyPly(p.id, 'wrong'),
	// Any failing ply of a mate puzzle, at any depth. FINDING-MATE-IN-K.md: this
	// is where the gate is going — mate-in-1 is 86.5% and mate-in-2 is 30.9%.
	mate: (p) => anyPly(p.id, 'mate'),
};

const VERDICT: Record<Verdict, string> = {
	blunder: color.ink2,
	found: color.good,
	coerced: color.warn,
	tied: color.warn,
	missed: color.bad,
};
/** The verdict in a word, for the notes file. */
const VERDICT_WORD: Record<Verdict, string> = {
	blunder: 'the blunder',
	found: 'found it',
	coerced: 'no opinion, most coercive',
	tied: 'no opinion',
	missed: 'missed it',
};

export function Lab() {
	// Reopen where you left off. Each value is validated on the way out by a
	// predicate only this component knows: a theme has to still be a theme, a
	// puzzle has to still be in the set, and a ply has to be inside the chain —
	// which is checked below, once the chain exists.
	const [theme, setTheme] = useState<string>(
		() => recall('labTheme', (v) => v === 'any' || THEMES.includes(v)) ?? 'any',
	);
	const [only, setOnly] = useState<Only>(
		() => (recall('labOnly', (v) => v in KEEP) as Only | undefined) ?? 'any',
	);
	const [id, setId] = useState<string | null>(
		() => recall('labId', (v) => ALL.some((q) => q.id === v)) ?? null,
	);
	const [ply, setPly] = useState(() => recall('labPly', (v) => v >= 0) ?? 0);
	/**
	 * The evaluation, TAGGED with the ply it belongs to.
	 *
	 * Without the tag there is a frame after a click where the new position is on
	 * the board and the previous ply's ranking is still under it — a table of
	 * moves that do not exist in the position shown, complete with a verdict about
	 * the wrong move. It renders for one paint and it is completely wrong for that
	 * paint, which is the worst kind of wrong on a screen whose whole purpose is
	 * to be checked.
	 */
	const [detail, setDetail] = useState<{ key: string; value: Detail } | null>(null);
	/**
	 * Stockfish's opinion, off by default.
	 *
	 * The detector's ranking is the subject of this screen, and putting an engine
	 * column beside it permanently would turn every position into a comparison
	 * with an authority rather than something to read. Asked for, it is the
	 * fastest way to settle "is the detector wrong here or am I" — so it is one
	 * toggle away and it says whose numbers they are.
	 */
	// On by default now. Will wants the reference alongside while troubleshooting
	// the ledger, and the original argument for hiding it — that an engine column
	// turns every position into a comparison with an authority — is about training,
	// not about a bench.
	const [showEngine, setShowEngine] = useState(true);
	/** The old depth search's ranking, explanation and move-list colours. */
	const [showOld, setShowOld] = useState(false);
	/**
	 * Whose obligations Γ is drawn for.
	 *
	 * Deficiency is a property of one side, so the layer has to be told which.
	 * The side to move is the default because that is the question the position
	 * asks — what must I answer — and the other reading, what my opponent owes,
	 * is one click away rather than a second layer.
	 */
	const [coverSide, setCoverSide] = useState<'toMove' | 'other'>('toMove');

	/** Which layer of the attack graph is drawn on the board (PLAN.md M1f). */
	const [graphLayer, setGraphLayer] = useState<Layer>('off');
	/**
	 * Shapes published by `ComplexPanel`'s ledger tab.
	 *
	 * Will: "Why are the squares indicated in the ledger not annotated graphically
	 * on the board? We developed UI for this?" The UI exists and draws a DIFFERENT
	 * ledger — `graphShapes`'s `owed` layer is built from `ledger2` and `cover2`,
	 * which is M2. So the picture and the table were of two systems. The panel now
	 * publishes its own rows and they take the board while that tab is open.
	 */
	const [complexShapes, setComplexShapes] = useState<ComplexShape[]>([]);
	/** Clicking a square focuses the overlay on that piece; a full board is a hairball. */
	const [focus, setFocus] = useState<number | null>(null);
	/**
	 * Train's "show options": every engine move drawn on the board, weighted.
	 *
	 * The toolbar's options button used to toggle the Stockfish COLUMN, which is a
	 * different thing wearing the same icon. Same button, same meaning as Train —
	 * arrows on the board, graded — and the column has its own labelled checkbox.
	 */
	const [options, setOptions] = useState<{ key: string; value: Candidate[] } | null>(null);
	/** Free play from the position on screen: moves are pushed onto a local line. */
	const [freePlay, setFreePlay] = useState<{ key: string; moves: string[] } | null>(null);
	/**
	 * The argument for the puzzle's move, not just its score.
	 *
	 * Will: "the whole point of the detector is to be able to annotate mistakes and
	 * puzzles to explain the black box Stockfish eval, which offers little direct
	 * pedagogy." A number cannot be taught from. This is the structure underneath
	 * it: what the move forces, what the opponent still has, and what each of
	 * those comes to.
	 */
	const [why, setWhy] = useState<{ key: string; value: Branch | null } | null>(null);
	/** Will's notes, one per puzzle and ply, kept in the browser and exportable. */
	const [notes, setNotes] = useState<Map<string, LabNote>>(new Map());
	const [draft, setDraft] = useState('');
	/** Where the notes file lives, once it has been pointed at one. */
	const [link, setLink] = useState<LinkState>({ kind: 'unlinked' });
	const [lookup, setLookup] = useState('');
	const [lookupError, setLookupError] = useState<string | null>(null);
	// The same rule every other board in the app uses, rather than a hardcoded
	// 420 that made this one visibly the odd one out.
	const [boardRef, boardSize] = useBoardSize();

	useEffect(() => {
		loadNotes().then(setNotes).catch(() => undefined);
		restoreLink().then(setLink).catch(() => undefined);
	}, []);
	const [engine, setEngine] = useState<{ key: string; value: Candidate[] } | null>(null);

	const pool = useMemo(
		() => ALL.filter((p) => theme === 'any' || p.themes.includes(theme)).filter(KEEP[only]),
		[theme, only],
	);

	// Keep a valid selection whenever the filters change.
	useEffect(() => {
		if (!pool.length) return;
		if (id && pool.some((p) => p.id === id)) return;
		setId(pool[Math.floor(Math.random() * pool.length)].id);
		setPly(0);
	}, [pool, id]);

	const puzzle = pool.find((p) => p.id === id) ?? pool[0] ?? null;
	const steps = useMemo(() => (puzzle ? chainOf(puzzle) : []), [puzzle]);
	const at = Math.min(ply, Math.max(0, steps.length - 1));
	const step = steps[at];

	// Written back AFTER clamping, so a stored ply can never be past the end of a
	// shorter chain even once.
	useEffect(() => {
		if (puzzle) remember({ labId: puzzle.id, labPly: at, labTheme: theme, labOnly: only });
	}, [puzzle, at, theme, only]);

	// The board belongs to the side solving the puzzle, and stays there.
	//
	// Orientation used to follow whoever was to move, so the board spun on every
	// ply. A puzzle is one side's problem from beginning to end: the solver is
	// whoever answers the blunder, and that is the view for the whole chain.
	const solver: Color = steps[1]?.mover ?? steps[0]?.mover ?? 'white';

	// Move numbering, so the scoresheet reads like a game rather than a list.
	//
	// `MoveList` derives the number from the ply and the column from the colour,
	// which means a chain that opens with Black has to start at ply 2 — otherwise
	// Black's move is numbered as though it opened the game and the empty White
	// cell that lines the columns up never appears.
	const offset = steps[0]?.mover === 'white' ? 1 : 2;
	const plyOf = (i: number) => i + offset;
	const indexOf = (p: number) => p - offset;
	const chips: MoveChip[] = useMemo(
		() =>
			steps.map((st, i) => ({
				san: sanOf(st.pos, st.played),
				ply: i + offset,
				// Ply 0 is the blunder: their mistake, which is exactly what the red
				// marker means in Train.
				mistake: i === 0,
				// And amber is "worth another look", which here is a ply the detector
				// did not get right.
				// NOT GATED ON `showOld`, and that was the bug. Will: "it's very
				// difficult to see from the move list styling where the solver errors
				// are. Is styling being applied?" It was not. `showOld` is the OLD DEPTH
				// SEARCH checkbox — a different evaluator, off by default — and both the
				// marker and the tone below were behind it, so with the box unchecked
				// every ply rendered muted grey whatever the solver had said. The
				// verdict being displayed is the solver's own and has nothing to do with
				// which rival columns are on screen.
				suboptimal: i > 0 && !!st.solver && st.verdict !== 'found' && st.verdict !== 'coerced',
				white: st.mover === 'white',
				// Colour carries the verdict, as the old chips did: reading it off a
				// one-pixel underline was worse.
				tone:
					i === 0
						? ('muted' as const)
						: !st.solver
							? ('muted' as const)
							: st.verdict === 'found'
								? ('good' as const)
								: st.verdict === 'missed'
									? ('bad' as const)
									: ('warn' as const),
			})),
		[steps, offset],
	);
	const prev = at > 0 ? steps[at - 1] : null;

	// ------------------------------------------------------------------
	// Scoring one ply takes about a fifth of a second; scoring a twelve-ply
	// chain took three, on the main thread, with no way to tell the tab had not
	// simply died. So the chain is walked cheaply and only the SELECTED ply is
	// scored — after a paint, so the board and the "working" note are on screen
	// before the thread is taken away.
	// ------------------------------------------------------------------
	const key = `${puzzle?.id ?? ''}:${at}`;
	useEffect(() => {
		if (!step || at === 0) return;
		let live = true;
		const t = setTimeout(() => {
			const value = detailOf(step);
			if (live) setDetail({ key, value });
		}, 16);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [step, at, key]);

	// Anything computed for another ply is not shown at all.
	const shown = detail && detail.key === key ? detail.value : null;

	// The engine runs in its own worker, so this does not compete with the
	// detector for the main thread — but it is still tagged with its ply, for the
	// same reason: a column of numbers belonging to the previous position is
	// worse than no column.
	useEffect(() => {
		if (!showEngine || !step || at === 0) return;
		let live = true;
		candidateMoves(fenOf(step.pos), step.mover === 'white' ? 'w' : 'b', 12, 500)
			.then((value) => {
				if (live) setEngine({ key, value });
			})
			.catch(() => {
				if (live) setEngine({ key, value: [] });
			});
		return () => {
			live = false;
		};
	}, [showEngine, step, at, key]);

	// The overlay is built from the position on screen, not from the puzzle —
	// free play and stepping both change it, and the picture must follow.
	const graph = useMemo(
		() => (graphLayer === 'off' || !step ? null : buildGraph(step.pos.board)),
		[graphLayer, step],
	);
	// Γ is built only for the layers that draw it. The ledger and the cover graph
	// are cheap — 1ms/ply measured — but building them for the attack layer would
	// tie two milestones' work together for no reason.
	const gam = useMemo(() => {
		if (!step || (graphLayer !== 'owed' && graphLayer !== 'cover')) return null;
		const owed = coverSide === 'toMove' ? step.pos.turn : step.pos.turn === 'white' ? 'black' : 'white';
		return gamma(step.pos, { owed });
	}, [step, graphLayer, coverSide]);

	const graphShapes = useMemo(
		() => (graph && step ? shapesFor(graph, graphLayer, focus, step.pos.board, gam ?? undefined) : []),
		[graph, graphLayer, focus, step, gam],
	);
	const graphNote =
		gam && step
			? explainCover(
					gam,
					classify2(gam, step.pos.board, coverSide === 'toMove' ? step.pos.turn : step.pos.turn === 'white' ? 'black' : 'white'),
					concede(step.pos, gam, coverSide === 'toMove' ? step.pos.turn : step.pos.turn === 'white' ? 'black' : 'white'),
					(f, t) => figurine(step.pos, makeSquare(f) + makeSquare(t)),
				)
			: graphLayer === 'couplings' && step
				? explainCouplings(step.pos.board)
				: graph && step
					? readGraph(graph, focus, step.pos.board)
					: null;

	const engineRows = showEngine && engine && engine.key === key ? engine.value : null;
	const optionArrows = options && options.key === key ? options.value : null;
	/** What the detector would play here, from the precomputed chain. */
	const detectorMove = at > 0 ? (puzzle?.plies?.[at - 1]?.b ?? null) : null;
	/**
	 * Which move the explanation is about.
	 *
	 * Will: "I also need to be able to see the written explanations for how the
	 * other alternative moves are scored." So any row in the ranking can be
	 * asked, and the detector's own move is what it opens on.
	 */
	const [asked, setAsked] = useState<string | null>(null);
	const explained = asked ?? detectorMove ?? step?.played ?? null;
	/**
	 * The explanation is keyed by the MOVE as well as the position.
	 *
	 * It was keyed by position alone while the search filling it always argued
	 * the puzzle's move, so asking about another row changed the heading and
	 * nothing else. Caught by scripts/lab-check.mjs, which clicks the second row
	 * and asserts the explanation changed.
	 */
	const argKey = `${key}:${explained ?? ''}`;
	const argument = why && why.key === argKey ? why.value : null;

	// The note belongs to the position, so changing ply changes the box.
	useEffect(() => {
		setAsked(null);
	}, [key]);

	const noteKey = puzzle ? `${puzzle.id}:${at}` : '';
	useEffect(() => {
		setDraft(notes.get(noteKey)?.text ?? '');
	}, [noteKey, notes]);

	/** Written on blur rather than on every keystroke: it is prose, not a form. */
	const commitNote = async () => {
		if (!puzzle) return;
		const current = notes.get(noteKey)?.text ?? '';
		if (draft.trim() === current.trim()) return;
		await saveNote(puzzle.id, at, draft);
		const fresh = await loadNotes();
		setNotes(fresh);
		await syncFile([...fresh.values()]);
	};

	/**
	 * The document.
	 *
	 * A browser cannot write into the repo, so saving is a download and a drop
	 * into the folder — which is why the file is markdown that reads on its own
	 * rather than a blob that only this app understands.
	 */
	/** The document, built from whatever notes exist right now. */
	const document_ = (rows: LabNote[]) => {
		const byId = new Map(ALL.map((p) => [p.id, p]));
		const doc = toMarkdown(rows, (n) => {
			const p = byId.get(n.puzzleId);
			if (!p) return {};
			const chain = chainOf(p);
			const st = chain[n.ply];
			return {
				fen: st ? fenOf(st.pos) : undefined,
				move: st?.playedText,
				verdict: st ? VERDICT_WORD[st.verdict] : undefined,
				rating: p.rating,
				themes: p.themes,
			};
		});
		return doc;
	};

	/**
	 * Keep the linked file current.
	 *
	 * Called after every note, not on a button: the point of linking a file is
	 * that saving stops being a thing you remember to do. A restored handle whose
	 * permission has lapsed reports that instead of failing quietly, and the
	 * button below turns into the re-grant.
	 */
	const syncFile = async (rows: LabNote[]) => {
		if (!canLink()) return;
		const state = await writeLinked(document_(rows)).catch(
			() => ({ kind: 'unlinked' }) as LinkState,
		);
		setLink(state);
	};

	/** First time: pick the file. Afterwards: force a write, or re-grant. */
	const saveNow = async () => {
		const rows = [...notes.values()];
		if (!canLink()) {
			downloadAs('lab-notes.md', document_(rows));
			return;
		}
		if (link.kind === 'unlinked') {
			const picked = await linkFile('lab-notes.md');
			setLink(picked);
			if (picked.kind !== 'linked') return;
		}
		setLink(await writeLinked(document_(rows), true));
	};

	// Built AFTER the ranking is on screen, and cheaply.
	//
	// It is a second search, and running it in the same tick as the first put the
	// hang straight back: the table could not paint until the explanation
	// finished, which on one position was eight seconds. So it waits for `shown`
	// — the ranking is rendered by then — and runs a quarter of a second later
	// with a small budget. Two plies of explanation, not three: the third ply
	// costs more than it says.
	useEffect(() => {
		if (!step || at === 0 || !shown || !explained) return;
		let live = true;
		const t = setTimeout(() => {
			const value = explain(step.pos, toMove(explained), 2, 15_000);
			if (live) setWhy({ key: argKey, value });
		}, 250);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [step, at, argKey, explained, shown]);

	// Free play replaces the board's position without disturbing the annotation,
	// which stays attached to the puzzle ply it belongs to.
	const playing = freePlay && freePlay.key === key ? freePlay.moves : null;
	const shownPos = useMemo(() => {
		if (!step) return null;
		if (!playing?.length) return step.pos;
		let q = step.pos;
		for (const u of playing) {
			try {
				q = play(q, u);
			} catch {
				break;
			}
		}
		return q;
	}, [step, playing]);

	const pick = () => {
		if (!pool.length) return;
		setId(pool[Math.floor(Math.random() * pool.length)].id);
		setPly(0);
	};

	// Straight to one puzzle by its Lichess id, so a position can be revisited
	// rather than found again by shuffling.
	const jumpTo = (raw: string) => {
		const want = raw.trim().replace(/^.*\/training\//, '');
		if (!want) return;
		const found = ALL.find((p) => p.id.toLowerCase() === want.toLowerCase());
		if (!found) {
			setLookupError(`${want} is not in this set of ${ALL.length}.`);
			return;
		}
		setLookupError(null);
		// The filters would hide it, so opening a puzzle by name clears them.
		setTheme('any');
		setOnly('any');
		setId(found.id);
		setPly(0);
	};

	const sharp = pool.filter((p) => p.sharp).length;
	const coerced = pool.filter((p) => p.firm && !p.sharp).length;
	const tied = pool.filter((p) => p.clean && !p.firm).length;
	const failed = pool.length - sharp - coerced - tied;

	return (
		<div>
			<Note style={{ marginBottom: space.card }}>
				{ALL.length} puzzles from the Lichess database — positions and answers chosen by
				someone else. Everything below is the <strong>detector's</strong> own output,
				computed live by the code the app ships. Stockfish appears only if you ask for
				it, in its own clearly-labelled column. Only the solving side's moves are counted, since the opponent's replies in a
				Lichess line are one engine's pick among moves that may lose equally. A ply where
				the answer scores top but so do nine other moves counts as <em>no opinion</em>,
				not as a success.
			</Note>

			<div style={{ display: 'flex', gap: space.snug, flexWrap: 'wrap', marginBottom: space.card }}>
				<label style={{ fontSize: text.note, color: color.ink2 }}>
					Motif{' '}
					<select
						value={theme}
						onChange={(e) => {
							setTheme(e.target.value);
							setId(null);
							setPly(0);
						}}
						style={{ fontSize: text.body, padding: 4 }}
					>
						<option value="any">any ({ALL.length})</option>
						{THEMES.map((t) => (
							<option key={t} value={t}>
								{t} ({ALL.filter((p) => p.themes.includes(t)).length})
							</option>
						))}
					</select>
				</label>

				<label style={{ fontSize: text.note, color: color.ink2 }}>
					Show{' '}
					<select
						value={only}
						onChange={(e) => {
							setOnly(e.target.value as Only);
							setId(null);
							setPly(0);
						}}
						style={{ fontSize: text.body, padding: 4 }}
					>
						<option value="any">all</option>
						<option value="sharp">solved, and the answer stood alone</option>
						<option value="coerced">tied, but the most coercive move was the answer</option>
						<option value="tied">solved only by a tie — no opinion</option>
						<option value="failed">failed — it preferred another move</option>
						<optgroup label="the complex — where it fails">
							<option value="wrong">mispriced — the answer was named and outbid</option>
							<option value="noOpinion">no opinion — the answer is at the top, and so is something else</option>
							<option value="blind">never named it — the answer is not in the option set</option>
							<option value="mate">mate — any failing ply of a mate puzzle</option>
						</optgroup>
					</select>
				</label>

				<button onClick={pick} style={buttonStyle}>
					Another position
				</button>

				{/*
				  * The engine column, on a label rather than behind an icon.
				  *
				  * It was only on the toolbar's options button, whose meaning lives in
				  * a tooltip — which is to say it was invisible. A column of someone
				  * else's numbers is a big enough thing to name in words.
				  */}
				<label style={{ fontSize: text.note, color: color.ink2, alignSelf: 'center' }}>
					<input
						type="checkbox"
						checked={showEngine}
						onChange={(e) => setShowEngine(e.target.checked)}
						style={{ marginRight: 4 }}
					/>
					Stockfish column
				</label>
					<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
						<input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />{' '}
						old depth search
					</label>
					<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
						graph layer{' '}
						<select
							value={graphLayer}
							onChange={(e) => {
								setGraphLayer(e.target.value as Layer);
								setFocus(null);
							}}
						>
							{LAYERS.map((l) => (
								<option key={l.key} value={l.key}>
									{l.label}
								</option>
							))}
						</select>
					</label>
					{(graphLayer === 'owed' || graphLayer === 'cover') && (
						<label style={{ fontSize: text.note, color: color.ink2, marginLeft: 12 }}>
							owed by{' '}
							<select value={coverSide} onChange={(e) => setCoverSide(e.target.value as 'toMove' | 'other')}>
								<option value="toMove">the side to move</option>
								<option value="other">the other side</option>
							</select>
						</label>
					)}

				<form
					onSubmit={(e) => {
						e.preventDefault();
						jumpTo(lookup);
					}}
					style={{ display: 'flex', gap: space.tight, alignItems: 'center' }}
				>
					<input
						value={lookup}
						onChange={(e) => setLookup(e.target.value)}
						placeholder="puzzle id"
						aria-label="Open a puzzle by its Lichess id"
						size={10}
						style={{ fontSize: text.body, padding: 4 }}
					/>
					<button type="submit" style={buttonStyle}>
						Open
					</button>
				</form>

				<span style={{ fontSize: text.note, color: color.ink2, alignSelf: 'center' }}>
					{lookupError && <strong style={{ color: color.bad }}>{lookupError} </strong>}
					{pool.length} in this filter ·{' '}
					<strong style={{ color: color.good }}>{sharp} solved outright</strong> ·{' '}
					<strong style={{ color: color.warn }}>{coerced} tied, most coercive</strong> ·{' '}
					<strong style={{ color: color.warn }}>{tied} only by a tie</strong> ·{' '}
					<strong style={{ color: color.bad }}>{failed} failed</strong>
				</span>
			</div>

			{!puzzle || !step ? (
				<Note>Nothing matches that filter.</Note>
			) : (
				<div style={{ display: 'flex', gap: space.card, flexWrap: 'wrap', alignItems: 'flex-start' }}>
					<div
						ref={boardRef}
						style={{
							flex: '1 1 420px',
							minWidth: 320,
							maxWidth: 560,
							// See the note above the Lab component: the board holds its place
							// while the right-hand column scrolls past it.
							position: 'sticky',
							top: space.snug,
							alignSelf: 'flex-start',
						}}
					>
						<Board
							fen={fenOf(shownPos ?? step.pos)}
							size={boardSize}
							orientation={solver}
							interactive={!!playing}
							movableColor={playing ? 'both' : 'auto'}
							lastMove={
								playing?.length
									? squaresOf(playing[playing.length - 1])
									: prev
										? squaresOf(prev.played)
										: undefined
							}
							onMove={(u) => setFreePlay({ key, moves: [...(playing ?? []), u] })}
							onSelectSquare={(sqName) =>
								setFocus((f) => {
									const n = parseSquare(sqName);
									return n === undefined || f === n ? null : n;
								})
							}
							arrows={
								complexShapes.length
									? complexShapes
									: graphLayer !== 'off'
									? graphShapes
									: playing
									? []
									: optionArrows
										? optionArrows.map((c) => ({
												orig: c.uci.slice(0, 2),
												dest: c.uci.slice(2, 4),
												brush: brushForGrade(c.grade),
												label: `${c.cp > 0 ? '+' : ''}${(c.cp / 100).toFixed(1)}`,
											}))
										: arrowsFor(step, prev, shown)
							}
						/>
						{graphLayer !== 'off' && (
							<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight }}>
								{/*
								 * The square prefix belongs to a sentence ABOUT a square, and only
								 * the graph layers produce one. `makeSquare(focus as number)` with
								 * no focus is `makeSquare(0)`, so every Γ reading was labelled
								 * "a1:" — a cast standing in for a check, and the new layer is
								 * what made it visible.
								 */}
								{graphNote
									? focus !== null && graphLayer !== 'owed' && graphLayer !== 'cover' && graphLayer !== 'couplings'
										? `${makeSquare(focus)}: ${graphNote}`
										: graphNote
									: 'click a piece to show only its edges'}
							</div>
						)}
						<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight }}>
							{prev ? (
								<>
									{side(prev.mover)} has just played{' '}
									<strong style={{ color: color.ink }}>{prev.playedText}</strong> (grey arrow).{' '}
								</>
							) : null}
							{side(step.mover)} to move
							{step.mover === solver ? ' — this is the solver' : ''}.
							{playing && (
								<>
									{' '}
									<strong style={{ color: color.accent }}>
										Playing on{playing.length ? ` — ${playing.length} half-move${playing.length > 1 ? 's' : ''} in` : ''}.
									</strong>{' '}
									Drag either side; the annotation below still belongs to the puzzle position.
								</>
							)}
						</div>

							<div style={{ marginTop: space.snug }}>
							<Toolbar
								actions={[
									{
										id: 'first',
										title: 'Back to the blunder',
										icon: 'first',
										onClick: () => setPly(0),
										disabled: at === 0,
									},
									{
										id: 'back',
										title: 'Previous move in the solution',
										icon: 'back',
										onClick: () => setPly(Math.max(0, at - 1)),
										disabled: at === 0,
									},
									{
										id: 'forward',
										title: 'Next move in the solution',
										icon: 'forward',
										onClick: () => setPly(Math.min(steps.length - 1, at + 1)),
										disabled: at >= steps.length - 1,
									},
									{
										id: 'options',
										title: 'Show every option, weighted by how good it is',
										icon: 'options',
										onClick: async () => {
											if (optionArrows) {
												setOptions(null);
												return;
											}
											if (!step) return;
											const board = shownPos ?? step.pos;
											const value = await candidateMoves(fenOf(board), board.turn === 'white' ? 'w' : 'b', 5).catch(
												() => [] as Candidate[],
											);
											setOptions({ key, value });
										},
										accent: !!optionArrows,
										disabled: at === 0,
									},
									{
										id: 'play',
										title: playing
											? 'Stop playing from here and return to the puzzle position'
											: 'Play on from this position — either side may move',
										icon: 'playon',
										onClick: () => setFreePlay(playing ? null : { key, moves: [] }),
										accent: !!playing,
									},
								]}
							/>
						</div>

						{/*
						  * The answer, in the same scoresheet as Train.
						  *
						  * It was a wrapping strip of figurine chips, which reads as a list of
						  * moves rather than as a game: no numbers, and every row starting at
						  * a different move. Train solved that once already — fixed columns,
						  * one number per row — so this uses the same component rather than a
						  * second answer to the same question.
						  *
						  * The two markers carry the Lab's meanings, which happen to be the
						  * same shapes: ply 0 IS their mistake, and a ply the detector got
						  * wrong is the one worth going back to.
						  */}
						<div style={{ marginTop: space.snug }}>
							<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.tight }}>
								The solution — {side(solver)} to play and win, after the blunder.
							</div>
							<MoveList
								chips={chips}
								currentPly={plyOf(at)}
								onJump={(p) => setPly(indexOf(p))}
								titleOf={(c) => {
									const st = steps[indexOf(c.ply)];
									if (!st) return 'Go back to this move';
									if (c.mistake) return `${c.san} — the blunder the puzzle is built on`;
									if (!st.solver) return `${c.san} — the opponent's reply, shown but not counted`;
									return `${c.san} — the detector ${VERDICT_WORD[st.verdict]}`;
								}}
							/>
							<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight, display: 'flex', gap: space.card, flexWrap: 'wrap' }}>
								<span>
									<span style={{ borderBottom: `2px solid ${color.bad}` }}>the blunder</span>
								</span>
								{showOld && (
								<span>
									<span style={{ borderBottom: `2px solid ${color.warn}` }}>
										the detector got this one wrong
									</span>
								</span>
								)}
								{showOld && steps.some((x) => x.detectorText) && (
									<span>≠ marks where it would have played something else</span>
								)}
							</div>
						</div>
					</div>

					<div style={{ flex: 1, minWidth: 320 }}>
						<h3 style={{ marginTop: 0 }}>
							{puzzle.themes.join(', ')}{' '}
							<span style={{ fontWeight: 400, color: color.ink2, fontSize: text.body }}>
								· rated {puzzle.rating} ·{' '}
								<a
									href={`https://lichess.org/training/${puzzle.id}`}
									target="_blank"
									rel="noreferrer"
									style={{ color: color.ink2 }}
								>
									{puzzle.id}
								</a>
							</span>
						</h3>

						{at === 0 ? (
							<Section>
								<strong>{step.playedText}</strong> — the blunder, about to be played by{' '}
								{side(step.mover)}. It is what creates the tactic, so the detector is not
								expected to agree with it. The answer belongs to {side(solver)}, whose side of
								the board you are looking at; pick a move from the solution to see what the
								detector makes of it.
							</Section>
						) : !shown ? (
							<Section>
								<Note>Working out this position…</Note>
							</Section>
						) : (
							<Section>
								<div
									style={{
										padding: space.snug,
										borderRadius: radius.panel,
										background: color.surface,
										borderStyle: 'solid',
										borderWidth: 1,
										borderColor: color.line,
										borderLeftWidth: 4,
										borderLeftColor: step.solver ? VERDICT[shown.verdict] : color.line,
										marginBottom: space.snug,
									}}
								>
									<strong style={{ color: step.solver ? VERDICT[shown.verdict] : color.ink2 }}>
										{!step.solver
											? 'Not counted'
											: shown.verdict === 'found'
												? 'Found it'
												: shown.verdict === 'coerced'
													? 'No opinion — but the most coercive'
													: shown.verdict === 'tied'
														? 'No opinion'
														: 'Missed it'}
									</strong>{' '}
									— the puzzle plays <strong>{step.playedText}</strong> for {side(step.mover)}
									{shown.playedScore !== null && (
										<>
											, which the detector values at <strong>{material(shown.playedScore)}</strong>
										</>
									)}
									.
									{!step.solver && (
										<>
											{' '}
											This is the <strong>opponent's</strong> reply. It is Stockfish's pick among
											moves that may all lose, so a disagreement here is not a fault — the
											detector only has to find {side(solver)}'s moves.
										</>
									)}
									{step.solver && shown.verdict === 'missed' && (
										<>
											{' '}
											The detector would play <strong>{shown.bestText}</strong> instead, valuing
											it at <strong>{material(shown.best[0]?.score ?? 0)}</strong> — a gap of{' '}
											{material((shown.best[0]?.score ?? 0) - (shown.playedScore ?? 0))}.
										</>
									)}
									{step.solver && shown.verdict === 'coerced' && (
										<>
											{' '}
											<strong>{shown.ties}</strong> of the {shown.legal} legal moves score exactly
											the same on material, so the evaluation has no opinion here. This one
											leaves the opponent the fewest replies that hold, which is a reason to{' '}
											<em>look</em> at it first — not a reason to play it. Coercion orders the
											search; material decides the answer.
										</>
									)}
									{step.solver && shown.verdict === 'tied' && (
										<>
											{' '}
											But <strong>{shown.ties}</strong> of the {shown.legal} legal moves score
											exactly the same, so nothing here picked the answer out — this ply passes
											the test without the detector having said anything.
										</>
									)}
								</div>

								{showOld && (
								<table
									data-ply-detail={plyOf(at)}
									style={{ borderCollapse: 'collapse', fontSize: text.body, width: '100%' }}
								>
									<caption
										style={{
											captionSide: 'top',
											textAlign: 'left',
											color: color.ink2,
											fontSize: text.note,
											paddingBottom: space.tight,
										}}
									>
										The detector's own ranking of this position — its first row is the move it
										would play.{' '}
										{showEngine
											? 'The last column is Stockfish, for comparison; the rest of the screen never consults it.'
											: 'Stockfish is not consulted here — tick “Stockfish column” above to add its numbers beside these.'}
									</caption>
									<thead>
										<tr style={{ color: color.ink2, fontSize: text.note, textAlign: 'left' }}>
											<th style={th}>move</th>
											<th style={th}>what the detector thinks it is worth</th>
											<th style={th} title="Material this move takes on the spot">takes</th>
											<th style={th} title="The rest: what the search and the static terms add on top of the capture">
												from the line
											</th>
											{showEngine && <th style={th}>Stockfish</th>}
										</tr>
									</thead>
									<tbody>
										{shown.rank.map((s, i) => {
											const isPlayed = uci(s.move) === step.played;
											// Row 0 is the detector's own choice. Both rows are marked,
											// because the interesting case is when they are different rows
											// and a table that highlights only one of them makes the reader
											// hunt for the other.
											const isDetector = i === 0;
											const isAsked = uci(s.move) === (explained ?? step.played);
											return (
												<tr
													key={i}
													onClick={() => setAsked(uci(s.move))}
													title="Explain this move"
													style={{
														cursor: 'pointer',
														outline: isAsked ? `1px solid ${color.accent}` : undefined,
														background: isPlayed
															? color.accentSoft
															: isDetector
																? color.badSoft
																: undefined,
													}}
												>
													<td style={td}>
														{figurine(step.pos, uci(s.move))}
														{!isPlayed && isDetector && (
															<span style={{ color: color.ink2 }}> ← the detector’s move</span>
														)}
														{isPlayed && (
															<span style={{ color: color.ink2 }}>
																{' '}
																← the puzzle's move
																{/* Row 0 IS the detector's choice, so agreement is visible here. */}
																{i === 0 ? ', and the detector\u2019s' : ''}
																{shown.playedRank && shown.playedRank > 4
																	? `, ranked ${shown.playedRank}`
																	: ''}
															</span>
														)}
													</td>
													<td style={{ ...td, fontFamily: mono }}>{material(s.score)}</td>
												{(() => {
													const b = breakdown(step.pos, s);
													return (
														<>
															<td style={{ ...td, fontFamily: mono, color: color.ink2 }}>
																{b.takes ? material(b.takes) : '—'}
															</td>
															<td style={{ ...td, fontFamily: mono, color: color.ink2 }}>
																{b.rest ? material(b.rest) : '—'}
															</td>
														</>
													);
												})()}
													{showEngine && (
														<td style={{ ...td, fontFamily: mono, color: color.ink2 }}>
															{engineRows === null ? '…' : engineCp(engineRows, uci(s.move))}
														</td>
													)}
												</tr>
											);
										})}
										{shown.unranked && (
											<tr style={{ background: color.badSoft }}>
												<td style={td}>
													{step.playedText}{' '}
													<span style={{ color: color.ink2 }}>← the puzzle's move</span>
												</td>
												<td style={{ ...td, fontFamily: mono }}>never scored</td>
												{showEngine && <td style={td} />}
												<td style={td} />
												<td style={td} />
											</tr>
										)}
									</tbody>
								</table>
								)}

								{step && at > 0 && <ComplexPanel pos={step.pos} played={step.played} plyKey={key} onShapes={setComplexShapes} />}

								{step && at > 0 && showOld && (
									<LedgerPanel pos={step.pos} played={step.played} plyKey={key} engine={engineRows} />
								)}

								{showOld && argument && (
								<Section>
									<h4 style={{ margin: `0 0 ${space.tight}px` }}>Explanation</h4>
									<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.snug }}>
										How the detector arrived at its score for{' '}
										<strong style={{ color: color.ink }}>
											{figurine(step.pos, explained ?? step.played)}
										</strong>
										{explained === detectorMove && detectorMove !== step.played
											? ' — the move it would play, not the puzzle\u2019s'
											: explained === step.played
												? ' — the puzzle\u2019s move'
												: ''}
										. Ask about any row in the ranking below.
									</div>
									{(() => {
										const story = narrate(
											step.pos,
											argument,
											shown.rank
												.filter((r) => uci(r.move) !== (explained ?? step.played))
												.map((r) => ({ move: r.move, score: r.score })),
											{
												name: (p, m) => figurine(p, uci(m)),
												amount: material,
												play: (p, m) => play(p, uci(m)),
												takes: (p, m) => immediate(p, m),
											},
										);
										return (
											<div style={{ fontSize: text.body, lineHeight: 1.6 }}>
												<p style={{ margin: 0 }}>{story.opening}</p>
												{story.line.map((l, i) => (
													<p key={i} style={{ margin: `${space.tight}px 0 0` }}>
														{l}
													</p>
												))}
												<p style={{ margin: `${space.tight}px 0 0` }}>{story.closing}</p>
											</div>
										);
									})()}
									<details style={{ marginTop: space.snug }}>
										<summary style={{ fontSize: text.note, color: color.ink2, cursor: 'pointer' }}>
											the branches behind that
										</summary>
										<div style={{ marginTop: space.tight }}>
											<BranchTree pos={step.pos} node={argument} depth={0} />
										</div>
									</details>
								</Section>
							)}

							{shown.line.length > 1 && (
									<Note style={{ marginTop: space.snug }}>
										<strong>What the detector expects to happen:</strong>{' '}
										{shown.line.map((m, i) => `${i + 1}. ${m}`).join('  ')}
									</Note>
								)}
							</Section>
						)}

							{/*
						  * Notes, against this puzzle and this ply.
						  *
						  * Keyed by position rather than by puzzle, because a note about
						  * move 3 is not a note about move 7 — and because the export has
						  * to be able to say which position was being looked at.
						  */}
						<Section>
							<div
								style={{
									fontSize: text.note,
									color: color.ink2,
									marginBottom: space.tight,
									display: 'flex',
									justifyContent: 'space-between',
									gap: space.snug,
									flexWrap: 'wrap',
								}}
							>
								<span>
									Your note on <strong style={{ color: color.ink }}>{puzzle.id}</strong>, move{' '}
									{at === 0 ? 'the blunder' : at} — saved in this browser as you leave the box.
								</span>
								<span style={{ display: 'flex', gap: space.tight, alignItems: 'center' }}>
									{link.kind === 'linked' && (
										<span style={{ color: color.good }}>
											saving to <strong>{link.name}</strong>
										</span>
									)}
									{link.kind === 'needs-permission' && (
										<span style={{ color: color.warn }}>{link.name} needs permission again</span>
									)}
									<button onClick={saveNow} style={buttonStyle} disabled={!notes.size}>
										{!canLink()
											? `Download ${notes.size || ''} notes`
											: link.kind === 'linked'
												? 'Save now'
												: link.kind === 'needs-permission'
													? 'Grant access'
													: 'Link a file…'}
									</button>
								</span>
							</div>
							<textarea
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								onBlur={commitNote}
								rows={4}
								placeholder="What is actually going wrong here?"
								style={{
									width: '100%',
									boxSizing: 'border-box',
									fontSize: text.body,
									fontFamily: 'inherit',
									padding: space.snug,
									borderRadius: radius.panel,
									borderStyle: 'solid',
									borderWidth: 1,
									borderColor: notes.has(noteKey) ? color.accent : color.line,
									background: color.surface,
									color: color.ink,
									resize: 'vertical',
								}}
							/>
							{notes.size > 0 && (
								<div style={{ fontSize: text.note, color: color.ink2, marginTop: space.tight }}>
									{link.kind === 'linked'
										? 'Every note rewrites that file — nothing else to do.'
										: canLink()
											? 'Link it once to lab-notes.md in the repo root and every note after that writes itself.'
											: 'This browser has no file picker, so saving is a download — drop lab-notes.md in the repo root.'}
									{' '}
									{[...notes.values()].filter((n) => n.puzzleId === puzzle.id).length > 0 &&
										`This puzzle has ${[...notes.values()].filter((n) => n.puzzleId === puzzle.id).length} note(s).`}
								</div>
							)}
						</Section>
					</div>
				</div>
			)}
		</div>
	);
}

/**
 * The argument, as an indented list.
 *
 * Deliberately not a diagram: what is being shown is a claim of the form "these
 * are the replies they have, and each of them comes to this", and a list is what
 * that is. The indentation is the alternation of moves.
 */
function BranchTree({ pos, node, depth }: { pos: Chess; node: Branch; depth: number }) {
	let after: Chess;
	try {
		after = pos.clone();
		after.play(node.move);
	} catch {
		return null;
	}
	const constrained =
		node.forced
			? 'the only legal move'
			: node.options === 1
				? 'the only reply that holds — everything else concedes'
				: node.options > 1
					? `${node.options} replies hold`
					: null;
	return (
		<div style={{ marginLeft: depth * 14, fontSize: text.body, lineHeight: 1.6 }}>
			<span style={{ fontFamily: mono, color: depth % 2 === 0 ? color.ink : color.ink2 }}>
				{figurine(pos, uci(node.move))}
			</span>{' '}
			<span style={{ color: color.ink2 }}>
				{material(node.value)}
				{constrained ? ` · ${constrained}` : ''}
			</span>
			{node.replies.map((r, i) => (
				<BranchTree key={i} pos={after} node={r} depth={depth + 1} />
			))}
		</div>
	);
}

/** A move in algebraic notation, which is what a scoresheet wants. */
function sanOf(pos: Chess, u: string): string {
	try {
		// `makeSan` needs the position the move is played from, and does not mutate
		// it — the disambiguation it works out is exactly what a figurine string
		// cannot express.
		return makeSan(pos, toMove(u));
	} catch {
		return u;
	}
}

/**
 * Where a move's score comes from.
 *
 * Will: "For debugging it would be good if the detector score is broken down
 * into the material diff it has calculated the score on because that would make
 * the reasoning more transparent."
 *
 * A single number cannot be argued with. These three can: what the move takes on
 * the spot, what the line it believes in comes to, and the difference — which is
 * everything the search decided that is not visible on the board. On rF0aS that
 * last column was +800 for a move that touched nothing, which is exactly the
 * shape of a term firing when it should not.
 */
function breakdown(pos: Chess, s: Scored): { takes: number; line: number; rest: number } {
	const takes = immediate(pos, s.move);
	return { takes, line: s.score, rest: s.score - takes };
}

/** From-and-to of a move, for chessground's last-move highlight. */
function squaresOf(u: string): [string, string] {
	const m = toMove(u);
	return [makeSquare(m.from), makeSquare(m.to)];
}

/**
 * Three things at most: what was just played, what the answer plays next, and —
 * only when they differ — what the detector would have played instead.
 */
function arrowsFor(step: Step, prev: Step | null, detail: Detail | null) {
	const out: { orig: string; dest: string; brush: string; label?: string }[] = [];
	if (prev) {
		// Grey, off the quality ramp: this is context, not a judgement. The
		// squares are highlighted by chessground's last-move marking as well.
		const q = toMove(prev.played);
		out.push({ orig: makeSquare(q.from), dest: makeSquare(q.to), brush: 'past' });
	}
	// The puzzle's move is the answer, so it is always the strongest arrow on the
	// board. It used to fade to `q3` on a miss while the detector's mistaken
	// choice got `q0` — the heaviest green on the ramp — which drew the wrong move
	// louder than the right one and said "best" about it into the bargain.
	const p = toMove(step.played);
	out.push({ orig: makeSquare(p.from), dest: makeSquare(p.to), brush: 'q0' });
	if (detail?.verdict === 'missed' && detail.best[0]) {
		// Red, because it is wrong. Nothing on the green ramp can say that.
		const b = detail.best[0].move;
		out.push({ orig: makeSquare(b.from), dest: makeSquare(b.to), brush: 'red' });
	}
	return out;
}

const buttonStyle: React.CSSProperties = {
	fontSize: text.body,
	padding: '4px 12px',
	borderRadius: radius.panel,
	borderStyle: 'solid',
	borderWidth: 1,
	borderColor: color.line,
	background: color.surface,
	color: color.ink,
	cursor: 'pointer',
};

const th: React.CSSProperties = { fontWeight: 400, padding: '2px 12px 4px 0' };
const td: React.CSSProperties = { padding: '3px 12px 3px 0' };

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
import { positionFromFen, parseSquare, makeSquare, fenOf } from '../domain/chess';
import { Toolbar } from '../components/Toolbar';
import { candidateMoves, brushForGrade, type Candidate } from '../engine/candidates';
import { MoveList, type MoveChip } from '../components/MoveList';
import { useBoardSize } from '../components/BoardPanel';
import { loadNotes, saveNote, toMarkdown } from '../domain/labNotes';
import type { LabNote } from '../data/db';
import { canLink, downloadAs, linkFile, restoreLink, writeLinked, type LinkState } from '../data/fileLink';
import { makeSan } from 'chessops/san';
import type { Chess } from 'chessops/chess';
import type { NormalMove, Role, Color } from 'chessops/types';
import { color, space, radius, text, mono } from '../ui/theme';
import { Note, Section, Button } from '../ui/primitives';
import PUZZLES from '../data/labPuzzles.json';
import LEDGER from '../data/ledgerBuckets.json';
import { recall, remember } from '../data/viewState';
import { LadderPanel } from '../components/LadderPanel';
import { ExplainPanel, type Ask } from '../components/ExplainPanel';
import type { BoardOverride } from '../components/LinePlayer';
import type { Shape as ComplexShape } from '../components/Board';
import { build as buildGraph } from '../domain/graph';
import { shapesFor, describe as readGraph, LAYERS, type Layer } from '../domain/graphShapes';
import { TrainingWheels } from '../components/TrainingWheels';
import { wheelShapes, wheelNotes, mateLine, mateArrows, mateNote, type Wheel } from '../domain/wheels';

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


const side = (c: Color) => (c === 'white' ? 'White' : 'Black');


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
	/**
	 * The question the explainer is answering, or null.
	 *
	 * Held here rather than inside the panel because opening a new question from
	 * elsewhere in the Lab has to REPLACE the conversation, not push onto it — the
	 * panel owns the recursion, the Lab owns which conversation is happening.
	 */
	const [asking, setAsking] = useState<Ask | null>(null);
	/**
	 * The board, borrowed by the explainer while a line is being walked.
	 *
	 * It wins over everything else: it is the most recently asked-for thing on
	 * screen, and mixing a hypothetical position with the real one's overlays would
	 * be worse than either.
	 */
	const [borrowed, setBorrowed] = useState<BoardOverride>(null);
	/** Clicking a square focuses the overlay on that piece; a full board is a hairball. */
	const [focus, setFocus] = useState<number | null>(null);
	/**
	 * The training-wheels menu (PLAN-EXPLAINER §5). Independent of whether an
	 * explanation is open, which is the point of it being a separate control: a
	 * reader looking at a position wants to name what is on the board without
	 * first asking a question about a move.
	 */
	const [wheels, setWheels] = useState<ReadonlySet<Wheel>>(() => new Set<Wheel>());
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

	// Four of the five wheels are pure board computations — the most expensive is a
	// few milliseconds — so this memoises on the position and the focused man and
	// needs no engine, no cache and no loading state.
	const wheelDraw = useMemo(
		() => (step && wheels.size ? wheelShapes(step.pos, wheels, focus) : []),
		[step, wheels, focus],
	);
	const wheelSays = useMemo(() => (step && wheels.size ? wheelNotes(step.pos, wheels) : []), [step, wheels]);

	/**
	 * MATE IS THE EXCEPTION and gets its own effect.
	 *
	 * It is a df-pn search — `scripts/mate-line-cost.mjs` measured mean 80ms and a
	 * worst case of 987ms — so running it inside the memo above would freeze the
	 * board for up to a second every time the ply changed. `working` exists so the
	 * checkbox says what it is doing rather than appearing to have done nothing.
	 *
	 * `cancelled` guards the position changing while a solve is in flight: without
	 * it a slow search resolves after the reader has stepped on and draws a mate
	 * from the previous position onto this one.
	 */
	const [mate, setMate] = useState<{ arrows: ComplexShape[]; note: string } | null>(null);
	const [mateWorking, setMateWorking] = useState(false);
	useEffect(() => {
		if (!step || !wheels.has('mate')) {
			setMate(null);
			setMateWorking(false);
			return;
		}
		let cancelled = false;
		setMateWorking(true);
		// A macrotask, so the checkbox and the working state paint before the search
		// blocks the thread. This is not concurrency — it is the minimum needed for
		// the UI to be honest about what it is doing.
		const id = setTimeout(() => {
			let found: ReturnType<typeof mateLine> = null;
			try {
				found = mateLine(step.pos);
			} catch {
				found = null;
			}
			if (cancelled) return;
			setMate(found ? { arrows: mateArrows(found), note: mateNote(found) } : null);
			setMateWorking(false);
		}, 0);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [step, wheels]);

	const graphShapes = useMemo(
		() => (graph && step ? shapesFor(graph, graphLayer, focus, step.pos.board) : []),
		[graph, graphLayer, focus, step],
	);
	// The `owed`, `cover` and `couplings` layers went to the attic with the ledger2
	// stack (M6), and their captions with them. What is left is the graph's own
	// reading, which depends on nothing but `graph.ts` and `reach.ts`.
	const graphNote = graph && step ? readGraph(graph, focus, step.pos.board) : null;

	const engineRows = showEngine && engine && engine.key === key ? engine.value : null;
	const optionArrows = options && options.key === key ? options.value : null;
	// The note belongs to the position, so changing ply changes the box.

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
							fen={borrowed ? borrowed.fen : fenOf(shownPos ?? step.pos)}
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
								borrowed
									? borrowed.arrows
									: // The wheels are a deliberate choice the reader has just made, so
									  // they outrank the automatic overlays — but not a borrowed board,
									  // which is showing a different position entirely.
									  wheelDraw.length || (mate?.arrows.length ?? 0)
									? [...wheelDraw, ...(mate?.arrows ?? [])]
									: complexShapes.length
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
										: arrowsFor(step, prev)
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
									? focus !== null
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
						) : (
							<Section>
								{/*
								  * WHAT THIS PLY IS, AND NOTHING INFERRED.
								  *
								  * This box used to be the old depth search narrating itself — "the
								  * detector values it at …", "the detector would play … instead". That
								  * stack is in `attic/depth-search` (M6) and its commentary went with
								  * it, because a sentence about an evaluator nobody runs any more is
								  * worse than no sentence.
								  *
								  * What is left is the fact: whose move, what was played, and whether
								  * it counts. Every judgement on this screen is now something the
								  * reader turned on — the ladder, the wheels, the explainer, or the
								  * engine table below.
								  */}
								<div
									style={{
										padding: space.snug,
										borderRadius: radius.panel,
										background: color.surface,
										borderStyle: 'solid',
										borderWidth: 1,
										borderColor: color.line,
										borderLeftWidth: 4,
										borderLeftColor: step.solver ? color.accent : color.line,
										marginBottom: space.snug,
									}}
								>
									The puzzle plays <strong>{step.playedText}</strong> for {side(step.mover)}.
									{!step.solver && (
										<>
											{' '}
											This is the <strong>opponent's</strong> reply — shown, but not one of the
											moves a solver has to find.
										</>
									)}
								</div>

								{/*
								  * THE STOCKFISH COLUMN, WHICH IS NOW THE WHOLE TABLE.
								  *
								  * It used to be one column beside the old detector's ranking, and when
								  * that table was archived the comparison would have gone with it. Will
								  * asked for it to stay, and it is the right call: the engine is the
								  * ORACLE (PLAN-EXPLAINER §0), so its ranking is the one thing on this
								  * screen that is not an opinion this project is responsible for.
								  *
								  * Rows are clickable, and that is the same doorway Train and Mistakes
								  * have: any move here can be asked about, against the others as its
								  * comparison set.
								  */}
								{showEngine &&
									(engineRows ? (
										<EngineTable rows={engineRows} played={step.played} onAsk={(uci) =>
											setAsking({ fen: fenOf(step.pos), uci, alternatives: engineRows.map((r) => r.uci) })
										} />
									) : (
										<Note>Asking Stockfish…</Note>
									))}

								
								{/*
								  * THE EXPLAINER. Asks about the puzzle's own move, against the
								  * engine's choice — which is the comparison a reader of this panel
								  * wants first. Everything deeper is reached by the "?" inside it.
								  */}
								{step && at > 0 && (
									<div style={{ marginBottom: space.snug }}>
										{asking ? (
											<ExplainPanel
												{...asking}
												onBoard={setBorrowed}
												onClose={() => {
													setAsking(null);
													setBorrowed(null);
												}}
											/>
										) : (
											<Button
												onClick={() =>
													setAsking({ fen: fenOf(step.pos), uci: step.played })
												}
											>
												Explain {step.playedText}
											</Button>
										)}
									</div>
								)}

								{step && (
									<TrainingWheels
										on={wheels}
										onChange={setWheels}
										notes={mate ? [...wheelSays, mate.note] : wheelSays}
										hasFocus={focus !== null}
										working={mateWorking ? 'mate' : null}
									/>
								)}

								{step && at > 0 && <LadderPanel pos={step.pos} played={step.played} plyKey={key} onShapes={setComplexShapes} onBoard={setBorrowed} />}



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


/** From-and-to of a move, for chessground's last-move highlight. */
function squaresOf(u: string): [string, string] {
	const m = toMove(u);
	return [makeSquare(m.from), makeSquare(m.to)];
}

/**
 * Three things at most: what was just played, what the answer plays next, and —
 * only when they differ — what the detector would have played instead.
 */
function arrowsFor(step: Step, prev: Step | null) {
	// THE PLAYED MOVE, AND NOTHING ELSE INFERRED.
	//
	// This used to add a red arrow for the old depth search's own pick whenever it
	// disagreed with the puzzle. Will, on whether the ladder should inherit that
	// slot: "Why would we show the ladder's move when the ladder is wrong and
	// superseded? Lab default should show only the played move."
	//
	// That is right, and it is the same mistake in a new coat. An arrow drawn
	// without being asked for reads as the app's answer, and this project no
	// longer has an analytical answer it stands behind — the engine is the oracle
	// and everything else is a lens the reader chooses. So the default board is
	// the position and what was played on it; the ladder, the wheels and the
	// explainer all draw only when switched on.
	const out: { orig: string; dest: string; brush: string; label?: string }[] = [];
	if (prev) {
		// Grey, off the quality ramp: this is context, not a judgement. The
		// squares are highlighted by chessground's last-move marking as well.
		const q = toMove(prev.played);
		out.push({ orig: makeSquare(q.from), dest: makeSquare(q.to), brush: 'past' });
	}
	const p = toMove(step.played);
	out.push({ orig: makeSquare(p.from), dest: makeSquare(p.to), brush: 'q0' });
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

/**
 * Stockfish's ranking for this position.
 *
 * The only table left in the Lab, and the only ranking on the screen that is not
 * this project's opinion. `loss` is the gap to the engine's best, which is the
 * number a reader actually wants; `cp` is kept beside it because a move can be
 * near-best in a lost position and the two say different things.
 *
 * The puzzle's own move is marked and is always present even when it falls
 * outside the engine's top twelve — a table that silently omits the answer is
 * the one thing this screen must not do.
 */
function EngineTable({
	rows,
	played,
	onAsk,
}: {
	rows: Candidate[];
	played: string;
	onAsk: (uci: string) => void;
}) {
	const has = rows.some((r) => r.uci === played);
	return (
		<div style={{ overflowX: 'auto' }}>
			<table style={{ borderCollapse: 'collapse', fontSize: text.body, width: '100%' }}>
				<caption style={{ captionSide: 'top', textAlign: 'left', fontSize: text.note, color: color.ink2, paddingBottom: space.tight }}>
					Stockfish, ranked. ★ is the puzzle's move. <em>Click a row to ask why.</em>
				</caption>
				<thead>
					<tr style={{ color: color.ink2 }}>
						<th style={th}> </th>
						<th style={th}>move</th>
						<th style={{ ...th, textAlign: 'right' }}>eval</th>
						<th style={{ ...th, textAlign: 'right' }}>loss</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr
							key={r.uci}
							onClick={() => onAsk(r.uci)}
							style={{ cursor: 'pointer', borderTop: `1px solid ${color.line}` }}
						>
							<td style={td}>{r.uci === played ? '★' : ''}</td>
							<td style={{ ...td, fontWeight: r.uci === played ? 600 : 400 }}>{r.san}</td>
							<td style={{ ...td, textAlign: 'right', fontFamily: mono }}>{cp(r.cp)}</td>
							<td style={{ ...td, textAlign: 'right', fontFamily: mono, color: r.loss ? color.ink2 : color.good }}>
								{r.loss ? `−${(r.loss / 100).toFixed(2)}` : '—'}
							</td>
						</tr>
					))}
					{!has && (
						// Said, rather than left blank. A blank cell reads as "zero" or as
						// "the engine agrees"; being outside the top twelve is neither, and
						// is itself a judgement worth printing as one.
						<tr style={{ borderTop: `1px solid ${color.line}` }}>
							<td style={td}>★</td>
							<td style={{ ...td, fontWeight: 600 }} colSpan={3}>
								<span style={{ color: color.ink2 }}>the puzzle's move is not in its top twelve</span>
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

const th: React.CSSProperties = { fontWeight: 400, padding: '2px 12px 4px 0' };
const td: React.CSSProperties = { padding: '3px 12px 3px 0' };

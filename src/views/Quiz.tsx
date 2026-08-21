// Quiz: the positions you got wrong, until you do not.
//
// Deliberately stricter than a run. There is no "works too" here — the card
// exists because a specific move was missed, and the point is to produce that
// move. Getting it wrong puts the card straight back in the queue rather than
// moving on, which is what "repeat until correct" means.

import { useEffect, useMemo, useState } from 'react';
import { BoardPanel } from '../components/BoardPanel';
import type { ToolbarAction } from '../components/Toolbar';
import { analysePosition, toColourPov } from '../data/cloudEval';
import { candidateMoves, brushForGrade, colourForGrade, type Candidate } from '../engine/candidates';
import { loadMistakes, saveCard, clearMistakes, deleteCard } from '../data/mistakes';
import {
	answer,
	due,
	summarise,
	inCategories,
	countByCategory,
	CATEGORIES,
	RETIRE_STREAK,
	type MistakeCard,
} from '../domain/mistakes';
import { applyUci, sameMove, replayLine } from '../domain/chess';
import { Empty, Button, Panel } from '../ui/primitives';
import { MoveList } from '../components/MoveList';
import { Move } from '../components/Move';
import { withGlyph } from '../domain/notation';
import { nameForPath } from '../domain/openings';
import { registerDebug, describePosition } from '../data/debug';
import { useViewport } from '../components/useViewport';
import { color } from '../ui/theme';

const INK_2 = color.ink2;

export function Quiz({ onOpenSettings }: { onOpenSettings?: () => void }) {
	const [cards, setCards] = useState<MistakeCard[]>([]);
	const [queue, setQueue] = useState<MistakeCard[]>([]);
	const [current, setCurrent] = useState<MistakeCard | null>(null);
	const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
	const [reveal, setReveal] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [done, setDone] = useState(0);
	const [boardVersion, setBoardVersion] = useState(0);
	/** Evaluation of the card's position, from our side. Null until it arrives. */
	const [evalCp, setEvalCp] = useState<number | null>(null);
	const [candidates, setCandidates] = useState<Candidate[] | null>(null);
	const [busy, setBusy] = useState(false);
	const vp = useViewport();
	/** Categories to draw from. Empty means all of them, not none. */
	const [categories, setCategories] = useState<MistakeCard['phase'][]>([]);

	async function reload(cats: MistakeCard['phase'][] = categories) {
		const all = await loadMistakes();
		setCards(all);
		const q = due(inCategories(all, cats), Date.now());
		setQueue(q);
		setCurrent(q[0] ?? null);
		setLoaded(true);
	}

	function toggleCategory(id: MistakeCard['phase']) {
		const next = categories.includes(id)
			? categories.filter((c) => c !== id)
			: [...categories, id];
		setCategories(next);
		void reload(next);
	}

	useEffect(() => {
		void reload();
	}, []);

	// Exposed to the console: schackal.dump(). Registered fresh on every render
	// so the snapshot closes over current state rather than the first render's.
	useEffect(() =>
		registerDebug('quiz', () => ({
			fen: current?.fen ?? null,
			position: describePosition(current?.fen),
			boardVersion,
			reveal,
			feedback,
			queueLength: queue.length,
			answeredThisSession: done,
			card: current && {
				id: current.id,
				phase: current.phase,
				ourColour: current.ourColour,
				expected: `${current.expectedSan} (${current.expectedUci})`,
				played: current.playedSan,
				ply: current.ply,
				streak: current.streak,
				lapses: current.lapses,
				retired: current.retired,
				dueAt: new Date(current.dueAt).toISOString(),
				origin: current.origin ?? null,
			},
			deck: cards.map((c) => ({
				id: c.id,
				phase: c.phase,
				expected: c.expectedUci,
				lapses: c.lapses,
				streak: c.streak,
				retired: c.retired,
				due: new Date(c.dueAt).toISOString(),
				// The check most worth making automatically: a card whose position
				// has the wrong side to move can never be answered.
				stmMatchesUs: safeStm(c.fen) === c.ourColour,
			})),
		})),
	);

	// The trainer has always shown a running evaluation; the quiz did not, so the
	// same position read as two different exercises depending on the tab. One
	// search per card, cached, and null until it lands rather than a fake zero.
	useEffect(() => {
		let live = true;
		setEvalCp(null);
		if (!current) return;
		const fen = current.fen;
		const colour = current.ourColour;
		void (async () => {
			try {
				const a = await analysePosition(fen, 14, 1, 250);
				if (live) setEvalCp(toColourPov(a.pvs[0]?.cpWhite ?? 0, colour));
			} catch {
				/* leave it blank — see "honest numbers or no numbers" */
			}
		})();
		return () => {
			live = false;
		};
	}, [current?.id]);

	/** Every legal move, weighted by quality — the trainer's own help, unchanged. */
	async function showOptions() {
		if (!current || busy) return;
		setBusy(true);
		try {
			setCandidates(await candidateMoves(current.fen, current.ourColour, 5));
			// Using help means the answer no longer counts, exactly as in the trainer.
			setReveal(true);
		} catch (e) {
			setFeedback({ ok: false, text: (e as Error).message });
		} finally {
			setBusy(false);
		}
	}

	/**
	 * The moves that led to this position, replayed.
	 *
	 * A card used to appear as a position with no history — you were asked what
	 * you should have played without being shown what had just happened, which
	 * for a mistake mined from a real game is most of the information. The path
	 * is already stored on every card; nothing has to be fetched.
	 */
	const line = useMemo(() => (current?.path?.length ? replayLine(current.path) : []), [current]);

	// replayLine returns the START position at index 0 and the position AFTER
	// ply i at index i, so the last entry is the card's own position and there
	// is one more entry than there are moves.
	const lastPly = Math.max(0, line.length - 1);

	/** Which position is on the board. `null` means the card itself. */
	const [previewPly, setPreviewPly] = useState<number | null>(null);
	const atCard = previewPly === null || previewPly >= lastPly;
	const boardFen = atCard ? current?.fen : line[previewPly as number]?.fen;

	/**
	 * The move that produced the position being shown.
	 *
	 * On the card itself this is the OPPONENT'S last move — which is exactly the
	 * thing you need to see in order to know what you are being asked.
	 */
	const lastMove = ((): [string, string] | undefined => {
		const uci = line[atCard ? lastPly : (previewPly as number)]?.uci;
		return uci ? [uci.slice(0, 2), uci.slice(2, 4)] : undefined;
	})();

	function step(delta: number) {
		const at = previewPly === null ? lastPly : previewPly;
		const to = Math.max(0, Math.min(lastPly, at + delta));
		setPreviewPly(to >= lastPly ? null : to);
	}

	function actions(): ToolbarAction[] {
		return [
			{
				id: 'first',
				title: 'Back to the start of the game',
				icon: 'first',
				onClick: () => setPreviewPly(0),
				disabled: !lastPly || previewPly === 0,
			},
			{
				id: 'back',
				title: 'Step back through the moves that led here',
				icon: 'back',
				onClick: () => step(-1),
				disabled: !lastPly || previewPly === 0,
			},
			{
				id: 'forward',
				title: 'Step forward, back towards the position you have to answer',
				icon: 'forward',
				onClick: () => step(1),
				disabled: !lastPly || atCard,
			},
			{
				id: 'options',
				title: 'Show every legal move, weighted by how good it is (stops this card counting)',
				icon: 'options',
				onClick: showOptions,
				disabled: !current || busy || !!candidates,
			},
			{
				id: 'reveal',
				title: 'Show me the move (stops this card counting)',
				icon: 'reveal',
				onClick: () => setReveal(true),
				disabled: !current || reveal,
			},
			{
				id: 'skip',
				title: 'Skip — put this card to the back of the queue',
				icon: 'playon',
				onClick: () => next([...queue.slice(1), queue[0]]),
				disabled: queue.length < 2,
			},
		];
	}

	function next(fromQueue: MistakeCard[]) {
		setQueue(fromQueue);
		setCurrent(fromQueue[0] ?? null);
		setFeedback(null);
		setReveal(false);
		setCandidates(null);
		// Back to the position being asked about. Carrying a preview across cards
		// would show one card's history under another card's question.
		setPreviewPly(null);
		// Always, not just on rejection. Two cards can share a position (same slip,
		// two candidate answers), and then `fen` does not change between them —
		// the board would keep the dests it consumed on the last move, i.e. none.
		setBoardVersion((v) => v + 1);
	}

	async function onMove(uci: string) {
		if (!current) return;

		// Not string equality — a card whose answer is castling was stored with
		// chessops' king-takes-rook spelling and could never be answered.
		const correct = sameMove(current.fen, uci, current.expectedUci);
		const updated = answer(current, correct && !reveal, Date.now());
		await saveCard(updated);
		setCards((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));

		let san = uci;
		try {
			san = withGlyph(applyUci(current.fen, uci).san, current.ourColour);
		} catch {
			/* keep the uci */
		}

		if (correct) {
			setFeedback({
				ok: true,
				text: reveal
					? `${san} — correct, but you were shown it. The card stays in the deck.`
					: updated.retired
						? `${san} — correct ${RETIRE_STREAK} times running. Retired.`
						: `${san} — correct. ${RETIRE_STREAK - updated.streak} more to retire it.`,
			});
			setDone((d) => d + 1);
			// Correct answers leave the queue; a shown one goes to the back.
			const rest = queue.slice(1);
			setTimeout(() => next(reveal ? [...rest, updated] : rest), 900);
		} else {
			// Straight back to the same card.
			setBoardVersion((v) => v + 1);
			setFeedback({ ok: false, text: `${san} is not it. Try again.` });
		}
	}

	if (!loaded) return <p style={{ opacity: 0.6 }}>Loading…</p>;

	const stats = summarise(inCategories(cards, categories), Date.now());
	const counts = countByCategory(cards, Date.now());

	if (!cards.length) {
		return (
			<Empty>
				<p style={{ margin: '0 0 10px', maxWidth: 520, display: 'inline-block' }}>
					No mistakes recorded yet. Anything you get wrong while training lands here on its
					own — and your real games are mined for the mistakes you made when it counted.
				</p>
				<div>
					{onOpenSettings && (
						<Button onClick={onOpenSettings}>Check your game import</Button>
					)}
				</div>
			</Empty>
		);
	}

	return (
		<div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
			<div
				style={{
					flex: vp.stacked ? '1 1 100%' : '1 1 320px',
					minWidth: 0,
					maxWidth: vp.stacked ? undefined : 560,
				}}
			>
				{current ? (
					<BoardPanel
						fen={boardFen ?? current.fen}
						ourColour={current.ourColour}
						evalCp={evalCp}
						lastMove={lastMove}
						// Only the card's own position accepts a move. Stepping back is
						// for looking; answering somewhere else in the game would be
						// answering a different question.
						interactive={!busy && atCard}
						onMove={onMove}
						version={boardVersion}
						actions={actions()}
						busy={busy}
						arrows={
							candidates
								? candidates.map((c) => ({
										orig: c.uci.slice(0, 2),
										dest: c.uci.slice(2, 4),
										brush: brushForGrade(c.grade),
										label: `${c.cp > 0 ? '+' : ''}${(c.cp / 100).toFixed(1)}`,
									}))
								: reveal
									? [
											{
												orig: current.expectedUci.slice(0, 2),
												dest: current.expectedUci.slice(2, 4),
												brush: 'green',
											},
										]
									: []
						}
					>
						<div style={{ marginTop: 10, minHeight: 96 }}>
							{brokenReason(current) ? (
								<div
									style={{
										fontSize: 13,
										background: '#ffebee',
										border: '1px solid #ef9a9a',
										borderRadius: 6,
										padding: '6px 8px',
										marginBottom: 6,
									}}
								>
									<strong>This card cannot be answered.</strong> {brokenReason(current)}{' '}
									<button
										onClick={async () => {
											await deleteCard(current.id);
											await reload();
										}}
										style={{ fontSize: 12, marginLeft: 4 }}
									>
										Remove it
									</button>
								</div>
							) : null}
							<div style={{ fontSize: 15 }}>
								<strong>Your move.</strong> {promptFor(current)}
							</div>
							<div style={{ fontSize: 13, color: INK_2, marginTop: 2 }}>
								{namesFor(current)} · you played{' '}
								<Move san={current.playedSan} colour={current.ourColour} size={13} /> ·
								missed {current.lapses}×
								{current.origin && (
									<>
										{' · '}
										<a
											href={current.origin.url}
											target="_blank"
											rel="noreferrer"
											style={{ color: INK_2 }}
										>
											see the game
										</a>
									</>
								)}
							</div>

							{feedback && (
								<div
									style={{
										marginTop: 8,
										fontSize: 14,
										color: feedback.ok ? '#2e7d32' : '#c62828',
									}}
								>
									{feedback.text}
								</div>
							)}

							{candidates && (
								<ol
									style={{
										fontSize: 13,
										paddingLeft: 0,
										listStyle: 'none',
										margin: '8px 0 0',
									}}
								>
									{candidates.map((c) => (
										<li
											key={c.uci}
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: 8,
												padding: '3px 0',
											}}
										>
											{/* Same swatch and ramp as the board draws. */}
											<span
												style={{
													width: 18,
													height: 6,
													borderRadius: 3,
													background: colourForGrade(c.grade),
													flexShrink: 0,
												}}
											/>
											<Move san={c.san} colour={current.ourColour} bold size={13} />
											<span style={{ opacity: 0.75, marginLeft: 'auto' }}>
												{c.cp > 0 ? '+' : ''}
												{(c.cp / 100).toFixed(2)}
												{c.loss > 0 && <span style={{ opacity: 0.6 }}> −{c.loss}</span>}
											</span>
										</li>
									))}
								</ol>
							)}

							{/* The run-up to the position. A mistake from a real game
								without the moves that produced it is a puzzle with the
								premise removed — and every card already stores the path,
								so nothing is fetched to show this. */}
							{lastPly > 0 && (
								<div style={{ marginTop: 10 }}>
									<MoveList
										// Index 0 is the starting position, not a move.
										chips={line.slice(1).map((m, i) => ({
											san: m.san ?? '',
											ply: i + 1,
											mistake: false,
											suboptimal: false,
											white: i % 2 === 0,
										}))}
										currentPly={atCard ? lastPly : (previewPly as number)}
										onJump={(ply) => setPreviewPly(ply >= lastPly ? null : ply)}
									/>
									{!atCard && (
										<Panel tone="accent" style={{ marginTop: 8, fontSize: 13 }}>
											Looking back at move {Math.ceil(((previewPly ?? 0) + 1) / 2)}. Step
											forward to answer the card.
										</Panel>
									)}
								</div>
							)}
						</div>
					</BoardPanel>
				) : (
					<p style={{ fontSize: 15 }}>
						Nothing due right now — {done} answered this session. Cards come back on the usual
						schedule, sooner if you miss them.
						{categories.length > 0 && (
							<>
								{' '}
								You are only drawing from{' '}
								{categories
									.map((c) => CATEGORIES.find((x) => x.id === c)?.label ?? c)
									.join(' and ')}
								;{' '}
								<button
									onClick={() => {
										setCategories([]);
										void reload([]);
									}}
									style={{ fontSize: 13 }}
								>
									show all
								</button>{' '}
								for the rest.
							</>
						)}
					</p>
				)}
			</div>

			<div style={{ flex: vp.stacked ? '1 1 100%' : '1 1 260px', minWidth: 0 }}>
				<h3 style={{ marginTop: 0 }}>Deck</h3>

				{/* Four different exercises share one deck; drilling one of them is a
					reasonable thing to want. Nothing selected means everything, so an
					empty filter never looks like an empty deck. */}
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
					{CATEGORIES.map((cat) => {
						const n = counts[cat.id] ?? { total: 0, due: 0 };
						const on = categories.includes(cat.id);
						return (
							<button
								key={cat.id}
								onClick={() => toggleCategory(cat.id)}
								disabled={n.total === 0}
								title={`${cat.note} ${n.due} due of ${n.total}.`}
								style={{
									fontSize: 12,
									padding: '4px 8px',
									borderRadius: 14,
									border: `1px solid ${on ? '#1565c0' : '#ddd'}`,
									background: on ? '#e3f2fd' : '#fff',
									color: n.total === 0 ? '#b5b4b0' : '#1a1a19',
									cursor: n.total === 0 ? 'default' : 'pointer',
									touchAction: 'manipulation',
								}}
							>
								{cat.label}{' '}
								<span style={{ color: INK_2 }}>
									{n.due}/{n.total}
								</span>
							</button>
						);
					})}
				</div>
				{categories.length > 0 && (
					<button
						onClick={() => {
							setCategories([]);
							void reload([]);
						}}
						style={{ fontSize: 11, marginBottom: 8 }}
					>
						Show all categories
					</button>
				)}
				<div style={{ fontSize: 14 }}>
					<strong>{stats.due}</strong> due · {stats.learning} in the deck · {stats.retired}{' '}
					retired
				</div>
				<p style={{ fontSize: 12, color: INK_2 }}>
					A card retires after {RETIRE_STREAK} correct answers in a row on separate occasions.
					Being shown the move does not count towards that — answering right after seeing the
					answer is not evidence you knew it.
				</p>

				<h3>Hardest</h3>
				<ol style={{ fontSize: 13, paddingLeft: 20 }}>
					{[...inCategories(cards, categories)]
						.sort((a, b) => b.lapses - a.lapses)
						.slice(0, 8)
						.map((c) => (
							<li key={c.id} style={{ marginBottom: 2 }}>
								<Move san={c.expectedSan} colour={c.ourColour} bold size={13} />{' '}
								<span style={{ color: INK_2 }}>
									(played{' '}
									<Move san={c.playedSan} colour={c.ourColour} size={12} />) — missed{' '}
									{c.lapses}×{c.retired && ' · retired'}
								</span>
								{lineLabelFor(c) && (
									<div style={{ fontSize: 11, color: INK_2 }}>{lineLabelFor(c)}</div>
								)}
							</li>
						))}
				</ol>

				{/* The debug handle now lives in the screen corner on every tab
					(components/DebugCorner.tsx) — a bug is not always on this one. */}
				<button
					onClick={async () => {
						await clearMistakes();
						await reload();
					}}
					style={{ fontSize: 13, marginTop: 8 }}
				>
					Clear deck
				</button>
			</div>

		</div>
	);
}

/**
 * Why this card can never be answered, or '' if it can.
 *
 * A card whose position has the opponent to move looks completely normal — the
 * board is oriented your way and the pieces are all there — but chessground
 * will only let the side to move be dragged, so every piece you reach for is
 * inert. From the outside that is indistinguishable from a broken board, which
 * is exactly why it is worth naming rather than leaving to be diagnosed.
 */
function brokenReason(c: MistakeCard): string {
	const stm = safeStm(c.fen);
	if (stm !== c.ourColour) {
		const side = (x: string) => (x === 'w' ? 'White' : x === 'b' ? 'Black' : `"${x}"`);
		return `The position has ${side(stm)} to move, but the card is stored as ${side(
			c.ourColour,
		)}. Nothing you drag will be accepted.`;
	}
	const pos = describePosition(c.fen) as { error?: string; legalMoves?: number };
	if (pos.error) return `The stored position is not valid (${pos.error}).`;
	if (!pos.legalMoves) return 'The stored position has no legal moves — the game is already over.';
	return '';
}

function safeStm(fen: string): string {
	try {
		return fen.split(' ')[1] ?? '?';
	} catch {
		return '?';
	}
}

export function promptFor(c: MistakeCard): string {
	// The motif comes first: a card mined from a real game where THEY blundered
	// asks a different question from one where we simply went wrong, and reading
	// "you played X and it cost 4.0" over a position you were winning describes
	// the wrong event.
	if (c.motif === 'missed-punish') {
		return `They had just blundered here. You played ${withGlyph(
			c.playedSan,
			c.ourColour,
		)} and let it go — find the punishment.`;
	}

	switch (c.phase) {
		case 'punish':
			return 'You missed the punishment here.';
		case 'book':
			return 'You lost the line here.';
		case 'game':
			return `You played ${withGlyph(c.playedSan, c.ourColour)} here in a real game, and it cost ${(
				(c.origin?.loss ?? 0) / 100
			).toFixed(1)}.`;
		default:
			return 'This move cost you material here.';
	}
}

/**
 * Which line this position belongs to, and where in it.
 *
 * Cards mined from real games used to show only the opponent and the date,
 * which says where the card came FROM but not what it is ABOUT — and "what is
 * it about" is the thing that makes a card connect to the rest of the deck. The
 * name is derived from the path when it was not recorded, so old cards and
 * game-mined cards get labelled too rather than only new book ones.
 */
export function lineLabelFor(c: MistakeCard): string | null {
	if (c.opening) return c.opening;
	// Cards made before openings were recorded still carry their old line IDs.
	if (c.lineIds?.length) return c.lineIds[0];
	if (c.path?.length) return nameForPath(c.path)?.name ?? null;
	return null;
}

/**
 * The move number the mistake was played on.
 *
 * `path` holds the moves BEFORE it, so the mistake is ply `path.length` counting
 * from zero — one further on than the path is long.
 */
export function moveNumberFor(c: MistakeCard): { no: number; white: boolean } {
	const ply = c.path?.length ?? c.ply ?? 0;
	return { no: Math.floor(ply / 2) + 1, white: ply % 2 === 0 };
}

function namesFor(c: MistakeCard): string {
	const parts: string[] = [];

	const line = lineLabelFor(c);
	const { no, white } = moveNumberFor(c);
	// Spelled out rather than left to the reader: "7…" is only obviously Black's
	// if you already know the convention, and the point is to be read, not decoded.
	parts.push(line ? `${line}, move ${no}${white ? '' : '…'}` : `Move ${no}${white ? '' : '…'}`);

	if (c.phase === 'game' && c.origin) {
		const when = new Date(c.origin.playedAt).toISOString().slice(0, 10);
		parts.push(`${c.origin.platform} vs ${c.origin.opponent}, ${when}`);
	}

	return parts.join(' · ');
}

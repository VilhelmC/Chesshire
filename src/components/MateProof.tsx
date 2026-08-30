// The mate, proved — every reply answered, and one line to walk.
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES, AND WHY IT IS SMALLER.
//
// `LadderPanel` showed all of `ladderReport`: three tabs, every rung, the ranked
// options and the exclusions above the answer. Will, looking at it in the
// browser:
//
//   "Why do we still have all the ladder UI? What purpose does it fill?"
//
// A fair question, and the screenshot answered it. On an opponent ply the panel
// announced `+5.00 forced — proved, with every higher rung excluded` for a move
// that Stockfish, one panel above, called `mated`. The ladder was not lying by
// its own lights — it proves what WE can force and says nothing about what they
// answer with — but a confident bold green number that disagrees with the oracle
// is worse than no number, and it cost a ten-second freeze on every ply to
// produce.
//
// THE MATE RUNG IS DIFFERENT and is the reason anything survives here. It is the
// ladder's one gated-correct rung: 0% missed on `mateIn1`, `mateIn2` and
// `mateIn3` across 2,656 solver plies once the horizon went to 5
// (`FINDING-THE-MATE-HORIZON.md`), and it terminates on `isCheckmate()` rather
// than on an evaluation, so there is no judgement in it to be wrong about.
//
// And it answers a question Stockfish structurally cannot. `#3` is a number;
// "every reply is answered, and here they are" is a proof. That difference is
// the whole reason to keep a second engine on the screen at all.
//
// ---------------------------------------------------------------------------
// COMPUTED WHEN ASKED, NEVER ON ARRIVAL.
//
// The freeze was not the ladder being slow; it was the ladder running whether or
// not anyone wanted it. A df-pn search at depth 5 is 88ms on average and over a
// second at the worst (`scripts/mate-line-cost.mjs`), which is fine for a button
// and unacceptable for a mount.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { Chess } from 'chessops/chess';
import type { NormalMove } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import { allMoves, mateGoal, mateTree, principalLine, type ProofNode } from '../domain/ladder';
import { solve } from '../domain/pns';
import { DEPTH } from '../domain/wheels';
import { lineFromUci } from '../domain/line';
import { fenOf } from '../domain/chess';
import { LineStepper, type BoardOverride } from './LineStepper';
import { color, space, text, mono } from '../ui/theme';
import { Section, Note, Button } from '../ui/primitives';

const sq = (s: number) => makeSquare(s);
const UCI: Record<string, string> = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' };
/** UCI spells a knight `n`. Taking the first letter of the role spells it `k`. */
const uci = (m: NormalMove) => sq(m.from) + sq(m.to) + (m.promotion ? UCI[m.promotion] : '');

/** The first move that proves a mate, at the shallowest depth one exists. */
function findMate(pos: Chess): { move: NormalMove; depth: number } | null {
	const goal = mateGoal(pos.turn, { narrow: true, seed: true });
	for (let d = 1; d <= DEPTH; d++) {
		for (const m of allMoves(pos)) {
			const child = pos.clone();
			child.play(m);
			if (solve(goal, child, d - 1).refuted) return { move: m, depth: d };
		}
	}
	return null;
}

export function MateProof({
	pos,
	plyKey,
	onBoard,
}: {
	pos: Chess;
	plyKey: string;
	/** Hand the board a position to show, or null to give it back. */
	onBoard?: (o: BoardOverride) => void;
}) {
	const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
	const [tree, setTree] = useState<ProofNode | null>(null);

	// A new position is a new question. Nothing is computed until asked again.
	useEffect(() => {
		setState('idle');
		setTree(null);
	}, [plyKey]);

	const run = () => {
		setState('working');
		// A macrotask, so the button's working state paints before the search takes
		// the thread. Not concurrency — the minimum needed for the UI to be honest
		// about what it is doing.
		setTimeout(() => {
			let found: ProofNode | null = null;
			try {
				const hit = findMate(pos);
				if (hit) found = mateTree(pos, hit.move, pos.turn, hit.depth);
			} catch {
				found = null;
			}
			setTree(found);
			setState('done');
		}, 0);
	};

	const side = pos.turn === 'white' ? 'White' : 'Black';

	return (
		<Section region="mate-proof">
			<h4 style={{ margin: `0 0 ${space.tight}px` }}>The mate, proved</h4>

			{state === 'idle' && (
				<>
					<Note style={{ marginBottom: space.tight }}>
						Is there a forced mate for <strong>{side}</strong>, and can every reply be answered? Searched to
						depth {DEPTH}, which covers 98.2% of the mates in the Lichess corpus.
					</Note>
					<Button onClick={run}>Look for a mate</Button>
				</>
			)}

			{state === 'working' && <Note>Searching…</Note>}

			{state === 'done' && !tree && (
				// SAID, not left blank. The same rule the training wheels needed: a
				// control that reports nothing when it finds nothing is indistinguishable
				// from one that does not work.
				<Note>No forced mate for {side} within {DEPTH} moves.</Note>
			)}

			{state === 'done' && tree && (
				<>
					{onBoard && <Walk tree={tree} pos={pos} onBoard={onBoard} />}
					<div
						style={{
							fontSize: text.note,
							color: color.ink2,
							fontFamily: mono,
							margin: `${space.snug}px 0 ${space.tight}px`,
						}}
					>
						every reply is listed, because a mate that answers only the reply we expected is not a mate.
						The stepper above walks <strong>one</strong> of them; the tree below is the proof.
					</div>
					<div data-region="mate-proof-tree" style={{ overflowX: 'auto' }}>
						<Tree node={tree} depth={0} />
					</div>
				</>
			)}
		</Section>
	);
}

/** The principal line, walkable with the same stepper the rest of the app uses. */
function Walk({ tree, pos, onBoard }: { tree: ProofNode; pos: Chess; onBoard: (o: BoardOverride) => void }) {
	const line = (() => {
		try {
			return lineFromUci(fenOf(pos), principalLine(tree).map(uci));
		} catch {
			return null;
		}
	})();
	if (!line) return null;
	return (
		<LineStepper
			line={line}
			label="the main line — their most stubborn defence at every turn"
			onBoard={onBoard}
			onClose={() => onBoard(null)}
			closeLabel="Back to the position"
			region="mate-proof-line"
		/>
	);
}

/** The certificate, indented. Ours in ink, theirs faint, mate in red. */
function Tree({ node, depth }: { node: ProofNode; depth: number }) {
	const mine = depth % 2 === 0;
	return (
		<div style={{ marginLeft: depth ? 16 : 0, fontFamily: mono, fontSize: text.note }}>
			<span
				style={{
					color: node.mate ? color.bad : mine ? color.ink : color.ink2,
					fontWeight: mine ? 600 : 400,
				}}
			>
				{uci(node.move)}
				{node.mate ? '#' : ''}
			</span>
			{!node.mate && !node.kids.length && !mine && (
				// A reply with no answer under it is the tree failing to close, and that
				// is a finding about the depth rather than a rendering gap.
				<span style={{ color: color.warn }}> — no answer found within depth {DEPTH}</span>
			)}
			{node.kids.map((k, i) => (
				<Tree key={i} node={k} depth={depth + 1} />
			))}
		</div>
	);
}

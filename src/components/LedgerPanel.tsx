// What the ledger sees, on the screen where it is being checked.
//
// ---------------------------------------------------------------------------
// The Lab's ranking table is the DEPTH SEARCH's opinion, and the ledger is what
// we are now working against — so reviewing a ledger failure meant reading a
// number from one system while reasoning about another. This panel shows the
// ledger's own working: what the side to move owes, whether they can pay, and
// how each candidate move scores.
//
// The score is presented as a sum, because that is what it is:
//
//     takes now  +  after their best answer  =  total
//
// The middle column was headed "they can't pay", which read as a separate
// penalty. It is not: it is what remains winnable once they have defended as
// well as they can. On Uqazm's R f1–f8 it is 4.0 because after R×f8 Q×f8 R×f8
// White is a queen for a rook up — the number is the rest of the line, not a
// second charge.
//
// Will: "add a column beside it with the change in the calculation so it becomes
// presented like a simple sum." The format transferred from the old narration
// even though none of its code did — a column of numbers that adds up lets a
// wrong answer be located at the term that produced it, rather than at the end.
//
// Two things this panel is careful about, both learned the hard way here.
// It marks the PUZZLE's move explicitly, so a table can never quietly omit the
// answer. And it is tagged with the ply it was computed for, so a stale frame
// cannot render the previous position's ledger under the current board.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import type { Chess } from 'chessops/chess';
import type { NormalMove, Role } from 'chessops/types';
import { makeSquare } from 'chessops/util';
import { ledger, type Obligation } from '../domain/ledger';
import { claims, classify, type Claim, type Mode } from '../domain/cover';
import { color, space, text, mono } from '../ui/theme';
import { Section } from '../ui/primitives';

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

const uciOf = (m: NormalMove) =>
	`${makeSquare(m.from)}${makeSquare(m.to)}${m.promotion ? (m.promotion[0] === 'k' ? 'n' : m.promotion[0]) : ''}`;

function name(pos: Chess, m: NormalMove): string {
	const piece = pos.board.get(m.from);
	if (!piece) return uciOf(m);
	const set = piece.color === 'white' ? GLYPH : DARK;
	const takes = pos.board.get(m.to) !== undefined;
	const becomes = m.promotion ? `=${set[m.promotion]}` : '';
	return `${set[piece.role]}${makeSquare(m.from)}${takes ? '×' : '–'}${makeSquare(m.to)}${becomes}`;
}

/** Stockfish's number, or a word saying it did not look at this move. */
const engineFor = (rows: { uci: string; cp: number }[], move: string): string => {
	const hit = rows.find((c) => c.uci === move);
	if (!hit) return 'unrated';
	if (Math.abs(hit.cp) >= 9000) return hit.cp > 0 ? 'mate' : 'mated';
	return `${hit.cp > 0 ? '+' : ''}${(hit.cp / 100).toFixed(2)}`;
};

/** Bare pawns, for a column that has to add up. Infinity is a word, not a number. */
const pawns = (cp: number): string => {
	if (!Number.isFinite(cp)) return cp > 0 ? 'mate' : 'mated';
	if (cp === 0) return '—';
	return (cp / 100).toFixed(1).replace('-', '−');
};

/** What each verdict means, in the words a person would use. */
const MODE: Record<Mode, string> = {
	solvent: 'every debt can be covered by one move',
	deficient: 'something cannot be paid',
	cardinality: 'each debt is answerable alone — no single move answers them all',
	emptiness: 'a debt has no answer even on its own',
	immobile: 'no legal move',
};

const MODE_COLOUR: Record<Mode, string> = {
	solvent: color.ink2,
	deficient: color.warn,
	cardinality: color.bad,
	emptiness: color.bad,
	immobile: color.bad,
};

type Computed = { key: string; owed: Obligation[]; rows: Claim[]; mode: Mode };

export function LedgerPanel({
	pos,
	played,
	plyKey,
	engine,
}: {
	pos: Chess;
	/** The puzzle's move here, so the table can never omit the answer. */
	played: string | null;
	/** Identifies the position, so a late result cannot land under a new board. */
	plyKey: string;
	/**
	 * Stockfish, for comparison, in its own clearly-labelled column.
	 *
	 * It lives here rather than in the retired ranking table because the whole
	 * point of the number is to be read BESIDE the one being checked. Nothing in
	 * this component consults it — it is displayed and never computed with.
	 */
	engine?: { uci: string; cp: number }[] | null;
}) {
	const [got, setGot] = useState<Computed | null>(null);

	// After a paint, like everything else expensive on this screen. ~86ms per
	// position, so this is politeness rather than necessity.
	useEffect(() => {
		let live = true;
		const t = setTimeout(() => {
			try {
				const value: Computed = {
					key: plyKey,
					owed: ledger(pos, pos.turn),
					rows: claims(pos),
					mode: classify(pos),
				};
				if (live) setGot(value);
			} catch {
				if (live) setGot(null);
			}
		}, 16);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [pos, plyKey]);

	const shown = got && got.key === plyKey ? got : null;
	const side = pos.turn === 'white' ? 'White' : 'Black';

	if (!shown) {
		return (
			<Section>
				<h4 style={{ margin: `0 0 ${space.tight}px` }}>Ledger (τ = 1)</h4>
				<div style={{ fontSize: text.note, color: color.ink2 }}>working…</div>
			</Section>
		);
	}

	const top = shown.rows.length ? shown.rows[0].value : 0;
	const ties = shown.rows.filter((r) => r.value === top).length;
	const head = shown.rows.slice(0, 6);
	const answer = played ? shown.rows.find((r) => uciOf(r.move) === played) : undefined;
	const inHead = answer && head.some((r) => uciOf(r.move) === played);

	return (
		<Section>
			<h4 style={{ margin: `0 0 ${space.tight}px` }}>Ledger (τ = 1)</h4>

			<div style={{ fontSize: text.note, color: color.ink2, marginBottom: space.snug }}>
				{side} owes{' '}
				{shown.owed.length ? (
					shown.owed.map((o, i) => (
						<span key={i} style={{ fontFamily: mono }}>
							{i > 0 && ' · '}
							{(pos.turn === 'white' ? GLYPH : DARK)[o.role]}
							{makeSquare(o.square)} {pawns(o.weight)}
						</span>
					))
				) : (
					<span>nothing</span>
				)}
				{' — '}
				<strong style={{ color: MODE_COLOUR[shown.mode] }}>{MODE[shown.mode]}</strong>
			</div>

			<table style={{ borderCollapse: 'collapse', fontSize: text.body }}>
				<thead>
					<tr style={{ color: color.ink2, textAlign: 'left' }}>
						<th style={th}>move</th>
						<th style={{ ...th, textAlign: 'right' }} title="Material this move lifts off the board, before any answer.">
							takes now
						</th>
						<th
							style={{ ...th, textAlign: 'right' }}
							title="After their best answer, what they still owe that they cannot cover — less whatever their answer collected."
						>
							after their best answer
						</th>
						<th style={{ ...th, textAlign: 'right' }}>total</th>
						{engine && (
							<th style={{ ...th, textAlign: 'right' }} title="Stockfish. Shown for comparison; nothing here is computed from it.">
								Stockfish
							</th>
						)}
					</tr>
				</thead>
				<tbody>
					{head.map((r, i) => {
						const isAnswer = played !== null && uciOf(r.move) === played;
						return (
							<tr key={i} style={isAnswer ? { background: color.goodSoft } : undefined}>
								<td style={td}>
									{name(pos, r.move)}
									{i === 0 && <span style={{ color: color.ink2 }}> ← the ledger's move</span>}
									{isAnswer && <span style={{ color: color.ink2 }}> ← the puzzle's move</span>}
								</td>
								<td style={{ ...td, fontFamily: mono, textAlign: 'right', color: color.ink2 }}>
									{pawns(r.takes)}
								</td>
								<td style={{ ...td, fontFamily: mono, textAlign: 'right', color: color.ink2 }}>
									{pawns(r.deficiency)}
								</td>
								<td style={{ ...td, fontFamily: mono, textAlign: 'right' }}>{pawns(r.value)}</td>
								{engine && (
									<td style={{ ...td, fontFamily: mono, textAlign: 'right', color: color.ink2 }}>
										{engineFor(engine, uciOf(r.move))}
									</td>
								)}
							</tr>
						);
					})}
					{/* The answer always gets a row. A table that drops it is the one
						thing this screen must not do. */}
					{answer && !inHead && (
						<tr style={{ background: color.goodSoft }}>
							<td style={td}>
								{name(pos, answer.move)}{' '}
								<span style={{ color: color.ink2 }}>
									← the puzzle's move, ranked {shown.rows.indexOf(answer) + 1}
								</span>
							</td>
							<td style={{ ...td, fontFamily: mono, textAlign: 'right' }}>{pawns(answer.takes)}</td>
							<td style={{ ...td, fontFamily: mono, textAlign: 'right' }}>{pawns(answer.deficiency)}</td>
							<td style={{ ...td, fontFamily: mono, textAlign: 'right' }}>{pawns(answer.value)}</td>
						</tr>
					)}
					{played && !answer && (
						<tr style={{ background: color.badSoft }}>
							<td style={td} colSpan={4}>
								the puzzle's move was never generated
							</td>
						</tr>
					)}
				</tbody>
			</table>

			{ties > 1 && (
				<div style={{ fontSize: text.note, color: color.bad, marginTop: space.tight }}>
					{ties} moves tie at {pawns(top)}
					{top === 0 ? ' — the ledger sees nothing here' : ' — no resolution'}. A puzzle has a
					unique answer, so a tie is an error rather than an absence of opinion.
				</div>
			)}
		</Section>
	);
}

const th: React.CSSProperties = { fontWeight: 400, padding: '2px 12px 4px 0' };
const td: React.CSSProperties = { padding: '3px 12px 3px 0' };

// Progress, as the opening actually branches.
//
// A row is a position. Its numbers are the whole subtree beneath it, so a
// collapsed row is honest on its own and expanding it is what separates "I know
// the Italian" from "I know the first four moves of the Italian" — the question
// a flat per-line list structurally cannot answer, because the shared trunk is
// averaged into every line that passes through it.
//
// Rows expand only where there is something to expand into, and the path from
// the root down to the deepest branch you have played is opened by default:
// making the user click four times through a trunk they have never failed on is
// the same busywork the tree exists to remove.

import { useState } from 'react';
import { Move } from './Move';
import { accuracyOf, type TreeNode, type TreeStats } from '../domain/tree';
import { useViewport } from './useViewport';

const INK_2 = '#52514e';
const GOOD = '#0ca30c';
const WARNING = '#fab219';
const CRITICAL = '#d03b3b';
const GRID = '#e6e5e2';

/** Attempts below which an accuracy is not worth colouring. */
const MIN_MEANINGFUL = 3;

export function ProgressTree({
	root,
	unplaced = 0,
	onPin,
}: {
	root: TreeNode;
	unplaced?: number;
	onPin?: (node: TreeNode) => void;
}) {
	// Open the spine: every node that is the only real continuation, plus its
	// ancestors. Anything that branches waits to be asked for.
	const [open, setOpen] = useState<Set<string>>(() => spine(root));
	// Four numeric columns do not fit beside an indented move on a 360px screen.
	// Stacked onto a second line rather than dropped: they are the content.
	const { phone } = useViewport();

	const toggle = (key: string) =>
		setOpen((s) => {
			const next = new Set(s);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});

	if (!root.children.length) {
		return (
			<p style={{ fontSize: 14, color: INK_2 }}>
				Nothing recorded against a position yet.
				{unplaced > 0 && ` ${unplaced} older answers predate position tracking and are not shown.`}
			</p>
		);
	}

	return (
		<div>
			{!phone && (
				<div
					style={{
						display: 'grid',
						gridTemplateColumns: '1fr 78px 66px 90px',
						gap: 4,
						fontSize: 11,
						color: INK_2,
						borderBottom: `1px solid ${GRID}`,
						paddingBottom: 4,
						marginBottom: 2,
					}}
				>
					<div>Position</div>
					<div style={{ textAlign: 'right' }}>Accuracy</div>
					<div style={{ textAlign: 'right' }}>Tries</div>
					<div style={{ textAlign: 'right' }}>Punish</div>
				</div>
			)}

			{root.children.map((c) => (
				<Row
					key={c.path.join(' ')}
					node={c}
					depth={0}
					open={open}
					toggle={toggle}
					onPin={onPin}
					phone={phone}
				/>
			))}

			{unplaced > 0 && (
				<p style={{ fontSize: 12, color: INK_2, marginTop: 10 }}>
					{unplaced} older answers were recorded before positions were tracked. They cannot be
					placed on the tree, so they are left out of it entirely rather than piled onto the
					root, where they would describe positions they never came from.
				</p>
			)}
		</div>
	);
}

function Row({
	node,
	depth,
	open,
	toggle,
	onPin,
	phone,
}: {
	node: TreeNode;
	depth: number;
	open: Set<string>;
	toggle: (key: string) => void;
	onPin?: (node: TreeNode) => void;
	phone: boolean;
}) {
	const key = node.path.join(' ');
	const isOpen = open.has(key);
	const acc = accuracyOf(node.total);
	const meaningful = node.total.attempts >= MIN_MEANINGFUL;

	return (
		<>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: phone ? '1fr auto' : '1fr 78px 66px 90px',
					gap: 4,
					alignItems: 'center',
					fontSize: 13,
					padding: phone ? '6px 0' : '3px 0',
					borderBottom: `1px solid ${GRID}`,
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						// Indentation has to give way first: at 14px a ply, six plies
						// leaves nothing for the move itself on a phone.
						paddingLeft: depth * (phone ? 8 : 14),
					}}
				>
					<button
						onClick={() => node.children.length && toggle(key)}
						style={{
							width: 16,
							height: 16,
							padding: 0,
							border: 'none',
							background: 'none',
							cursor: node.children.length ? 'pointer' : 'default',
							color: INK_2,
							fontSize: 10,
							visibility: node.children.length ? 'visible' : 'hidden',
						}}
						aria-label={isOpen ? 'Collapse' : 'Expand'}
					>
						{isOpen ? '▾' : '▸'}
					</button>

					{node.ply % 2 === 1 && (
						<span style={{ color: INK_2, fontSize: 11 }}>{Math.ceil(node.ply / 2)}.</span>
					)}
					<Move san={node.san ?? ''} colour={node.colour ?? 'w'} size={13} />

					{node.children.length > 0 && !isOpen && (
						<span style={{ fontSize: 11, color: INK_2 }}>
							+{node.children.length} {node.children.length === 1 ? 'reply' : 'replies'}
						</span>
					)}
					{onPin && (
						<button
							onClick={() => onPin(node)}
							title="Practise from here"
							style={{
								marginLeft: 'auto',
								fontSize: 10,
								padding: '1px 5px',
								border: `1px solid ${GRID}`,
								borderRadius: 4,
								background: '#fff',
								cursor: 'pointer',
								color: INK_2,
							}}
						>
							pin
						</button>
					)}
				</div>

				<div
					style={{
						textAlign: 'right',
						fontVariantNumeric: 'tabular-nums',
						// Colour is not the only channel: the number is right there, and
						// too little data is shown as an em dash rather than a colour.
						color: !meaningful || acc === null ? INK_2 : acc >= 0.85 ? GOOD : acc >= 0.6 ? WARNING : CRITICAL,
						fontWeight: meaningful ? 600 : 400,
					}}
					title={
						meaningful
							? `${node.total.correct} of ${node.total.attempts} first-try correct`
							: 'Not enough attempts here to mean anything yet'
					}
				>
					{acc === null ? '—' : `${Math.round(acc * 100)}%`}
					{!meaningful && acc !== null && '*'}
				</div>

				{!phone && (
					<div style={{ textAlign: 'right', color: INK_2, fontVariantNumeric: 'tabular-nums' }}>
						{node.total.attempts || '—'}
						{node.total.assisted > 0 && (
							<span title={`${node.total.assisted} answered with help, excluded`}> ᴴ</span>
						)}
					</div>
				)}

				{!phone && (
					<div style={{ textAlign: 'right', color: INK_2, fontVariantNumeric: 'tabular-nums' }}>
						{node.total.punishAttempts
							? `${node.total.punishCorrect}/${node.total.punishAttempts}`
							: '—'}
					</div>
				)}

				{phone && (
					// Second line rather than a tooltip: there is no hover here, so a
					// title attribute would simply hide these numbers.
					<div
						style={{
							gridColumn: '1 / -1',
							fontSize: 11,
							color: INK_2,
							paddingLeft: depth * 8 + 22,
						}}
					>
						{node.total.attempts || 0} tries
						{node.total.punishAttempts > 0 &&
							` · punish ${node.total.punishCorrect}/${node.total.punishAttempts}`}
						{node.total.assisted > 0 && ` · ${node.total.assisted} with help`}
					</div>
				)}
			</div>

			{isOpen &&
				node.children.map((c) => (
					<Row
						key={c.path.join(' ')}
						node={c}
						depth={depth + 1}
						open={open}
						toggle={toggle}
						onPin={onPin}
						phone={phone}
					/>
				))}
		</>
	);
}

/** Keys of every node on the unbranching spine, so the trunk starts open. */
function spine(root: TreeNode): Set<string> {
	const out = new Set<string>();
	let node = root;
	while (node.children.length === 1) {
		node = node.children[0];
		out.add(node.path.join(' '));
	}
	// One level past the first real branch, so the fork itself is visible.
	if (node.children.length > 1) out.add(node.path.join(' '));
	return out;
}

/** One-line summary of a subtree, for the weak-spot list. */
export function describeNode(node: TreeNode, stats: TreeStats = node.own): string {
	const acc = accuracyOf(stats);
	return acc === null
		? 'no attempts'
		: `${Math.round(acc * 100)}% of ${stats.attempts}`;
}

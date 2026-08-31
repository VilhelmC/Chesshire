// The training-wheels menu — checkboxes for the overlays that passed their gates.
//
// ---------------------------------------------------------------------------
// Deliberately dumb. It owns no computation: `domain/wheels.ts` turns a position
// and a set of keys into shapes, and this turns clicks into that set. The host
// view memoises on the FEN and hands the shapes to the board.
//
// The notes under the checkboxes are the primitives' own fixed sentences. They
// are shown because a ring the reader cannot name has taught them a shape rather
// than an idea — and because the sentence is the part that can be checked
// against the board, which an arrow cannot.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { WHEELS, type Wheel } from '../domain/wheels';
import { ACTIVE, color, radius, text, TOUCH } from '../ui/theme';

export type TrainingWheelsProps = {
	on: ReadonlySet<Wheel>;
	onChange: (next: Set<Wheel>) => void;
	/**
	 * Are the selected overlays being drawn?
	 *
	 * Optional so a host that has no reason to suppress them need not care; the
	 * three that draw hint arrows all do.
	 */
	active?: boolean;
	onActiveChange?: (next: boolean) => void;
	/** The fixed sentences for whatever is currently firing. */
	notes?: string[];
	/** Whether a man is selected, so the safe-move row can say it needs one. */
	hasFocus?: boolean;
	/**
	 * A wheel whose search is still running.
	 *
	 * Only `mate` can be here. It is the one wheel that is not a board
	 * computation — mean 80ms and up to a second — and a checkbox that ticks and
	 * then does nothing for a second reads as broken rather than as busy.
	 */
	working?: Wheel | null;
};

export function TrainingWheels({
	on,
	onChange,
	active = true,
	onActiveChange,
	notes = [],
	hasFocus = false,
	working = null,
}: TrainingWheelsProps) {
	/**
	 * COLLAPSED BY DEFAULT, AND COLLAPSING CHANGES NOTHING ELSE.
	 *
	 * Five checkboxes and their explanations is a tall block to keep beside the
	 * board in Train and Mistakes, so it folds. What it must not do is touch the
	 * wheels themselves.
	 *
	 * The first version cleared them on close, reasoning that a mark on the board
	 * with no visible control behind it is worse than no mark. Will: "when
	 * training wheels panel is collapsed all the training wheels are being
	 * untoggled — that's wrong — state should persist regardless of whether the
	 * panel with the training wheel options is currently displayed."
	 *
	 * Right, and the reasoning was the mistake: A DISCLOSURE IS NOT A SWITCH. The
	 * worry it was answering — an overlay nobody can account for — is answered by
	 * the header, which names what is on while collapsed.
	 */
	const [open, setOpen] = useState(false);
	const showing = open;

	const toggle = (key: Wheel) => {
		const next = new Set(on);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		onChange(next);
	};

	return (
		<div className="wheels" data-region="training-wheels">
			<div className="wheels-head">
				<button
					type="button"
					className="wheels-toggle"
					aria-expanded={showing}
					onClick={() => setOpen(!open)}
				>
					<span aria-hidden="true">{showing ? '▾' : '▸'}</span> <strong>training wheels</strong>
					{/*
					  * WHAT IS ON, WHETHER OR NOT THE PANEL IS OPEN. This is what makes
					  * folding safe: a reader who collapses the panel with two overlays
					  * running can still see, from the header alone, that they are running
					  * and which they are.
					  */}
					{on.size > 0 ? (
						<span className="wheel-note">
							{' '}
							{/* The labels, not the keys: the header said "deficient" while the
							checkbox under it said "not worth attacking". */}
						— {WHEELS.filter((w) => on.has(w.key))
							.map((w) => w.label)
							.join(', ')}{' '}
						{active ? 'on' : 'selected, hidden'}
						</span>
					) : (
						<span className="wheel-note"> — overlays for what is on the board</span>
					)}
				</button>

				{/*
				  * THE MASTER SWITCH, and it is not the disclosure.
				  *
				  * Will: "we need a way to toggle all the training wheels selected at
				  * once — because currently the show visual annotation conflicts with
				  * the training wheel visual annotation." An overlay's arrows replace
				  * the ones from "show options", so seeing the engine's weighted moves
				  * meant unticking every wheel and re-ticking them afterwards.
				  *
				  * It SUPPRESSES rather than clears — the selection is still there, and
				  * the header says so — which is what makes it worth pressing twice.
				  * Shown only once something is selected: a switch for nothing is a
				  * control that has to be understood before it can be ignored.
				  */}
				{onActiveChange && on.size > 0 && (
					<button
						type="button"
						onClick={() => onActiveChange(!active)}
						aria-pressed={active}
						title={
							active
								? 'Hide the overlays without losing which are selected — the board goes back to arrows from the buttons'
								: 'Draw the selected overlays again'
						}
						style={{
							marginLeft: 'auto',
							fontSize: text.note,
							padding: '2px 8px',
							borderRadius: radius.small,
							border: `1px solid ${active ? ACTIVE.border : color.line}`,
							background: active ? ACTIVE.background : 'transparent',
							color: active ? ACTIVE.color : color.ink,
							cursor: 'pointer',
							minHeight: TOUCH,
							whiteSpace: 'nowrap',
						}}
					>
						{active ? 'overlays on' : 'overlays off'}
					</button>
				)}
			</div>

			{showing &&
				WHEELS.map((w) => {
				// The safe-move row is the one that needs a selected man, and saying so
				// on the row itself is better than drawing nothing and letting the
				// reader conclude the overlay is broken.
				const waiting = active && w.needsFocus && on.has(w.key) && !hasFocus;
				const busy = active && working === w.key;
				return (
					<label key={w.key} className={`wheel${waiting || busy ? ' waiting' : ''}`}>
						<input type="checkbox" checked={on.has(w.key)} onChange={() => toggle(w.key)} />
						<span className="wheel-label">{w.label}</span>
						<span className="wheel-note">
							{busy ? 'searching…' : waiting ? 'click a man on the board' : w.note}
						</span>
					</label>
				);
				})}

			{showing && notes.length > 0 && (
				<ul className="wheel-says">
					{notes.map((n) => (
						<li key={n}>{n}</li>
					))}
				</ul>
			)}
		</div>
	);
}

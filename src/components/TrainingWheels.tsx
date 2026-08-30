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

export type TrainingWheelsProps = {
	on: ReadonlySet<Wheel>;
	onChange: (next: Set<Wheel>) => void;
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

export function TrainingWheels({ on, onChange, notes = [], hasFocus = false, working = null }: TrainingWheelsProps) {
	/**
	 * COLLAPSED BY DEFAULT ONCE NOTHING IS ON.
	 *
	 * Five checkboxes and their explanations is a tall block to keep on screen in
	 * Train and Mistakes, where the board and the move list are what the reader is
	 * actually looking at. Open it, use it, and it stays open while anything is
	 * ticked — the summary line says what is on, so collapsing never hides the
	 * fact that an overlay is drawing.
	 */
	const [open, setOpen] = useState(false);
	const showing = open || on.size > 0;

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
					onClick={() => {
						// Closing it turns the overlays off. An overlay still drawing under
						// a collapsed panel is a mark on the board with no way to find out
						// what put it there.
						if (showing) onChange(new Set());
						setOpen(!showing);
					}}
				>
					<span aria-hidden="true">{showing ? '▾' : '▸'}</span> <strong>training wheels</strong>
					{!showing && <span className="wheel-note"> — overlays for what is on the board</span>}
					{showing && on.size > 0 && (
						<span className="wheel-note">
							{' '}
							— {[...on].join(', ')}
						</span>
					)}
				</button>
			</div>

			{showing &&
				WHEELS.map((w) => {
				// The safe-move row is the one that needs a selected man, and saying so
				// on the row itself is better than drawing nothing and letting the
				// reader conclude the overlay is broken.
				const waiting = w.needsFocus && on.has(w.key) && !hasFocus;
				const busy = working === w.key;
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

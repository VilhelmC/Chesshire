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
import { WHEELS, type Wheel } from '../domain/wheels';

export type TrainingWheelsProps = {
	on: ReadonlySet<Wheel>;
	onChange: (next: Set<Wheel>) => void;
	/** The fixed sentences for whatever is currently firing. */
	notes?: string[];
	/** Whether a man is selected, so the safe-move row can say it needs one. */
	hasFocus?: boolean;
};

export function TrainingWheels({ on, onChange, notes = [], hasFocus = false }: TrainingWheelsProps) {
	const toggle = (key: Wheel) => {
		const next = new Set(on);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		onChange(next);
	};

	return (
		<div className="wheels">
			<div className="wheels-head">
				<strong>training wheels</strong>
				{on.size > 0 && (
					<button type="button" className="link" onClick={() => onChange(new Set())}>
						clear
					</button>
				)}
			</div>

			{WHEELS.map((w) => {
				// The safe-move row is the one that needs a selected man, and saying so
				// on the row itself is better than drawing nothing and letting the
				// reader conclude the overlay is broken.
				const waiting = w.needsFocus && on.has(w.key) && !hasFocus;
				return (
					<label key={w.key} className={`wheel${waiting ? ' waiting' : ''}`}>
						<input type="checkbox" checked={on.has(w.key)} onChange={() => toggle(w.key)} />
						<span className="wheel-label">{w.label}</span>
						<span className="wheel-note">{waiting ? 'click a man on the board' : w.note}</span>
					</label>
				);
			})}

			{notes.length > 0 && (
				<ul className="wheel-says">
					{notes.map((n) => (
						<li key={n}>{n}</li>
					))}
				</ul>
			)}
		</div>
	);
}

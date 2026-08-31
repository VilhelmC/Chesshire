// The training wheels, as one hook, so every tab gets the same ones.
//
// ---------------------------------------------------------------------------
// Will:
//
//   "Maybe we should integrate with train and mistakes so I can test in a more
//    realistic setting. We should reuse all components across tabs so if we have
//    to make changes we only do it in one place and it applies the same
//    everywhere."
//
// The overlays shipped into the Lab only, and the Lab is a bench — Train and
// Mistakes are where somebody is actually learning, which is where a training
// wheel belongs. Copying the wiring into two more views would have been three
// copies of an async search, three `working` flags and three chances to fix a
// bug twice.
//
// So the state, the memo, the cancellation and the notes live here, and a host
// is three lines: call it, hand `arrows` to the board, hand the rest to
// `<TrainingWheels>`.
//
// ---------------------------------------------------------------------------
// WHAT THE HOST STILL OWNS. The FEN, and where the arrows go. Those genuinely
// differ — the Lab draws on a puzzle ply, Train on the live position, Mistakes
// on a card — and a hook that tried to own them would be a fourth place for the
// board to be driven from.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Square } from 'chessops/types';
import { positionFromFen } from '../domain/chess';
import {
	WHEELS,
	wheelShapes,
	wheelNotes,
	matesBothWays,
	matesArrows,
	mateNotes,
	nullMove,
	type Wheel,
} from '../domain/wheels';
import type { Shape } from '../components/Board';
import { recall, remember } from '../data/viewState';

export type TrainingWheelsState = {
	on: ReadonlySet<Wheel>;
	setOn: (next: Set<Wheel>) => void;
	/**
	 * Are the selected wheels being drawn?
	 *
	 * Separate from `on` because they answer different questions: `on` is which
	 * overlays you train with, `active` is whether they are on the board right
	 * now. Switching them off has to leave the selection alone, or the switch is
	 * a destructive one and nobody will use it twice.
	 */
	active: boolean;
	setActive: (next: boolean) => void;
	/** Everything to draw, sync overlays and the mate search together. */
	arrows: Shape[];
	/** One line per active wheel, including the ones that found nothing. */
	notes: string[];
	/** The wheel whose search is still running, for the row to say so. */
	working: Wheel | null;
};

export function useTrainingWheels(fen: string | null, focus?: Square | null): TrainingWheelsState {
	/*
	 * THE TOGGLES OUTLIVE THE PAGE.
	 *
	 * Will: "the training wheel options are not being persisted." They were not,
	 * and the reason is the same one that made collapsing the panel clear them a
	 * fortnight ago: this state was treated as belonging to the widget rather
	 * than to the reader. It belongs to the reader. Somebody who trains with the
	 * mate overlay on wants it on tomorrow, and having to switch it back on at
	 * every reload is the app forgetting how it is used.
	 *
	 * Restored through `viewState`, which validates on the way out — a wheel
	 * ablated away since it was written is dropped rather than restored, because
	 * a Set holding a name no overlay answers to is a checkbox that cannot be
	 * unticked.
	 *
	 * One store shared by all three hosts, deliberately: the wheels are the same
	 * wheels in the Lab, in Train and in Mistakes, and remembering them per tab
	 * would be three answers to one question.
	 */
	const [on, setOnState] = useState<ReadonlySet<Wheel>>(
		() =>
			new Set(
				(recall('wheels', (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')) ?? [])
					.filter((k): k is Wheel => WHEELS.some((w) => w.key === k)),
			),
	);

	/** One way in, so nothing can set the wheels without storing them. */
	const setOn = useCallback((next: Set<Wheel>) => {
		setOnState(next);
		remember({ wheels: [...next] });
	}, []);

	/** Whether the selected wheels are drawn at all. Persisted like the selection. */
	const [active, setActiveState] = useState<boolean>(
		() => recall('wheelsOff', (v) => typeof v === 'boolean') !== true,
	);

	const setActive = useCallback((next: boolean) => {
		setActiveState(next);
		remember({ wheelsOff: !next });
	}, []);

	const pos = useMemo(() => {
		if (!fen) return null;
		try {
			return positionFromFen(fen);
		} catch {
			return null;
		}
	}, [fen]);

	// Four of the five wheels are pure board computations — the most expensive is
	// a few milliseconds — so they memoise on the position and the focused man and
	// need no engine, no cache and no loading state.
	const sync = useMemo(() => (pos && on.size ? wheelShapes(pos, on, focus) : []), [pos, on, focus]);
	const syncNotes = useMemo(() => (pos && on.size ? wheelNotes(pos, on, focus) : []), [pos, on, focus]);

	/**
	 * MATE IS THE EXCEPTION and gets its own effect.
	 *
	 * It is a df-pn search — 88ms mean and over a second at the worst
	 * (`scripts/mate-line-cost.mjs`) — and since it now asks the question for BOTH
	 * sides it runs twice. Inside the memo above that would freeze the board for
	 * two seconds every time the position changed.
	 *
	 * `cancelled` guards the position changing while a search is in flight:
	 * without it a slow one resolves after the reader has moved on and draws a
	 * mate from the previous position onto this one.
	 */
	const [mate, setMate] = useState<{ arrows: Shape[]; notes: string[] } | null>(null);
	const [working, setWorking] = useState<Wheel | null>(null);

	useEffect(() => {
		if (!pos || !on.has('mate')) {
			setMate(null);
			setWorking(null);
			return;
		}
		let cancelled = false;
		setWorking('mate');
		// A macrotask, so the checkbox and the working state paint before the
		// search takes the thread. Not concurrency — the minimum needed for the UI
		// to be honest about what it is doing.
		const id = setTimeout(() => {
			let found: ReturnType<typeof matesBothWays> = { deliver: null, threat: null };
			try {
				found = matesBothWays(pos);
			} catch {
				found = { deliver: null, threat: null };
			}
			if (cancelled) return;
			// Set EITHER WAY. A ticked wheel that says nothing when it finds nothing
			// is indistinguishable from one that is broken.
			setMate({
				arrows: matesArrows(found),
				notes: mateNotes(found, pos.turn, nullMove(pos) !== null),
			});
			setWorking(null);
		}, 0);
		return () => {
			cancelled = true;
			clearTimeout(id);
		};
	}, [pos, on]);

	/*
	 * ONE SWITCH FOR ALL OF THEM, and it does not clear the selection.
	 *
	 * Will: "we need a way to toggle all the training wheels selected at once —
	 * because currently the show visual annotation conflicts with the training
	 * wheel visual annotation."
	 *
	 * That conflict is real and it is in the hosts: an overlay's arrows REPLACE
	 * the hint arrows from "show options" and "show me the move" — see the
	 * `wheels.arrows.length ? … : …` in Train and Mistakes. So a reader with the
	 * mate wheel on could not see the engine's weighted options at all, and the
	 * only way out was to untick every wheel and tick them all again afterwards.
	 *
	 * Suppressing rather than clearing is the whole point: `on` is what you are
	 * learning with and survives, `active` is whether it is on the board this
	 * minute. The same distinction the disclosure got wrong once already — a
	 * disclosure is not a switch — except this time a switch is exactly what was
	 * asked for, so it is one, and it is not the disclosure.
	 */
	return {
		on,
		setOn,
		active,
		setActive,
		// Suppressed at the boundary, so no host can forget to check.
		arrows: active ? [...sync, ...(mate?.arrows ?? [])] : [],
		notes: active ? [...syncNotes, ...(mate?.notes ?? [])] : [],
		working: active ? working : null,
	};
}

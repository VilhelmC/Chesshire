// Two ways of knowing how much room there is.
//
// `useMeasure` watches an element and is what the board uses: sizing from the
// container rather than from the window means the board stays right when the
// layout changes around it — stacking, a sidebar appearing, an on-screen
// keyboard — without anyone having to work out the arithmetic twice.
//
// `useViewport` is for the coarser decisions that are genuinely about the
// device: whether the tabs need to scroll, whether panels sit beside each other
// or below, whether a control needs its label spelled out because there is no
// hover to reveal a tooltip on.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Below this, panels stack and controls get labels. */
export const PHONE_MAX = 640;
/** Below this, the two-column shell collapses to one. */
export const NARROW_MAX = 900;

export type Viewport = {
	width: number;
	height: number;
	/** One hand, no hover, no tooltips. */
	phone: boolean;
	/**
	 * Panels should be stacked rather than sat side by side.
	 *
	 * Not simply "narrow": a phone held sideways is 851px wide and 393px TALL,
	 * and stacking there spends the scarce dimension (height) to relieve the
	 * plentiful one. Stack when the screen is narrow AND taller than it is wide.
	 */
	stacked: boolean;
	/** The primary input cannot hover, so `title` is invisible. */
	touch: boolean;
};

function read(): Viewport {
	const width = typeof window === 'undefined' ? 1280 : window.innerWidth;
	const height = typeof window === 'undefined' ? 800 : window.innerHeight;
	const touch =
		typeof window !== 'undefined' && typeof window.matchMedia === 'function'
			? window.matchMedia('(hover: none)').matches
			: false;
	return {
		width,
		height,
		// Portrait phones only: a landscape phone has plenty of width and is not
		// short of the things `phone` is used to economise on.
		phone: Math.min(width, height) <= PHONE_MAX && height >= width,
		stacked: width <= NARROW_MAX && height >= width,
		touch,
	};
}

export function useViewport(): Viewport {
	const [vp, setVp] = useState<Viewport>(read);

	useEffect(() => {
		let frame = 0;
		const onResize = () => {
			// Resize fires continuously while an on-screen keyboard animates in.
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => setVp(read()));
		};
		window.addEventListener('resize', onResize);
		window.addEventListener('orientationchange', onResize);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', onResize);
			window.removeEventListener('orientationchange', onResize);
		};
	}, []);

	return vp;
}

/**
 * The measured width of an element, and a ref to attach.
 *
 * Starts at 0, which callers must treat as "not yet known" rather than "no
 * room" — rendering a zero-sized board for one frame and then resizing it makes
 * chessground animate from nothing.
 */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T>, number] {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;

		const update = () => setWidth(el.clientWidth);
		update();

		if (typeof ResizeObserver === 'undefined') {
			window.addEventListener('resize', update);
			return () => window.removeEventListener('resize', update);
		}
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return [ref, width];
}

/** Clamp, because it is written three times otherwise. */
export function clamp(n: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, n));
}

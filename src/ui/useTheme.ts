// Light, dark, or whatever the system says.
//
// Three states rather than two. "Follow the system" is the right default and is
// wrong often enough to need overruling: a phone on a schedule goes dark at
// sunset, and sunset is not when a bright room becomes a dark one. Someone who
// wants the app light at 9pm should be able to say so without arguing with
// their operating system about it.
//
// The choice is written to the root element as `data-theme`, which the CSS in
// index.css reads. Nothing else in the app knows a theme exists — the colour
// tokens are `var()` references, so every inline style follows for free.

import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'offbook.theme';

export function storedTheme(): ThemeChoice {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

/**
 * Apply a choice to the document.
 *
 * Exported and called once before React mounts, as well as from the control:
 * waiting for the first render would paint a light page and then repaint it
 * dark, which is the flash every theme implementation is judged by.
 */
export function applyTheme(choice: ThemeChoice): void {
	const root = document.documentElement;
	if (choice === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', choice);

	// The browser chrome — address bar, status bar — reads this, and an app that
	// is dark under a white status bar looks like a rendering fault.
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', isDark(choice) ? '#16161a' : '#1a1a19');
}

/** What is actually on screen, resolving `system` against the media query. */
export function isDark(choice: ThemeChoice = storedTheme()): boolean {
	if (choice === 'dark') return true;
	if (choice === 'light') return false;
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function setTheme(choice: ThemeChoice): void {
	try {
		if (choice === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, choice);
	} catch {
		/* private mode — it just will not persist */
	}
	applyTheme(choice);
	for (const fn of listeners) fn(choice);
}

const listeners = new Set<(c: ThemeChoice) => void>();

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
	const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

	useEffect(() => {
		listeners.add(setChoice);
		return () => {
			listeners.delete(setChoice);
		};
	}, []);

	// While following the system, follow it as it CHANGES — a phone switching to
	// dark at sunset should not require the app to be reopened.
	useEffect(() => {
		if (choice !== 'system') return;
		const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
		if (!mq) return;
		const onChange = () => applyTheme('system');
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [choice]);

	return [choice, setTheme];
}

// Service worker registration, install prompt, and update detection.
//
// Three separate things the browser tells you, exposed as one small store the
// UI can subscribe to.
//
// SECURE CONTEXT
//
// Service workers and installability require https OR localhost. Reaching the
// dev server at http://192.168.1.38:5173 from a phone is neither, so nothing
// here will fire there — `pwaState.reason` says which of the two is missing
// rather than leaving the install button silently absent. Honest numbers, and
// an absent button is a claim as well.

export type PWAState = {
	/** The worker is registered and controlling this page. */
	ready: boolean;
	/** A new version is downloaded and waiting to take over. */
	updateReady: boolean;
	/** The browser has offered an install prompt we can replay. */
	canInstall: boolean;
	/** Already running as an installed app. */
	installed: boolean;
	/** Why nothing is available, when nothing is. Empty when all is well. */
	reason: string;
};

type Listener = (s: PWAState) => void;

let state: PWAState = {
	ready: false,
	updateReady: false,
	canInstall: false,
	installed: false,
	reason: '',
};

const listeners = new Set<Listener>();

export function pwaState(): PWAState {
	return state;
}

export function subscribePWA(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function set(patch: Partial<PWAState>) {
	state = { ...state, ...patch };
	for (const fn of listeners) fn(state);
}

/** The saved beforeinstallprompt event. Chrome allows exactly one replay. */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
/** True between "apply the update" and the reload it causes. */
let applying = false;

export function registerSW() {
	if (typeof window === 'undefined') return;

	set({
		installed:
			window.matchMedia?.('(display-mode: standalone)').matches ||
			// iOS Safari predates display-mode and uses its own flag.
			(navigator as NavigatorWithStandalone).standalone === true,
	});

	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferredPrompt = e as BeforeInstallPromptEvent;
		set({ canInstall: true, reason: '' });
	});

	window.addEventListener('appinstalled', () => {
		deferredPrompt = null;
		set({ canInstall: false, installed: true });
	});

	if (!('serviceWorker' in navigator)) {
		set({ reason: 'This browser has no service worker support.' });
		return;
	}
	if (!window.isSecureContext) {
		// The single most likely thing to be wrong, and invisible otherwise.
		set({
			reason:
				'Not a secure context. Installing needs https or localhost — over a LAN address the browser will not register a service worker.',
		});
		return;
	}
	// Vite serves /sw.js from public/ in dev too, but registering it there means
	// a cached shell fighting hot module reload for the rest of the session.
	if (import.meta.env.DEV) {
		set({ reason: 'Service worker is disabled in dev; run a production build to test it.' });
		return;
	}

	window.addEventListener('load', () => {
		// BASE_URL, not '/': the app may be served from a subpath, and a worker
		// registered at the origin root would have no authority over it.
		const base = import.meta.env.BASE_URL || '/';
		navigator.serviceWorker
			.register(`${base}sw.js`, { scope: base })
			.then((reg) => {
				set({ ready: true });

				if (reg.waiting && navigator.serviceWorker.controller) {
					waiting = reg.waiting;
					set({ updateReady: true });
				}

				reg.addEventListener('updatefound', () => {
					const fresh = reg.installing;
					if (!fresh) return;
					fresh.addEventListener('statechange', () => {
						// `controller` present means this is a REPLACEMENT, not the
						// first install. Prompting on the first install would ask you
						// to reload a page you just opened.
						if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
							waiting = fresh;
							set({ updateReady: true });
						}
					});
				});

				// A long session should not sit on a stale version forever.
				setInterval(() => void reg.update(), UPDATE_CHECK_MS);
			})
			.catch((err) => set({ reason: `Service worker failed to register: ${err}` }));

		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// Only when WE asked for it. The first install also fires this, via
			// clients.claim() — reloading there would bounce the page a second
			// after you opened it, for no reason you could see.
			if (!applying) return;
			applying = false;
			window.location.reload();
		});
	});
}

/** Hourly. Frequent enough to catch a deploy, rare enough to be free. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Apply a waiting update. The controllerchange handler reloads the page. */
export function applyUpdate() {
	if (!waiting) return;
	applying = true;
	waiting.postMessage('skip-waiting');
	set({ updateReady: false });
}

/**
 * Show the browser's install prompt. Returns what the user chose.
 * Must be called from a user gesture or the browser ignores it.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	if (!deferredPrompt) return 'unavailable';
	const prompt = deferredPrompt;
	deferredPrompt = null;
	set({ canInstall: false });
	await prompt.prompt();
	const { outcome } = await prompt.userChoice;
	return outcome;
}

type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

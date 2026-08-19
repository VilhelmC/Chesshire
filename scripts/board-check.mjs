// End-to-end check that the board actually accepts a move.
//
// ---------------------------------------------------------------------------
// This exists because the bug it guards against is invisible to unit tests and
// to a production build.
//
// Chessground's `fen` config sets the PIECES ONLY — `turnColor` is separate
// state, defaulting to white, and a piece is draggable only when
// `turnColor === piece.color`. The Board component set `turnColor` in an effect
// rather than at construction. In production that was fine. Under React
// StrictMode (development only) the board is built, torn down and rebuilt, and
// the effect's "have I already pushed this position?" cache survived the
// remount — so the second, real board never received `turnColor` and every
// black-to-move position was inert.
//
// White-to-move positions worked throughout, because white is the default. That
// is why it surfaced on the quiz (which shows arbitrary positions) and not on
// the trainer (which starts from move 1).
//
// So: both colours, and against the DEV server, or it proves nothing.
//
//     npm run dev                      # in another terminal, port 5173
//     node scripts/board-check.mjs
//
// Needs `npm i -D playwright` — not a runtime dependency.
// ---------------------------------------------------------------------------

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/';

const CASES = [
	{
		name: 'black to move',
		fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
		ourColour: 'b',
		expectedUci: 'g8f6',
		expectedSan: 'Nf6',
		from: ['g', 8],
		to: ['f', 6],
	},
	{
		name: 'white to move',
		fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
		ourColour: 'w',
		expectedUci: 'f3g5',
		expectedSan: 'Ng5',
		from: ['f', 3],
		to: ['g', 5],
	},
];

function cardFor(c) {
	return {
		id: `check-${c.name}`,
		fen: c.fen,
		ourColour: c.ourColour,
		expectedUci: c.expectedUci,
		expectedSan: c.expectedSan,
		playedSan: '??',
		lineIds: [],
		ply: 5,
		phase: 'game',
		origin: {
			platform: 'lichess',
			url: 'https://lichess.org/test',
			opponent: 'someone',
			playedAt: 0,
			loss: 300,
		},
		firstSeen: 0,
		lastSeen: 0,
		streak: 0,
		lapses: 1,
		dueAt: 0,
		retired: false,
	};
}

async function seed(page, card) {
	await page.evaluate(async (c) => {
		const req = indexedDB.open('offbook');
		const db = await new Promise((res, rej) => {
			req.onsuccess = () => res(req.result);
			req.onerror = () => rej(req.error);
		});
		await new Promise((res, rej) => {
			const tx = db.transaction('mistakes', 'readwrite');
			tx.objectStore('mistakes').clear();
			tx.objectStore('mistakes').put(c);
			tx.oncomplete = res;
			tx.onerror = () => rej(tx.error);
		});
		db.close();
	}, card);
}

/** Board pixel centre of a square, respecting orientation. */
function squareCentre(box, file, rank, orientation) {
	const sq = box.width / 8;
	const f = file.charCodeAt(0) - 97;
	const x = orientation === 'black' ? 7 - f : f;
	const y = orientation === 'black' ? rank - 1 : 8 - rank;
	return { x: box.x + x * sq + sq / 2, y: box.y + y * sq + sq / 2 };
}

const browser = await chromium.launch();
const page = await browser.newPage();
let failures = 0;

await page.goto(URL, { waitUntil: 'networkidle' });

for (const c of CASES) {
	await seed(page, cardFor(c));
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Mistakes' }).click();
	await page.waitForTimeout(700);

	const cg = await page.evaluate(async () => (await window.schackal.collect()).views?.chessground);
	const board = page.locator('cg-board').first();
	const box = await board.boundingBox();
	const orientation = cg?.orientation ?? 'white';

	const from = squareCentre(box, ...c.from, orientation);
	const to = squareCentre(box, ...c.to, orientation);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(500);

	// Match the feedback line specifically. A bare /correct/ also matches the
	// sidebar's explanation of how cards retire, which made a failing case
	// report moveAccepted=true.
	const accepted = await page.evaluate(() =>
		/\u2014 correct|is not it/i.test(document.body.innerText),
	);
	const ok = accepted && cg?.canMove === true;
	if (!ok) failures++;

	console.log(
		`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)}  ` +
			`turnColor=${cg?.turnColor} movable=${cg?.movableColor} ` +
			`canMove=${cg?.canMove} dests=${cg?.destsSize} moveAccepted=${accepted}`,
	);
}

// --- move-list preview ------------------------------------------------------
//
// Clicking a chip must actually change the position on the board. This was
// broken for every odd ply, and for every ply at all after a resume, because
// the trainer previewed from an in-memory map of past states that was only ever
// half-populated. Asserting the FEN changes is what catches that; asserting the
// click handler ran is not.
{
	const PATH = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'];
	await page.evaluate(async (path) => {
		localStorage.setItem('offbook.lichessToken', 'board-check-placeholder');
		const req = indexedDB.open('offbook');
		const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
		const state = {
			fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4',
			path,
			ourColour: 'w', phase: 'book', opening: null, bookHere: [],
			expected: [{ uci: 'e1g1', san: 'O-O' }],
			lastOpponent: null, motifs: [], evalNow: 35, punishPlies: 0,
			finished: null, note: null, currentItem: null,
			branchPoint: null, deviationPoint: null, retryPoint: null,
		};
		await new Promise((res) => {
			const tx = db.transaction('session', 'readwrite');
			tx.objectStore('session').put({
				id: 'current', ts: Date.now(), runId: 'check', state,
				lossByPly: {}, mistakePlies: [], evals: [], sawMistake: false,
			});
			tx.oncomplete = res;
		});
		db.close();
	}, PATH);

	// Reload so the run is RESUMED — the state in which every chip used to be dead.
	await page.reload({ waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'Train' }).click();
	await page.waitForTimeout(1200);

	const fenNow = async () =>
		(await page.evaluate(async () => (await window.schackal.collect()).views?.train?.fen)) ?? null;

	const live = await fenNow();
	for (let ply = 1; ply <= PATH.length; ply++) {
		const chip = page.locator(`button[data-ply="${ply}"]`).first();
		const count = await chip.count();
		if (!count) {
			console.log(`FAIL  chip ply ${ply}    no button found for ${PATH[ply - 1]}`);
			failures++;
			continue;
		}
		await chip.click();
		await page.waitForTimeout(250);
		const shown = await fenNow();

		// An earlier ply must move the board off the live position. The LAST chip
		// is the live position, so clicking it steps out of preview rather than
		// previewing — it must leave the board exactly where it was.
		const isLive = ply === PATH.length;
		const ok = !!shown && (isLive ? shown === live : shown !== live);
		if (!ok) failures++;
		console.log(
			`${ok ? 'PASS' : 'FAIL'}  chip ply ${ply}    ` +
				(isLive
					? ok
						? 'live ply — stays put, as it should'
						: 'live ply moved the board'
					: ok
						? shown.split(' ')[0].slice(0, 28)
						: 'board did not change'),
		);
		// Step back out so each ply is tested from the live position.
		await page.getByRole('button', { name: 'Back to the game' }).click().catch(() => {});
		await page.waitForTimeout(150);
	}
	await page.evaluate(() => localStorage.removeItem('offbook.lichessToken'));
}

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);

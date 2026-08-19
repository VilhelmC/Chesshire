// Headless reproduction of "can't move a piece on a mistake card".
//
// Seeds one card straight into IndexedDB, opens the Mistakes tab, and tries to
// drag the piece the card is asking for — then reports what chessground thought
// was possible. Run with: node scripts/repro-quiz.mjs

import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';

// Italian, Black to move after 3.Bc4 — a plausible Black card.
const CARD = {
	id: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq|g8f6',
	fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
	ourColour: 'b',
	expectedUci: 'g8f6',
	expectedSan: 'Nf6',
	playedSan: 'Nd4',
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

// MISMATCH=1 seeds a card whose position has the OPPONENT to move — the state
// that would make every one of your pieces undraggable.
if (process.env.MISMATCH) {
	CARD.id = 'mismatch';
	CARD.ourColour = 'w';       // we think we are White...
	// ...but the position has Black to move.
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
	if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });

// Seed the deck. Dexie has already created the schema by now.
await page.evaluate(async (card) => {
	const req = indexedDB.open('offbook');
	const db = await new Promise((res, rej) => {
		req.onsuccess = () => res(req.result);
		req.onerror = () => rej(req.error);
	});
	await new Promise((res, rej) => {
		const tx = db.transaction('mistakes', 'readwrite');
		tx.objectStore('mistakes').put(card);
		tx.oncomplete = res;
		tx.onerror = () => rej(tx.error);
	});
	db.close();
}, CARD);

await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Mistakes' }).click();
await page.waitForTimeout(800);

const board = page.locator('cg-board').first();
const present = await board.count();
console.log(`chessground mounted: ${present > 0}`);

if (present) {
	const state = await page.evaluate(() => {
		const el = document.querySelector('cg-container')?.parentElement;
		const w = window;
		return {
			pieces: document.querySelectorAll('cg-board piece').length,
			// The two properties that decide whether a drag is possible at all.
			cgClasses: document.querySelector('cg-board')?.parentElement?.className ?? null,
			rect: el ? { w: el.clientWidth, h: el.clientHeight } : null,
			hasDebug: typeof w.schackal !== 'undefined',
		};
	});
	console.log('board:', JSON.stringify(state));

	if (state.hasDebug) {
		const dump = await page.evaluate(async () => await window.schackal.collect());
			console.log('quiz legalMoves:', dump.views?.quiz?.position?.legalMoves);
		console.log('card:', JSON.stringify(dump.views?.quiz?.card ?? null));
		console.log('chessground:', JSON.stringify(dump.views?.chessground ?? null, null, 1));
	}

	// Try the actual drag: g8 -> f6 on a board oriented for Black.
	const box = await board.boundingBox();
	const sq = box.width / 8;
	// Black orientation: file a..h maps right-to-left, rank 1..8 top-to-bottom.
	const at = (file, rank) => ({
		x: box.x + (7 - (file.charCodeAt(0) - 97)) * sq + sq / 2,
		y: box.y + (Number(rank) - 1) * sq + sq / 2,
	});
	const from = at('g', 8);
	const to = at('f', 6);

	// What is actually under the cursor at g8?
	const target = await page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		const style = el ? getComputedStyle(el) : null;
		return {
			tag: el?.tagName ?? null,
			cls: el?.className ?? null,
			pointerEvents: style?.pointerEvents ?? null,
			touchAction: style?.touchAction ?? null,
			parentTag: el?.parentElement?.tagName ?? null,
			transform: style?.transform ?? null,
		};
	}, from);
	console.log('element at g8:', JSON.stringify(target));

	// 1. drag
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await page.mouse.up();
	await page.waitForTimeout(600);
	let fb = await feedbackText(page);
	console.log('after DRAG:', fb);

	// 2. click-move (select origin, click destination)
	if (!fb) {
		await page.mouse.click(from.x, from.y);
		await page.waitForTimeout(200);
		const selected = await page.evaluate(
			() => document.querySelectorAll('cg-board square.selected, cg-board .selected').length,
		);
		console.log('squares marked selected after clicking g8:', selected);
		await page.mouse.click(to.x, to.y);
		await page.waitForTimeout(600);
		fb = await feedbackText(page);
		console.log('after CLICK-MOVE:', fb);
	}

	console.log(
		'page text:',
		JSON.stringify(
			await page.evaluate(() =>
				document.body.innerText
					.split('\n')
					.map((l) => l.trim())
					.filter((l) => l && !/^[0-9A-H]$/.test(l))
					.slice(7, 20),
			),
		),
	);
}

async function feedbackText(page) {
	return await page.evaluate(() => {
		const t = document.body.innerText;
		const m = t.match(/[^\n]*(is not it|correct|Try again)[^\n]*/i);
		return m ? m[0].trim() : null;
	});
}

if (errors.length) console.log('console:', errors.slice(0, 10));
await browser.close();

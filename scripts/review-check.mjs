// Does Review actually say something about BOTH players?
//
// Seeds one imported game played as Black — the case that was broken on screen
// while every unit test passed — and steps through it reading the commentary.
// Run with: node scripts/review-check.mjs (needs a built dist).

const srv = spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--port', '4325', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await p.goto('http://localhost:4325/', { waitUntil: 'networkidle' });

// A game played as BLACK — the case that was broken — where White blunders at
// ply 5 and Black gives it straight back at ply 6.
await p.evaluate(async () => {
	const row = {
		id: 'chesscom:test1',
		platform: 'chesscom',
		playedAt: Date.now(),
		analysedAt: Date.now(),
		url: 'https://chess.com/game/1',
		opponent: 'adrian',
		result: 'loss',
		mistakes: 0,
		moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5', 'Nf6', 'Nxf7'],
		// WHITE's point of view, index 0 = after ply 1.
		evals: [20, 15, 25, 20, -300, 20, -40],
		ourColour: 'b',
	};
	const db = await new Promise((res, rej) => {
		const r = indexedDB.open('offbook');
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	});
	await new Promise((res, rej) => {
		const tx = db.transaction('imported', 'readwrite');
		tx.objectStore('imported').put(row);
		tx.oncomplete = res;
		tx.onerror = () => rej(tx.error);
	});
});

await p.reload({ waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Review', exact: true }).click();
await p.getByText('vs adrian').first().click();
await p.waitForTimeout(400);

const out = [];
for (let ply = 1; ply <= 7; ply++) {
	await p.getByRole('button', { name: '▶' }).click();
	await p.waitForTimeout(80);
	const t = await p.evaluate(() => {
		const el = [...document.querySelectorAll('div')].find(
			(d) => /^(Your move|Their move)/.test(d.textContent || '') && d.children.length <= 3,
		);
		return el ? el.textContent.replace(/\s+/g, ' ').trim() : '(nothing)';
	});
	out.push(`ply ${ply}: ${t}`);
}
console.log(out.join('\n'));

const table = await p.evaluate(() => {
	const t = document.querySelector('table');
	return t ? t.textContent.replace(/\s+/g, ' ').trim() : '(no table)';
});
console.log('\nTABLE:', table);
const heads = await p.evaluate(() =>
	[...document.querySelectorAll('h3')].map((h) => h.textContent).join(' | '),
);
console.log('HEADINGS:', heads);
await p.screenshot({ path: 'review.png', fullPage: false });
await b.close();
srv.kill();

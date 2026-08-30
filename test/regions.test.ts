// The names in `docs/REGIONS.md` are the names the components emit.
//
// Will: "can we make sure containers and divs are named so it's actually
// possible to refer to them". A naming convention nobody checks is a naming
// suggestion — this is the check, and it fails when a region is renamed in one
// place and not the other.
//
// Deliberately a SOURCE test rather than a render test. Rendering the Lab needs
// a DOM, an engine and a puzzle corpus, and none of that is what is being
// asserted: the claim is only that a documented name exists somewhere in the
// component that owns it, which is exactly what the doc promises a reader.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** region → the file that must emit it. */
const OWNED: Record<string, string> = {
	'lab-controls': 'src/views/Lab.tsx',
	'lab-counts': 'src/views/Lab.tsx',
	'lab-board': 'src/views/Lab.tsx',
	'lab-ply': 'src/views/Lab.tsx',
	'ply-statement': 'src/views/Lab.tsx',
	'engine-table': 'src/views/Lab.tsx',
	'training-wheels': 'src/components/TrainingWheels.tsx',
	'explain-panel': 'src/components/ExplainPanel.tsx',
};

/** Passed as a `region` prop rather than written as an attribute. */
const PASSED: Record<string, string> = {
	'mate-proof': 'src/components/MateProof.tsx',
	'explain-line': 'src/components/ExplainPanel.tsx',
	'mate-proof-line': 'src/components/MateProof.tsx',
	'line-player': 'src/components/LinePlayer.tsx',
};

describe('every documented region is emitted', () => {
	for (const [region, file] of Object.entries(OWNED)) {
		it(`${region} — ${file}`, () => {
			expect(read(file)).toContain(`data-region="${region}"`);
		});
	}
	for (const [region, file] of Object.entries(PASSED)) {
		it(`${region} — passed to a stepper by ${file}`, () => {
			expect(read(file)).toContain(`region="${region}"`);
		});
	}
});

describe('the doc lists what the code emits', () => {
	const doc = read('docs/REGIONS.md');

	it('exists', () => {
		expect(doc).not.toBe('');
	});

	for (const region of [...Object.keys(OWNED), ...Object.keys(PASSED)]) {
		it(`documents ${region}`, () => {
			expect(doc).toContain(region);
		});
	}

	it('has no region in the source that the doc does not name', () => {
		// The direction that actually rots: a new panel gets a `data-region` and
		// nobody adds the row. Sub-regions derived by a stepper (`…-plies`,
		// `…-controls`) are template strings and are covered by their parent.
		const files = [
			'src/views/Lab.tsx',
			'src/views/Train.tsx',
			'src/views/Quiz.tsx',
			'src/components/TrainingWheels.tsx',
			'src/components/MateProof.tsx',
			'src/components/ExplainPanel.tsx',
			'src/components/LineStepper.tsx',
			'src/hooks/useTrainingWheels.ts',
		];
		const found = new Set<string>();
		for (const f of files)
			for (const m of read(f).matchAll(/data-region="([a-z0-9-]+)"/g)) found.add(m[1]);
		const undocumented = [...found].filter((r) => !doc.includes(r));
		expect(undocumented).toEqual([]);
	});
});

// Account, data, and the instruments.
//
// ---------------------------------------------------------------------------
// The tab bar used to have seven entries and three of them were scaffolding:
// "M0 — dependency checks", "M2 audit", "Coverage audit". They were built to
// prove the pipeline worked, and they did — the endpoint probe is what found
// the explorer's 401, and the analysis check is what surfaced the engine
// failure. They are worth keeping and they are not features.
//
// So the tab bar was a record of how the app was BUILT rather than of what it
// is FOR. That is a reasonable thing for it to be while you are the only user
// and an unreasonable one the moment you send someone a link.
//
// They live here now, folded shut, labelled as instruments. Demoted rather than
// deleted: the last three bugs were all found on the phone, and dev-only would
// have meant not having them exactly where they were needed.
// ---------------------------------------------------------------------------

import { SignIn } from '../components/SignIn';
import { DataPanel } from '../components/DataPanel';
import { SyncStatus } from '../components/SyncStatus';
import { ImportGames } from './ImportGames';
import { Build } from './Build';
import { Coverage } from './Coverage';
import { Drills } from './Drills';
import { Section, Disclosure, Note } from '../ui/primitives';
import { ThemeControl } from '../ui/ThemeControl';
import { space } from '../ui/theme';

export function Settings({ onImported }: { onImported: () => void }) {
	return (
		<div>
			<Section title="Account">
				<SignIn />
			</Section>

			<Section
				title="Your games"
				note="Imported automatically, about once a day."
			>
				<SyncStatus />
				<ImportGames onImported={onImported} />
			</Section>

			<Section
				title="Your data"
				note="Everything lives in this browser. Export is how it moves to another device — there is no account holding a copy."
			>
				<DataPanel />
			</Section>

			<Section
				title="Appearance"
				note="Follows your device unless you say otherwise — a phone that goes dark at sunset is not always right about the room you are in."
			>
				<ThemeControl />
			</Section>

			<Section title="Instruments">
				<Note style={{ marginBottom: space.snug }}>
					Diagnostics, not features. These are how the app is interrogated when something
					behaves oddly — they were how the explorer&apos;s 401 and the engine&apos;s missing
					file were both found. Nothing here changes your training.
				</Note>

				<Disclosure
					summary="Connection and dependency checks"
					note="Verifies the board, the chess rules, the engine and the Lichess endpoints, one at a time, and reports which of them is actually failing."
				>
					<Build />
				</Disclosure>

				<Disclosure
					summary="Coverage audit"
					note="Where opponents leave your book early, and where the book runs out on you."
				>
					<Coverage />
				</Disclosure>

				<Disclosure
					summary="Punishment generator"
					note="Ranks positions by punishment gap against how often they occur — the research tool the drill pipeline was built from."
				>
					<Drills />
				</Disclosure>
			</Section>
		</div>
	);
}

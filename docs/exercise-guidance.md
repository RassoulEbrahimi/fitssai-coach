# TRAINING-EXEC-01C exercise guidance

The active card owns only an independent Radix dialog trigger and presentation state. Guidance has no session, set-write, plan-edit or timer API. The dialog portals above Focus Mode using the same 100000/100001 layers as the existing rest sheet. Focus Mode's existing containment hook yields to the portalled dialog. Radix restores focus to the originating Info button. Content unmounts on close, so both the same and another exercise reopen in Ausführung.

The rest sheet and finish dialog already block background pointer/keyboard interaction. Info is also disabled while the rest sheet is open. Dismissing rest to use Info changes only sheet visibility; the existing clock continues. No additional timer or overlay coordinator is introduced.

## Identity and reviewed coverage

The catalogue exposes Firestore document IDs, but AddWorkoutDialog copies the selected name and prescription without its catalogue ID. Plan `id` fields are optional and not verified catalogue identities; execution and generated-plan fixtures carry names. Therefore lookup uses a normalized exact title, then an explicit alias map. Internal canonical keys are registry keys, never invented catalogue IDs.

Normalization uses Unicode NFC, trim, lowercase, collapsed whitespace and U+2010/U+2011 hyphen equivalence. Accents, other punctuation, equipment and variant qualifiers are retained. No substring, category, target-muscle or fuzzy lookup is used. E.g. `Bankdrücken enger Griff`, `Schrägbankdrücken`, `Side Plank` and `Push-ups auf Knien` are unsupported.

| Entry | Explicit aliases | Repository evidence | Described variant |
| --- | --- | --- | --- |
| Bankdrücken | Bench Press | functions/src/plan.fixtures.ts; src/lib/exerciseEditorTestUtils.ts | Flat barbell bench press |
| Liegestütze | Push-ups | src/lib/exerciseCategories.test.ts | Standard floor push-up |
| Klimmzüge | Pull-up | src/lib/exerciseCategories.test.ts | Overhand pull-up |
| Plank | Planks | src/lib/exerciseCategories.test.ts; src/lib/exerciseFields.test.ts | Forearm plank |
| Crunches | None | src/components/ExerciseSelector.test.tsx | Supine floor crunch |

These five entries are initial static product copy, not a claim that the live catalogue is fully covered or that a trainer has independently approved the content. Each entry's variant is explicit in its preparation. Unknown exercises still have Info, the exercise title, both tabs and the same German unsupported message; no anatomy or instructions are inferred.

## Content review references

Reviewed on 2026-09-14 against the following public technique references. German copy is concise original wording; medical, outcome and universal safety claims are excluded. Primary/secondary lists conservatively distinguish the main target from assistance/stabilization rather than asserting isolation.

- [NASM: barbell bench press](https://www.nasm.org/resource-center/exercise-library/barbell-bench-press)
- [NASM: push-up](https://www.nasm.org/resource-center/exercise-library/push-up)
- [NASM: pull-up](https://www.nasm.org/resource-center/exercise-library/pull-up)
- [NASM: plank](https://www.nasm.org/resource-center/exercise-library/plank)
- [California Department of Public Health: crunch, 10-minute workouts](https://calfreshhealthyliving.cdph.ca.gov/en/pages/10-Minute-Workouts.aspx)

References are development documentation only: guidance fetches no content or media. Existing local assets are generic fitness backgrounds, not exercise-specific images. The deliberate fallback is “Anleitung ohne Abbildung”. Future `media` entries must import a reviewed local asset and supply meaningful alt text.

The local SVG is a supportive front/back schematic. Filled regions mean primary, outlined regions secondary. Deep and overlapping muscles share broad regions; the text lists are authoritative. It is not a medical anatomy model.

## Extending coverage

Verify a real app name and its unambiguous variant before adding an entry. Review setup, execution, cues, muscle labels and each alias together. Keep qualified variants separate. Run the collision/negative-match tests and active-workout regression suite. Do not add persistence or runtime generation to fill coverage gaps.

## Browser verification

Verified on 2026-09-14 in the in-app Chromium browser using an isolated local fixture: real TodayWorkoutCard, TrainingProvider, FocusModeProvider and rest controller; simulated account and set persistence. No production account or remote data was changed.

- 320px, 375px and 1280px desktop; light and dark themes; supported content and a long unsupported exercise name. No horizontal overflow. Mobile dialog content scrolls independently, with tabs and the 44px close target reachable. Desktop dialog is centered and 512px wide.
- Started a workout, opened guidance, selected both tabs and returned to the same workout. Info did not toggle collapse. No Historie tab.
- Completed one set and opened guidance during running rest: countdown advanced from 01:06 to 01:05 and the set remained checked after closing. During paused rest it remained at 00:34 across guidance and Focus Mode interactions.
- Guidance appeared above Focus Mode (100001 versus 99999). Arrow keys selected tabs; Tab reached the scrollable panel. Escape closed only guidance and restored the originating Info button. Focus Mode remained active.
- Unknown variant retained its full title and the unsupported message in both tabs, with no borrowed instructions or muscle map. Browser captured no warning/error console messages.

Automated tests additionally advance the clock by 12 seconds while guidance is open and assert unchanged session, plan, writes and completed sets for both running and paused rest. Existing 01A/01B regressions remain in place.

Validation: `npm run verify` passed (client and Functions typechecks; 1,659 client tests in 107 files; 491 Functions tests in 12 files; both builds; mojibake and placeholder guards). Changed-file ESLint and `git diff --check` passed. The build retains the existing large-chunk warning. The sandbox's Git ownership prevented the existing build-metadata test from reading HEAD on the first full run; the complete verification passed under the repository owner's permissions.

# TRAINING-UI-01 — Active workout presentation and exercise thumbnails

A presentation-only change to the running-workout exercise card. Execution identity, set writes, actual performance, rest, guidance, previous performance and the completion summary are unchanged (TRAINING-EXEC-01A–03A). There are no new queries, persistence, Firestore fields or backend changes.

## Card anatomy

### Header

`ExerciseWithSets` renders the markup; `workoutPresentation.css` lays it out by card width with a container query.

Narrow cards (under 420px: every phone width, in the dashboard and in Focus Mode):

```
[ thumbnail 72 ] [ title, up to 2 lines (3 below 300px) ]
[ sets · rest + progress              ] [ ⌄ 44 ] [ ⓘ 44 ]
```

Wide cards (420px and up: Focus Mode on tablets, the desktop dashboard):

```
[ thumbnail 72 ] [ title                 ] [ ⌄ 44 ] [ ⓘ 44 ]
                 [ sets · rest + progress ]
```

On phones the actions do not share the title row. Measured cards are 238px (320px dashboard) to 363px (412px Focus Mode) wide. Beside a 72px thumbnail and two 44px actions, the title would get 60–120px and German compound names would break mid-word.

- **Title:** an `h3`, 16px (18px from `sm`), semibold, `leading-snug`. It clamps at two lines, or three in cards under 300px, and never truncates to one line. `hyphens: auto` uses the document's `lang="de"`; `overflow-wrap: anywhere` is the last resort.
- **Meta:** `done/total Sätze` and the rest duration. A completed exercise also gets a check icon and a screen-reader "abgeschlossen", not colour alone.
- **Actions:** collapse (`CollapsibleTrigger`, named `<exercise> <done>/<total> Sätze`) and Info (`ExerciseGuidanceDialog`) are sibling 44×44 buttons. Neither is nested in the other or in the title.
- **CSS scope:** class names are prefixed `workout-exercise-*`, because Vite loads the stylesheet globally.

### Set rows

`ExerciseSetRow`:

- "1. Satz" and "Vorgabe: …" share one wrapping line.
- The reps (56px) and kg (72px) inputs are 44px tall with 16px text. The 44×44 completion control sits on the same line.
- "Letztes Mal" and `Übernehmen` follow below.
  - `Übernehmen` shows a 32px face inside a real 44px button, with −6px vertical margins, so a row whose reference fits on one line does not grow.
  - The TRAINING-EXEC-02B `::after` extension was not a real 44px target: Chromium does not hit-test a pseudo-element or child outside a `<button>`'s own box. This was measured with `elementFromPoint`.
- Row content is capped at `max-w-md`, so on wide cards the completion control stays next to the inputs.

### Rest and session

- The inline rest bar drops its border and uses a `text-xl` countdown.
- The pulse animations on "Training läuft" and on the finish button are gone.
- Session content is capped at `max-w-3xl`.

## Thumbnail architecture

- **`src/lib/exerciseName.ts`:** the exact-identity normaliser (NFC, trim, lowercase, collapsed whitespace, two Unicode hyphen variants). It was moved out of `exerciseGuidance.ts`, which re-exports it; it was not duplicated. `previousPerformance.ts` keeps its own existing normaliser for untyped history data.
- **`src/lib/exercisePresentation.ts`:** reviewed presentation entries, each with a canonical key, explicit aliases and an optional local thumbnail (`src`, `source`, `status`).
  - Lookup is an exact map of normalised names. There is no substring, fuzzy or category matching.
  - It is independent of guidance coverage; a test checks that `Crunches` has guidance but no thumbnail.
- **`ExerciseThumbnail`:** a decorative (`aria-hidden`), fixed 72×72 surface.
  - **Reviewed asset:** a local `<img>` with `width`/`height`, `loading="lazy"`, `alt=""` and `object-contain`.
  - **No asset, or `onError`:** a deterministic fallback. It shows a monogram (the first letters of up to three words, or two characters of a single word) over a 32-cell mosaic hashed from the identity, in `text-primary`.
  - The surface element keeps its size and identity when the image fails.
- **Bundling:** assets are imported through Vite. The 683-byte SVG is inlined as a data URI, so there is no extra request.

### Adding final artwork

1. Add the file under `src/assets/exercise-thumbnails/` and import it in `exercisePresentation.ts`.
2. Register the exact canonical name and any reviewed aliases, with `source` and `status: 'final'`.
3. Update the table below.

Never register a qualified variant (angle, grip, machine) under a base name: `Bankdrücken schräg Multipresse` must not receive the flat-bench image. Existing plans and logs need no migration.

## Asset coverage

**Final approved artwork: 0 of 64 identities.**

- `bankdrücken` and its reviewed alias `bench press` share one original local SVG schematic made in this change. It is temporary, not approved product artwork, and its fixed light palette shows as a light tile in dark mode.
- Every other identity uses the generated fallback, which is also temporary.

**Inventory sources:**
- production name lists (`exerciseFields.ts`, `exerciseGuidance.ts`);
- the Functions plan fixture;
- client test fixtures;
- the task brief's long-name examples;
- the ignored local browser fixture.

The production exercise catalogue loads from Firestore at runtime and is not in the repository, so this table cannot list every name users see. Any name that is not registered resolves to the fallback.

| Normalised identity | Resolved thumbnail | Asset source | Status | Found in |
| --- | --- | --- | --- | --- |
| `ausfallschritte` | Fallback: monogram `AU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |
| `back extension` | Fallback: monogram `BE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `bankdrücken` | `src/assets/exercise-thumbnails/bench-press.svg` | Original local SVG schematic (TRAINING-UI-01) | Temporary local graphic | `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts`, `functions/src/plan.fixtures.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx`, `src/components/TodayWorkoutCard.test.tsx`, `src/components/InlineEditableExercise.test.tsx`, `src/components/workout/ExerciseGuidanceDialog.test.tsx`, execution tests (`src/test/sessionBoundExecution.test.tsx`, `src/lib/workoutExecution.test.ts`, `src/components/workout/DayAccordion.test.tsx`) |
| `bankdrücken enger griff` | Fallback: monogram `BEG` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/components/InlineEditableExercise.test.tsx`, `src/components/workout/ExerciseGuidanceDialog.test.tsx` |
| `bankdrücken schräg multipresse` | Fallback: monogram `BSM` + identity mosaic | Generated in the client; no image file | Temporary fallback | task brief long-name examples |
| `barbell row` | Fallback: monogram `BR` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `beinbeuger` | Fallback: monogram `BE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `beinheben` | Fallback: monogram `BE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `beinpresse` | Fallback: monogram `BE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |
| `beinpresse 45° plate loaded` | Fallback: monogram `B4P` + identity mosaic | Generated in the client; no image file | Temporary fallback | task brief long-name examples |
| `beinstrecker` | Fallback: monogram `BE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |
| `bench press` | `src/assets/exercise-thumbnails/bench-press.svg` | Same SVG via the reviewed alias `Bench Press` | Temporary local graphic | `src/lib/exerciseGuidance.ts`, `src/lib/exerciseEditorTestUtils.ts` |
| `bizepscurls` | Fallback: monogram `BI` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `bulgarian split squat` | Fallback: monogram `BSS` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `burpees` | Fallback: monogram `BU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/components/ExerciseSelector.test.tsx` |
| `butterfly` | Fallback: monogram `BU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `crunches` | Fallback: monogram `CR` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `curl` | Fallback: monogram `CU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/test/addWorkoutModalHistoryGuard.test.tsx` |
| `deadlift` | Fallback: monogram `DE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseEditorTestUtils.ts` |
| `dips` | Fallback: monogram `DI` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts`, execution tests (`src/test/sessionBoundExecution.test.tsx`, `src/lib/workoutExecution.test.ts`, `src/components/workout/DayAccordion.test.tsx`) |
| `face pull` | Fallback: monogram `FP` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `farmers walk` | Fallback: monogram `FW` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `gesäßbrücke` | Fallback: monogram `GE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `good morning` | Fallback: monogram `GM` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `hammercurls` | Fallback: monogram `HA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `hip thrust` | Fallback: monogram `HT` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `klimmzüge` | Fallback: monogram `KL` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx`, `src/components/TodayWorkoutCard.test.tsx` |
| `kniebeuge` | Fallback: monogram `KN` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `kniebeugen` | Fallback: monogram `KN` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, execution tests (`src/test/sessionBoundExecution.test.tsx`, `src/lib/workoutExecution.test.ts`, `src/components/workout/DayAccordion.test.tsx`) |
| `kreuzheben` | Fallback: monogram `KR` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `lat pulldown` | Fallback: monogram `LP` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/test/historicalExerciseIdentity.test.tsx` |
| `latziehen` | Fallback: monogram `LA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts` |
| `latzug` | Fallback: monogram `LA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `laufen` | Fallback: monogram `LA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/components/InlineEditableExercise.test.tsx` |
| `leg curl` | Fallback: monogram `LC` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `liegestütze` | Fallback: monogram `LI` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/InlineEditableExercise.test.tsx` |
| `lunges` | Fallback: monogram `LU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseEditorTestUtils.ts` |
| `overhead press` | Fallback: monogram `OP` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `plank` | Fallback: monogram `PL` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts`, `src/components/workout/ExerciseGuidanceDialog.test.tsx`, execution tests (`src/test/sessionBoundExecution.test.tsx`, `src/lib/workoutExecution.test.ts`, `src/components/workout/DayAccordion.test.tsx`) |
| `planks` | Fallback: monogram `PL` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseGuidance.ts` |
| `pull-up` | Fallback: monogram `PU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts` |
| `pull-ups` | Fallback: monogram `PU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseEditorTestUtils.ts` |
| `push-ups` | Fallback: monogram `PU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseGuidance.ts`, `src/lib/exerciseCategories.test.ts`, `src/lib/exerciseEditorTestUtils.ts` |
| `radfahren` | Fallback: monogram `RA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/components/InlineEditableExercise.test.tsx` |
| `reverse butterfly` | Fallback: monogram `RB` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `row` | Fallback: monogram `RO` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/test/historicalExerciseIdentity.test.tsx` |
| `rückenstrecker` | Fallback: monogram `RÜ` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts`, `src/components/ExerciseSelector.test.tsx` |
| `rudern` | Fallback: monogram `RU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `functions/src/plan.fixtures.ts`, `src/lib/exerciseCategories.test.ts`, execution tests (`src/test/sessionBoundExecution.test.tsx`, `src/lib/workoutExecution.test.ts`, `src/components/workout/DayAccordion.test.tsx`) |
| `rumänisches kreuzheben` | Fallback: monogram `RK` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `russian twist` | Fallback: monogram `RT` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `russian twists` | Fallback: monogram `RT` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts` |
| `schrägbankdrücken` | Fallback: monogram `SC` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |
| `schulterdrücken` | Fallback: monogram `SC` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |
| `schwimmen` | Fallback: monogram `SC` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts` |
| `seilspringen` | Fallback: monogram `SE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/components/ExerciseSelector.test.tsx` |
| `seitheben` | Fallback: monogram `SE` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `sit-ups` | Fallback: monogram `SU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `squat` | Fallback: monogram `SQ` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseEditorTestUtils.ts`, `src/components/TodayWorkoutCard.test.tsx` |
| `superman` | Fallback: monogram `SU` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `trizepsdrücken` | Fallback: monogram `TR` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `trizepsstrecken kabelzug kordel` | Fallback: monogram `TKK` + identity mosaic | Generated in the client; no image file | Temporary fallback | task brief long-name examples |
| `überzüge` | Fallback: monogram `ÜB` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseCategories.test.ts` |
| `unterarmstütz` | Fallback: monogram `UN` + identity mosaic | Generated in the client; no image file | Temporary fallback | local browser fixture only (ignored, not in the repo) |
| `wadenheben` | Fallback: monogram `WA` + identity mosaic | Generated in the client; no image file | Temporary fallback | `src/lib/exerciseFields.ts`, `src/lib/exerciseCategories.test.ts` |

Monograms and mosaics are presentation only, not unique IDs. For example, `pull-up`, `pull-ups` and `push-ups` all show `PU` and differ only in their mosaic. The name text stays authoritative.

## Verification

**Automated tests:**
- `ExerciseThumbnail.test.tsx`: fixed dimensions, a lazy decorative image, identity-specific fallbacks, and fallback when the image breaks.
- `exercisePresentation.test.ts`: a known asset, reviewed aliases only, similar names not matched, independence from guidance, no remote sources.
- `ExerciseWithSets.test.tsx`: a thumbnail surface on every card; long names kept whole without `truncate`; Info and collapse independent; completed state stated in text.
- `ExerciseSetRow.test.tsx`: the real 44px `Übernehmen` target.
- The existing TRAINING-EXEC-01A–03A unit and integration suites run unchanged.

### Browser (local fixture, production CSS)

Measured with `getBoundingClientRect`, `scrollWidth` and `elementFromPoint`:

| Viewport | Mode | Theme | Card | Title column | Longest title | Header layout | Horizontal overflow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 320 | Dashboard | light, dark | 238px | 128px | 3 lines | narrow | none |
| 375 | Dashboard | light, dark | 293px | 183px | 2 lines | narrow | none |
| 375 | Focus Mode | dark | 343px | 234px | 2 lines | narrow | none |
| 412 | Dashboard | light, dark | 330px | 220px | 2 lines | narrow | none |
| 1280 | Dashboard, Focus Mode | light, dark | 768px | 550px | 1 line | wide | none |

**Every viewport:**
- the thumbnail is 72×72;
- titles are 16px semibold, never clipped, and never overlap the actions;
- collapse and Info are 44×44;
- the reps and kg inputs are 56×44 and 72×44, and completion is 44×44 inside the row, which does not overflow.

**Set-row height:**
- 142px when "Letztes Mal" fits beside `Übernehmen`;
- 162px when it wraps (the longest reference, at 320–412px);
- 104px without a reference.

**`Übernehmen` hit area:** `elementFromPoint` hits the button 5.5px above and below its 32px face, and its box does not overlap the completion control.

### Functional checks

Run at 320px with DOM events, and repeated across reloads and Focus Mode:
- Recording `10` and `52,5` neither completes the set nor starts rest, and the values survive reloads, Focus Mode and returning from the summary.
- `Übernehmen` on set 2 fills only the reps recorded last time (8) and leaves completion unchanged.
- Completing a set opens exactly one rest sheet and timer.
- Escape leaves the inline timer, which reopens the sheet.
- Pause shows resume; +15 goes from 87 to 102 seconds and −15 back to 87; skip ends rest while the set stays completed.
- Info on an unsupported exercise shows the unsupported state without changing collapse, and collapse opens no dialog.
- A completed exercise shows its border, the check icon, the screen-reader "abgeschlossen" and the name `Bankdrücken 4/4 Sätze`.
- "Training beenden" shows the TRAINING-EXEC-03A summary ("Erfasste Leistung", "Vergleich zum letzten Mal"), and "Zurück zum Training" keeps the session running.

## Known limitations

- **No final artwork:** there is no approved exercise artwork yet. The bench-press schematic is temporary and keeps its light palette in dark mode.
- **Monogram collisions:** monograms can repeat between exercises, so only the mosaic tells them apart.
- **Collapse target:** expand and collapse work only through the 44×44 chevron button; tapping the title or thumbnail does nothing. This keeps collapse and Info as independent controls, without interactive content nested inside a button.
- **Very long names:** names longer than two lines (three in cards under 300px) end in an ellipsis. The full name stays in the heading text, in the names of the collapse and Info buttons, and in the guidance dialog title.
- **Hyphenation:** `hyphens: auto` needs the browser's German dictionary. Without it, long words wrap through `overflow-wrap: anywhere`.

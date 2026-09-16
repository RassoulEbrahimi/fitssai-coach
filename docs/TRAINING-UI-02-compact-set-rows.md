# TRAINING-UI-02 — Compact set rows

A presentation-only change to the expanded set rows of the running workout. It supersedes the "Set rows" section of `TRAINING-UI-01-active-workout-presentation.md`.

Unchanged (TRAINING-EXEC-01A–03A, TRAINING-UI-01/01B):
- the exercise header;
- thumbnails;
- execution identity;
- completion, actual and previous persistence;
- rest timer behaviour, guidance, Focus Mode and the completion summary.

There are no new queries, writes, Firestore fields or backend changes.

## Row anatomy

`ExerciseSetRow` renders one row. `workoutPresentation.css` places it by card width with container queries on `.workout-exercise-unit`.

| Card width | Layout | Used by (measured) |
| --- | --- | --- |
| 340px and up | `1. Satz  [12] × [50] kg  • 90 s Pause  ○`, one line | Focus Mode at 375/412px, desktop |
| 260–339px | Same line; the rest wraps under the inputs | Focus Mode at 320px, Dashboard at 375/412px |
| under 260px | `1. Satz • 90 s Pause` on top; `[12] × [50] kg  ○` below | Dashboard at 320px (238px card) |

**Set number:**
- "N. Satz" stays visible.
- It labels the row group, and uses tabular numerals so the fields line up down the list.

**Fields:**
- Reps are 48×40 and kg 60×40, with centred 16px semibold numerals.
- They have no visible labels. Screen-reader labels read "Wiederholungen für Satz N" and "Gewicht für Satz N in kg".
- `×` and `kg` are `aria-hidden` text around the fields.

**Rest:**
- `formatRestDisplay(exercise.rest, { withLabel: true })` gives "• 90 s Pause".
- It is display only; the timer still reads the prescription through `buildExecutionSetViewModels`.
- It is omitted when no rest, or 0 s, is prescribed.

**Completion:**
- The 44×44 `role="checkbox"` is unchanged.
- It comes last in the DOM, so keyboard order stays reps → kg → `Übernehmen` → completion, while CSS places it at the end of the first line.

**List:**
- Rows are divided (`divide-y`) inside the exercise card rather than drawn as separate cards.
- Content is capped at `max-w-md`, as before, so completion stays near the fields on wide cards.

**Completed:**
- A flat `bg-primary/[0.06]` band, plus the checked control and `data-completed`.
- Muted text on completed rows uses `foreground / 0.65`. Plain muted text measured 4.3:1 on the tint inside an already-completed card, and the override measures 6.1:1 in light mode and 7.8:1 in dark mode.

**Details below the line:**
- These are validation errors, a written-out prescription, and "Letztes Mal".
- They appear only when there is something to show. No space is reserved.

## Prescription as placeholders

`formatSetTargetPlaceholders` in `setPrescription.ts` turns the prescription into input placeholders only.

**Reps:**
- A plain count (`12`) or a count range (`8–12`, whitespace removed) of up to 5 characters becomes a placeholder.
- `30 Sekunden`, `AMRAP` and long ranges do not.

**Weight:**
- Only a single load in kg becomes a placeholder, and only if it passes `isRecordedWeightKg`, shown in German notation (`52,5`).
- Words (`Körpergewicht`), ranges, percentages, other units and `0 kg` do not.
- Nothing is invented for a missing load.

**When a placeholder can't carry it:**
- When any part of the prescription cannot become a placeholder, the row writes it out once below the fields, e.g. "Vorgabe: 30 Sekunden" or "Vorgabe: 6 × Körpergewicht".
- Plain numeric rows have no "Vorgabe" text.

**Placeholders are never data:**
- They use only the native `placeholder` attribute.
- The field value is still draft ?? recorded, and drafts, commits and completion never read the placeholder.
- An integration test checks that blur, Enter and completion on an untouched field write nothing, or a `completion-only` log, while rest starts once.

**Visual distinction from recorded values:**
- The placeholder is 14px, regular weight and muted, while a recorded value is 16px, semibold and foreground.
- Empty fields get a dashed border (`data-empty`), which does not rely on colour.

## Previous performance

- The line reads "Letztes Mal: 10 × 52,5 kg" plus `Übernehmen`, aligned under the fields on cards 340px and wider.
- The compact pair comes from `formatPerformancePair`. Screen readers get the unit form ("10 Wdh. · 52,5 kg"), and the pair is `aria-hidden`.
- A single recorded value keeps the named form ("8 Wdh.", "50 kg").
- `Übernehmen` is still a real 44px button, now with a 28px face and −8px margins. The line's 8px top margin keeps that box clear of the fields and the completion control.
- Copy semantics are unchanged: drafts only, empty fields only.

## Measurements

Setup:
- a local fixture with production CSS and Montserrat loaded;
- headless Chrome with device-metrics emulation;
- the same script run on `main` (`fb62873`) and on this branch.

Heights of the expanded sets region (`CollapsibleContent`):

| Context | 3 sets: main → branch | 4 sets with "Letztes Mal": main → branch |
| --- | --- | --- |
| Focus Mode 412px | 332 → 163px | 574 → 354px |
| Focus Mode 375px | 332 → 163px | 594 → 354px |
| Focus Mode 320px | 332 → 211px | 614 → 418px |
| Dashboard 412px | 332 → 211px | 594 → 418px |
| Dashboard 375px | 332 → 211px | 614 → 418px |
| Dashboard 320px | 332 → 223px | 634 → 494px |

Row heights:

| Case | Height |
| --- | --- |
| Before (main), open row | 104px |
| One line | 52px |
| Rest wrapped | 68px |
| Compact tier | 72px |
| Error line | +37px |
| Written-out prescription | +20px |
| "Letztes Mal" | +38px, or +58px when `Übernehmen` wraps in the compact tier |

**Checked at 320, 375, 412 and 1280px, in light and dark, in both modes:**
- no horizontal overflow;
- placeholders fit their fields;
- the completion centre hits the control;
- `Übernehmen` is hit 7.5px above and below its face, and its box overlaps no field or completion control.

**Known limit:** at 412px the Dashboard card is 330px, a few pixels short of the one-line tier, so the rest wraps there.

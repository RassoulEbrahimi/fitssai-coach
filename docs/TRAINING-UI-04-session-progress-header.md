# TRAINING-UI-04 — Session header and progress

A presentation-only change to the status block at the top of the running workout, plus one fix to the shared `Progress` wrapper.

Unchanged:
- the exercise card header (TRAINING-UI-03) and the set rows (TRAINING-UI-02);
- thumbnails (TRAINING-UI-01B);
- the rest timer, bottom sheet and inline rest bar;
- the finish button and the finish flow;
- `TrainingSessionContext`: `startedAt`, the one-second tick, duration, session identity and calendar binding.

There are no new queries, writes, Firestore fields or backend changes.

## Before

```
[flame] Training läuft  (stopwatch emoji) 17:31      5/26 Sätze
████████████────────────────────────────────────────  8px
```

- **Layout:** `mb-4 space-y-2`, with a wrapping flex row.
  - The time was 12px muted text behind a literal ⏱️ emoji, in proportional figures: "11:11" measured 39.5px and "00:00" 54px, so the line shifted every second.
  - On the Dashboard at 320px (238px wide), the count wrapped onto a row of its own.
- **Progress bar:** 8px, with a `bg-muted/50` track.
  - The shared wrapper never gave `value` to Radix, so the bar was exposed as an unnamed, indeterminate progress bar.

## After

`ActiveWorkoutSession` renders the markup; the `.workout-session-*` rules in `workoutPresentation.css` lay it out.

```
Phones, 18rem and wider:
[flame] Training läuft    [timer] 17:31    5/26 Sätze
━━━━━━━━━━───────────────────────────────────────  6px

Under 18rem (Dashboard at 320px):
[flame] Training läuft            5/26 Sätze
[timer] 17:31
━━━━━━━━───────────────────────────────────  6px

30rem and wider (capped at 549px):
[flame] Training läuft   [timer] 17:31                  5/26 Sätze
━━━━━━━━━━━━━━━──────────────────────────────────────────────────
```

The block has no surface of its own: no border, background, shadow or radius. It sits 16px under the hero (the card's own padding) and 12px above the first exercise card, the same gap as between cards.

**State:** `todayWorkout.trainingInProgress`.
- 14px semibold in the primary colour, after a static 16px `Flame` icon.
- It is a plain `span`, not a heading.

**Elapsed time:** a Lucide `Timer` icon and `<time dateTime="PT17M31S">17:31</time>`.
- `Timer` (a stopwatch) replaces the emoji. The hero already uses `Clock` for the planned duration, so the two times stay distinguishable.
- 14px medium, foreground colour, `tabular-nums`, no wrap. Every mm:ss value has the same width, so the line does not jitter.
- The formatter is unchanged: minutes keep counting past 59, with no hours ("125:07", "318:32"). Nothing truncates.
- The value still comes from `durationSeconds`. The component owns no clock.

**Count:** "`completed`/`total` Sätze".
- 12px medium, muted, `tabular-nums`, no wrap.
- It stays one text element, so existing queries such as `getByText('1/5 Sätze')` still match.
- It is factual only: no percentage text and no judgement.

**Progress bar:** the shared `Progress`.
- 6px (`h-1.5`), rounded, on the full `bg-muted` token, so the thinner line keeps a visible track.
- Its value is `progress.progressPercent`, computed as before in `useWorkoutExecution`.

### Widths

The same markup is used everywhere; only the grid changes, through container queries on `.workout-session-status`.

| Header width | Where | Arrangement |
| --- | --- | --- |
| under 18rem | Dashboard at 320px (238px) | row 1: state · count; row 2: time |
| 18rem–30rem | Focus Mode at 320–412px (288–380px), Dashboard at 375–412px (293–330px) | one line, three facts spread evenly |
| 30rem and up | tablet and desktop | one line: state and time together, count at the end of the bar |

- **Widest content:** "Training läuft" 118px with its icon, "318:32" 70px with its icon, "26/26 Sätze" 74px, and two 12px gaps: 287px in total. So one line fits from the 288px Focus Mode width at 320px, whatever the duration.
- **Units:** the breakpoints are in `rem`, so a larger root font size moves them with the text.
- **Overflow:** if content still ran out of room between breakpoints, "Training läuft" would wrap between its words before anything overflowed. The time and the count never wrap.
- **Wide screens:** the line and the bar are capped at `1px + 1rem + 72px + 0.75rem + 28rem` (549px). On a wide card, that is exactly where the exercise progress lines end (border, padding, thumbnail, gap, and the 28rem identity column from TRAINING-UI-03).

### Dashboard and Focus Mode

`ActiveWorkoutSession` is mounted once, and Focus Mode portals the same subtree, so there is one header and one clock. Both modes render the same markup; only the width differs. Leaving or entering Focus Mode remounts the header, which reads the running duration from the session context again; nothing resets.

## Shared `Progress` fix

`src/components/ui/progress.tsx` now passes `value` and `max` to `ProgressPrimitive.Root`. Radix then supplies:
- `aria-valuenow`, `aria-valuemin` and `aria-valuemax`;
- `aria-valuetext` (e.g. "19%");
- `data-state`: `loading` or `complete`, and `indeterminate` only when there is no value.

**Bounding:**
- Radix rejects values outside `0..max`: it logs an error and treats the bar as indeterminate.
- A session can log more sets than it plans (`getCompletedCount` is not capped), so the wrapper clamps numbers into the scale first.
- `NaN`, `null` and `undefined` stay indeterminate.

**Drawing:** the indicator is drawn from the same bounded value on the same scale, so what is drawn and what is announced agree.
- For in-range values and the default `max` of 100, the transform is exactly what it was before.
- A custom `max` is now drawn to scale; before, it was ignored when drawing.

**Other consumers:**
- *`OnboardingForm`*: passes its own `aria-valuenow` / `aria-valuemax` / `aria-valuetext`, which still override Radix's attributes because the rest of the props are spread after them.
- *`AvatarUploadProgress` and `ProfileCard`*: pass 0–100 and now gain correct semantics.
- *`ExerciseWithSets`*: its bar keeps `aria-hidden="true"` and stays out of the accessibility tree.
- *`Dashboard`*: only imports `Progress`.
- No sizes or colours changed for any consumer.

## Accessibility

Reading order equals visual order. The screen reader hears:

> Training läuft, Trainingsdauer 17:31, 5/26 Sätze, Trainingsfortschritt, 19%

- Visually hidden text ("Trainingsdauer", from `todayWorkout.sessionDuration`) names the time, and visually hidden commas separate the facts.
- The time is not a live region, so a screen reader does not announce every tick.
- **Session bar:** the only exposed progress bar on the page, named "Trainingsfortschritt" (`todayWorkout.sessionProgress`). It carries the percentage, while the text states the count, so the two complement each other instead of repeating.
- **Exercise bars:** stay decorative (`aria-hidden`), as in TRAINING-UI-03.
- **Icons:** `aria-hidden`.

## Measurements

**Setup:**
- a local fixture with production CSS, Montserrat, and seeded 0/5/26 of 26 sets;
- headless Chrome with device-metrics emulation and a pinned session clock;
- the same script on `main` (`e8ec8b7`) and on this branch.

**Status block, 5/26 sets at 17:31, `main` → branch (the same in light and dark):**

| Context | Width | Rows | Height | Gap to first card |
| --- | --- | --- | --- | --- |
| Focus Mode 320px | 288px | 1 → 1 | 36 → 32px | 16 → 12px |
| Focus Mode 375px | 343px | 1 → 1 | 36 → 32px | 16 → 12px |
| Focus Mode 412px | 380px | 1 → 1 | 36 → 32px | 16 → 12px |
| Dashboard 320px | 238px | 2 → 2 | 56 → 54px | 16 → 12px |
| Dashboard 375px | 293px | 1 → 1 | 36 → 32px | 16 → 12px |
| Dashboard 412px | 330px | 1 → 1 | 36 → 32px | 16 → 12px |
| Desktop 1280px, both modes | 768px | 1 → 1 | 36 → 32px; bar 768 → 549px | 16 → 12px |

- **Dashboard at 320px:** on `main`, the count wrapped onto its own row. Now the time takes row 2 and the count stays beside the state.
- **Hero to first exercise card:** 68 → 60px, or 88 → 82px on the Dashboard at 320px.
- **Evenly spread gaps:** 22px (Focus Mode 320), 24px (Dashboard 375), 43px (Dashboard 412), 49px (Focus Mode 375) and 68px (Focus Mode 412).
- **Desktop:** 20px between state and time.

**Digit widths:**
- `main`: "11:11" measured 39.5px and "00:00" 54px, so the line moved by up to 14.5px every second.
- Branch: "11:11", "00:00" and "88:88" all measure 42.4px.

**Edge cases:**
- **Cases:** 0/26 at 00:45, 5/26 at 59:59, and 26/26 at 60:00, 125:07 and 318:32.
- **Where:** 320, 375 and 412px, in both modes.
- **Results:**
  - The header never overflowed and the page never scrolled horizontally.
  - The layout kept its row count everywhere: one line, except the Dashboard at 320px.
  - The narrowest gaps were 12.8px (Focus Mode 320px, 318:32, 26/26) and 15.3px (Dashboard 375px, same content).

**Bar:**
- `aria-valuenow` 0 / 19 / 100, with `data-state` `loading` / `loading` / `complete`.
- Chrome's accessibility tree exposes exactly one progress bar, "Trainingsfortschritt", with value 19.

**Contrast, composited on the card (light / dark):**
- **State:** 3.3 / 5.7–6.0:1, the same colour as `main`.
- **Time:** 19.9 / 18.2–19.1:1. On `main` it was muted: 4.8 / 7.4–7.8:1.
- **Count:** 4.8 / 7.4–7.8:1, unchanged.
- **Bar:** the fill is 3.0:1 against the track and 3.3:1 against the card. The track is 1.1 / 1.3:1 against the card; it was 1.0 / 1.0:1 on `main`.

## Known limitations

- **State contrast:** "Training läuft" keeps the primary green. On a light card that is 3.3:1 at 14px semibold, below the 4.5:1 AA target for small text. This is unchanged from `main`, and the colour token was kept on purpose.
- **Breakpoints:** they come from the German strings measured in Montserrat.
  - Another language, a fallback font, or a session of 1,000 minutes or more (a seventh character) would need measuring again.
  - Until then, "Training läuft" wraps between its words before anything overflows.
- **Hours:** minutes are not converted to hours past 59; that is the existing format.
- **"Sätze":** still a German literal in the component, as in the exercise card.
- **Overshoot:** if more sets are logged than planned, the bar is now full and announced as 100%, while the text keeps the real count (e.g. "27/26 Sätze"). `useWorkoutExecution` still compares its unbounded percentage with 100 for `isComplete`; that is unchanged here.
- **Announcements:** the progress bar is not a live region, so a change in percentage is not announced on its own. The set tick itself is what the user hears.
- **Verification:** headless Chrome with emulated viewports, not a physical device and not a screen reader.
  - Chrome's DevTools accessibility tree reports the bar's `valuetext` as empty, although the DOM carries `aria-valuetext="19%"` from Radix.

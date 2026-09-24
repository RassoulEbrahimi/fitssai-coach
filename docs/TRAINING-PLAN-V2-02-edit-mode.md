# TRAINING-PLAN-V2-02 — Canonical Edit Mode

Replaces the V2-01 editing compatibility surface with the canonical Edit Mode
for one dated workout day. No Firestore schema, rules, Functions, session
identity, set completion or execution UI changed. Main, Day Detail and Plan
Overview are unchanged.

## Structure

```
Abbrechen        Pull A bearbeiten        Fertig
Nur Do 10 · Änderungen werden sofort gespeichert.
☰  Kreuzheben            3×5 · 150s        ⇄  ×
☰  Klimmzüge             3×max · 120s      ⇄  ×
…
[ + Übung hinzufügen ]
  ✦ Auto-ausfüllen
```

| Part | Component |
| --- | --- |
| Edit Mode screen | `DayEditSurface` |
| Replace / add picker (bottom sheet) | `ExercisePickerSheet` on `BottomSheet` |
| Auto-ausfüllen | `AutoFillSheet` |
| Rules as data (move, replace, add, lock, suggestions) | `src/lib/trainingsplanEdit.ts` |
| Reorder persistence | `useReorderExercise` |
| Catalogue | `useExerciseCatalogue` (the `exercises` collection the existing selector reads) |

Rows are structure only: drag handle, name, a one-line prescription for
orientation, replace, remove. No set editors, inputs or execution controls.

## Persistence scope

Every edit addresses one plan day by its own `weekKey` / `dayIndex` and
rewrites only that day's exercise array (read plan → rebuild one day → write
`content` back), exactly like the existing editors. Nothing propagates to
other weeks, to later days with the same workout name, or to templates.
Changes are saved as they are made, so there is no global Save: **Abbrechen**
and **Fertig** both return to the same Day Detail without discarding anything.

- **Reorder** — new `useReorderExercise`: moves one exercise; every exercise
  object is carried over unchanged. It refuses when the name at the source
  index differs from what the user saw (list changed underneath) and runs
  through the history guard as the new edit kind `move`, whose affected
  positions are exactly the range between both ends.
- **Replace** — the existing `useExerciseEditor` (identity change → existing
  `replace` guard). Sets, reps and rest stay; weight, description and notes
  are cleared to `""` because they describe the replaced movement. No other
  field is added or guessed.
- **Remove** — the existing `useDeleteExercise` with the existing undo toast
  (`useRestoreExercise`). No confirmation; the row disappears optimistically.
- **Add** — the existing `useAddExercise` (by plan id). The user picks a
  catalogue entry, then confirms sets / reps / rest prefilled with the existing
  add form's defaults (3 / 10 / 90s). Only confirmed values are written.

All five plan-day editors now share one serialization lane per plan
(`planEditLane`), so a quick second edit reads the first one's result instead
of racing it. Edit Mode addresses rows by their place on screen, which runs
ahead of the saved list while moves are in flight; the lane applies the
writes in the same order.

## Reorder

The handle (Lucide `Menu`, 44 × 44) starts a framer-motion `Reorder` drag;
only the handle starts it (`touch-action: none` on the handle), so the list
still scrolls anywhere else. The row in the hand is lifted onto its own surface
with a subtle shadow. A drag persists once, on release, as a single move. The
handle also moves its row with ArrowUp / ArrowDown, keeps focus on the moved
row and announces the new position. A refused or failed move puts the row
back (the saved list wins once the last move settles).

## Replace

Bottom sheet titled "Übung ersetzen" naming the exercise being replaced.
"Ähnliche Übungen" lists catalogue entries with the same main muscle group —
judged only by the repository's reviewed muscle data (`exerciseMuscleSummary`),
never guessed; unknown exercises get no suggestions. The day's own exercises
and the replaced one are left out. The catalogue is searchable. Nothing is
written until an entry is chosen.

## Auto-ausfüllen

There is no suggestion source in the app: the KI tab it opened before was
already a "not available" notice (`AIPromptAssist`). The sheet keeps exactly
that behaviour: it says so, writes nothing and offers the manual add flow.
When suggestions exist they belong in this sheet as a list the user accepts
explicitly. No AI or backend work was added.

## Active session safety

A running workout reads its exercises live from its own plan day and keys set
completion, drafts and the rest timer by exercise position. Therefore:

- **Editing the running session's day** (including the source week of a
  mirrored week): structure is **locked**. Edit Mode stays reachable, shows
  "Dieses Training läuft gerade. Die Übungen kannst du ändern, sobald es
  beendet ist.", and disables reorder, replace, remove and add. The handlers
  in `WorkoutView` refuse the same edits (`isEditLocked`), so no path changes
  the live session. Auto-ausfüllen stays reachable (it writes nothing).
- **Editing any other day while a workout runs**: allowed. The session is
  bound to its own day, so its identity, progress, timer, set completion and
  drafts are untouched (tested).
- The pre-start cache still follows today's plan day only; editing another
  day never replaces it (tested).

Edit Mode never calls start or resume.

## Navigation

Unchanged V2-01 history model: Main → Day Detail → Edit Mode. Fertig,
Abbrechen and browser / Android Back each pop to the same Day Detail with
focus back on "Bearbeiten". The sheets are Radix dialogs and never touch the
history, so closing one (Escape, ×, backdrop) stays in Edit Mode; browser Back
while a sheet is open leaves Edit Mode as usual.

## Responsive QA

Checked with Playwright at 320 / 375 / 412 px, light and dark: 3 exercises,
8 exercises, long names, a real pointer drag (mid-drag state and persisted
result), replace picker, after replacement, after deletion, add (pick and
prescription), autofill, locked (running workout). No horizontal overflow at
any width; long names truncate with the full name in `title`; all actions stay
44 × 44 and inside the viewport; the sheet fits 320 px with its footer visible.

## Deviations and known limitations

- The design artifact `Trainingsplan V2.dc.html` was not available to this
  implementation; structure and hierarchy follow the task's canonical layout
  and the V2-01 visual language (tokens, Montserrat, Lucide, flat surfaces).
- A one-line scope note ("Nur Do 10 · Änderungen werden sofort gespeichert.")
  sits under the header; it replaces V2-01's boxed notice.
- Sets / reps / weight of an existing exercise are no longer editable in Edit
  Mode (structure editing only, by design). Prescription is set when adding.
- Auto-ausfüllen offers no suggestions (none exist); see above.
- Plans whose week has no content of its own (legacy mirrored weeks) keep the
  existing editors' behaviour: edits addressed to the mirroring week fail as
  "not found" rather than materialising a week.
- A move refused because the list changed underneath is retried with the
  shared backoff before it is reported.
- `AddWorkoutModal` is no longer rendered by the Trainingsplan tab; it and its
  tests stay for the legacy `DayAccordion` until a later removal.

# TRAINING-HISTORY-01 — Workout History & Session Detail

A factual, read-only record of completed training inside the Training tab.
No Firestore schema, rules, indexes, Functions, finish writer, session
identity, set completion or performance logging changed.

## What a history session is

- A **completed day-session record** in `users/{uid}/workout_logs`: classified
  as a day session (`shared/workoutCompletion.ts`), `completed === true`, a
  readable `workoutDay` and a `planId`. Exercise-position logs, ticked sets,
  a measured duration or progress never create one.
- Identity is **`planId + workoutDay`**, the address the day-session writer
  converges on. `readCompletedWorkoutDays()` (weekKey + dayIndex) is plan
  progress and is not used: Plan A Week 1 Monday and Plan B Week 1 Monday are
  two workouts. Duplicate rows of one session collapse, read in id order.
- A completion without a readable `workoutDay` is not listed. No date is
  taken from the plan calendar, `completedAt`, today or list order.

## Reading (`src/lib/workoutHistory.ts`, `src/hooks/queries/useWorkoutHistory.ts`)

- List: `where(workoutDay < cursor) · orderBy(workoutDay desc) · limit(100)`
  over the mixed collection — the shape the previous-performance lookup
  already uses, served by the single-field index. Documents are classified
  and deduplicated; a page counts **sessions**, not documents, and reads
  bounded chunks until 30 sessions are found, the source is exhausted, or
  8 chunks were read. Days are taken whole: a full chunk's oldest day is read
  again with the next chunk, and a chunk that is a single day is completed
  with an equality read of that day. The cursor is that day, so pages never
  overlap. `Ältere Trainings laden` reads the next page.
- Session: the day records at `planId == · workoutDay ==` (the writer's own
  query), the plan document, the exercise-position logs at
  `planId · weekKey · dayIndex` (set tracking's query) and their set
  subcollections. Exercise logs that name another `workoutDay` are not the
  session's.
- Every read is a server read (`getDocsFromServer`): an offline cache read
  would answer "nothing" and turn an error into an empty history. Failures
  reject and show a retry.
- Cached with React Query; the tab invalidates it when the plan's completed
  day records change (a finish).

## Evidence, not plan shape

A plan can change after a session: Edit Mode may append an exercise to a day
that already has history, and prescriptions can change. So the plan never
decides what a past session contains.

- **Historical evidence** decides the exercises: a position is part of the
  session only when its own logs record activity — a parent activity marker
  (`completed === true`, `completedAt`, or the older duration/calorie fields;
  `src/lib/positionActivity.ts`, now shared with the plan-edit guard's
  `hasRecordedActivity`) or at least one stored set (ticked, or with trusted
  `user-recorded` values). A plan exercise without activity is not listed.
- **The historical plan is a name lookup only** for those positions.
- No planned-set denominators (`2/3`, `17/18 Sätze`) and no exercise count
  from the plan. Counts come from stored sets (`6 Sätze abgehakt`).
- The title is the plan day's explicit label (`Push A`); a weekday-only label
  gives `Training`, never a muscle title derived from the day's current
  exercise list.

## Names

Only from the session's **own** plan: `planId → weekKey/dayIndex` through
`planWeekMirroring` (the same mirroring the plan-edit guard and previous
performance use; `readDisplayedDay` was added beside
`readDisplayedDayExercises`). Never the active plan. Unreadable plan or day →
`Training`; an evidenced position with no name → `Übung n` (with "Name nicht
mehr zuordenbar" when the plan day exists). No name snapshot is written; the
cached session record keeps only the names of evidenced positions.

## What is shown

- Row: date block (`Heute` / `Gestern` / weekday + day), title, and the
  measured duration when stored and plausible (`readDurationSec`), never
  estimated. No exercise count: the session's own count would take a read per
  row. A completion without plan position reads `Nur Abschluss gespeichert`.
- Detail: date, title, `52 Min · 17 Sätze abgehakt` (each part only when
  stored), plan context, then each evidenced exercise with one line per stored set. Reps/weight only when the set is
  `user-recorded` (`readSetLogState`), formatted with the immediate summary's
  `formatPerformanceValues` / `formatRecordedSet`. Completion-only sets read
  `Abgehakt · ohne Werte`; a completion-only exercise collapses to
  `n Sätze abgehakt · keine Werte erfasst`; an exercise ticked without sets
  reads `Als erledigt markiert · keine Sätze erfasst`; recorded but unticked sets keep
  `offen`; legacy prescription-copied numbers are never shown.
- Partial / legacy data is explained in one sentence; nothing is invented.

## Navigation

Two screens on the existing Trainingsplan stack (`trainingsplanNavigation`):
`history` and `session {planId, workoutDay}`.

- Trainingsplan → Verlauf → Session → Zurück = Verlauf → Zurück = Trainingsplan
- Trainingsplan (Heute, erledigt) → Zusammenfassung ansehen → Session → Zurück = Trainingsplan
- Trainingsplan → erledigter Tag → Zusammenfassung ansehen → Session → Zurück = derselbe Tag

Browser/Android Back and Forward, scroll and focus restoration and remount
restoration work as for the other pushed screens. Stored stacks are validated:
History only on Main, a session only on top, and outside History only this
plan's own session (on Main or on its own completed day). Without a plan the
stack is kept under a scope that is not a plan id, where only History and its
sessions are valid.

`Zusammenfassung ansehen` appears only when **this plan's** completed
day-session exists for exactly that date (`hasCompletedSession`). There is no
fallback to the latest session or another plan's date.

## Without an active plan

The existing no-plan card stays as it is; the `Verlauf` row sits below it.
Sessions still resolve names from their own plans.

## Deliberate deviations from the design

- Mock data (`12-Wochen-Plan`, `Woche 3/12`) is not used: the plan context is
  the fixed `4-Wochen-Plan · Woche n`.
- The `Verlauf` row names the newest session from a small read (up to two
  chunks of 30 documents); when that read fails or finds none without
  reaching the end, the row shows no meta rather than "Noch keine Trainings".
- The not-found state offers `Zum Verlauf` only when opened from Verlauf; from
  Today or a day, `Zurück` leads back there.
- No `x/y` set counts and no `n Übungen` (design): the denominator and the
  count would come from the plan's current state, not from the session.
- Titles are the explicit day label or `Training`; generated plans with
  weekday labels therefore show `Training` in History.
- A session with no stored exercise activity says so in one sentence instead
  of listing the plan's exercises.
- The bottom navigation stays visible on Verlauf and Session Detail, as on
  Plan Overview (no footer action).

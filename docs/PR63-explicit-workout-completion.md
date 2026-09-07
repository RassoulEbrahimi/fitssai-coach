# PR #63: Explicit successful workout completion

Baseline verified before edits: clean `main` in `D:/Git/fitssai-coach` at
`825f47260885242e3a18c931ad85f617ac4e93f6`. Local main, origin/main and live
remote main matched. PR #62's merge commit is this same baseline. Branch:
`codex/pr-63-explicit-workout-completion`.

## Product contract and traced flow

`TodayWorkoutCard` starts a session bound by `TrainingSessionContext` to its
plan, week, day index and calendar date. Opening `WorkoutSummaryModal` only
shows the summary; its timer continues. Checking sets, logging exercises,
allowing time to pass, and opening the summary do not complete the day.

The summary's `onFinish` calls `handleCloseSummary(true)`. This is the deliberate
save-and-finish action. There is no separate end-early save action: it can be
confirmed at any set percentage, including zero. The existing normal success
message explicitly says the workout is complete. The modal's `onClose`, back
button and dismissal call `handleCloseSummary(false)`, clear any finish-attempt
stamp and return to training without a persistence write or session close.

### Future-day completion guard (independent review follow-up)

For v1.1, only today's or past training days may be completed. Start is disabled
for a future selected date, with the existing `dashboard.futureDay.locked` copy
shown below it: "Nur für heutige oder vergangene Tage verfügbar". The Start
handler also checks the date before binding a session.

The explicit successful-finish persistence path independently checks the bound
`workoutDay` using `isBerlinFuture`, the same helper as
`Dashboard.toggleDayComplete`. It compares against the current Berlin calendar
day, not a supplied/frozen finish timestamp or the currently selected UI date.
For a future date it throws `FutureWorkoutDayError` before the guarded writer
can write duration, completion, or timestamps. The card displays the same
existing future-day message inline and as an error toast, retains the session,
and does not publish success or invalidate progress queries.

This also protects legacy/hydrated future sessions, including those whose date
is resolved from their bound plan position while an eligible day is selected.
It does not alter the duration-only API, offline queue, plan-date clamping, or
any exercise/set/plan writes. Future-date rejection precedes skipped-duration
handling; the skipped contract below is unchanged for eligible dates.

Eleven additional cases cover disabled Start without session binding, captured
and legacy hydrated future sessions with unchanged downstream consumers, no
future-day write for new or existing rows, untrusted future finish timestamps,
eligible past-day start/finish, and summer/winter Berlin midnight boundaries.
The three-day progress fixture now advances the calendar as each day becomes
eligible and uses the last completed day for its streak assertion.

Successful finish now calls `recordSuccessfulWorkoutFinish`. Its acknowledged
`written` result means the authoritative day row holds `completed: true`,
`completedAt` and the measured `durationSec`. Only then does the card clear the
session and display normal success. The separate `recordSessionDuration` API
keeps its duration-only contract and cannot create completion.

### Skipped measurement is terminal closure, not successful completion

This follows the explicit PR #62 contract in `docs/PR62-session-persistence.md`,
its card regression tests, and the distinct finish branches; it is not an
inference from the save button's label. PR #62 describes a skipped finish as
neither saved-training success nor a retryable failure. Its informational
message says the training ended without a recorded duration. Therefore:

- `skipped: no-duration` still writes nothing, closes the session, and shows the
  existing informational message. It does not complete the day or suppress an
  otherwise eligible training nudge. Missing, future or implausibly old start
  times are not converted to a fabricated duration or completion.
- `skipped: incomplete-metadata` likewise writes nothing. The card already
  rejects missing bound identity/date before reaching the writer.
- A rejected or offline persistence attempt retains the session and its frozen
  timestamp, shows a retry error, and creates no completion or success state.
- Existing completion is not undone by a later skipped or failed attempt.

PR #62 accepts zero elapsed seconds as `written`. That existing boundary stays
unchanged: an explicit successful finish at zero seconds completes the day,
while the duration readers count it as unmeasured. This keeps measurement
coverage truthful without making measurement presence a completion predicate.

The independent explicit day-toggle action remains unchanged. It already
writes completion through the PR #62 guarded writer. No exercise toggle is
promoted into that action.

## Atomic persistence, identity and timestamp

Both session APIs use one internal write path. The explicit finish adds
`completed: true` and `completedAt: Timestamp.fromMillis(endedAt)` to the same
`writeDaySessionRecord` call carrying the absolute duration and plan position.
There is one Firestore transaction, not a duration write followed by a separate
completion write. Rejection cannot leave newly saved duration with missing
completion. No additional transaction architecture is introduced.

The guarded writer is unchanged: PR #60's discriminator excludes exercise
positions, including malformed non-null exercise indices. Existing recognized
day rows keep their IDs. New writes converge on the deterministic plan/date
address, and the transaction rechecks identity before setting or updating it.
Exercise parents and their set subcollections are never written by finish.

The card uses only the session's bound identity. A legacy session lacking a
captured date resolves through its bound position and the same plan's calendar
mapping. Selecting Day B does not retarget a running Day A session.

`completedAt` is the frozen first deliberate finish instant from PR #62, before
any write attempt can fail. Remount/reload and reconnect retries use that same
stored `endedAt`, not retry time. Back-to-training clears it, so a later finish
records the user's later deliberate finish event. Duration remains an absolute
value and completion a boolean; replay neither increments nor duplicates a day.

## Downstream consumers

After acknowledgement the card invalidates the bound user's plan-log query and
the user's weekly/monthly activity queries. They refetch the persisted record;
there are no optimistic completion flags or separate display rules.

- Calendar, dashboard day status and weekly progress use `isCalendarDayComplete`
  and `readCompletedDayDates` over `useWorkoutLogs`.
- Activity uses `isCompletedDayLog`, deduplicates calendar dates and reports
  measured and unmeasured completed days separately.
- Weekly Review uses `buildWeeklyReviewMetrics` and the shared PR #60 completion
  helpers. A three-day week reports 1/3, 2/3, 3/3 exactly once per completed day.
- Nudge eligibility uses the same plan-day/calendar-day authority and becomes
  suppressed after completion. Exercise-only, failed and skipped finishes remain
  eligible when the schedule otherwise allows a nudge.
- The active streak insight consumes Activity's `activeDays`, and is tested at
  three completed days. Profile's separate statistics remain disabled migration
  code (`data = null` after removal of `get_user_stats`); they are not a functioning
  completion consumer and are not restored in this PR.

No AI call is needed to write completion or compute these metrics. Persisted AI
review prose and historical review context are outside this change.

## Regression coverage

Tests use the real card, summary, training providers, query adapters, completion
helpers and guarded writer with an in-memory Firestore boundary. The boundary
now supports timestamp round-trips and date range filters for real Activity
queries.

- New/existing day completion in one write, with exact completion timestamp and
  measured duration; existing exercise parents and set children remain unchanged.
- Concurrent first finishes, repeated acknowledged finishes and retry convergence.
- Transaction rejection before completion; pending acknowledgement; repeated
  clicks; offline/reconnect; recoverable session state and no false success.
- Day A to Day B and return; remount/reload retry; legacy bound-date resolution;
  frozen finish time across retries and a fresh stamp after returning to training.
- Skipped duration, skipped metadata, zero-second coverage and exercise-only
  completion; opening/dismissing the summary does not complete a day.
- Mounted fresh query caches agree across Calendar, Activity, Review and nudge
  after failure then successful retry. Successive days report 33%, 67%, 100%.
- Active streak insight receives three completed days. All finish writes target
  only day-session logs; the plan remains equal and its cache is not invalidated.

PR #62's duration-only writer tests remain intact. Its successful card assertions
now require the newly requested completion fields; failure, skipped and identity
guarantees remain in force. The old module-wide source-text ban on completion in
`aiSurfaces.test.ts` now executes the duration-only API and asserts it writes no
completion fields, allowing the separately explicit finish API in that module.

## Scope

Production changes are limited to the explicit session-record entry point and
the card's finish call/query invalidation. No workout-plan, exercise, set,
schedule, regeneration, AI generation, nutrition, offline queue, notification
delivery, dependency, Functions, security-rule or shared completion-code changes.
No merge or deployment is part of this PR.

## Validation

- Focused finish/persistence tests: 2 files, 58 tests passed.
- Full client suite: 67 files, 1,142 tests passed (27 additional cases, including
  11 future-day guard cases from the independent review follow-up).
- Client typecheck: both app and node configurations passed.
- Client production Vite/PWA build passed. Existing large-chunk advisory remains.
- Mojibake guard passed (292 files); placeholder guard passed (330 files).
- All six touched TypeScript/TSX files passed lint with no warnings or errors.
- Git whitespace check passed.
- Functions/rules tests were not run: those areas and shared backend code did
  not change.

Validation used the installed Node entry points, equivalent to the package
scripts, avoiding the machine's broken default npm launcher noted in PR #62.
Existing dialog accessibility and React Router future-flag warnings remain in
the test output; they do not fail the suite. The first full run exposed the
obsolete source-text guard described above; after converting it to a behavioral
assertion the full suite passed.

Only the main-branch push or manual dispatch triggers the repository's deploy
workflow. Publishing this feature branch/PR does not request a deployment.

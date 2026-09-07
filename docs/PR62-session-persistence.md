# PR #62: Day/session persistence and recoverable finish

Baseline verified before edits: repository `RassoulEbrahimi/fitssai-coach`, clean
`main` at `f6bfeb6579b85b65cedf3412680948bf09d270f7`. Local `origin/main` and
remote `refs/heads/main` matched. Branch: `codex/pr-62-session-persistence`.

## Traced defect paths

- `TodayWorkoutCard.handleStartTraining` calls `TrainingSessionContext.startSession`.
  The version 1 localStorage payload previously captured planId/weekKey/dayIndex/
  startedAt, but no calendar date. `TrainingContext` combines this independent
  session context with the selected workout's data context.
- `WorkoutView` derives activeWeek and activeDayIndex from selectedDate, passes
  them to `TodayWorkoutCard`, and synchronizes the displayed exercises through
  `TrainingDataContext.syncFromPlan`. Navigation changes these props/data without
  rebinding the active session. The old card finish handler nevertheless used
  the selected props and current plan, borrowing only startedAt from the session.
- `recordSessionDuration`, `useWorkoutLogs.toggleDay`, and
  `offlineHandlers.TOGGLE_DAY` queried planId + workoutDay and wrote docs[0].
  The optimistic day-toggle cache update also selected the first date match.
- `useSetTracking.toggleSet` and `offlineHandlers.TOGGLE_SET` create exercise
  parents with exerciseIndex and, when available, workoutDay. Set documents live
  in each exercise parent's workout_set_logs subcollection. Therefore these
  parents can precede day rows in the old date query.
- `useWeekCompletion.toggleExercise` and the historically named
  `offlineHandlers.TOGGLE_DAY_COMPLETION` query the full exercise position,
  including exerciseIndex. Those exercise write paths are unchanged.
- The old finish handler dismissed the summary, caught/logged write rejection,
  then always called endSession and displayed the normal finish toast. It also
  treated skipped persistence and missing identity as successful finishes.

## Authoritative identity and write behavior

`writeDaySessionRecord` reuses the unchanged PR #60 `isDaySessionLog` predicate
through the client adapter to `shared/workoutCompletion.ts`. The rule requires
no exercise position (exerciseIndex absent/null) and a usable calendar date or
plan position. Non-null malformed exercise indices remain unknown, never day
sessions. The write target additionally requires the exact planId/workoutDay.

All three day/session writers share that guarded path. Existing recognized day
rows retain their IDs; when more than one exists, ID ordering gives stable
selection without merging history. A new row uses
`day-session_<encoded planId>_<workoutDay>`. A Firestore transaction reads the
target again, rejects identity conflicts, and writes only the requested fields.
Concurrent first saves and repeated retries converge on the same new address.
The optimistic cache update excludes exercise and unknown rows as well.

There is no new Firestore discriminator, collection, migration, historical
reindexing, deletion, or bulk update. Unknown rows remain untouched. Legacy
position-only rows without workoutDay are not assigned a calendar date by the
writer. Existing duplicate historical day rows are not consolidated.

## Session binding and recoverable finish

New local session payloads additionally capture workoutDay at start. Finish
uses session.planId/weekKey/dayIndex/workoutDay/startedAt, independent of the
selected day. Older version 1 sessions remain readable; a missing date can be
resolved using their bound position and the same plan's existing calendar
mapping. Missing/unusable identity fails visibly rather than selecting today.

The summary stays open during saving, disables repeated saves, and displays an
inline retry error using the existing modal and error toast. The pre-save
confetti was removed so opening the summary does not celebrate an
unacknowledged finish. The card's memo comparison now observes isOnline so
reconnecting enables a valid retry.

Finishing has three outcomes and `handleCloseSummary` keeps them distinct.

A `written` result clears the session, closes the summary/focus mode and shows
normal success.

A rejected or unreachable write keeps the session, its timer and its stamped
finish instant, shows the inline retry error and never claims success.

A `skipped` result is terminal, not a failure: the writer established there was
no duration worth storing. A session left running past `MAX_SESSION_SEC` skips
for the same reason on every future attempt, so holding it open for a retry
would strand the user in a workout they could never end. The session therefore
ends, nothing is written, and an info toast says the training ended without a
recorded duration rather than reporting a saved one.

The instant the user stopped training is stamped once, into the stored session
payload as `endedAt`, before any part of the save can fail. Every retry of that
same finish reuses it — including after a remount or a reload, which is why it
lives in the payload rather than in component state — so reconnecting an hour
later records the workout and not the wait. Dismissing the summary drops the
stamp, because going back to training means the real finish comes later; the
next attempt stamps afresh. While a stamp is held the summary shows the frozen
duration it will persist instead of a timer still running through the retry.
`endedAt` is optional and validated on read, so pre-PR62 stored sessions still
resume.

Finish does not use the offline queue. Transactions require a server connection;
offline finish stays recoverable until connectivity returns. Queue durability
and account ownership remain the separate PR #63/#64 work. Existing day-toggle
queue entry types, payload mapping, and replay ownership are unchanged.

## Scope and regression coverage

Duration is still a measured absolute value, never an increment or estimate.
Missing/implausible duration is not written as zero. Duration-only saves do not
write completed/completedAt, and exercise-only completion remains insufficient
for authoritative day completion. Explicit successful day-completion wiring is
intentionally deferred to the next PR.

Tests exercise the real writer and card/session providers with a controlled
Firestore boundary: exercise-first mixed rows; existing/new day rows; malformed
history; deterministic-address collisions; identity changes before commit;
concurrent/repeated saves; rejection/retry; Day A to Day B navigation and return;
session recovery after remount; pending acknowledgement; offline/reconnect;
and skipped duration. Hook tests cover the real online action and optimistic
cache update, plus the real offline TOGGLE_DAY handler.

The finish-outcome tests cover both terminal skip cases — a session left past
`MAX_SESSION_SEC` and one that ends before it starts — asserting the session
clears, no row is written or completed, and the message is neither a success
nor a retry prompt. The freeze is covered end to end: a rejected save at T1
retried after a remount at T1+90min, and an offline finish at T1 reconnected at
T1+60min, both persist the T1 duration; going back to training drops the stamp
so a later finish measures the longer session. Each was confirmed to fail
against the unfixed code.

No workout-plan mutation, set/exercise deletion, completion fabrication, or
duration fabrication is introduced. Shared completion code, weekly coverage,
coaching/recommendations, nudges/dedupe, AI quotas, generation, nutrition,
notifications, Functions, and security rules are unchanged.

## Validation

- Client suite: 67 files, 1,115 tests passed.
- Client typecheck: both tsconfig.app.json and tsconfig.node.json passed.
- Production Vite build: passed; bundle-size advisory remains non-blocking.
- Mojibake and placeholder guards: passed, 292 files scanned by each.
- Touched TypeScript/TSX lint: no errors; the existing session-context Fast
  Refresh export warning remains.
- Git diff whitespace check: passed.
- Functions and rules validation was not run because neither those workspaces,
  rules, nor shared code used by Functions changed.

Dependencies were installed from the unchanged lockfile with
`npm ci --legacy-peer-deps`, matching the repository workflow. Local validation
used the installed Node entry points because the default npm launcher resolves
to a missing user-profile npm installation.

The tested persistence/finish boundary is ready for review. The next completion
PR must explicitly record authoritative day completion only after its own
successful completion action; this PR deliberately does not provide that wiring.
No architecture conflict with that next isolated change was found.

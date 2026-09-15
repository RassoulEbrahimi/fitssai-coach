# TRAINING-EXEC-03A: completion review and factual comparison

## Architecture and rules

`WorkoutSummaryModal` remains the final review **before** persistence. Opening
or closing it does not end the session. `TodayWorkoutCard` still commits dirty
drafts before opening, refuses invalid drafts, waits for pending set writes on
confirmation, and preserves the existing duration, failure and retry behavior.
Only **Training speichern & beenden** confirms the finish.

The card passes its session-bound `buildRecordedPerformance` output and existing
`getPreviousExercise` reader to the modal. `buildWorkoutCompletionComparison` is
a pure projection of those inputs. It adds no query, Firestore read, persistence,
identity resolution, global state, model call or derived fitness metric.

- Current values come only from explicitly user-recorded actual performance.
  Completion-only data, unverified legacy numbers and prescriptions are excluded
  by `buildRecordedPerformance`; previous values never fill current gaps.
- Previous values come from the existing TRAINING-EXEC-02B trusted occurrence,
  including its identity, occurrence ordinal and workout date resolution.
- A row matches the exact same `setNumber`. Sets are never shifted or combined
  across occurrences. At least one metric must exist on both sides.
- Each available delta is current minus previous. Missing metrics have null
  deltas. Kg subtraction is rounded to two decimals to remove floating point
  noise; display uses the existing German formatter.
- Open sets with recorded actual values remain visible and say **offen**.
- Equal values are shown on both sides without a delta badge. Mixed positive
  and negative changes have neutral text, with no training-outcome judgment.
- An exercise without comparable sets, or the entire comparison section when
  empty, is omitted. Unavailable history never blocks the review or finish.

## Summary and accessibility

The title is **Training abschließen?**, followed by the bound workout date,
duration, completed/planned sets and **Übungen abgeschlossen**. The exercise
statistic now counts an exercise only when its planned set count is positive
and its completed count reaches that count; a partially completed exercise
does not count as completed. The percentage explicitly describes ticked sets.

**Erfasste Leistung** retains the exact current recorded values. The comparison
has a named section, exercise and set headings, nested lists, and definition
lists labelling **Heute** and **Letztes Mal**. The previous date appears once per
exercise. Deltas are readable text with neutral foreground colors. Comparison
content has no live region. The dialog now has an associated description.
Existing focus containment, opener restoration, scrolling and finish/back
button behavior remain in place. Names and delta labels wrap.

## Validation

- Client and Functions typechecks: passed.
- Client tests: 113 files, 1,876 tests passed.
- Functions tests: 12 files, 491 tests passed.
- Client and Functions production builds: passed.
- Firestore rules: 45 tests passed against the local emulator.
- Mojibake and placeholder guards, changed-file ESLint and `git diff --check`:
  passed.

Focused new model/UI/integration assertions cover numeric directions and zero,
decimal kg, partial and disjoint metrics, same-set matching, missing data,
trusted sources, mixed changes, current open sets and truthful stats. Existing
01A/B/C and 02A/B suites remain green, including offline/races, invalid drafts,
pending writes, explicit completion and failed-finish retries. New integration
coverage commits a dirty draft before comparison, browses calendar days while
bound, and verifies that rest/session state and history read/write counts stay
unchanged when reopening the review.

Browser verification uses the production Dashboard and providers with the
existing local in-memory Firestore fixture, plus the production modal in a
local layout fixture. It does not contact a live account. Verified mixed change,
reps-only/weight-only values, open sets, current counts, close/reopen, focus
return, keyboard scrolling and session-bound comparison after calendar browsing.
Layout checks cover 320px, 375px and desktop in light and dark modes, including
long exercise/workout names, wrapping deltas and reachable footer actions.
Measured dialog content widths equal their scroll widths (no horizontal
overflow). The fixture console reports no application errors.

## Limits

This inherits 02B's bounded lookup and trusted-history availability. It offers
no trend or training-outcome interpretation. Browser testing uses fixtures;
finish failure/retry and loading/failure histories are covered by integration
tests rather than induced against a live backend. Existing dependency notices
about Browserslist, bundle sizes and React Router future flags remain.

For local validation, the sandbox's Git/cache/build permissions required owner
access. Rules testing required the locked rules-test dependencies and an official
portable Java runtime in an ignored local QA folder; no system Java settings or
repository dependency versions were changed.

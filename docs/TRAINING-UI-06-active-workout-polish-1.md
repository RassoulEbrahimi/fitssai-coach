# TRAINING-UI-06 — Active workout polish, pass 1

Six product corrections to the running workout. Five are presentation; one
(the accordion) moves a piece of view state up one level. Nothing about
execution changes: session identity, set writes, recorded performance, the
rest timer, the summary flow, history, Firestore and the persistence model are
untouched, and there are no new queries, writes, listeners or backend changes.

## 1. No toast when a set is completed

`TodayWorkoutCard.handleToggleSet` used to toast on a successful set write:

```ts
void toggleSetAsync(params).then((data) => {
  if (params.completed && !data.queued) showToast(t('todayWorkout.setCompleted', { set: params.setNumber }));
}).catch(() => rollbackRest?.());
```

That was the only caller of `todayWorkout.setCompleted`, and the key does not
exist in `src/messages/de.json`, so the toast showed the raw key over the pause
that had just opened. The success branch is gone:

```ts
void toggleSetAsync(params).catch(() => rollbackRest?.());
```

- The tick, the write and the prescribed rest are unchanged, including the rest
  rollback when the write fails.
- No translation key was added: the toast is removed, not translated.
- Every other toast is untouched — the finish message, the finish-without-
  duration and retry messages, the set-write failure and the locked future day.

## 2. One expanded exercise at a time

`ActiveWorkoutSession` now owns the open exercise:

```tsx
const [expandedExercise, setExpandedExercise] = React.useState<number | null>(0);
…
isExpanded={expandedExercise === index}
onExpandedChange={(expanded) => setExpandedExercise(expanded ? index : null)}
```

`ExerciseWithSets`'s `defaultExpanded?: boolean` became a controlled pair,
`isExpanded: boolean` and `onExpandedChange: (expanded: boolean) => void`, and
its `Collapsible` went from `defaultOpen` to `open`/`onOpenChange`.

**Why controlled rather than a `useEffect` that closes the others:** the card
keeps no open state at all, so there is nothing for two cards to disagree
about. A tap is a request; what is drawn is whatever the session hands back.
`null` — everything closed — is a normal state, not an edge case.

- Opening B closes A. Tapping the open one closes it and leaves all closed.
- Identity is the exercise's position in the running day: the same index set
  writes, recorded performance and the rest timer already use.
- **Nothing is lost when the open exercise changes.** Drafts live in the
  `SetPerformanceDraftStore`, recorded values in the set-tracking cache and the
  rest timer in `useRestTimer` — all owned by `TodayWorkoutCard`, above Focus
  Mode's portal. A collapsed card only stops drawing them.
- The inline rest bar is rendered outside `CollapsibleContent` and keyed off
  `timerState.exerciseIndex`, so a running pause stays visible on its own
  exercise whether that exercise is open or not.
- Guidance is a sibling control with its own Radix root; opening it never
  changes what is expanded, and expanding never opens it.

## 3. Focus rings are not painted in the running workout

The app is used on a phone. A ring drawn around whichever control was last
touched competed with the set being worked on, so it is no longer painted —
inside `.workout-session` only.

- The ring utilities were removed from the controls this screen owns: the
  collapse trigger, the set completion toggle and the "Übernehmen" face.
- One scoped rule in `workoutPresentation.css` covers the shared `Button`,
  `Input` and the inline rest bar, which keep their own classes:

```css
.workout-session :is(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: none;
  box-shadow: none;
}
```

  Specificity 0,3,0 outweighs Tailwind's 0,2,0 `focus-visible:ring-*`.

**This is paint only.** Roles, accessible names, `aria-expanded`,
`aria-checked`, tab order, activation, `focus()` and the dialogs' focus
trapping are all unchanged. The guidance dialog, the rest sheet and the summary
render in portals attached to `document.body`, outside `.workout-session`, so
the rule cannot reach them. Nothing outside the running workout is affected.

## 4. The subtitle names the muscle groups

Under the exercise name, `2/4 Sätze · 90 s Pause` became `Brust, Trizeps`.

`src/lib/exerciseMuscleSummary.ts` returns a subtitle for a name, or nothing:

1. **Reviewed anatomy first.** When `exerciseGuidance` knows the exercise, its
   `muscles` are named in everyday words (`lats` → Rücken, `deepAbs` → Bauch).
   The rule: the primary groups, deduplicated; a movement with a *single*
   primary group also names the first helper it trains. So Bankdrücken reads
   "Brust, Trizeps" and Klimmzüge "Rücken, Bizeps", while Plank — which already
   spreads across two primary groups — stays "Bauch" instead of overstating its
   shoulder stabilisers.
2. **Otherwise the compact catalogue map**, keyed by the canonical identity
   `exercisePresentation` already resolves. Aliases, plurals and translations
   therefore resolve through the existing exact-match rules rather than a second
   name list; the thumbnail data itself is untouched. Every catalogue identity
   has an entry, two words at most.
3. **Otherwise nothing.** A name the repository does not know has no subtitle
   line at all rather than an invented or generic one.

Conditioning movements name what they train ("Ausdauer", "Ganzkörper"), which
is the honest short answer for them and keeps the line the same shape.

The header keeps everything else: a completed exercise still shows its check
and the screen-reader word "abgeschlossen", and the progress bar is unchanged.
The set count did not disappear from the interface — it is the collapse
control's accessible name, `"Bankdrücken 2/4 Sätze"`, as it already was — and
the prescribed rest is on every set row.

## 5. Set-row values: larger, flat, unboxed

`ExerciseSetRow` only. The numbers are the row now, written straight on the
surface:

| | before | after |
| --- | --- | --- |
| reps and weight | 16px semibold | **18px** semibold |
| placeholder (the prescription) | 14px | **16px** |
| `×` / `kg` | 16px / 14px | **18px / 16px** |
| `• 90 s Pause` | 12px | **14px** |
| static prescription (no inputs) | 14px | **16px** |
| field box | `border-input` on four sides, `bg-background`, `rounded-md`, focus ring | **no box**: `bg-transparent`, `border-x-0 border-t-0`, `rounded-none`, no ring, no shadow |
| empty field | dashed box | **dashed hairline underline only** |
| field size | 48×40 / 60×40 | **56×44 / 68×44** |

Measured in the browser: `background: rgba(0,0,0,0)`, border widths
`0/0/1px/0`, `border-radius: 0`, `box-shadow: none`, and 44px-tall fields in a
44px line.

Unchanged: `data-empty`, the prescription as placeholder and never as a value
(UI-02), recorded values (EXEC-02A), "Letztes Mal" and "Übernehmen" (EXEC-02B),
the decimal comma, commit-on-blur/Enter and validation. An invalid field now
shows a solid destructive underline and destructive text instead of a red box.

## 6. The finish action is a normal bottom button again

`Training beenden` is the same primary 52px control with the same semantics —
it commits dirty drafts and opens `WorkoutSummaryModal`, and only "Training
speichern & beenden" finishes the workout. Only its placement changed.

Removed from `workoutPresentation.css`: `position: sticky`, `bottom`,
`z-index`, the `border-image` surface, `--workout-finish-surface/-inset/-pad/
-height`, the `.workout-focus-layer .workout-session` block, the
`scroll-margin-bottom` rules and the desktop/landscape `@media` override.
What is left:

```css
.workout-finish {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid hsl(var(--border));
}
```

`.workout-card-clip` (and `overflow: clip`) existed only so the Dashboard card
would not become the sticky scroll container; the card is back to
`overflow-hidden`, and the `workout-focus-layer` class, which only carried the
bar's safe-area variables, is gone from the Focus Mode overlay.

There is no spacer, reserve or negative margin left behind: the action area is
the session's last child and the session ends exactly where it ends (measured
gap 0 at every width, in both modes).

## Browser QA

Headless Chrome 153 over CDP against the local fixture (the real Dashboard,
production CSS, Montserrat, pinned date), Wednesday's 8 exercises / 26 sets
with 5 done and "Letztes Mal" history. 16 runs: 320×568, 375×812, 412×915 and
1280×800 × light/dark × Dashboard/Focus Mode. Identical results in all 16
unless noted.

| Check | Result |
| --- | --- |
| A. Completing a set | No toast at all — no Sonner or Radix toast immediately or 2.6 s later, and no `todayWorkout.` text anywhere on screen |
| B. The pause | One "Pause" dialog, `z-index: 100001`, timer at `00:45` (Plank's prescribed rest); the hit test at the bottom of the screen returns the sheet, and the finish action is inside an `aria-hidden` subtree. Dismissing it leaves the inline bar: "Pause Satz 1 00:45" |
| C/D. Accordion | Open sets, per run: `[0] → [1] → [] → [0]`. Never two |
| E. Subtitle | Brust, Trizeps · Beine, Gesäß · Brust, Schultern · Trizeps · Bauch. No run contains "Sätze" or "Pause" in a subtitle. One line each; header height unchanged at 96px (98/118px for the names that wrap) |
| F/G. Set rows | 18px semibold values, transparent background, `0/0/1px/0` dashed border while empty, `border-radius: 0`, no shadow, 56×44 and 68×44 fields, 44×44 completion toggle |
| H. Finish CTA | `position: static` in all 16 runs, exactly one control, the session's last child |
| I. Mid-workout | The button is off-screen (top 957–1119px) at every width in both modes. The bottom 8px and 40px of the viewport hit exercise content, never the action |
| J. End of the workout | Scrolled to, the hit test at the button's centre returns "Training beenden" in all 16 runs. Gap between the session's bottom and the action area: 0px |
| K. Layout | No horizontal overflow of the page or the overlay (`0/0`) at any width; rest, guidance and summary open above as before |

Screenshots: `ui06.local/shots/after-<theme>-<mode>-<width>.png` (local only).

## Tests

- `exerciseMuscleSummary.test.ts` (new): guidance derivation for all five
  reviewed exercises, the single-primary rule (Plank stays "Bauch"), alias
  resolution, coverage of every catalogue identity in at most two words, the
  map and the anatomy agreeing where both exist, no duplicate words, no entry
  outside the catalogue, and `undefined` for unknown or empty names.
- `ActiveWorkoutSession.test.tsx`: first exercise open and only that one;
  opening another closes the first; tapping the open one closes everything;
  never two open across repeated switching; an uncommitted draft and a recorded
  value both survive a switch with no commit; a running rest stays visible when
  its exercise is closed; guidance does not change what is open. Finish: the
  action reaches the end with nothing below it, plus the CSS contract — a plain
  block with no `position`, no `--workout-finish-*`, no `scroll-margin-bottom`,
  no safe-area, no media override, no `.workout-card-clip`, and exactly one
  `:focus-visible` rule, scoped to `.workout-session`.
- `ExerciseWithSets.test.tsx`: a controlled-expansion harness; the card draws
  the state it is given, reports open/close instead of deciding, stays closed
  when the session does not open it; the subtitle shows muscle groups for seven
  exercises, contains no sets or rest, is absent for an unknown exercise, and a
  completed unknown exercise still shows its check and "abgeschlossen"; the
  collapse trigger has no ring class and still takes focus.
- `ExerciseSetRow.test.tsx`: flat fields (transparent, no `border-input`, no
  ring or shadow, `rounded-none`, hairline only while empty), larger values,
  hints and rest text, 44px fields, and no ring on the "Übernehmen" face.
- `sessionBoundExecution.test.tsx`: completing a set through the real card
  starts exactly one pause with the prescribed length and raises no toast and
  no raw key; un-ticking raises none either and takes the rest away.
- `previousPerformance.test.tsx`: opening an exercise without history closes
  the one with it, and the reference comes straight back when it is reopened,
  with no extra read and no write.
- `TodayWorkoutCard.test.tsx` and `focusModeAccessibility.test.tsx`: one
  primary action at the end of the session, the card clipping ordinarily again,
  one action and unsaved drafts through Focus Mode transitions, and the rest
  sheet and summary still covering it.

UI-02, UI-03, UI-04, session-bound execution, actual performance, previous
performance and the completion summary suites run unchanged.

## Known limitations

- **No visible focus indicator in the running workout.** This is the requested
  product decision for a mobile-only audience, and it is a WCAG 2.4.7 (Focus
  Visible) regression for keyboard users on that screen. Everything else about
  keyboard operation is intact, and it is one CSS rule to restore.
- **Qualified variant names have no subtitle.** "Kreuzheben konventionell" and
  "Schrägbankdrücken mit Kurzhanteln" are not catalogue identities — the same
  exact-match rule that gives them a fallback thumbnail gives them no muscle
  line. That is the intended safe fallback; adding them would mean adding
  identities to the frozen thumbnail catalogue.
- **The Dashboard's floating navigation can cover the button.** Without the
  sticky bar, a user who stops scrolling with "Training beenden" in the last
  ~54px of the viewport finds the navigation over it; scrolling a little
  further clears it. Measured: naturally scrolled to, the hit test returns the
  button in all 16 runs; parked against the bottom edge on the Dashboard it
  returns the navigation. Focus Mode, which a started workout enters
  automatically, has no navigation and is unaffected.
- **The action is off-screen while training**, by design: it is reached by
  scrolling to the end of the workout (top 957–1119px at mid-workout).
- **Expansion resets on a Focus Mode transition.** Entering or leaving
  fullscreen remounts the card subtree, so the first exercise opens again. This
  is unchanged from `defaultExpanded={index === 0}`; drafts, recorded values and
  the rest timer still survive, as they are owned above the portal.
- **The subtitle is display text.** It is never written, compared or used to
  resolve an exercise, and a Firestore catalogue name outside the repository's
  list simply has no line.

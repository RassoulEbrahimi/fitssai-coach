# TRAINING-UI-05 — Finish action area

A presentation-only change to the "Training beenden" control at the end of the running workout. It is now a primary action in every state, and on phones it stays in reach while a long workout scrolls.

What finishing means is unchanged:
1. Pressing "Training beenden" commits dirty drafts. An invalid draft blocks it and focuses the field.
2. `WorkoutSummaryModal` opens. The session stays active and nothing is written.
3. Only "Training speichern & beenden" in the summary finishes the workout. Retry, offline and "Zurück zum Training" behave as before.

Unchanged:
- set rows (TRAINING-UI-02), the exercise header (TRAINING-UI-03), the session header (TRAINING-UI-04), thumbnails (TRAINING-UI-01B);
- `WorkoutSummaryModal`, `RestBottomSheet`, the guidance dialog and the Focus Mode portal;
- `progress` and how `isComplete` is calculated. `isComplete` only chooses whether a check icon is shown.

There are no new queries, writes, state, listeners or backend changes.

## Before

```
[ list … ]
┌────────────────────────────────────┐
│          Training beenden          │  48px, outline (white) until 100 %, then green with a check
└────────────────────────────────────┘
```

- **Styling:** `variant={isComplete ? "default" : "outline"}`. An unfinished workout (the normal case for someone stopping early) looked like a secondary control.
- **Placement:** only at the physical end of the list. At mid-scroll in the long QA workout (8 exercises, 26 sets) it was off-screen at every phone width, in both modes. At 375×812 its top was at 1023px in Focus Mode and 1077px on the Dashboard.
- **Short workout (3 exercises) at 375×812:** mid-scroll, the old button was visible in Focus Mode (748–796), but on the Dashboard it sat at 780–828, inside the 96px navigation reserve.
- **Dashboard card:** the card had `overflow-hidden`, which makes the card, not the page, the scroll container for anything sticky inside it.
- **Dashboard at 320×568:** positioned near the end of the list, the button could sit under the floating bottom navigation.

## After

`ActiveWorkoutSession` wraps the button in `.workout-finish`, its last child, after `.workout-session-list`. `workoutPresentation.css` positions it.

```
Phones and tablets, mid-scroll                 End of the list
│ … exercise cards scroll underneath …   │     │ … last set, "Letztes Mal", toggle │
├────────────────────────────────────────┤     ├────────────────────────────────────┤  1px rule
│ [          Training beenden          ] │     │ [        Training beenden        ] │  52px
└────────────────────────────────────────┘     └────────────────────────────────────┘
  Focus Mode: bar at the overlay bottom,         the bar rests in its own place and
  padded for the home indicator                  covers nothing
  Dashboard: button above the navigation,
  the bar surface under the navigation
```

### The button
- **Style:** always `Button` default: the primary token with `primary-foreground` text. It is never outline, destructive, disabled-looking or red, and has no warning icon.
- **Size:** `h-[3.25rem]` (52px), full column width, 16px semibold, the system `rounded-md`.
- **Label and name:** the label is the unchanged `todayWorkout.finishTraining` ("Training beenden"), which is also the accessible name. There is no aria-label.
- **Complete workout:** adds an `aria-hidden` Lucide `Check` before the label. Name, classes and behaviour stay the same.
- **Order:** the button is still the last tab stop of the session, after every set.

### The bar (`.workout-finish`)
- **Sticky:** `position: sticky; bottom: 0; z-index: 1`. This is plain CSS, with no portal, fixed layer, scroll listener or `IntersectionObserver`, and there is exactly one control.
- **Surface:**
  - Solid and matching its surroundings: `--card` inside the Dashboard card, `--background` in Focus Mode.
  - A 1px `--border` rule on top.
  - Both are painted by a hard-stop `border-image` whose outset reaches the card or overlay edge past the content gutters. That is painted overflow only: it does not widen the layout, and the card or overlay clips it.
  - No shadow, blur, visible gradient or pill.
- **Spacing:** `margin-top: 1rem` above the rule, then 12px, the button, and the bottom padding.
- **Dashboard:**
  - The page scrolls, and the navigation floats at the bottom. `--workout-finish-inset` is `var(--bottom-nav-offset) + env(safe-area-inset-bottom)`, the same reserve DashboardPage keeps at the end of the page.
  - The bar's bottom padding includes that reserve, so the navigation sits on the bar's surface instead of a sliver of exercise content, and taps beside the navigation land on the inert bar.
  - An equal negative `margin-bottom` takes the reserve back out of the layout. In flow the bar is 76px, and the card clips the rest.
- **Focus Mode (`.workout-focus-layer`, set on the overlay):**
  - The overlay scrolls and has no navigation, so the inset is 0.
  - Bottom padding is `max(0.75rem, env(safe-area-inset-bottom))`. Nothing is hard-coded.
- **Card clip:** `TodayWorkoutCard`'s Dashboard card uses `.workout-card-clip`, which is `overflow: hidden; overflow: clip`.
  - `clip` still clips the hero and the rounded corners, but it is not a scroll container, so the bar sticks to the page.
  - Browsers without `clip` keep `hidden`. There the bar stays at the end of the list, as before.
- **Focused controls:** buttons and inputs in `.workout-session-list` get `scroll-margin-bottom` = inset + bar height + 8px. Tab, and the invalid-draft `focus()`, therefore scroll a field clear of the bar instead of leaving it underneath.
- **Desktop and landscape:** at `min-width: 64rem`, or `max-height: 29.99rem` (landscape phones, where bar plus navigation would cover about half the screen), the bar is `position: static`: a plain 1px rule, 12px, the button and 12px at the end of the list.

### Stacking
The bar is one page layer (`z-index: 1`) inside the Dashboard's stacking context or the isolated Focus overlay. These still open above it: RestBottomSheet (100000/100001), exercise guidance (100000/100001) and the summary (99999/100000, portalled after the overlay). Radix modals hide the bar from assistive technology and block pointer input, as before.

## Measurements

Headless Chrome 152 over CDP, with the local fixture (real Dashboard, production CSS, Montserrat) and a pinned date:
- **Long workout:** Wednesday, 8 exercises and 26 sets, with "Letztes Mal" history on the first and last exercise.
- **Short workout:** `?short=1`, 3 exercises.
- **Coverage:** before (`main`) and after on the same tree, in light and dark, in Dashboard and Focus Mode.

| Viewport | Mode | Before, mid-scroll | After, mid-scroll |
| --- | --- | --- | --- |
| 320×568 | Focus | off-screen (top 955) | bar 492–568, button 504–556 |
| 375×812 | Focus | off-screen (top 1023) | bar 736–812, button 748–800 |
| 412×915 | Focus | off-screen (top 1074) | bar 839–915, button 851–903 |
| 320×568 | Dashboard | off-screen (top 1087) | button 408–460, navigation below |
| 375×812 | Dashboard | off-screen (top 1077) | button 652–704 (812 − 96 − 64) |
| 412×915 | Dashboard | off-screen (top 1106) | button 755–807 |
| 1280×800 | both | end of list | end of list, static, 77px area |
| 812×375 | both | end of list | end of list, static |

**In every run:**
- exactly one control;
- label fits (238px button on the Dashboard at 320);
- no horizontal overflow of the page or the overlay;
- the hit test at the button centre returns the button;
- the button is the last tab stop.

**End of the list, last exercise expanded:** the last card, last set row, its input and toggle, and the "Letztes Mal: 30 Wdh." line all end above the bar and hit-test as themselves at 320, 375, 412 and 1280, in both modes. Active inline rest (56px) and the last row are also clear.

**Safe area** (CDP `setSafeAreaInsetsOverride`, 34px bottom):
- Focus Mode padding becomes 34px: at 375 the bar is 714–812 and the button 726–778.
- Dashboard padding becomes 142px (12 + 96 + 34): at 375 the button is 618–670.

**Focus scrolling:** at 320, 375 and 412, in both modes, a reps input placed under the bar (hit test: the bar) scrolls 84px clear, both on programmatic `focus()` and on a real Tab key.

**Keyboard:** a real Tab from the last completion toggle lands on the button with no scroll jump. `:focus-visible` draws the 2px ring plus the global outline inside the bar's 12px padding, unclipped at 320px in dark mode.

**Overlays:**
- With the rest sheet (opened by completing a set), guidance or summary open, the hit test at the button centre returns the overlay.
- With the summary open, `body` has `pointer-events: none` and the bar is inside an `aria-hidden` subtree.

**Colours:**
- The button is `rgb(22, 162, 73)` with `rgb(250, 250, 250)` text in both themes, at 0 %, 19 % and 100 % complete.
- Before, it was white (light) or `rgb(9, 9, 11)` (dark) with a border until 100 %.

## Tests

`ActiveWorkoutSession.test.tsx`:
- With 0, 5 and 26 of 26 sets done:
  - exactly one enabled "Training beenden";
  - no `aria-disabled` and no aria-label;
  - primary classes at 52px.
- With sets still open: no outline, secondary, disabled-looking or destructive classes, and no icon.
- Complete: only an `aria-hidden` check, with the same name and classes.
- One press calls `onFinish` once and nothing else; the workout is still running.
- The bar is the session's last child after the list, holds only the button, and the button is the last control.
- No `fixed` or `z-*` classes.
- CSS contract, since jsdom does not lay out sticky:
  - sticky with `bottom: 0` and `z-index: 1`;
  - no shadow or blur, and no `position: fixed` in the file;
  - navigation and safe-area insets for each mode, with the reserve padding and matching negative margin;
  - focus `scroll-margin`;
  - the static desktop/landscape override;
  - `.workout-card-clip`;
  - the Focus overlay class.

`TodayWorkoutCard.test.tsx`: on the Dashboard, one enabled primary action at 0 % progress, inside `.workout-card-clip`, with no `overflow-hidden` ancestor and no dialog open.

`focusModeAccessibility.test.tsx` (real Dashboard and Focus Mode):
- **Moving between modes:** exactly one action after start (inside the Focus dialog), after leaving and after re-entering. An uncommitted reps draft survives both transitions, with no write.
- **Rest sheet open:** the action leaves the accessibility tree, `userEvent` cannot click it (pointer-events), and no summary opens.
- **Summary open:** the same, plus one summary, no write, the session unchanged, and Focus Mode still open underneath.

`sessionBoundExecution.test.tsx`: the `running()` helper now finds the session through `.workout-finish` instead of the button's direct parent.

Dirty drafts, invalid-draft blocking, failed finish and retry, offline finish, session binding, actual and previous performance, completion summary, and the UI-02, UI-03 and UI-04 suites all run unchanged and pass.

## Known limitations
- **Dashboard at 320×568, scroll position 0:** the session starts just above the fold, so the bar, which cannot rise above its own session, overlaps the lower half of the session status line. The first few pixels of scrolling clear it.
- **Focus Mode, end of scroll:** the bar settles 24px higher (the card content's bottom padding sits below it).
- **Toast overlap:** the "set completed" toast (Sonner, bottom of the screen) briefly overlaps the bottom area, as it overlapped content there before. Its German text is missing: the toast shows the raw key `todayWorkout.setCompleted`. That is a pre-existing issue, flagged separately.
- **Safe area on iOS:** production `index.html` has no `viewport-fit=cover`, so iOS reports zero safe-area insets and keeps content out of the unsafe area itself. The bar then uses its 12px minimum; the inset path was verified with a CDP override. The Focus card's `pb-safe` class has no definition (pre-existing, untouched).
- **Browsers without `overflow: clip`** (Safari before 16): the Dashboard action stays at the end of the list. Focus Mode is unaffected.
- **Viewport coverage while stuck:** the bar covers the bottom 76px of the viewport in Focus Mode (98px with a 34px inset), and 172px including the navigation reserve on the Dashboard. Content scrolls underneath, and focused controls scroll clear.

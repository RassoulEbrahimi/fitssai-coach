# TRAINING-UI-03 — Exercise card header and collapsed state

A presentation-only change to the header of the running-workout exercise card. It supersedes the "Header" section of `TRAINING-UI-01-active-workout-presentation.md`.

Unchanged:
- the set rows (TRAINING-UI-02);
- thumbnails and their assets (TRAINING-UI-01B);
- execution identity, and completion, actual and previous persistence;
- rest timer behaviour, guidance, Focus Mode and the completion summary.

There are no new queries, writes, Firestore fields or backend changes.

## Header anatomy

`ExerciseWithSets` renders the markup and `workoutPresentation.css` lays it out. The structure is the same at every card width, in the Dashboard and in Focus Mode; only the available width changes.

```
┌─────────────────────────────────────────┐
│ [thumbnail] Exercise name           [ⓘ] │
│             3/4 Sätze · 90 s Pause      │
│             ────────                [⌄] │
└─────────────────────────────────────────┘
```

**Before (TRAINING-UI-01), on phones:**

```
[thumbnail] [name, up to 2 lines]
[sets  rest + progress] [⌄] [ⓘ]
```

The actions had a structural row of their own, which put a collapsed card at 150–154px.

**Grid:**
- Columns are `72px | minmax(0, 1fr) | 20px`, with a 12px gap and a single row.
- The name block is centred against the thumbnail. A taller block keeps the thumbnail at the top.

**Name block (`.workout-exercise-identity`):**
- **Name:** an `h3`, 16px (18px from `sm`), semibold, `leading-snug`.
  - It clamps at two lines, or three in cards under 300px.
  - It never truncates to one line, and the type never shrinks.
- **Meta:** "`done/total` Sätze" and the rest from `formatRestDisplay(rest, { withLabel: true })`, e.g. "3/4 Sätze · 90 s Pause".
- **Progress:** a 4px bar with `completedCount / totalSets`, computed as before.
- A two-line name plus meta and progress comes to exactly 72px, so the thumbnail sets the header height.
- The block is capped at 28rem, so desktop cards do not stretch the progress line.

**Actions (`.workout-exercise-actions`):** one column holding Info, then collapse.
- Both are real 44×44 buttons, siblings, neither nested in the other.
- The 88px stack takes a 72×20px track through −8px vertical and −12px horizontal margins.
- The boxes reach into the card padding and the column gap, where each button's own 12px inset already spaces the icon. The icons line up with the card padding.
- Stacking the actions, rather than placing them side by side, keeps a meaningful width for the name.

**Collapsed and expanded:**
- The header markup and geometry are identical in both states. Only the trigger's `aria-expanded` / `data-state` and the chevron differ.
- The chevron now turns 180° when open. Before, the `collapsible-chevron` class had no CSS rule, so the two states looked the same.
- The rotation animates only under `prefers-reduced-motion: no-preference`.
- `Collapsible` itself is unchanged. A collapsed card renders no set rows, and Radix's content element is empty and `hidden`.

**Cards under 260px (the Dashboard at 320px, a 238px card):**
- A 72px thumbnail beside the action column would leave the name 96px; measured with Montserrat, long names took four or five lines.
- The tile is 56×56 there, which gives the name 112px and at most three lines.
- This comes only from header CSS; `ExerciseThumbnail` and its assets are untouched.
- The meta wraps to two lines at this width.

## Meta separator

- Each fact (sets, rest) is its own flex item with a leading `·` from CSS.
- The line starts one dot-width to the left of a clipped box, so a fact that wraps to a new line hides its dot instead of starting with it.
- The dot uses `content: "·" / ""`, so it is not spoken. Screen readers get a visually hidden comma instead: "3/4 Sätze, 90 s Pause".
- Without a prescribed rest, only the sets are shown.

## Completed exercise

Completed exercises keep the TRAINING-UI-01 treatment:
- the tinted card and border;
- a check icon before "3/3 Sätze";
- a screen-reader "abgeschlossen";
- the collapse name "Bankdrücken 3/3 Sätze".

The card also carries `data-complete`. There is no exercise-level completion action.

## Accessibility

- **Tab order:** Info → collapse → inline rest bar → set rows. It follows the visual order, and collapse comes right before the sets it controls.
  - This is a change: collapse used to come first.
- **Names:** Info is "Informationen zu <Übung>", and collapse is "<Übung> <done>/<total> Sätze".
- **Focus rings:**
  - The action boxes reach the card's `overflow: hidden` edge, where an outer ring was clipped (measured).
  - Both buttons now draw their 2px ring inset, with no offset, inside the 44px box.
  - This also removes the white offset band the collapse ring showed on dark cards.
- **Progress bar:** now `aria-hidden`, because the "n/total Sätze" text beside it is the stated progress.
  - The shared shadcn `Progress` wrapper does not pass `value` to Radix, so the bar was announced as an indeterminate progress bar with no value.
  - Fixing the wrapper is left to a separate task.
- **Rest timer:** the inline rest bar stays below the header, outside it, in both collapse states. Info is still disabled while the rest sheet is open.

## Measurements

**Setup:**
- a local fixture with production CSS and Montserrat;
- headless Chrome with device-metrics emulation;
- the same script on `main` (`bbf48dd`) and on this branch.

**Cards measured:**
- short: Kniebeugen;
- long: Kreuzheben konventionell, Schrägbankdrücken mit Kurzhanteln, Bankdrücken schräg Multipresse, Trizepsstrecken Kabelzug Kordel, Beinpresse 45° Plate Loaded;
- Plank.

**Collapsed cards, `main` → branch:**

| Context | Card | Name width | Short name | Long names | Longest name |
| --- | --- | --- | --- | --- | --- |
| Focus Mode 320px | 288px | 178 → 146px | 150 → 98px | 150 → 98–120px | 2 → 3 lines |
| Focus Mode 375px | 343px | 233 → 201px | 150 → 98px | 150 → 98px | 2 → 2 lines |
| Focus Mode 412px | 380px | 270 → 238px | 150 → 98px | 150 → 98px | 2 → 2 lines |
| Dashboard 320px | 238px | 128 → 112px (56px tile) | 154 → 98px | 154 → 140px | 3 → 3 lines |
| Dashboard 375px | 293px | 183 → 151px | 150 → 98px | 150 → 98–120px | 2 → 3 lines |
| Dashboard 412px | 330px | 220 → 188px | 150 → 98px | 150 → 98px | 2 → 2 lines |
| Desktop 1280px, both modes | 768px | 550 → 448px (capped) | 106 → 106px | 106 → 106px | 1 → 1 line |

**Seven collapsed cards stacked (Kniebeugen to Plank, gaps included):**

| Context | Height |
| --- | --- |
| Focus Mode 375/412px, Dashboard 412px | 1122 → 758px |
| Focus Mode 320px, Dashboard 375px | 1122 → 802px |
| Dashboard 320px | 1150 → 968px |
| Desktop | 814px, unchanged |

**Other states:**

| State | Focus Mode 375px | Dashboard 320px |
| --- | --- | --- |
| Completed, collapsed | 150 → 98px | 154 → 98px |
| Collapsed, rest timer running (long name) | 218 → 166px | 222 → 208px |
| Expanded, 3 sets | 313 → 261px | 377 → 363px |
| Expanded, 4 sets with "Letztes Mal" | 504 → 452px | 648 → 592px |

**Headers:**
- In every context, an expanded header has the same height, name, meta and action positions as when collapsed.
- The set rows and the inline rest bar follow directly below it.

**Checked at 320, 375, 412 and 1280px, in light and dark, in both modes:**
- no horizontal overflow on the page or the Focus Mode overlay;
- no overlap between the name or meta and either action;
- the progress bar stays inside the card;
- both actions are 44×44 and inside the card;
- `elementFromPoint` hits each action at its centre and 18px towards every edge;
- no name is clamped.

**Functional (trusted CDP key and mouse events, Focus Mode 320px and Dashboard 320px):**
- Tapping Info on a collapsed card opens that exercise's guidance and leaves the card collapsed. Escape returns focus to Info.
- Tab from Info reaches collapse, and Enter expands. Tab then reaches the first reps field, Shift+Tab returns, and Space collapses.
- Taps 18px off the chevron's centre still toggle it and open no dialog.

## Known limitations

- **Hyphenation:** `hyphens: auto` needs the browser's German dictionary. Headless Chrome has none, so the screenshots break "Trizepsstrecken" and "Schrägbankdrücken" mid-word without a hyphen, as `main` does.
- **Dashboard at 320px:**
  - The thumbnail is 56px.
  - Long names take three lines and the meta two, so those cards stay at 140px (154px before).
  - Short names are 98px.
- **Dashboard 375px and Focus Mode 320px:** names are 146–151px wide, so "Schrägbankdrücken mit Kurzhanteln" and "Bankdrücken schräg Multipresse" take three lines (a 120px card).
- **Very long names:** names beyond the clamp still end in an ellipsis. The full name stays in the heading text, in both button names and in the guidance dialog title.
- **Thumbnail artwork:** the art is still the TRAINING-UI-01B placeholder pack.

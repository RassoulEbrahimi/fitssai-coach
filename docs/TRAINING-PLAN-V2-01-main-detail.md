# TRAINING-PLAN-V2-01 — Trainingsplan main, Day Detail & Plan Overview

Presentation and navigation only. No Firestore schema, rules, Functions,
session identity, set completion, performance logging, rest timer or finish
persistence changed.

## Architecture

- `TodayWorkoutCard` stays the single execution host: start, resume, Focus
  Mode, the active workout, finish and the rest timer. A new optional
  `renderOverview` prop replaces only its idle hero outside Focus Mode;
  without the prop the card renders exactly as before.
- `WorkoutView` always gives the card **today's** plan day. Browsing (Day
  Detail, Plan Overview, next week) never reaches the card, so it cannot
  rebind a session. A bound session still wins over everything, as before.
- The card stays mounted at one tree position on every V2 screen, so resume,
  drafts and the rest timer survive navigation.
- Start/resume from Day Detail go through the card's own `start`/`resume`
  (`controlsRef`). `start` resumes instead when a session already runs.
- `src/lib/trainingsplanModel.ts` decides every screen state as pure data
  (Today state, agenda rows, rest merging, next-week teaser, Day Detail
  action, Plan Overview).

## Navigation

Main is the root; Day Detail, Plan Overview and the edit surface are pushed
on top and popped in reverse (`useTrainingsplanNavigation`):

- Main → Day Detail → Zurück = Main
- Main → Plan Overview → Zurück = Main
- Plan Overview → Day Detail → Zurück = Plan Overview
- Day Detail → Bearbeiten → Fertig = that Day Detail

Each push adds one browser-history entry at the current URL carrying the
whole stack (`src/lib/trainingsplanNavigation.ts`), so browser / Android
Back and Forward follow the same hierarchy, and a remount or reload on an
entry restores its screen. The entries never change the hash, and the app's
tab router only reacts to hash changes, so routing outside the tab is
untouched. Popping restores the previous screen's scroll position and moves
focus back to the control that opened the screen above it. Navigation never
reaches the running workout.

## Screens

| Design | Component |
| --- | --- |
| 01–04 Main (Geplant / Läuft / Erledigt / Ruhetag) | `TrainingsplanHeader`, `TodayModule`, `WeekAgenda`, `NextWeekTeaser`, `CurrentPlanRow` |
| 05 Tagesdetail | `DayDetail` |
| 06 Bearbeiten | `DayEditSurface` (compatibility surface, not the final edit mode) |
| 07 Planübersicht | `PlanOverview` |

## Deliberate deviations from the design

- **No duration estimates** ("~70 Min"). The plan stores none, and a
  per-exercise minute constant is exactly what the "no fabricated workout
  duration" guard forbids. Only a measured duration from the day session
  record is shown (Erledigt).
- **Names.** Plans carry no plan name and generated days are labelled with
  the weekday. The plan is "4-Wochen-Plan"; a day uses its own label when it
  names the workout, otherwise its muscle focus from the exercise catalogue,
  otherwise "Training".
- **No "Zusammenfassung ansehen"**: no history/summary reopening exists yet.
- **Future days**: browse only, no "move to today". **Past days**: browse only.
- **Plan Overview**: no goal/level/deload and no plan actions — none exist.
- **Edit mode**: existing inline editor, delete with undo, add and autofill
  dialog, unchanged persistence (per plan day). Reorder, swap sheet, scope
  rules and proposals are TRAINING-PLAN-V2-02.
- Rest days can no longer receive an exercise from the tab (rest rows are
  not interactive by design).

Legacy `WeekNavigation`, `WeekProgress` and `DayAccordion` are no longer
rendered by the tab but are kept, with their tests, for a later removal.

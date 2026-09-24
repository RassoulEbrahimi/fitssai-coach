import { describe, expect, it } from "vitest";
import {
  buildPlanOverview,
  buildWeekAgenda,
  dayMuscleLine,
  findCurrentExercise,
  findNextWeekWorkout,
  formatDaySummaryLine,
  formatPrescription,
  getPlanCalendar,
  readWorkoutLabel,
  resolveDayDetailAction,
  resolvePlanPosition,
  resolveTodayState,
  summarizeWorkoutDay,
  type AgendaRow,
  type PlanCalendar,
  type TrainingsplanInputs,
} from "./trainingsplanModel";
import type { DayContent } from "./types";

/*
  TRAINING-PLAN-V2-01: the Trainingsplan screens as data. A plan created on
  Tuesday 2026-09-08 starts on Monday 2026-09-07; 2026-09-23 (Wednesday) is
  Week 3, day 2 - the canonical "Mi 23" of the design.
*/
const ex = (name: string, sets: number, reps: string, rest?: string) => ({ name, sets, reps, rest });
const PULL = [ex("Kreuzheben", 3, "5", "150s"), ex("Klimmzüge", 3, "max", "120s")];
const PUSH = [ex("Bankdrücken", 3, "8", "90s"), ex("Seitheben", 3, "12", "60s"), ex("Trizepsdrücken", 2, "10")];
const LEGS = [ex("Kniebeugen", 4, "6", "150s")];
const WEEK: DayContent[] = [
  { day: "Pull A", exercises: PULL },
  { day: "Dienstag", exercises: [] },
  { day: "Push A", exercises: PUSH },
  { day: "Donnerstag", exercises: [] },
  { day: "Freitag", exercises: LEGS },
  { day: "Samstag", exercises: [] },
  { day: "Sonntag", exercises: [] },
];
const CONTENT: Record<string, DayContent[]> = { "Week 1": WEEK, "Week 2": WEEK, "Week 3": WEEK, "Week 4": WEEK };
const calendar = getPlanCalendar("2026-09-08T08:00:00Z") as PlanCalendar;

const inputs = (overrides: Partial<TrainingsplanInputs> = {}, completed: string[] = []): TrainingsplanInputs => ({
  calendar,
  readWeek: (weekKey) => CONTENT[weekKey] ?? [],
  today: "2026-09-23",
  isDayCompleted: (weekKey, dayIndex) => completed.includes(`${weekKey}|${dayIndex}`),
  session: null,
  ...overrides,
});
const WEDNESDAY = { weekKey: "Week 3", dayIndex: 2, workoutDay: "2026-09-23" };
const MONDAY = { weekKey: "Week 3", dayIndex: 0, workoutDay: "2026-09-21" };
const FRIDAY = { weekKey: "Week 3", dayIndex: 4, workoutDay: "2026-09-25" };

describe("plan positions", () => {
  it("anchors the plan to its first Monday and ends after four weeks", () => {
    expect(calendar.startDay).toBe("2026-09-07");
    expect(resolvePlanPosition(calendar, "2026-09-23")).toEqual({ status: "active", weekKey: "Week 3", weekNumber: 3, dayIndex: 2 });
    expect(resolvePlanPosition(calendar, "2026-09-06")).toEqual({ status: "before-start" });
    expect(resolvePlanPosition(calendar, "2026-10-05")).toEqual({ status: "finished" });
  });
});

describe("the Today state model", () => {
  it("is planned when today has a workout that is not done", () => {
    const state = resolveTodayState(inputs(), false);
    expect(state).toMatchObject({ kind: "planned", workout: { ...WEDNESDAY, summary: { title: "Push A", exerciseCount: 3, setCount: 8 } } });
  });

  it("is active whenever a session runs, ahead of planned and completed", () => {
    const session = { ...WEDNESDAY };
    expect(resolveTodayState(inputs({ session }), true)).toEqual({ kind: "active", sessionDay: "2026-09-23", isSessionToday: true });
    expect(resolveTodayState(inputs({ session }, ["Week 3|2"]), true).kind).toBe("active");
  });

  it("names another day's running session instead of falling back to today", () => {
    expect(resolveTodayState(inputs({ session: { ...MONDAY } }), true))
      .toEqual({ kind: "active", sessionDay: "2026-09-21", isSessionToday: false });
  });

  it("is completed once today's day session record says so, pointing at the next workout", () => {
    const state = resolveTodayState(inputs({}, ["Week 3|2"]), false);
    expect(state).toMatchObject({ kind: "completed", workout: WEDNESDAY, next: { ...FRIDAY, summary: { title: "Beine · Gesäß", titleSource: "muscles" } } });
  });

  it("is a rest day when today has no exercises, with tomorrow's workout next", () => {
    const state = resolveTodayState(inputs({ today: "2026-09-24" }), false);
    expect(state).toMatchObject({ kind: "rest", next: FRIDAY });
  });

  it("reports a finished programme rather than serving Week 1 again", () => {
    expect(resolveTodayState(inputs({ today: "2026-10-06" }), false)).toEqual({ kind: "plan-finished" });
  });
});

describe("the weekly agenda", () => {
  const byDay = (rows: AgendaRow[]) => Object.fromEntries(rows.map((row) => [row.key, row]));

  it("shows one row per day with completed, today, upcoming and rest states", () => {
    const agenda = buildWeekAgenda(inputs({}, ["Week 3|0"]));
    expect(agenda).toMatchObject({ weekNumber: 3, completedDays: 1, trainingDays: 3 });
    const rows = byDay(agenda.rows);
    expect(rows["2026-09-21"]).toMatchObject({ kind: "workout", status: "completed", isToday: false });
    expect(rows["2026-09-22"]).toMatchObject({ kind: "rest", from: "2026-09-22", to: "2026-09-22" });
    expect(rows["2026-09-23"]).toMatchObject({ kind: "workout", status: "today", isToday: true });
    expect(rows["2026-09-24"]).toMatchObject({ kind: "rest", isToday: false });
    expect(rows["2026-09-25"]).toMatchObject({ kind: "workout", status: "upcoming", summary: { exerciseCount: 1 } });
    // Saturday and Sunday are after today: one merged row.
    expect(rows["2026-09-26"]).toMatchObject({ kind: "rest", from: "2026-09-26", to: "2026-09-27" });
    expect(agenda.rows).toHaveLength(6);
  });

  it("keeps rest days up to today single and merges only those after it", () => {
    const agenda = buildWeekAgenda(inputs({ today: "2026-09-27" }));
    expect(agenda.rows.filter((row) => row.kind === "rest").map((row) => row.key))
      .toEqual(["2026-09-22", "2026-09-24", "2026-09-26", "2026-09-27"]);
    expect(agenda.rows.find((row) => row.key === "2026-09-27")).toMatchObject({ kind: "rest", isToday: true });
  });

  it("marks the running session's day as active and a missed past day as open", () => {
    const agenda = buildWeekAgenda(inputs({ today: "2026-09-25", session: { ...WEDNESDAY } }));
    const rows = byDay(agenda.rows);
    expect(rows["2026-09-23"]).toMatchObject({ status: "active" });
    expect(rows["2026-09-21"]).toMatchObject({ status: "open" });
    expect(rows["2026-09-25"]).toMatchObject({ status: "today" });
  });

  it("never makes a rest day a workout row", () => {
    const agenda = buildWeekAgenda(inputs());
    agenda.rows.filter((row) => row.kind === "workout").forEach((row) => {
      expect(row.kind === "workout" && row.summary.exerciseCount).toBeGreaterThan(0);
    });
  });
});

describe("the next week teaser", () => {
  it("is the first workout of next calendar week", () => {
    expect(findNextWeekWorkout(inputs())).toMatchObject({ weekKey: "Week 4", dayIndex: 0, workoutDay: "2026-09-28", summary: { title: "Pull A" } });
  });

  it("is absent in the programme's last week", () => {
    expect(findNextWeekWorkout(inputs({ today: "2026-09-30" }))).toBeNull();
  });
});

describe("Day Detail's one action", () => {
  it("starts only today's planned workout while nothing runs", () => {
    expect(resolveDayDetailAction(inputs(), WEDNESDAY, false)).toEqual({ kind: "start" });
  });

  it("resumes the running workout from its own day and blocks every other", () => {
    const running = inputs({ session: { ...WEDNESDAY } });
    expect(resolveDayDetailAction(running, WEDNESDAY, true)).toEqual({ kind: "resume" });
    expect(resolveDayDetailAction(running, FRIDAY, true)).toEqual({ kind: "blocked" });
    expect(resolveDayDetailAction(running, MONDAY, true)).toEqual({ kind: "blocked" });
  });

  it("never restarts a completed day, moves a future one or starts a past one", () => {
    expect(resolveDayDetailAction(inputs({}, ["Week 3|2"]), WEDNESDAY, false)).toEqual({ kind: "completed" });
    expect(resolveDayDetailAction(inputs(), FRIDAY, false)).toEqual({ kind: "future" });
    expect(resolveDayDetailAction(inputs(), MONDAY, false)).toEqual({ kind: "past" });
  });

  it("offers nothing on a rest day", () => {
    expect(resolveDayDetailAction(inputs(), { weekKey: "Week 3", dayIndex: 1, workoutDay: "2026-09-22" }, false))
      .toEqual({ kind: "none" });
  });
});

describe("Plan Overview", () => {
  it("describes the current week's structure and the programme's run", () => {
    const overview = buildPlanOverview(inputs());
    expect(overview).toMatchObject({
      totalWeeks: 4,
      weekNumber: 3,
      status: "active",
      startDay: "2026-09-07",
      endDay: "2026-10-04",
      trainingDaysPerWeek: 3,
      restDays: ["2026-09-22", "2026-09-24", "2026-09-26", "2026-09-27"],
    });
    expect(overview.workoutDays.map((day) => [day.workoutDay, day.summary.title, day.summary.exerciseCount]))
      .toEqual([["2026-09-21", "Pull A", 2], ["2026-09-23", "Push A", 3], ["2026-09-25", "Beine · Gesäß", 1]]);
  });

  it("describes the last week once the programme is finished", () => {
    expect(buildPlanOverview(inputs({ today: "2026-10-20" }))).toMatchObject({ status: "finished", weekNumber: 4 });
  });
});

describe("day summaries", () => {
  it("uses the plan's own label, but never a bare weekday", () => {
    expect(readWorkoutLabel("Push A")).toBe("Push A");
    expect(readWorkoutLabel("Montag")).toBeNull();
    expect(readWorkoutLabel("Mo.")).toBeNull();
    expect(readWorkoutLabel("Tag 3")).toBeNull();
    expect(readWorkoutLabel("Montag – Oberkörper")).toBe("Oberkörper");
    expect(readWorkoutLabel("")).toBeNull();
  });

  it("falls back to the catalogue's muscle focus, then to a plain title", () => {
    const known = summarizeWorkoutDay({ day: "Montag", exercises: [ex("Bankdrücken", 3, "8"), ex("Dips", 3, "10")] });
    expect(known.titleSource).toBe("muscles");
    expect(known.title.split(" · ")[0]).toBe("Brust");
    const unknown = summarizeWorkoutDay({ day: "Montag", exercises: [ex("Geheimübung", 3, "8")] });
    expect(unknown).toMatchObject({ title: "Training", titleSource: "fallback", muscles: [] });
  });

  it("counts exercises and sets, and invents no duration", () => {
    const summary = summarizeWorkoutDay({ day: "Push A", exercises: PUSH });
    expect(summary).toMatchObject({ exerciseCount: 3, setCount: 8 });
    expect(formatDaySummaryLine(summary)).toBe("3 Übungen · 8 Sätze");
    expect(formatDaySummaryLine(summarizeWorkoutDay({ day: "Tag", exercises: [ex("Plank", 1, "60s")] }))).toBe("1 Übung · 1 Satz");
  });

  it("adds a muscle line only when it says more than the title", () => {
    const labelled = summarizeWorkoutDay({ day: "Push A", exercises: PUSH });
    expect(dayMuscleLine(labelled)?.split(" · ")).toEqual(expect.arrayContaining(["Brust", "Trizeps", "Schultern"]));
    const derived = summarizeWorkoutDay({ day: "Montag", exercises: [ex("Bizepscurls", 3, "10")] });
    expect(dayMuscleLine(derived)).toBeNull();
  });

  it("formats the prescription as sets × reps and the rest the plan states", () => {
    expect(formatPrescription(ex("Kreuzheben", 3, "5", "150s"))).toBe("3×5 · 150s");
    expect(formatPrescription(ex("Klimmzüge", 3, "max", "2 min"))).toBe("3×max · 2min");
    expect(formatPrescription(ex("Trizepsdrücken", 2, "10"))).toBe("2×10");
  });

  it("finds the exercise a running session is on", () => {
    const done = [3, 1, 0];
    expect(findCurrentExercise(PUSH, (index) => done[index])).toEqual({ index: 1, name: "Seitheben" });
    expect(findCurrentExercise(PUSH, (index) => [3, 3, 2][index])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import {
  buildWeeklyFacts,
  compareExercise,
  compareSessions,
  computeDurationCoverage,
  computeExerciseFacts,
  computeHistoryCoverage,
  computePreferenceAlignment,
  computeWeeklyAdherence,
  exerciseKey,
  type CompletionInput,
  type PlanDayInput,
} from "./facts";

/** Mon–Sun: three training days, four rest days. */
const THREE_DAY_WEEK: readonly PlanDayInput[] = Object.freeze([
  { dayIndex: 0, exerciseCount: 4 },
  { dayIndex: 1, exerciseCount: 0 },
  { dayIndex: 2, exerciseCount: 5 },
  { dayIndex: 3, exerciseCount: 0 },
  { dayIndex: 4, exerciseCount: 4 },
  { dayIndex: 5, exerciseCount: 0 },
  { dayIndex: 6, exerciseCount: 0 },
]);

const done = (dayIndex: number, weekKey = "Week 2"): CompletionInput => ({
  weekKey,
  dayIndex,
  completed: true,
});

describe("computeWeeklyAdherence", () => {
  it("counts only non-rest days as scheduled", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, []);

    // Not 7 — the plan decides how many training days a week has.
    expect(facts.scheduledDays).toBe(3);
    expect(facts.days.filter((day) => day.isRestDay)).toHaveLength(4);
  });

  it("reports 0% when nothing was completed", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, []);

    expect(facts.completedDays).toBe(0);
    expect(facts.missedDays).toBe(3);
    expect(facts.adherencePercent).toBe(0);
  });

  it("reports a partial week", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [done(0), done(2)]);

    expect(facts.completedDays).toBe(2);
    expect(facts.missedDays).toBe(1);
    expect(facts.adherencePercent).toBe(67);
  });

  it("reports 100% when every training day is done", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [done(0), done(2), done(4)]);

    expect(facts.adherencePercent).toBe(100);
    expect(facts.missedDays).toBe(0);
  });

  it("ignores completions from another week", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [done(0, "Week 1"), done(2)]);

    expect(facts.completedDays).toBe(1);
  });

  it("never credits a rest day", () => {
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [done(1), done(3)]);

    expect(facts.completedDays).toBe(0);
    expect(facts.adherencePercent).toBe(0);
  });

  it("returns null rather than 0% when nothing is scheduled", () => {
    // A rest week is not a 0% week.
    const allRest = THREE_DAY_WEEK.map((day) => ({ ...day, exerciseCount: 0 }));
    const facts = computeWeeklyAdherence("Week 2", allRest, []);

    expect(facts.scheduledDays).toBe(0);
    expect(facts.adherencePercent).toBeNull();
  });

  it("does not mutate its inputs", () => {
    const before = JSON.stringify(THREE_DAY_WEEK);
    computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [done(0)]);

    expect(JSON.stringify(THREE_DAY_WEEK)).toBe(before);
  });

  it("cannot invent completion from a record with no plan position", () => {
    // Pre-PR47 day logs may carry a wrong workoutDay and no weekKey/dayIndex.
    // Nothing here reads a date, so such a record simply cannot count.
    const facts = computeWeeklyAdherence("Week 2", THREE_DAY_WEEK, [
      { weekKey: "", dayIndex: 0, completed: true },
    ]);

    expect(facts.completedDays).toBe(0);
  });
});

describe("computeDurationCoverage", () => {
  it("reports none when nothing was measured", () => {
    const coverage = computeDurationCoverage([{ durationSec: null }, {}]);

    expect(coverage.state).toBe("none");
    expect(coverage.measuredDurationSec).toBe(0);
    expect(coverage.unmeasuredSessionCount).toBe(2);
  });

  it("reports full when every session was measured", () => {
    const coverage = computeDurationCoverage([{ durationSec: 1800 }, { durationSec: 2700 }]);

    expect(coverage.state).toBe("full");
    expect(coverage.measuredDurationSec).toBe(4500);
    expect(coverage.measuredSessionCount).toBe(2);
  });

  it("reports partial and sums only what was measured", () => {
    const coverage = computeDurationCoverage([{ durationSec: 1800 }, { durationSec: null }]);

    expect(coverage.state).toBe("partial");
    // A floor across the period, not its total.
    expect(coverage.measuredDurationSec).toBe(1800);
    expect(coverage.unmeasuredSessionCount).toBe(1);
  });

  it.each([0, -60, Number.NaN, 13 * 60 * 60])("treats %s as unmeasured", (value) => {
    expect(computeDurationCoverage([{ durationSec: value }]).state).toBe("none");
  });

  it("returns no synthetic estimate for an empty period", () => {
    expect(computeDurationCoverage([])).toEqual({
      state: "none",
      measuredDurationSec: 0,
      measuredSessionCount: 0,
      unmeasuredSessionCount: 0,
    });
  });
});

describe("computeHistoryCoverage", () => {
  it("is complete when every record carries a plan position", () => {
    const coverage = computeHistoryCoverage([
      { weekKey: "Week 1", dayIndex: 0 },
      { weekKey: "Week 1", dayIndex: 2 },
    ]);

    expect(coverage.state).toBe("complete");
  });

  it("is partial when some records lack one", () => {
    const coverage = computeHistoryCoverage([
      { weekKey: "Week 1", dayIndex: 0 },
      { workoutDay: "2026-03-10" },
    ]);

    expect(coverage.state).toBe("partial");
    expect(coverage.usableCount).toBe(1);
    expect(coverage.unusableCount).toBe(1);
  });

  it("is insufficient when none does", () => {
    // A date alone cannot be trusted for a weekly claim, so it is not "usable".
    expect(computeHistoryCoverage([{ workoutDay: "2026-03-10" }]).state).toBe("insufficient");
  });
});

describe("exercise facts", () => {
  it("aggregates sets and reps", () => {
    const facts = computeExerciseFacts({
      name: "Bankdrücken",
      prescribedSets: 3,
      sets: [
        { setNumber: 1, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 2, repsCompleted: 9, weightUsed: 60 },
        { setNumber: 3, repsCompleted: 8, weightUsed: 62.5 },
      ],
    });

    expect(facts.completedSets).toBe(3);
    expect(facts.totalReps).toBe(27);
    expect(facts.topWeight).toBe(62.5);
    expect(facts.prescribedSets).toBe(3);
  });

  it("does not treat a bodyweight exercise as 0 kg", () => {
    const facts = computeExerciseFacts({
      name: "Klimmzüge",
      sets: [{ setNumber: 1, repsCompleted: 8 }, { setNumber: 2, repsCompleted: 7, weightUsed: null }],
    });

    expect(facts.hasWeight).toBe(false);
    expect(facts.topWeight).toBeNull();
    // Crucially not 0, which would read as a failed lift.
    expect(facts.topWeight).not.toBe(0);
  });

  it("keys on a stable id when one exists", () => {
    expect(exerciseKey({ exerciseId: "ex-1", name: "Bankdrücken" })).toBe("id:ex-1");
  });

  it("falls back to a normalised name, folding umlauts", () => {
    expect(exerciseKey({ name: "Bankdrücken" })).toBe(exerciseKey({ name: "bankdruecken" }));
    expect(exerciseKey({ name: "Schrägbank Drücken" })).toBe(exerciseKey({ name: "schraegbankdruecken" }));
  });

  it("does not match different exercises", () => {
    expect(exerciseKey({ name: "Bankdrücken" })).not.toBe(exerciseKey({ name: "Schulterdrücken" }));
  });
});

describe("compareExercise", () => {
  const facts = (over: Partial<Parameters<typeof computeExerciseFacts>[0]> = {}) =>
    computeExerciseFacts({
      name: "Bankdrücken",
      prescribedSets: 3,
      sets: [
        { setNumber: 1, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 2, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 3, repsCompleted: 10, weightUsed: 60 },
      ],
      ...over,
    });

  it("detects a weight increase at comparable reps", () => {
    const heavier = facts({
      sets: [
        { setNumber: 1, repsCompleted: 9, weightUsed: 62.5 },
        { setNumber: 2, repsCompleted: 9, weightUsed: 62.5 },
        { setNumber: 3, repsCompleted: 9, weightUsed: 62.5 },
      ],
    });

    expect(compareExercise(facts(), heavier)).toEqual({
      kind: "weight-increase",
      exerciseName: "Bankdrücken",
      previous: 60,
      current: 62.5,
    });
  });

  it("does not call it a gain when reps collapsed", () => {
    const heavierButFewer = facts({
      sets: [{ setNumber: 1, repsCompleted: 3, weightUsed: 70 }],
    });

    expect(compareExercise(facts(), heavierButFewer)?.kind).not.toBe("weight-increase");
  });

  it("detects more reps at the same weight", () => {
    const moreReps = facts({
      sets: [
        { setNumber: 1, repsCompleted: 12, weightUsed: 60 },
        { setNumber: 2, repsCompleted: 12, weightUsed: 60 },
        { setNumber: 3, repsCompleted: 12, weightUsed: 60 },
      ],
    });

    expect(compareExercise(facts(), moreReps)).toMatchObject({ kind: "reps-increase", previous: 30, current: 36 });
  });

  it("detects reps progress on a bodyweight exercise", () => {
    const before = computeExerciseFacts({ name: "Klimmzüge", sets: [{ setNumber: 1, repsCompleted: 6 }] });
    const after = computeExerciseFacts({ name: "Klimmzüge", sets: [{ setNumber: 1, repsCompleted: 9 }] });

    expect(compareExercise(before, after)).toMatchObject({ kind: "reps-increase", previous: 6, current: 9 });
  });

  it("makes no weight claim when only one side carried a load", () => {
    const unweighted = computeExerciseFacts({ name: "Klimmzüge", sets: [{ setNumber: 1, repsCompleted: 8 }] });
    const weighted = computeExerciseFacts({
      name: "Klimmzüge",
      sets: [{ setNumber: 1, repsCompleted: 8, weightUsed: 10 }],
    });

    // No "increase from 0 kg" — the earlier session simply had no load recorded.
    expect(compareExercise(unweighted, weighted)?.kind).not.toBe("weight-increase");
  });

  it("prefers the reps signal when an extra set also raised total reps", () => {
    // 3x10 -> 4x10 is both more sets and more reps; reps is the more
    // informative statement, so only that one is made.
    const extraSet = facts({
      sets: [
        { setNumber: 1, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 2, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 3, repsCompleted: 10, weightUsed: 60 },
        { setNumber: 4, repsCompleted: 10, weightUsed: 60 },
      ],
    });

    expect(compareExercise(facts(), extraSet)).toMatchObject({ kind: "reps-increase", previous: 30, current: 40 });
  });

  it("detects more completed sets when total reps did not rise", () => {
    // 3x10 (30 reps) -> 4x7 (28 reps): the extra set is the only true signal.
    const extraShorterSet = facts({
      sets: [
        { setNumber: 1, repsCompleted: 7, weightUsed: 60 },
        { setNumber: 2, repsCompleted: 7, weightUsed: 60 },
        { setNumber: 3, repsCompleted: 7, weightUsed: 60 },
        { setNumber: 4, repsCompleted: 7, weightUsed: 60 },
      ],
    });

    expect(compareExercise(facts(), extraShorterSet)).toMatchObject({
      kind: "sets-increase",
      previous: 3,
      current: 4,
    });
  });

  it("reports reduced volume without editorialising", () => {
    const fewer = facts({ sets: [{ setNumber: 1, repsCompleted: 10, weightUsed: 60 }] });

    expect(compareExercise(facts(), fewer)).toMatchObject({ kind: "reduced-volume", previous: 3, current: 1 });
  });

  it("produces nothing for an identical session", () => {
    expect(compareExercise(facts(), facts())).toBeNull();
  });

  it("produces nothing for incomparable exercises", () => {
    const other = computeExerciseFacts({ name: "Kniebeuge", sets: [{ setNumber: 1, repsCompleted: 20, weightUsed: 100 }] });

    expect(compareExercise(facts(), other)).toBeNull();
  });

  it("pairs the same exercises across two weeks and ignores unmatched ones", () => {
    const week1 = [
      computeExerciseFacts({ name: "Bankdrücken", sets: [{ setNumber: 1, repsCompleted: 8, weightUsed: 60 }] }),
      computeExerciseFacts({ name: "Rudern", sets: [{ setNumber: 1, repsCompleted: 10, weightUsed: 40 }] }),
    ];
    const week2 = [
      computeExerciseFacts({ name: "Bankdrücken", sets: [{ setNumber: 1, repsCompleted: 8, weightUsed: 65 }] }),
      computeExerciseFacts({ name: "Beinpresse", sets: [{ setNumber: 1, repsCompleted: 10, weightUsed: 120 }] }),
    ];

    const facts = compareSessions(week1, week2);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "weight-increase", exerciseName: "Bankdrücken" });
  });
});

describe("computePreferenceAlignment", () => {
  const measured = computeDurationCoverage([{ durationSec: 3600 }, { durationSec: 3600 }]);

  it("reports a frequency mismatch", () => {
    const alignment = computePreferenceAlignment({ daysPerWeek: 4 }, 3, measured);

    expect(alignment.frequency).toEqual({ preferred: 4, scheduled: 3, matches: false });
  });

  it("reports a frequency match", () => {
    expect(computePreferenceAlignment({ daysPerWeek: 3 }, 3, measured).frequency?.matches).toBe(true);
  });

  it("draws no conclusion when the preference was never given", () => {
    expect(computePreferenceAlignment({}, 3, measured).frequency).toBeUndefined();
  });

  it("compares session length against measured durations only", () => {
    const alignment = computePreferenceAlignment({ sessionMinutes: 45 }, 3, measured);

    expect(alignment.sessionLength).toMatchObject({
      preferredMinutes: 45,
      measuredAverageMinutes: 60,
      coverage: "full",
      matches: false,
    });
  });

  it("draws no duration conclusion when nothing was measured", () => {
    const none = computeDurationCoverage([{ durationSec: null }]);

    expect(computePreferenceAlignment({ sessionMinutes: 45 }, 3, none).sessionLength).toBeUndefined();
  });

  it("labels a partly measured comparison as partial", () => {
    const partial = computeDurationCoverage([{ durationSec: 2700 }, { durationSec: null }]);
    const alignment = computePreferenceAlignment({ sessionMinutes: 45 }, 3, partial);

    expect(alignment.sessionLength?.coverage).toBe("partial");
    // The average is over the measured subset, so 45 min matches.
    expect(alignment.sessionLength?.measuredAverageMinutes).toBe(45);
  });

  it("treats a small difference as a match", () => {
    const close = computeDurationCoverage([{ durationSec: 50 * 60 }]);

    expect(computePreferenceAlignment({ sessionMinutes: 45 }, 3, close).sessionLength?.matches).toBe(true);
  });
});

describe("buildWeeklyFacts", () => {
  const base = {
    weekKey: "Week 2",
    planDays: THREE_DAY_WEEK,
    completions: [done(0), done(2)],
    weekLogs: [{ weekKey: "Week 2", dayIndex: 0, durationSec: 2700 }],
  };

  it("assembles every fact group", () => {
    const facts = buildWeeklyFacts({ ...base, preferences: { daysPerWeek: 4, sessionMinutes: 45 } });

    expect(facts.adherence.completedDays).toBe(2);
    // Two completed sessions, one of them timed. Coverage is counted over the
    // sessions the week completed, so this is a floor and says so.
    expect(facts.duration.state).toBe("partial");
    expect(facts.history.state).toBe("complete");
    expect(facts.alignment.frequency?.matches).toBe(false);
    expect(facts.hasAnyData).toBe(true);
  });

  it("works with no goal and no preferences", () => {
    const facts = buildWeeklyFacts(base);

    expect(facts.goal).toBeUndefined();
    expect(facts.alignment).toEqual({});
    expect(facts.adherence.adherencePercent).toBe(67);
  });

  it("reports no data for an empty week", () => {
    const facts = buildWeeklyFacts({ weekKey: "Week 2", planDays: [], completions: [], weekLogs: [] });

    expect(facts.hasAnyData).toBe(false);
  });

  it("does not mutate the plan it was given", () => {
    const before = JSON.stringify(THREE_DAY_WEEK);
    buildWeeklyFacts({ ...base, preferences: { daysPerWeek: 4 } });

    expect(JSON.stringify(THREE_DAY_WEEK)).toBe(before);
  });
});

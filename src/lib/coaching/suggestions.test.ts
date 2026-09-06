import { describe, it, expect } from "vitest";
import { buildSuggestions, primarySuggestion } from "./suggestions";
import { buildWeeklyFacts, type PlanDayInput, type WeeklyFactsInput } from "./facts";
import type { FitnessGoal } from "./fitnessGoal";

const THREE_DAY_WEEK: readonly PlanDayInput[] = Object.freeze([
  { dayIndex: 0, exerciseCount: 4 },
  { dayIndex: 1, exerciseCount: 0 },
  { dayIndex: 2, exerciseCount: 5 },
  { dayIndex: 3, exerciseCount: 0 },
  { dayIndex: 4, exerciseCount: 4 },
  { dayIndex: 5, exerciseCount: 0 },
  { dayIndex: 6, exerciseCount: 0 },
]);

const facts = (over: Partial<WeeklyFactsInput> = {}) =>
  buildWeeklyFacts({
    weekKey: "Week 2",
    planDays: THREE_DAY_WEEK,
    completions: [],
    weekLogs: [],
    ...over,
  });

const allDone = [0, 2, 4].map((dayIndex) => ({ weekKey: "Week 2", dayIndex, completed: true }));

const codes = (input: Partial<WeeklyFactsInput> = {}) =>
  buildSuggestions(facts(input)).map((suggestion) => suggestion.code);

describe("adherence rules", () => {
  it("acknowledges a fully completed week", () => {
    const suggestion = primarySuggestion(facts({ completions: allDone }));

    expect(suggestion?.code).toBe("adherence-high");
    expect(suggestion?.params).toMatchObject({ completed: 3, scheduled: 3, percent: 100 });
  });

  it("leads with consistency when adherence is low", () => {
    // Consistency before volume — and never a fatigue or overtraining claim.
    const suggestion = primarySuggestion(facts({ completions: [] }));

    expect(suggestion?.code).toBe("adherence-low");
  });

  it("reports a middling week as partial", () => {
    expect(codes({ completions: allDone.slice(0, 2) })).toContain("adherence-partial");
  });

  it("makes no adherence claim for a week with nothing scheduled", () => {
    const restWeek = THREE_DAY_WEEK.map((day) => ({ ...day, exerciseCount: 0 }));

    expect(codes({ planDays: restWeek })).not.toContain("adherence-low");
  });
});

describe("empty state", () => {
  it("returns exactly one truthful no-data suggestion", () => {
    const suggestions = buildSuggestions(facts({ planDays: [], completions: [] }));

    expect(suggestions).toEqual([{ code: "no-data", priority: 100 }]);
  });
});

describe("plan completion", () => {
  it("recommends preparing the next plan once the programme is over", () => {
    const suggestion = primarySuggestion(facts({ completions: allDone, planFinished: true }));

    expect(suggestion?.code).toBe("plan-finished");
  });
});

describe("progression rules", () => {
  const progression = [
    { kind: "weight-increase" as const, exerciseName: "Bankdrücken", previous: 60, current: 62.5 },
  ];

  it("states the measured change with its numbers", () => {
    const suggestion = buildSuggestions(facts({ completions: allDone, progression }))
      .find((entry) => entry.code === "progression-weight");

    expect(suggestion?.params).toEqual({ exercise: "Bankdrücken", previous: 60, current: 62.5 });
  });

  it("reports reduced volume without diagnosing a cause", () => {
    const codesFound = codes({
      completions: allDone,
      progression: [{ kind: "reduced-volume", exerciseName: "Rudern", previous: 4, current: 2 }],
    });

    expect(codesFound).toContain("volume-reduced");
    // No overtraining/fatigue/injury vocabulary exists in the code set at all.
    expect(codesFound.join(" ")).not.toMatch(/overtrain|fatigue|injur|rehab/i);
  });
});

describe("preference alignment rules", () => {
  it("points out a frequency mismatch", () => {
    const suggestion = buildSuggestions(
      facts({ completions: allDone, preferences: { daysPerWeek: 4 } })
    ).find((entry) => entry.code === "frequency-mismatch");

    expect(suggestion?.params).toEqual({ preferred: 4, scheduled: 3 });
  });

  it("says nothing when the frequency matches", () => {
    expect(codes({ completions: allDone, preferences: { daysPerWeek: 3 } }))
      .not.toContain("frequency-mismatch");
  });

  it("says nothing when no preference was given", () => {
    expect(codes({ completions: allDone })).not.toContain("frequency-mismatch");
  });

  it("reports a session-length mismatch and carries its coverage", () => {
    const suggestion = buildSuggestions(
      facts({
        completions: allDone,
        preferences: { sessionMinutes: 45 },
        weekLogs: [{ weekKey: "Week 2", dayIndex: 0, durationSec: 5400 }],
      })
    ).find((entry) => entry.code === "session-length-mismatch");

    // Three completed sessions, one timed: the 90-minute average is over the
    // measured subset, and the coverage says so rather than implying a total.
    expect(suggestion?.params).toMatchObject({ preferred: 45, measured: 90, coverage: "partial" });
  });

  it("makes no duration claim when nothing was measured", () => {
    expect(
      codes({
        completions: allDone,
        preferences: { sessionMinutes: 45 },
        weekLogs: [{ weekKey: "Week 2", dayIndex: 0, durationSec: null }],
      })
    ).not.toContain("session-length-mismatch");
  });
});

describe("goal awareness", () => {
  const withGoal = (goal: FitnessGoal | undefined) =>
    facts({
      completions: allDone,
      goal,
      progression: [{ kind: "weight-increase", exerciseName: "Bankdrücken", previous: 60, current: 65 }],
    });

  it("produces a valid review with no goal at all", () => {
    const suggestions = buildSuggestions(withGoal(undefined));

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.map((s) => s.code)).toContain("adherence-high");
  });

  it("lets gainMuscle lead with progression", () => {
    expect(primarySuggestion(withGoal("gainMuscle"))?.code).toBe("progression-weight");
  });

  it("changes only ordering, never the underlying numbers", () => {
    const withoutGoal = buildSuggestions(withGoal(undefined));
    const withMuscle = buildSuggestions(withGoal("gainMuscle"));

    // Same set of statements, same parameters — only the order differs.
    const params = (list: typeof withoutGoal) =>
      Object.fromEntries(list.map((s) => [s.code, s.params]));

    expect(params(withMuscle)).toEqual(params(withoutGoal));
    expect(new Set(withMuscle.map((s) => s.code))).toEqual(new Set(withoutGoal.map((s) => s.code)));
  });

  it("does not prioritise loseFat into calorie territory", () => {
    // No boost, and no weight-loss or calorie code exists to promote.
    const codesFound = buildSuggestions(withGoal("loseFat")).map((s) => s.code);

    expect(codesFound.join(" ")).not.toMatch(/calorie|kalorien|weight-loss|deficit/i);
  });
});

describe("purity", () => {
  it("never mutates the facts it was given", () => {
    const input = facts({ completions: allDone, preferences: { daysPerWeek: 4 } });
    const before = JSON.stringify(input);

    buildSuggestions(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("is deterministic across repeated calls", () => {
    const input = facts({ completions: allDone, preferences: { daysPerWeek: 4 } });

    expect(buildSuggestions(input)).toEqual(buildSuggestions(input));
  });
});

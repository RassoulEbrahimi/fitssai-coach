import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkoutHelpers } from "@/hooks/useWorkoutHelpers";
import { readDisplayedDayExercises } from "@/lib/planWeekMirroring";
import {
  applyPreviousToDraft,
  completeDaysOnly,
  exerciseIdentityKeys,
  findPreviousPerformance,
  formatWorkoutDayDate,
  normalizeExerciseName,
  PREVIOUS_PERFORMANCE_LOG_LIMIT,
  PREVIOUS_PERFORMANCE_MAX_OCCURRENCES,
  type StoredDocument,
} from "@/lib/previousPerformance";
import type { WorkoutPlan } from "@/lib/types";

/*
  TRAINING-EXEC-02B: which earlier workout a "Letztes Mal" reference may come
  from, resolved purely. The source below is deliberately unfiltered - it
  hands back today's and future logs too - so every exclusion is the
  resolver's own, not a property of the query that feeds it.
*/

/** The running workout: Week 2, Tuesday, of a plan whose Week 1 Tuesday was 2026-09-08. */
const TARGET = { planId: "plan-now", weekKey: "Week 2", dayIndex: 1, workoutDay: "2026-09-15" };

const day = (...names: string[]) => ({ day: "Tag", exercises: names.map((name) => ({ name, sets: 3, reps: "10" })) });
const rest = () => ({ day: "Tag", exercises: [] });
/** Tuesday (1) and Thursday (3) train `names` in Weeks 1 and 2. */
const plan = (...names: string[]) => ({
  "Week 1": [rest(), day(...names), rest(), day(...names)],
  "Week 2": [rest(), day(...names), rest(), day(...names)],
});

interface Position { planId?: string; weekKey?: string; dayIndex?: number; exerciseIndex?: number }
const log = (id: string, workoutDay: string | undefined, position: Position = {}): StoredDocument => ({
  id,
  data: {
    planId: "plan-now", weekKey: "Week 1", dayIndex: 1, exerciseIndex: 0, completed: false,
    ...(workoutDay !== undefined ? { workoutDay } : {}),
    ...position,
  },
});
const recorded = (setNumber: number, reps: number | null, weightKg: number | null = null, id = `s${setNumber}`): StoredDocument => ({
  id,
  data: {
    setNumber, completed: true, performanceSource: "user-recorded",
    ...(reps !== null ? { repsCompleted: reps } : {}),
    ...(weightKg !== null ? { weightUsed: weightKg } : {}),
  },
});

interface Fixture {
  logs: StoredDocument[];
  plans?: Record<string, unknown>;
  sets?: Record<string, StoredDocument[]>;
}

const sourceFor = ({ logs, plans = { "plan-now": plan("Bankdrücken") }, sets = {} }: Fixture) => ({
  recentLogs: vi.fn(async (_beforeDay: string, count: number) =>
    [...logs].sort((a, b) => String(b.data.workoutDay).localeCompare(String(a.data.workoutDay))).slice(0, count)),
  planContent: vi.fn(async (planId: string) => plans[planId] ?? null),
  setDocuments: vi.fn(async (logId: string) => sets[logId] ?? []),
});

const keysFor = (...names: string[]) => exerciseIdentityKeys(names.map((name) => ({ name })));

const lookup = async (fixture: Fixture, names: string[] = ["Bankdrücken"]) => {
  const source = sourceFor(fixture);
  const keys = keysFor(...names);
  const result = await findPreviousPerformance(source, TARGET, keys);
  return { source, keys, result, of: (index: number) => result[keys[index]!] };
};

describe("exercise identity", () => {
  it("folds case, surrounding and repeated whitespace and Unicode composition, and nothing else", () => {
    expect(normalizeExerciseName("  Bank   DRÜCKEN ")).toBe("bank drücken");
    expect(normalizeExerciseName("Bankdrücken")).toBe(normalizeExerciseName("Bankdrücken"));
    expect(normalizeExerciseName("Schrägbankdrücken")).not.toBe(normalizeExerciseName("Bankdrücken"));
    for (const unusable of ["", "   ", 42, null, undefined]) expect(normalizeExerciseName(unusable)).toBeNull();
  });

  it("numbers repeated exercises by occurrence within the day", () => {
    const [first, row, second, unnamed] = exerciseIdentityKeys([
      { name: "Bankdrücken" }, { name: "Rudern" }, { name: " bankdrücken" }, {},
    ]);
    expect(new Set([first, row, second]).size).toBe(3);
    expect(unnamed).toBeNull();
    expect(second).toBe(keysFor("Bankdrücken", "Bankdrücken")[1]);
    expect(first).toBe(keysFor("Bankdrücken")[0]);
  });
});

describe("choosing the previous occurrence", () => {
  it("takes the most recent earlier occurrence and opens nothing older once it is found", async () => {
    const { of, source } = await lookup({
      logs: [log("tue", "2026-09-08"), log("thu", "2026-09-10", { dayIndex: 3 })],
      sets: { tue: [recorded(1, 10, 52.5)], thu: [recorded(1, 12, 55)] },
    });

    expect(of(0)).toEqual({ workoutDay: "2026-09-10", sets: { 1: { reps: 12, weightKg: 55 } } });
    expect(source.setDocuments.mock.calls.map(([logId]) => logId)).toEqual(["thu"]);
  });

  it("never uses the running workout's own day or its own plan position", async () => {
    const { of, source } = await lookup({
      logs: [
        log("today", "2026-09-15", { weekKey: "Week 2", dayIndex: 3 }),
        // The running plan day itself, even with an inconsistent earlier date.
        log("running", "2026-09-14", { weekKey: "Week 2", dayIndex: 1 }),
        log("tue", "2026-09-08"),
      ],
      sets: { today: [recorded(1, 99)], running: [recorded(1, 98)], tue: [recorded(1, 10)] },
    });

    expect(of(0)).toEqual({ workoutDay: "2026-09-08", sets: { 1: { reps: 10, weightKg: null } } });
    expect(source.setDocuments.mock.calls.map(([logId]) => logId)).toEqual(["tue"]);
  });

  it("ignores workouts dated after the running one", async () => {
    const { result, source } = await lookup({
      logs: [log("future", "2026-09-17", { weekKey: "Week 2", dayIndex: 3 })],
      sets: { future: [recorded(1, 10)] },
    });

    expect(result).toEqual({});
    expect(source.setDocuments).not.toHaveBeenCalled();
  });

  it("resolves a log against its own plan, never the running plan", async () => {
    const { result, of, keys, source } = await lookup({
      // Index 0 of the old plan's Tuesday is Rudern; in the running plan it is Bankdrücken.
      logs: [log("old", "2026-09-01", { planId: "plan-old", exerciseIndex: 0 })],
      plans: { "plan-now": plan("Bankdrücken", "Rudern"), "plan-old": { "Week 1": [rest(), day("Rudern")] } },
      sets: { old: [recorded(1, 15)] },
    }, ["Bankdrücken", "Rudern"]);

    expect(result[keys[0]!]).toBeUndefined();
    expect(of(1)).toEqual({ workoutDay: "2026-09-01", sets: { 1: { reps: 15, weightKg: null } } });
    expect(source.planContent.mock.calls.map(([planId]) => planId)).toEqual(["plan-old"]);
  });

  it("skips logs whose plan is missing or malformed, without falling back to another plan", async () => {
    const { of, source } = await lookup({
      logs: [
        log("gone", "2026-09-12", { planId: "plan-gone" }),
        log("text", "2026-09-11", { planId: "plan-text" }),
        log("list", "2026-09-10", { planId: "plan-list" }),
        log("tue", "2026-09-08"),
      ],
      plans: { "plan-now": plan("Bankdrücken"), "plan-text": "Bankdrücken", "plan-list": [day("Bankdrücken")] },
      sets: { gone: [recorded(1, 99)], text: [recorded(1, 98)], list: [recorded(1, 97)], tue: [recorded(1, 10)] },
    });

    expect(of(0)).toEqual({ workoutDay: "2026-09-08", sets: { 1: { reps: 10, weightKg: null } } });
    expect(source.setDocuments.mock.calls.map(([logId]) => logId)).toEqual(["tue"]);
  });

  it("matches an exact normalised name", async () => {
    const { of } = await lookup({
      logs: [log("old", "2026-09-01", { planId: "plan-old" })],
      plans: { "plan-old": { "Week 1": [rest(), day("  bankDRÜCKEN ")] } },
      sets: { old: [recorded(1, 10, 52.5)] },
    });

    expect(of(0)?.sets).toEqual({ 1: { reps: 10, weightKg: 52.5 } });
  });

  it("does not match similar but different exercises", async () => {
    const { result, source } = await lookup({
      logs: [0, 1, 2].map((exerciseIndex) => log(`old-${exerciseIndex}`, "2026-09-01", { planId: "plan-old", exerciseIndex })),
      plans: { "plan-old": { "Week 1": [rest(), day("Schrägbankdrücken", "Bankdrücken eng", "Bank")] } },
      sets: { "old-0": [recorded(1, 10)], "old-1": [recorded(1, 10)], "old-2": [recorded(1, 10)] },
    });

    expect(result).toEqual({});
    expect(source.setDocuments).not.toHaveBeenCalled();
  });

  it("keeps repeated exercises apart by occurrence and never lets two share one", async () => {
    const twice = await lookup({
      logs: [
        log("first", "2026-09-01", { planId: "plan-old", exerciseIndex: 0 }),
        log("second", "2026-09-01", { planId: "plan-old", exerciseIndex: 2 }),
      ],
      plans: { "plan-old": { "Week 1": [rest(), day("Bankdrücken", "Rudern", "Bankdrücken")] } },
      sets: { first: [recorded(1, 10)], second: [recorded(1, 6)] },
    }, ["Bankdrücken", "Bankdrücken"]);

    expect(twice.of(0)?.sets).toEqual({ 1: { reps: 10, weightKg: null } });
    expect(twice.of(1)?.sets).toEqual({ 1: { reps: 6, weightKg: null } });

    const once = await lookup({
      logs: [log("only", "2026-09-01", { planId: "plan-old", exerciseIndex: 0 })],
      plans: { "plan-old": { "Week 1": [rest(), day("Bankdrücken")] } },
      sets: { only: [recorded(1, 10)] },
    }, ["Bankdrücken", "Bankdrücken"]);

    expect(once.of(0)?.sets).toEqual({ 1: { reps: 10, weightKg: null } });
    expect(once.of(1)).toBeUndefined();
  });

  it("names a mirrored week's exercise from the week it displays, as the app does", async () => {
    const mirrored = { "Week 1": [rest(), day("Rudern")], "Week 2": [rest(), day("Bankdrücken")] };
    const { of, keys, result } = await lookup({
      logs: [
        log("week3", "2026-09-01", { planId: "plan-old", weekKey: "Week 3" }),
        log("week5", "2026-09-02", { planId: "plan-old", weekKey: "Week 5" }),
      ],
      plans: { "plan-old": mirrored },
      sets: { week3: [recorded(1, 10)], week5: [recorded(1, 99)] },
    }, ["Bankdrücken", "Rudern"]);

    // Week 3 has no content of its own and shows Week 2's; Week 5 is past the programme.
    expect(of(0)).toEqual({ workoutDay: "2026-09-01", sets: { 1: { reps: 10, weightKg: null } } });
    expect(result[keys[1]!]).toBeUndefined();
  });

  it("uses no reference when two different earlier positions on the same day both qualify", async () => {
    const { result } = await lookup({
      logs: [log("a", "2026-09-08"), log("b", "2026-09-08", { planId: "plan-old" })],
      plans: { "plan-now": plan("Bankdrücken"), "plan-old": { "Week 1": [rest(), day("Bankdrücken")] } },
      sets: { a: [recorded(1, 10)], b: [recorded(1, 12)] },
    });

    expect(result).toEqual({});
  });

  it("reads duplicate logs of one position in the same order as the set reader", async () => {
    const { of } = await lookup({
      logs: [log("b-parent", "2026-09-08"), log("a-parent", "2026-09-08")],
      sets: {
        "a-parent": [recorded(1, 9, null, "set_1"), recorded(1, 7, null, "auto-1"), recorded(2, 5)],
        "b-parent": [recorded(1, 11), recorded(3, 4)],
      },
    });

    expect(of(0)?.sets).toEqual({
      1: { reps: 7, weightKg: null },
      2: { reps: 5, weightKg: null },
      3: { reps: 4, weightKg: null },
    });
  });
});

describe("trusting recorded values", () => {
  it("uses only explicitly recorded values - never legacy numbers, completion or out-of-range values", async () => {
    const { result } = await lookup({
      logs: [log("tue", "2026-09-08")],
      sets: {
        tue: [
          { id: "legacy", data: { setNumber: 1, repsCompleted: 10, weightUsed: 60, completedAt: "ts" } },
          { id: "ticked", data: { setNumber: 2, completed: true, performanceSource: "completion-only", repsCompleted: 10 } },
          { id: "empty", data: { setNumber: 3, completed: false, performanceSource: "user-recorded" } },
          { id: "fraction", data: { setNumber: 4, completed: true, performanceSource: "user-recorded", repsCompleted: 10.5, weightUsed: 0 } },
          { id: "unknown", data: { setNumber: 5, completed: true, performanceSource: "coach-estimated", repsCompleted: 8 } },
        ],
      },
    });

    expect(result).toEqual({});
  });

  it("counts a recorded set that was never ticked, and ignores malformed set numbers", async () => {
    const { of } = await lookup({
      logs: [log("tue", "2026-09-08")],
      sets: {
        tue: [
          { id: "a", data: { setNumber: 1, completed: false, performanceSource: "user-recorded", weightUsed: 52.5 } },
          { id: "b", data: { setNumber: "2", completed: true, performanceSource: "user-recorded", repsCompleted: 8 } },
          { id: "c", data: { setNumber: 0, completed: true, performanceSource: "user-recorded", repsCompleted: 8 } },
        ],
      },
    });

    expect(of(0)?.sets).toEqual({ 1: { reps: null, weightKg: 52.5 } });
  });

  it("passes over a newer occurrence with nothing recorded for an older one that has values", async () => {
    const { of } = await lookup({
      logs: [log("thu", "2026-09-10", { dayIndex: 3 }), log("tue", "2026-09-08")],
      sets: {
        thu: [{ id: "s1", data: { setNumber: 1, performanceSource: "completion-only" } }],
        tue: [recorded(1, 10, 52.5)],
      },
    });

    expect(of(0)).toEqual({ workoutDay: "2026-09-08", sets: { 1: { reps: 10, weightKg: 52.5 } } });
  });

  it("gives up after a bounded number of occurrences without recorded values", async () => {
    const count = PREVIOUS_PERFORMANCE_MAX_OCCURRENCES + 1;
    const plans: Record<string, unknown> = {};
    const logs: StoredDocument[] = [];
    const sets: Record<string, StoredDocument[]> = {};
    for (let index = 0; index < count; index += 1) {
      plans[`plan-${index}`] = plan("Bankdrücken");
      logs.push(log(`untrusted-${index}`, `2026-08-${String(20 + index)}`, { planId: `plan-${index}` }));
      sets[`untrusted-${index}`] = [{ id: "s1", data: { setNumber: 1, performanceSource: "completion-only" } }];
    }
    plans["plan-oldest"] = plan("Bankdrücken");
    logs.push(log("trusted", "2026-08-01", { planId: "plan-oldest" }));
    sets.trusted = [recorded(1, 10)];

    const { result, source } = await lookup({ logs, plans, sets });

    expect(result).toEqual({});
    expect(source.setDocuments).toHaveBeenCalledTimes(PREVIOUS_PERFORMANCE_MAX_OCCURRENCES);
  });

  it("maps set numbers exactly and invents nothing for sets that were not recorded", async () => {
    const { of } = await lookup({
      logs: [log("tue", "2026-09-08")],
      sets: { tue: [recorded(1, 10, 52.5), recorded(3, null, 40)] },
    });

    expect(of(0)?.sets).toEqual({ 1: { reps: 10, weightKg: 52.5 }, 3: { reps: null, weightKg: 40 } });
    expect(of(0)?.sets[2]).toBeUndefined();
  });
});

describe("the bounded read", () => {
  it("asks for one page of logs dated before the running workout", async () => {
    const { source } = await lookup({ logs: [log("tue", "2026-09-08")], sets: { tue: [recorded(1, 10)] } });

    expect(source.recentLogs).toHaveBeenCalledTimes(1);
    expect(source.recentLogs).toHaveBeenCalledWith("2026-09-15", PREVIOUS_PERFORMANCE_LOG_LIMIT);
  });

  it("drops the oldest day of a full page, which may be incomplete", async () => {
    const dayLogs = Array.from({ length: PREVIOUS_PERFORMANCE_LOG_LIMIT - 1 }, (_, index) =>
      ({ id: `day-${index}`, data: { planId: "plan-now", workoutDay: "2026-09-10", completed: true } }));
    const page = [...dayLogs, log("edge", "2026-09-01")];

    expect(completeDaysOnly(page, PREVIOUS_PERFORMANCE_LOG_LIMIT).map((doc) => doc.id)).not.toContain("edge");
    expect(completeDaysOnly(page.slice(1), PREVIOUS_PERFORMANCE_LOG_LIMIT)).toHaveLength(page.length - 1);

    const { result, source } = await lookup({ logs: page, sets: { edge: [recorded(1, 10)] } });
    expect(result).toEqual({});
    expect(source.setDocuments).not.toHaveBeenCalled();
  });

  it("skips day logs, undated logs and malformed positions without opening them", async () => {
    const { result, source } = await lookup({
      logs: [
        { id: "day", data: { planId: "plan-now", workoutDay: "2026-09-08", completed: true, durationSec: 1800 } },
        log("undated", undefined),
        log("negative", "2026-09-08", { exerciseIndex: -1 }),
        log("fraction", "2026-09-08", { exerciseIndex: 0.5 }),
        log("beyond", "2026-09-08", { exerciseIndex: 4 }),
      ],
      sets: { day: [recorded(1, 10)], undated: [recorded(1, 10)], negative: [recorded(1, 10)], beyond: [recorded(1, 10)] },
    });

    expect(result).toEqual({});
    expect(source.setDocuments).not.toHaveBeenCalled();
  });

  it("reads nothing without an exercise identity or a usable day", async () => {
    const source = sourceFor({ logs: [log("tue", "2026-09-08")] });

    expect(await findPreviousPerformance(source, TARGET, [null])).toEqual({});
    expect(await findPreviousPerformance(source, { ...TARGET, workoutDay: "15.09.2026" }, keysFor("Bankdrücken"))).toEqual({});
    expect(source.recentLogs).not.toHaveBeenCalled();
  });

  it("rejects rather than guessing when a plan or a set list cannot be read", async () => {
    const planFails = sourceFor({ logs: [log("tue", "2026-09-08")], sets: { tue: [recorded(1, 10)] } });
    planFails.planContent.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "unavailable" }));
    await expect(findPreviousPerformance(planFails, TARGET, keysFor("Bankdrücken"))).rejects.toMatchObject({ code: "unavailable" });

    const setsFail = sourceFor({ logs: [log("thu", "2026-09-10", { dayIndex: 3 }), log("tue", "2026-09-08")], sets: { tue: [recorded(1, 10)] } });
    setsFail.setDocuments.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "unavailable" }));
    await expect(findPreviousPerformance(setsFail, TARGET, keysFor("Bankdrücken"))).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("week mirroring agrees with the Workout view's plan reader", () => {
  const exercises = (name: string) => [{ day: "Tag", exercises: [{ name, sets: 3, reps: "10" }] }];
  const shapes: Record<string, Record<string, unknown>> = {
    "Week 1 only": { "Week 1": exercises("A") },
    "Weeks 1 and 2": { "Week 1": exercises("A"), "Week 2": exercises("B") },
    "Week 2 only": { "Week 2": exercises("B") },
    "Weeks 1 and 3": { "Week 1": exercises("A"), "Week 3": exercises("C") },
    "all four": { "Week 1": exercises("A"), "Week 2": exercises("B"), "Week 3": exercises("C"), "Week 4": exercises("D") },
    "compact keys": { week1: exercises("A"), week2: exercises("B") },
    "object-shaped weeks": { "Week 1": { 0: exercises("A")[0] }, "Week 2": { 0: exercises("B")[0] } },
  };

  it.each(Object.entries(shapes))("reads Weeks 1-4 of %s identically", (_label, content) => {
    const { result } = renderHook(() => useWorkoutHelpers({ content } as unknown as WorkoutPlan));
    for (const weekKey of ["Week 1", "Week 2", "Week 3", "Week 4"]) {
      const shown = result.current.getWeekContentWithFallback(weekKey)[0]?.exercises;
      expect(readDisplayedDayExercises(content as never, weekKey, 0), `${weekKey}`).toEqual(shown);
    }
  });
});

describe("copying into today's draft", () => {
  const BOTH = { reps: 10, weightKg: 52.5 };

  it("fills both empty fields when both previous values exist", () => {
    expect(applyPreviousToDraft({}, undefined, BOTH)).toEqual({ reps: "10", weight: "52,5" });
  });

  it("fills only the fields the previous set has", () => {
    expect(applyPreviousToDraft({}, undefined, { reps: 10, weightKg: null })).toEqual({ reps: "10" });
    expect(applyPreviousToDraft({}, undefined, { reps: null, weightKg: 52.5 })).toEqual({ weight: "52,5" });
  });

  it("never replaces a value already recorded today", () => {
    const recordedToday = { reps: 12, weightKg: null };
    expect(applyPreviousToDraft({}, recordedToday, BOTH)).toEqual({ weight: "52,5" });
    expect(applyPreviousToDraft({}, { reps: 12, weightKg: 50 }, BOTH)).toEqual({});
    // A cleared-but-unsaved field over a recorded value is still today's value.
    expect(applyPreviousToDraft({ weight: "" }, { reps: null, weightKg: 50 }, BOTH)).toEqual({ reps: "10", weight: "" });
  });

  it("never replaces typed or refused text, and copies only what is missing", () => {
    expect(applyPreviousToDraft({ reps: "12" }, undefined, BOTH)).toEqual({ reps: "12", weight: "52,5" });
    const refused = { weight: "abc", weightError: "Gewicht ungültig." };
    expect(applyPreviousToDraft(refused, undefined, BOTH)).toEqual({ ...refused, reps: "10" });
    expect(applyPreviousToDraft({ reps: "  " }, undefined, BOTH)).toEqual({ reps: "10", weight: "52,5" });
  });

  it("returns a new draft and leaves the one it was given untouched", () => {
    const draft = { reps: "12" };
    applyPreviousToDraft(draft, undefined, BOTH);
    expect(draft).toEqual({ reps: "12" });
  });
});

it("formats the previous workout's day without passing through a time zone", () => {
  expect(formatWorkoutDayDate("2026-09-08")).toBe("08.09.2026");
});

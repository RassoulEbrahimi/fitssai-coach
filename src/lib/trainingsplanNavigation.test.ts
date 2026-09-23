import { describe, expect, it } from "vitest";
import { trainingsplanHistoryKey, readTrainingsplanStack, withTrainingsplanStack, type PushedScreen } from "./trainingsplanNavigation";

const DAY = { weekKey: "Week 3", dayIndex: 3, workoutDay: "2026-09-24" };
const PLAN: PushedScreen = { kind: "plan" };
const DETAIL: PushedScreen = { kind: "detail", day: DAY };
const EDIT: PushedScreen = { kind: "edit", day: DAY };

describe("Trainingsplan history state", () => {
  it("round-trips a stack for its plan and keeps the entry's other state", () => {
    const state = withTrainingsplanStack({ other: 1 }, "plan-1", [PLAN, DETAIL, EDIT]);
    expect(state.other).toBe(1);
    expect(readTrainingsplanStack(state, "plan-1")).toEqual([PLAN, DETAIL, EDIT]);
  });

  it("reads Main for no state, another plan or an empty stack", () => {
    expect(readTrainingsplanStack(null, "plan-1")).toEqual([]);
    expect(readTrainingsplanStack(withTrainingsplanStack(null, "plan-1", [PLAN]), "plan-2")).toEqual([]);
    expect(withTrainingsplanStack({ [trainingsplanHistoryKey]: { planId: "plan-1", stack: [PLAN] } }, "plan-1", []))
      .not.toHaveProperty(trainingsplanHistoryKey);
  });

  it("rejects malformed screens rather than guessing", () => {
    const read = (stack: unknown[]) => readTrainingsplanStack({ [trainingsplanHistoryKey]: { planId: "p", stack } }, "p");
    expect(read([{ kind: "detail", day: { ...DAY, dayIndex: 9 } }])).toEqual([]);
    expect(read([{ kind: "detail", day: { ...DAY, workoutDay: "morgen" } }])).toEqual([]);
    expect(read([{ kind: "settings" }])).toEqual([]);
    // Editing only ever sits on its own day.
    expect(read([EDIT])).toEqual([]);
    expect(read([{ kind: "detail", day: { ...DAY, workoutDay: "2026-09-25" } }, EDIT])).toEqual([]);
  });

  it("stores only the fields a screen needs", () => {
    const stack = readTrainingsplanStack(
      { [trainingsplanHistoryKey]: { planId: "p", stack: [{ kind: "detail", day: { ...DAY, summary: "x" }, extra: true }] } },
      "p"
    );
    expect(stack).toEqual([DETAIL]);
  });
});

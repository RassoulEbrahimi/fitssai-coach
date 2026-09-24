import { describe, expect, it } from "vitest";
import {
  NO_PLAN_SCOPE,
  trainingsplanHistoryKey,
  readTrainingsplanStack,
  withTrainingsplanStack,
  type PushedScreen,
} from "./trainingsplanNavigation";

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

  describe("Verlauf and Session Detail (TRAINING-HISTORY-01)", () => {
    const HISTORY: PushedScreen = { kind: "history" };
    const session = (planId: string, workoutDay = DAY.workoutDay): PushedScreen => ({ kind: "session", session: { planId, workoutDay } });
    const read = (stack: unknown[], planId = "p") =>
      readTrainingsplanStack({ [trainingsplanHistoryKey]: { planId, stack } }, planId);

    it("round-trips History and a session of any plan opened from it", () => {
      const state = withTrainingsplanStack(null, "p", [HISTORY, session("older-plan")]);
      expect(readTrainingsplanStack(state, "p")).toEqual([HISTORY, session("older-plan")]);
    });

    it("opens a session from Today or its own completed day, for this plan only", () => {
      expect(read([session("p")])).toEqual([session("p")]);
      expect(read([DETAIL, session("p")])).toEqual([DETAIL, session("p")]);
      // Never another plan's session, and never another day's, outside History.
      expect(read([session("other")])).toEqual([]);
      expect(read([DETAIL, session("p", "2026-09-23")])).toEqual([]);
    });

    it("rejects impossible or malformed stacks", () => {
      expect(read([PLAN, HISTORY])).toEqual([]);
      expect(read([HISTORY, session("x"), DETAIL])).toEqual([]);
      expect(read([HISTORY, { kind: "session", session: { planId: "", workoutDay: DAY.workoutDay } }])).toEqual([]);
      expect(read([HISTORY, { kind: "session", session: { planId: "a/b", workoutDay: DAY.workoutDay } }])).toEqual([]);
      expect(read([HISTORY, { kind: "session", session: { planId: "x", workoutDay: "gestern" } }])).toEqual([]);
    });

    it("keeps only History and its sessions without a plan", () => {
      expect(read([HISTORY, session("old")], NO_PLAN_SCOPE)).toEqual([HISTORY, session("old")]);
      expect(read([PLAN], NO_PLAN_SCOPE)).toEqual([]);
      expect(read([DETAIL], NO_PLAN_SCOPE)).toEqual([]);
      expect(readTrainingsplanStack(withTrainingsplanStack(null, NO_PLAN_SCOPE, [HISTORY]), "plan-1")).toEqual([]);
    });
  });
});

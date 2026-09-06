import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTrainingNudge } from "./useTrainingNudge";
import type { AnyWorkoutLogShape } from "@/lib/workoutCompletion";
import type { WorkoutPlan } from "@/lib/types";

/*
  The stateful half of the nudge layer, tested through the behaviour that
  cannot be seen in a pure function: one notification per training day no
  matter how often the app is opened *or how the day's wording changes*, and a
  dismissal that survives a reload.

  The Notification double is the real code path — jsdom has no service worker,
  so `showBrowserNudge` falls through to the constructor, which is what a
  desktop browser does.
*/

const PLAN_CREATED_AT = "2025-01-06T08:00:00.000Z";
const MONDAY = new Date("2025-01-06T11:00:00.000Z");
const WEDNESDAY = new Date("2025-01-08T11:00:00.000Z");

const exercises = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Übung ${index + 1}`, sets: 3, reps: 10 }));

/** One training day, so the weekly-consistency line stays out of the way. */
const plan = (): WorkoutPlan =>
  ({
    id: "plan-1",
    created_at: PLAN_CREATED_AT,
    content: {
      "Week 1": [
        { day: "Montag", exercises: exercises(3) },
        { day: "Dienstag", exercises: [] },
        { day: "Mittwoch", exercises: [] },
        { day: "Donnerstag", exercises: [] },
        { day: "Freitag", exercises: [] },
        { day: "Samstag", exercises: [] },
        { day: "Sonntag", exercises: [] },
      ],
    },
  }) as unknown as WorkoutPlan;

/** Monday and Wednesday, for the "the next training day still nudges" cases. */
const twoDayPlan = (): WorkoutPlan => {
  const source = plan() as unknown as { content: Record<string, { exercises: unknown[] }[]> };
  const content = JSON.parse(JSON.stringify(source.content)) as Record<
    string,
    { exercises: unknown[] }[]
  >;
  content["Week 1"][2].exercises = exercises(3);
  return { ...(plan() as object), content } as unknown as WorkoutPlan;
};

/** One ticked exercise on Monday: real progress, never a finished day. */
const oneExerciseDone: AnyWorkoutLogShape = {
  week_key: "Week 1",
  day_index: 0,
  exercise_index: 0,
  workout_day: "2025-01-06",
  completed: true,
};

let shown: string[] = [];

const stubNotification = (permission: NotificationPermission) => {
  const Notification = function (this: unknown, title: string) {
    shown.push(title);
  } as unknown as typeof window.Notification;
  (Notification as unknown as { permission: NotificationPermission }).permission = permission;
  (Notification as unknown as { requestPermission: unknown }).requestPermission = vi.fn(
    async () => permission
  );
  Object.defineProperty(window, "Notification", {
    value: Notification,
    configurable: true,
    writable: true,
  });
};

const removeNotification = () =>
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "Notification");

beforeEach(() => {
  shown = [];
  localStorage.clear();
  removeNotification();
});

afterEach(() => {
  removeNotification();
  vi.restoreAllMocks();
});

interface HookProps {
  plan: WorkoutPlan;
  logs: readonly AnyWorkoutLogShape[];
  date: Date;
}

const render = (initial: Partial<HookProps> = {}) =>
  renderHook((props: HookProps) => useTrainingNudge(props), {
    initialProps: {
      plan: initial.plan ?? plan(),
      logs: initial.logs ?? [],
      date: initial.date ?? MONDAY,
    },
  });

/** Let the delivery effect run and settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useTrainingNudge", () => {
  it("shows the in-app nudge without any browser permission", () => {
    const { result } = render();

    expect(result.current.channelState).toBe("unsupported");
    expect(result.current.nudges).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it("delivers one browser notification when permission is granted", async () => {
    stubNotification("granted");
    const { result } = render();

    await waitFor(() => expect(shown).toHaveLength(1));
    expect(result.current.channelState).toBe("granted");
  });

  it("does not deliver a second one on reload", async () => {
    stubNotification("granted");
    const first = render();
    await waitFor(() => expect(shown).toHaveLength(1));
    first.unmount();

    // Same day, same plan, app reopened: the record must still suppress it.
    render();
    await settle();
    expect(shown).toHaveLength(1);
  });

  it("delivers nothing when permission is denied, and keeps the in-app nudge", async () => {
    stubNotification("denied");
    const { result } = render();

    await settle();
    expect(shown).toEqual([]);
    expect(result.current.nudges).toHaveLength(1);
  });

  it("delivers nothing for a completed day", async () => {
    stubNotification("granted");
    const { result } = render({
      logs: [
        { week_key: "Week 1", day_index: 0, workout_day: "2025-01-06", completed: true },
      ],
    });

    await settle();
    expect(shown).toEqual([]);
    expect(result.current.nudges).toEqual([]);
    expect(result.current.evaluation.reason).toBe("day-completed");
  });

  it("requests permission only when asked to", async () => {
    stubNotification("default");
    const { result } = render();

    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.requestPermission();
    });
    expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("one browser notification per training day, whatever the wording", () => {
  /*
    The regression this suite exists for. The delivery record used to be keyed
    on plan|week|day|**type**, and the type changes mid-day: ticking a single
    exercise turns "planned-session-today" into "unfinished-session". That read
    as a nudge nobody had been shown yet, so the same person was interrupted
    twice about the same session. The key is the training day now, so the
    wording can change as often as it likes.
  */
  it("fires once for the planned session, then not again once it is under way", async () => {
    stubNotification("granted");
    const { result, rerender } = render();

    // 1. Planned session, nothing logged: one notification.
    await waitFor(() => expect(shown).toHaveLength(1));
    expect(result.current.nudges[0].type).toBe("planned-session-today");

    // 2. The user completes one exercise.
    rerender({ plan: plan(), logs: [oneExerciseDone], date: MONDAY });

    // 3. The wording changes — the day is under way but still not finished.
    await waitFor(() => expect(result.current.nudges[0].type).toBe("unfinished-session"));

    // 4. And no second notification is raised for that same training day.
    await settle();
    expect(shown).toHaveLength(1);
  });

  it("keeps the same delivery identity across that transition", async () => {
    const { result, rerender } = render();
    const before = result.current.nudges[0];

    rerender({ plan: plan(), logs: [oneExerciseDone], date: MONDAY });
    const after = result.current.nudges[0];

    // The render identity moves with the wording; the delivery identity does not.
    expect(after.key).not.toBe(before.key);
    expect(after.dayKey).toBe(before.dayKey);
  });

  it("survives a reload in the middle of the session", async () => {
    stubNotification("granted");
    const first = render();
    await waitFor(() => expect(shown).toHaveLength(1));
    first.unmount();

    // Reopened after a couple of exercises: still the same training day.
    render({ logs: [oneExerciseDone] });
    await settle();
    expect(shown).toHaveLength(1);
  });

  it("delivers again on the next planned training day", async () => {
    stubNotification("granted");
    const monday = render({ plan: twoDayPlan() });
    await waitFor(() => expect(shown).toHaveLength(1));
    monday.unmount();

    // A new day is a new plan position, so it is a new nudge.
    render({ plan: twoDayPlan(), date: WEDNESDAY });
    await waitFor(() => expect(shown).toHaveLength(2));
  });
});

describe("dismissal", () => {
  it("hides the nudge and keeps it hidden after a reload the same day", () => {
    const { result, unmount } = render();
    act(() => result.current.dismiss(result.current.nudges[0].dayKey));
    expect(result.current.nudges).toEqual([]);
    unmount();

    expect(render().result.current.nudges).toEqual([]);
  });

  it("does not come back when the wording changes", () => {
    // Dismissed before the first exercise must not reappear as "noch offen".
    const { result, rerender } = render();
    act(() => result.current.dismiss(result.current.nudges[0].dayKey));

    rerender({ plan: plan(), logs: [oneExerciseDone], date: MONDAY });
    expect(result.current.nudges).toEqual([]);
  });

  it("suppresses the browser notification for that day too", async () => {
    const { result, unmount } = render();
    act(() => result.current.dismiss(result.current.nudges[0].dayKey));
    unmount();

    stubNotification("granted");
    render();
    await settle();
    expect(shown).toEqual([]);
  });

  it("closes the day's weekly line along with the day nudge", () => {
    const { result } = render({ plan: twoDayPlan() });
    expect(result.current.nudges).toHaveLength(2);

    act(() => result.current.dismiss(result.current.nudges[0].dayKey));
    expect(result.current.nudges).toEqual([]);
  });

  it("leaves the next training day free to nudge again", async () => {
    const monday = render({ plan: twoDayPlan() });
    act(() => monday.result.current.dismiss(monday.result.current.nudges[0].dayKey));
    monday.unmount();

    stubNotification("granted");
    const wednesday = render({ plan: twoDayPlan(), date: WEDNESDAY });
    expect(wednesday.result.current.nudges.length).toBeGreaterThan(0);
    await waitFor(() => expect(shown).toHaveLength(1));
  });

  it("does not mark the workout completed", () => {
    const { result } = render({ logs: [oneExerciseDone] });
    act(() => result.current.dismiss(result.current.nudges[0].dayKey));

    /*
      A dismissal is a UI preference, not a training record. Re-evaluating the
      same day with the same logs still reports it as open, and the stored logs
      still carry no day session.
    */
    const reopened = render({ logs: [oneExerciseDone] });
    expect(reopened.result.current.evaluation.eligible).toBe(true);
    expect(reopened.result.current.evaluation.reason).toBeNull();
  });

  it("writes only to this device's nudge record", () => {
    const logs = [oneExerciseDone];
    const source = plan();
    const planBefore = JSON.stringify(source);
    const logsBefore = JSON.stringify(logs);

    const { result } = renderHook(() => useTrainingNudge({ plan: source, logs, date: MONDAY }));
    act(() => result.current.dismiss(result.current.nudges[0].dayKey));

    expect(JSON.stringify(source)).toBe(planBefore);
    expect(JSON.stringify(logs)).toBe(logsBefore);
    // The one key it may touch, and nothing else on the origin.
    expect(Object.keys(localStorage)).toEqual(["fitssai.nudges.v1"]);
  });
});

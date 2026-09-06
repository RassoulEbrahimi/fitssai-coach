import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTrainingNudge } from "./useTrainingNudge";
import type { WorkoutPlan } from "@/lib/types";

/*
  The stateful half of the nudge layer, tested through the behaviour that
  cannot be seen in a pure function: one notification per training day, no
  matter how often the app is opened, and a dismissal that survives a reload.

  The Notification double is the real code path — jsdom has no service worker,
  so `showBrowserNudge` falls through to the constructor, which is what a
  desktop browser does.
*/

const PLAN_CREATED_AT = "2025-01-06T08:00:00.000Z";
const MONDAY = new Date("2025-01-06T11:00:00.000Z");

const exercises = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Übung ${index + 1}`, sets: 3, reps: 10 }));

const plan = (): WorkoutPlan =>
  ({
    id: "plan-1",
    created_at: PLAN_CREATED_AT,
    /* One training day, so the weekly-consistency line stays out of the way. */
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

const render = (logs: unknown[] = []) =>
  renderHook(() =>
    useTrainingNudge({ plan: plan(), logs: logs as never, date: MONDAY })
  );

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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown).toHaveLength(1);
  });

  it("delivers nothing when permission is denied, and keeps the in-app nudge", async () => {
    stubNotification("denied");
    const { result } = render();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown).toEqual([]);
    expect(result.current.nudges).toHaveLength(1);
  });

  it("delivers nothing for a completed day", async () => {
    stubNotification("granted");
    const { result } = render([
      { id: "d", week_key: "Week 1", day_index: 0, workout_day: "2025-01-06", completed: true },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown).toEqual([]);
    expect(result.current.nudges).toEqual([]);
    expect(result.current.evaluation.reason).toBe("day-completed");
  });

  it("hides the nudge on dismissal, and keeps it hidden after a reload", async () => {
    const { result, unmount } = render();
    const key = result.current.nudges[0].key;

    act(() => result.current.dismiss(key));
    expect(result.current.nudges).toEqual([]);

    unmount();
    const reopened = render();
    expect(reopened.result.current.nudges).toEqual([]);
  });

  it("suppresses a browser notification the user already dismissed", async () => {
    const { result, unmount } = render();
    act(() => result.current.dismiss(result.current.nudges[0].key));
    unmount();

    stubNotification("granted");
    render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shown).toEqual([]);
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

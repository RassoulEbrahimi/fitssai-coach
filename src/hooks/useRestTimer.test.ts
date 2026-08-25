import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRestTimer } from "./useRestTimer";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rest timer set ownership", () => {
  it("a completed set starts a timer owned by that set", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 90, 1);
    });

    expect(result.current.timerState.exerciseIndex).toBe(0);
    expect(result.current.timerState.setNumber).toBe(1);
    expect(result.current.timerState.remainingSeconds).toBe(90);
    expect(result.current.isTimerOwnedBy(0, 1)).toBe(true);
  });

  it("un-completing that exact set cancels the timer", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 90, 1);
    });
    act(() => {
      result.current.cancelTimerForSet(0, 1);
    });

    expect(result.current.timerState.exerciseIndex).toBeNull();
    expect(result.current.timerState.setNumber).toBeNull();
    expect(result.current.timerState.remainingSeconds).toBe(0);
  });

  it("changing a different set does not cancel the running timer", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 90, 1);
    });

    act(() => {
      // A different set of the same exercise…
      result.current.cancelTimerForSet(0, 2);
    });
    expect(result.current.timerState.setNumber).toBe(1);
    expect(result.current.timerState.remainingSeconds).toBe(90);

    act(() => {
      // …and the same set number on a different exercise.
      result.current.cancelTimerForSet(1, 1);
    });
    expect(result.current.timerState.exerciseIndex).toBe(0);
    expect(result.current.timerState.setNumber).toBe(1);
  });

  it("ownership follows the most recent set to start a timer", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 90, 1);
    });
    act(() => {
      result.current.startTimer(0, 60, 2);
    });

    expect(result.current.isTimerOwnedBy(0, 2)).toBe(true);
    expect(result.current.isTimerOwnedBy(0, 1)).toBe(false);

    // Un-completing the now-superseded set must not stop set 2's timer.
    act(() => {
      result.current.cancelTimerForSet(0, 1);
    });
    expect(result.current.timerState.setNumber).toBe(2);
    expect(result.current.timerState.remainingSeconds).toBe(60);
  });

  it("survives rapid toggles without cancelling the wrong timer", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 90, 1);
      result.current.cancelTimerForSet(0, 2);
      result.current.startTimer(0, 45, 3);
      result.current.cancelTimerForSet(0, 1);
    });

    expect(result.current.isTimerOwnedBy(0, 3)).toBe(true);
    expect(result.current.timerState.remainingSeconds).toBe(45);
  });

  it("counts down and clears ownership when finished", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(0, 2, 1);
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.timerState.isComplete).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(result.current.timerState.exerciseIndex).toBeNull();
    expect(result.current.isTimerOwnedBy(0, 1)).toBe(false);
  });

  it("skipTimer clears any owner", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(2, 90, 4);
    });
    act(() => {
      result.current.skipTimer();
    });

    expect(result.current.isTimerOwnedBy(2, 4)).toBe(false);
    expect(result.current.timerState.exerciseIndex).toBeNull();
  });

  it("isTimerActiveFor still reports per exercise", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => {
      result.current.startTimer(1, 30, 2);
    });

    expect(result.current.isTimerActiveFor(1)).toBe(true);
    expect(result.current.isTimerActiveFor(0)).toBe(false);
  });
});

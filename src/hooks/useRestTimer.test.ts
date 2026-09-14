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

const SESSION = { version: 1, planId: 'p1', weekKey: 'Week 1', dayIndex: 0, workoutDay: '2026-09-14', startedAt: 1000 };
const REST_KEY = 'fitssai.training.rest:u1';

describe('deadline controller and recovery', () => {
  beforeEach(() => localStorage.clear());
  const mount = () => renderHook(() => useRestTimer('u1', SESSION));

  it('auto-opens, dismisses and reopens without changing its deadline', () => {
    const { result } = mount();
    act(() => result.current.startTimer(0, 90, 2));
    const deadline = result.current.timerState.deadlineMs;
    expect(result.current.isSheetOpen).toBe(true);
    act(() => result.current.setSheetOpen(false));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.timerState.remainingSeconds).toBe(85);
    act(() => result.current.setSheetOpen(true));
    expect(result.current.timerState.deadlineMs).toBe(deadline);
  });

  it.each(['focus', 'visibilitychange', 'interval'])('reconciles a suspended clock on %s', (event) => {
    const { result } = mount();
    act(() => result.current.startTimer(1, 90, 1));
    act(() => {
      vi.setSystemTime(Date.now() + 65000);
      if (event === 'interval') vi.advanceTimersByTime(250);
      else (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });
    expect(result.current.timerState.remainingSeconds).toBe(25);
    act(() => {
      vi.setSystemTime(Date.now() + 60000);
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current.timerState).toMatchObject({ status: 'finished', remainingSeconds: 0 });
    expect(result.current.isSheetOpen).toBe(false);
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });

  it('pauses at the current clock, adjusts only this interval and resumes from that value', () => {
    const { result } = mount();
    act(() => result.current.startTimer(0, 90, 1));
    act(() => {
      vi.setSystemTime(Date.now() + 10000);
      result.current.pauseTimer();
    });
    expect(result.current.timerState).toMatchObject({ status: 'paused', remainingSeconds: 80, deadlineMs: null });
    act(() => vi.advanceTimersByTime(120000));
    expect(result.current.timerState.remainingSeconds).toBe(80);
    act(() => result.current.adjustTimer(15));
    expect(result.current.timerState.remainingSeconds).toBe(95);
    act(() => result.current.adjustTimer(-15));
    expect(result.current.timerState.totalRestSeconds).toBe(90);
    act(() => result.current.resumeTimer());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.timerState.remainingSeconds).toBe(75);
  });

  it.each([false, true])('clamps adjustments at zero and completes (paused: %s)', (paused) => {
    const { result } = mount();
    act(() => result.current.startTimer(0, 10, 1));
    if (paused) act(() => result.current.pauseTimer());
    act(() => result.current.adjustTimer(15));
    expect(result.current.timerState.remainingSeconds).toBe(25);
    expect(result.current.timerState.totalRestSeconds).toBe(10);
    act(() => { result.current.adjustTimer(-15); result.current.adjustTimer(-15); });
    expect(result.current.timerState.remainingSeconds).toBe(0);
    expect(result.current.timerState.status).toBe('finished');
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('never resurrects expired rest from a stale +15 or pause click', () => {
    const { result } = mount();
    act(() => result.current.startTimer(0, 10, 1));
    act(() => { vi.setSystemTime(Date.now() + 11000); result.current.adjustTimer(15); });
    expect(result.current.timerState.status).toBe('finished');
  });

  it.each([1, 2])('an old failure cannot cancel a new timer, even for set %s', (setNumber) => {
    const { result } = mount();
    let rollback!: () => void;
    act(() => { rollback = result.current.startTimer(0, 60, 1); });
    act(() => result.current.startTimer(0, 90, setNumber));
    act(() => rollback());
    expect(result.current.timerState).toMatchObject({ status: 'running', setNumber, remainingSeconds: 90 });
  });

  it('rolls back the current failed completion only', () => {
    const { result } = mount();
    let rollback!: () => void;
    act(() => { rollback = result.current.startTimer(0, 60, 1); });
    act(() => rollback());
    expect(result.current.timerState.status).toBe('idle');
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });

  it.each([false, true])('restores same-session running/paused rest (paused: %s)', (paused) => {
    const first = mount();
    act(() => first.result.current.startTimer(1, 90, 2));
    act(() => vi.advanceTimersByTime(10000));
    if (paused) act(() => first.result.current.pauseTimer());
    first.unmount();
    act(() => vi.advanceTimersByTime(20000));
    const { result } = mount();
    expect(result.current.timerState).toMatchObject({ status: paused ? 'paused' : 'running', exerciseIndex: 1, setNumber: 2, remainingSeconds: paused ? 80 : 60 });
    expect(result.current.isSheetOpen).toBe(false);
  });

  it('discards an expired deadline on reload', () => {
    const first = mount();
    act(() => first.result.current.startTimer(0, 10, 1));
    first.unmount();
    vi.setSystemTime(Date.now() + 20000);
    const { result } = mount();
    expect(result.current.timerState.status).toBe('idle');
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });

  it.each([
    { planId: 'p2' }, { weekKey: 'Week 2' }, { dayIndex: 1 },
    { workoutDay: '2026-09-15' }, { startedAt: 2000 },
  ])('discards a different session %j', (change) => {
    const first = mount();
    act(() => first.result.current.startTimer(0, 90, 1));
    first.unmount();
    const { result } = renderHook(() => useRestTimer('u1', { ...SESSION, ...change }));
    expect(result.current.timerState.status).toBe('idle');
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });

  it('isolates accounts and invalidates callbacks across session transitions', () => {
    const { result, rerender } = renderHook(({ uid, session }) => useRestTimer(uid, session), { initialProps: { uid: 'u1', session: SESSION } });
    let rollback!: () => void;
    act(() => { rollback = result.current.startTimer(0, 90, 1); });
    rerender({ uid: 'u2', session: SESSION });
    expect(result.current.timerState.status).toBe('idle');
    act(() => result.current.startTimer(0, 60, 1));
    act(() => rollback());
    expect(result.current.timerState.remainingSeconds).toBe(60);
  });

  it.each(['{broken', 'null', '{"version":9}', '{"version":1,"state":{}}'])('ignores malformed storage %s', (raw) => {
    localStorage.setItem(REST_KEY, raw);
    const { result } = mount();
    expect(result.current.timerState.status).toBe('idle');
    expect(localStorage.getItem(REST_KEY)).toBeNull();
  });

  it('keeps working when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = mount();
    act(() => result.current.startTimer(0, 90, 1));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.timerState.remainingSeconds).toBe(89);
    spy.mockRestore();
  });
});

it('a failure from an unmounted card cannot erase a replacement card recovery', () => {
  localStorage.clear();
  const first = renderHook(() => useRestTimer('u1', SESSION));
  let rollback!: () => void;
  act(() => { rollback = first.result.current.startTimer(0, 60, 1); });
  first.unmount();
  const next = renderHook(() => useRestTimer('u1', SESSION));
  act(() => next.result.current.startTimer(0, 90, 2));
  const saved = localStorage.getItem(REST_KEY);
  act(() => rollback());
  expect(localStorage.getItem(REST_KEY)).toBe(saved);
  expect(next.result.current.timerState.setNumber).toBe(2);
});

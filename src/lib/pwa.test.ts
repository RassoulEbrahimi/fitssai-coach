import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, schedulePeriodicUpdate } from "./pwa";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("schedulePeriodicUpdate", () => {
  it("asks the registration to re-check on an interval", () => {
    const update = vi.fn();

    schedulePeriodicUpdate({ update }, 1000);

    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("stops checking once the returned cleanup runs", () => {
    const update = vi.fn();

    const stop = schedulePeriodicUpdate({ update }, 1000);
    vi.advanceTimersByTime(1000);
    stop();
    vi.advanceTimersByTime(5000);

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("survives a registration that throws while offline", () => {
    const update = vi.fn(() => {
      throw new Error("offline");
    });

    schedulePeriodicUpdate({ update }, 1000);

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("is a no-op without a usable registration", () => {
    expect(() => schedulePeriodicUpdate(undefined)()).not.toThrow();
    expect(() =>
      schedulePeriodicUpdate({ update: undefined as unknown as () => void })()
    ).not.toThrow();
  });

  it("defaults to an hourly check", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

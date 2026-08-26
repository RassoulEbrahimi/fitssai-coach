import { describe, it, expect } from "vitest";
import {
  MAX_SESSION_SEC,
  computeDurationSec,
  isWorkoutDayString,
  readDurationSec,
  summariseMeasuredDuration,
  toWorkoutDay,
} from "./workoutLog";

const AT = (iso: string) => new Date(iso).getTime();

describe("computeDurationSec", () => {
  it("derives whole seconds from the start and end instants", () => {
    const start = AT("2026-03-10T18:00:00Z");
    const end = AT("2026-03-10T18:42:30Z");

    expect(computeDurationSec(start, end)).toBe(2550);
  });

  it("is unaffected by how long the page was open, only by elapsed clock time", () => {
    // A reload mid-session keeps the original startedAt, so a session that
    // began an hour ago still measures an hour.
    const start = AT("2026-03-10T18:00:00Z");

    expect(computeDurationSec(start, AT("2026-03-10T19:00:00Z"))).toBe(3600);
  });

  it("rejects a missing start rather than reporting zero", () => {
    // 0 would be a measurement claim: "trained for no time".
    expect(computeDurationSec(null, AT("2026-03-10T18:00:00Z"))).toBeNull();
    expect(computeDurationSec(undefined, AT("2026-03-10T18:00:00Z"))).toBeNull();
    expect(computeDurationSec(0, AT("2026-03-10T18:00:00Z"))).toBeNull();
  });

  it("never returns a negative duration for a start in the future", () => {
    const result = computeDurationSec(AT("2026-03-10T20:00:00Z"), AT("2026-03-10T18:00:00Z"));

    expect(result).toBeNull();
    expect(result === null || result >= 0).toBe(true);
  });

  it("rejects an implausibly long span", () => {
    const start = AT("2026-03-10T08:00:00Z");

    expect(computeDurationSec(start, start + (MAX_SESSION_SEC + 1) * 1000)).toBeNull();
    expect(computeDurationSec(start, start + MAX_SESSION_SEC * 1000)).toBe(MAX_SESSION_SEC);
  });

  it("is stable when the same end is computed twice", () => {
    // Ending twice must not accumulate: the value is absolute, not additive.
    const start = AT("2026-03-10T18:00:00Z");
    const end = AT("2026-03-10T18:30:00Z");

    expect(computeDurationSec(start, end)).toBe(computeDurationSec(start, end));
    expect(computeDurationSec(start, end)).toBe(1800);
  });

  it("rejects non-finite inputs", () => {
    expect(computeDurationSec(Number.NaN, AT("2026-03-10T18:00:00Z"))).toBeNull();
    expect(computeDurationSec(AT("2026-03-10T18:00:00Z"), Number.NaN)).toBeNull();
  });
});

describe("toWorkoutDay", () => {
  it("formats YYYY-MM-DD", () => {
    expect(toWorkoutDay(new Date("2026-03-10T12:00:00Z"))).toBe("2026-03-10");
  });

  it("uses the Berlin day, not the UTC day, just before local midnight", () => {
    // 23:30 Berlin on 10 March is 22:30 UTC the same day; the point is that a
    // time which is already the next day in some zones stays on the Berlin day.
    expect(toWorkoutDay(new Date("2026-03-10T22:30:00Z"))).toBe("2026-03-10");
  });

  it("rolls to the next Berlin day after local midnight", () => {
    // 23:30 UTC on 10 March is 00:30 on 11 March in Berlin (UTC+1).
    expect(toWorkoutDay(new Date("2026-03-10T23:30:00Z"))).toBe("2026-03-11");
  });

  it("crosses the December → January boundary correctly", () => {
    // 23:30 UTC on 31 Dec is 00:30 on 1 Jan in Berlin — new day, month & year.
    expect(toWorkoutDay(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(toWorkoutDay(new Date("2025-12-31T12:00:00Z"))).toBe("2025-12-31");
  });

  it("handles summer time, when Berlin is UTC+2", () => {
    // 22:30 UTC on 15 July is already 00:30 on 16 July in Berlin.
    expect(toWorkoutDay(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
  });
});

describe("isWorkoutDayString", () => {
  it("accepts a canonical date", () => {
    expect(isWorkoutDayString("2026-01-01")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["2026-1-1", "01-01-2026", "", "today", null, undefined, 20260101]) {
      expect(isWorkoutDayString(value)).toBe(false);
    }
  });
});

describe("readDurationSec", () => {
  it("passes through a plausible measurement", () => {
    expect(readDurationSec(1800)).toBe(1800);
  });

  it("treats a legacy document with no duration as unmeasured, not zero", () => {
    expect(readDurationSec(undefined)).toBeNull();
    expect(readDurationSec(null)).toBeNull();
  });

  it("rejects junk without throwing", () => {
    for (const value of [0, -5, Number.NaN, "1800", {}, MAX_SESSION_SEC + 1]) {
      expect(readDurationSec(value)).toBeNull();
    }
  });
});

describe("summariseMeasuredDuration", () => {
  it("sums only measured durations", () => {
    const summary = summariseMeasuredDuration([
      { durationSec: 1800 },
      { durationSec: 900 },
    ]);

    expect(summary).toEqual({ measuredMinutes: 45, measuredCount: 2, unmeasuredCount: 0 });
  });

  it("counts legacy logs separately instead of adding zero minutes", () => {
    const summary = summariseMeasuredDuration([
      { durationSec: 1800 },
      { durationSec: undefined },
      { durationSec: null },
    ]);

    // 30 minutes is a floor across three workouts, not the period's total.
    expect(summary.measuredMinutes).toBe(30);
    expect(summary.measuredCount).toBe(1);
    expect(summary.unmeasuredCount).toBe(2);
  });

  it("reports nothing measured for an all-legacy history", () => {
    const summary = summariseMeasuredDuration([{ durationSec: null }, { durationSec: null }]);

    expect(summary.measuredMinutes).toBe(0);
    expect(summary.measuredCount).toBe(0);
    expect(summary.unmeasuredCount).toBe(2);
  });
});

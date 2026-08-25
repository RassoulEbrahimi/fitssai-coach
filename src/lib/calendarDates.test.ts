import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { format } from "date-fns";
import {
  getCalendarWeekDates,
  getCalendarDayIndex,
  isCalendarToday,
  shiftCalendarWeeks,
  toCalendarDateString,
  getWorkoutDate,
  getWorkoutWeekDay,
} from "./workoutDateUtils";

/** Deterministic clock: never depend on the machine's real date. */
const freeze = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  vi.useRealTimers();
});

const iso = (d: Date) => format(d, "yyyy-MM-dd");

describe("getCalendarWeekDates", () => {
  it("returns Monday through Sunday of the week containing the date", () => {
    // 2026-08-25 is a Tuesday.
    const week = getCalendarWeekDates(new Date(2026, 7, 25));

    expect(week).toHaveLength(7);
    expect(week.map(iso)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("is stable for every day of the same week", () => {
    const fromMonday = getCalendarWeekDates(new Date(2026, 7, 24)).map(iso);
    const fromSunday = getCalendarWeekDates(new Date(2026, 7, 30)).map(iso);
    expect(fromSunday).toEqual(fromMonday);
  });

  it("spans a month boundary without changing month of the selected date", () => {
    // 2026-09-01 is a Tuesday; its week starts in August.
    const week = getCalendarWeekDates(new Date(2026, 8, 1));
    expect(iso(week[0])).toBe("2026-08-31");
    expect(iso(week[6])).toBe("2026-09-06");
  });

  it("spans the December → January year boundary", () => {
    // 2026-12-31 is a Thursday.
    const week = getCalendarWeekDates(new Date(2026, 11, 31));
    expect(iso(week[0])).toBe("2026-12-28");
    expect(iso(week[6])).toBe("2027-01-03");
    expect(format(week[6], "MMM yyyy")).toContain("2027");
  });
});

describe("getCalendarDayIndex", () => {
  it("is Monday-based", () => {
    expect(getCalendarDayIndex(new Date(2026, 7, 24))).toBe(0); // Monday
    expect(getCalendarDayIndex(new Date(2026, 7, 25))).toBe(1); // Tuesday
    expect(getCalendarDayIndex(new Date(2026, 7, 30))).toBe(6); // Sunday
  });

  it("agrees with the week array", () => {
    const date = new Date(2026, 7, 27);
    const week = getCalendarWeekDates(date);
    expect(iso(week[getCalendarDayIndex(date)])).toBe(iso(date));
  });
});

describe("shiftCalendarWeeks", () => {
  it("moves whole weeks and keeps the weekday", () => {
    const tuesday = new Date(2026, 7, 25);
    expect(iso(shiftCalendarWeeks(tuesday, -1))).toBe("2026-08-18");
    expect(iso(shiftCalendarWeeks(tuesday, 1))).toBe("2026-09-01");
    expect(getCalendarDayIndex(shiftCalendarWeeks(tuesday, 5))).toBe(1);
  });

  it("crosses the year boundary backwards and forwards", () => {
    expect(iso(shiftCalendarWeeks(new Date(2027, 0, 5), -1))).toBe("2026-12-29");
    expect(iso(shiftCalendarWeeks(new Date(2026, 11, 29), 1))).toBe("2027-01-05");
  });
});

describe("isCalendarToday", () => {
  beforeEach(() => freeze("2026-08-25T09:00:00+02:00"));

  it("recognises today", () => {
    expect(isCalendarToday(new Date(2026, 7, 25))).toBe(true);
  });

  it("rejects other days", () => {
    expect(isCalendarToday(new Date(2026, 7, 24))).toBe(false);
    expect(isCalendarToday(new Date(2025, 10, 25))).toBe(false);
  });

  it("still reports the Berlin day just before local midnight", () => {
    vi.setSystemTime(new Date("2026-08-25T23:30:00+02:00"));
    expect(isCalendarToday(new Date(2026, 7, 25))).toBe(true);
    expect(isCalendarToday(new Date(2026, 7, 26))).toBe(false);
  });
});

describe("calendar display is independent of plan.created_at", () => {
  const PLAN_CREATED = "2025-11-03T10:00:00.000Z"; // a Monday in November 2025

  it("shows the current month/year, not the plan's", () => {
    // Regression: the header read "Nov. 2025" while the real date was in 2026.
    const today = new Date(2026, 7, 25);

    const week = getCalendarWeekDates(today);

    expect(format(week[getCalendarDayIndex(today)], "MMM yyyy")).toContain("2026");
    for (const date of week) {
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(7); // August
    }
  });

  it("differs from the plan-anchored date the old header used", () => {
    const today = new Date(2026, 7, 25);

    // What the plan grid resolves for the same date: clamped to Week 4, which
    // lands back in the plan's own month.
    const { weekKey } = getWorkoutWeekDay(PLAN_CREATED, today);
    const planAnchored = getWorkoutDate(PLAN_CREATED, weekKey, 0);

    expect(weekKey).toBe("Week 4");
    expect(planAnchored.getFullYear()).toBe(2025);
    expect(getCalendarWeekDates(today)[0].getFullYear()).toBe(2026);
  });

  it("keeps the date → plan-day mapping untouched", () => {
    // The product meaning of a selected workout date is unchanged: the same
    // real date still resolves to the same plan week and day as before.
    const inPlan = new Date(2025, 10, 5); // Wednesday of plan week 1
    const resolved = getWorkoutWeekDay(PLAN_CREATED, inPlan);

    expect(resolved.weekKey).toBe("Week 1");
    expect(resolved.dayIndex).toBe(2);
    expect(toCalendarDateString(getCalendarWeekDates(inPlan)[resolved.dayIndex])).toBe(
      "2025-11-05"
    );
  });
});

describe("deep-link restoration (#/workout?w=&d=)", () => {
  const PLAN_CREATED = "2025-11-03T10:00:00.000Z"; // Monday, plan week 1

  it("still resolves a deep link to the same plan day as before", () => {
    // Dashboard turns ?w=2&d=3 into a date via getWorkoutDate; unchanged.
    const target = getWorkoutDate(PLAN_CREATED, "Week 2", 3);
    expect(toCalendarDateString(target)).toBe("2025-11-13"); // Thursday of week 2

    const roundTrip = getWorkoutWeekDay(PLAN_CREATED, target);
    expect(roundTrip.weekKey).toBe("Week 2");
    expect(roundTrip.dayIndex).toBe(3);
  });

  it("displays the deep-linked day inside its own real calendar week", () => {
    const target = getWorkoutDate(PLAN_CREATED, "Week 2", 3);

    const week = getCalendarWeekDates(target);
    const index = getCalendarDayIndex(target);

    expect(index).toBe(3);
    expect(toCalendarDateString(week[index])).toBe(toCalendarDateString(target));
    expect(format(week[index], "MMM yyyy")).toContain("2025");
  });

  it("round-trips every week/day a deep link may carry", () => {
    for (let week = 1; week <= 4; week += 1) {
      for (let day = 0; day <= 6; day += 1) {
        const target = getWorkoutDate(PLAN_CREATED, `Week ${week}`, day);
        const resolved = getWorkoutWeekDay(PLAN_CREATED, target);

        expect(resolved.weekKey).toBe(`Week ${week}`);
        expect(resolved.dayIndex).toBe(day);
        // And the calendar places it on the matching weekday.
        expect(getCalendarDayIndex(target)).toBe(day);
      }
    }
  });
});

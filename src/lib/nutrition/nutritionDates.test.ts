import { afterEach, describe, it, expect, vi } from "vitest";
import {
  NUTRITION_TIMEZONE,
  addNutritionDays,
  assertNutritionDate,
  isNutritionDate,
  nutritionDateAt,
} from "@shared/nutrition";
import { PLAN_TIMEZONE } from "@shared/planWeek";
import { getBerlinToday } from "@/lib/dateUtils";

/*
  Nutrition dates are Berlin calendar days. The instants below sit one second
  either side of Berlin midnight on ordinary days and on both 2026 DST switches
  (29 March: 02:00 CET -> 03:00 CEST; 25 October: 03:00 CEST -> 02:00 CET).
*/

describe("isNutritionDate", () => {
  it.each(["2026-01-01", "2026-12-31", "2028-02-29", "2026-03-29", "2026-10-25"])("accepts %s", (value) => {
    expect(isNutritionDate(value)).toBe(true);
  });

  it.each([
    "2026-02-29", // not a leap year
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-4-01",
    "26-04-01",
    "2026/04/01",
    "2026-04-01T00:00:00Z",
    " 2026-04-01",
    "",
    "Montag",
  ])("rejects %j", (value) => {
    expect(isNutritionDate(value)).toBe(false);
  });

  it.each([null, undefined, 20260401, new Date("2026-04-01")])("rejects non-string %j", (value) => {
    expect(isNutritionDate(value)).toBe(false);
  });

  it("assertNutritionDate throws on a malformed date", () => {
    expect(() => assertNutritionDate("2026-02-30")).toThrow(RangeError);
    expect(assertNutritionDate("2026-02-28")).toBe("2026-02-28");
  });
});

describe("nutritionDateAt", () => {
  it("uses the training plan's timezone, not a second definition", () => {
    expect(NUTRITION_TIMEZONE).toBe(PLAN_TIMEZONE);
    expect(NUTRITION_TIMEZONE).toBe("Europe/Berlin");
  });

  it.each([
    // Ordinary winter midnight (CET, UTC+1).
    ["2026-01-14T22:59:59Z", "2026-01-14"],
    ["2026-01-14T23:00:00Z", "2026-01-15"],
    // Ordinary summer midnight (CEST, UTC+2).
    ["2026-07-14T21:59:59Z", "2026-07-14"],
    ["2026-07-14T22:00:00Z", "2026-07-15"],
    // Midnight into the spring-forward day (still CET).
    ["2026-03-28T22:59:59Z", "2026-03-28"],
    ["2026-03-28T23:00:00Z", "2026-03-29"],
    // Across the switch itself: 00:59:59Z is 01:59:59 CET, 01:00:00Z is 03:00 CEST.
    ["2026-03-29T00:59:59Z", "2026-03-29"],
    ["2026-03-29T01:00:00Z", "2026-03-29"],
    // Midnight out of the 23-hour day (now CEST).
    ["2026-03-29T21:59:59Z", "2026-03-29"],
    ["2026-03-29T22:00:00Z", "2026-03-30"],
    // Midnight into the fall-back day (still CEST).
    ["2026-10-24T21:59:59Z", "2026-10-24"],
    ["2026-10-24T22:00:00Z", "2026-10-25"],
    // Midnight out of the 25-hour day (now CET).
    ["2026-10-25T22:59:59Z", "2026-10-25"],
    ["2026-10-25T23:00:00Z", "2026-10-26"],
    // New year in Berlin while it is still the old year in UTC.
    ["2026-12-31T23:30:00Z", "2027-01-01"],
  ])("files %s under %s", (instant, expected) => {
    expect(nutritionDateAt(new Date(instant))).toBe(expected);
  });

  it("refuses an invalid Date", () => {
    expect(() => nutritionDateAt(new Date("not a date"))).toThrow(RangeError);
  });
});

describe("the client's Berlin today agrees with nutritionDateAt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "2026-01-14T22:59:59Z",
    "2026-01-14T23:00:00Z",
    "2026-03-28T23:00:00Z",
    "2026-03-29T21:59:59Z",
    "2026-03-29T22:00:00Z",
    "2026-10-24T22:00:00Z",
    "2026-10-25T22:59:59Z",
    "2026-10-25T23:00:00Z",
  ])("at %s", (instant) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(instant));

    expect(getBerlinToday()).toBe(nutritionDateAt(new Date()));
  });
});

describe("addNutritionDays", () => {
  it.each([
    ["2026-03-28", 1, "2026-03-29"],
    ["2026-03-28", 2, "2026-03-30"], // across the 23-hour day
    ["2026-10-24", 1, "2026-10-25"],
    ["2026-10-24", 2, "2026-10-26"], // across the 25-hour day
    ["2026-10-26", -2, "2026-10-24"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-02-28", 1, "2026-03-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-05-10", 0, "2026-05-10"],
    ["2026-01-01", 365, "2027-01-01"],
  ])("%s %+d day(s) is %s", (date, days, expected) => {
    expect(addNutritionDays(date, days)).toBe(expected);
  });

  it("rejects a malformed date or a fractional day count", () => {
    expect(() => addNutritionDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addNutritionDays("2026-02-01", 0.5)).toThrow(RangeError);
    expect(() => addNutritionDays("2026-02-01", Number.NaN)).toThrow(RangeError);
  });
});

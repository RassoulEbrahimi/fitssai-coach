import { PLAN_TIMEZONE, berlinIsoDate } from "../planWeek";

/**
 * Nutrition calendar dates.
 *
 * Every Nutrition V2 record is filed under a local calendar day written as
 * `YYYY-MM-DD` — never an instant, never a weekday label. The day is the
 * Berlin day, and it is decided by the same helper the training plan uses
 * (`berlinIsoDate` in `shared/planWeek.ts`), so Nutrition has no Berlin
 * "today" of its own that could disagree with Training's.
 *
 * Nothing here reads a clock: "today" is `nutritionDateAt(now)` with `now`
 * supplied by the caller's environment.
 */

/** Nutrition days are Berlin days — the timezone the training plan uses. */
export const NUTRITION_TIMEZONE = PLAN_TIMEZONE;

/** A local calendar day, `YYYY-MM-DD`. Validate with `isNutritionDate`. */
export type NutritionDate = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 86_400_000;

/** Epoch milliseconds of UTC midnight for a calendar day, or null if it is not a real day. */
const utcMidnight = (value: string): number | null => {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // Date rolls 2026-02-30 over into March; a day that does not survive the
  // round trip does not exist.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.getTime();
};

const formatUtcDay = (ms: number): NutritionDate => {
  const date = new Date(ms);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** True for a real calendar day written exactly as `YYYY-MM-DD`. */
export const isNutritionDate = (value: unknown): value is NutritionDate =>
  typeof value === "string" && utcMidnight(value) !== null;

/** Throws unless `value` is a valid Nutrition date. */
export const assertNutritionDate = (value: unknown, label = "date"): NutritionDate => {
  if (!isNutritionDate(value)) {
    throw new RangeError(`${label} must be a calendar date formatted YYYY-MM-DD`);
  }
  return value;
};

/**
 * The Nutrition date an instant falls on: its Berlin calendar day.
 *
 * Throws on an invalid `Date` rather than filing anything under a guess.
 */
export const nutritionDateAt = (instant: Date): NutritionDate => {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new RangeError("instant must be a valid Date");
  }
  return berlinIsoDate(instant);
};

/**
 * Calendar arithmetic on Nutrition dates.
 *
 * Works on the dates themselves, not on instants, so a 23- or 25-hour day at a
 * DST switch still moves exactly one day.
 */
export const addNutritionDays = (date: NutritionDate, days: number): NutritionDate => {
  const start = utcMidnight(assertNutritionDate(date));
  if (!Number.isInteger(days)) {
    throw new RangeError("days must be a whole number");
  }
  return formatUtcDay((start as number) + days * MS_PER_DAY);
};

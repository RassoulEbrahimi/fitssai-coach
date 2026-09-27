import type { ZodIssue } from "zod";
import {
  NUTRITION_PLAN_DAY_COUNT,
  nutritionPlanContentSchema,
  nutritionPlanSchema,
  type NutritionPlan,
  type NutritionPlanContent,
  type NutritionPlanLifecycle,
} from "./contracts";
import { addNutritionDays, assertNutritionDate, type NutritionDate } from "./dates";

/**
 * The pure rules of a persisted Nutrition V2 base plan, shared by every slice
 * that persists or reads one (NUT-09 repeat, NUT-10 slot heads, NUT-11
 * generation). No Firestore, no React, no Node or browser API, no clock.
 *
 *   assertNutritionPlanStructure  the structural hard rules (the schema), for a
 *                                 persisted plan or (…ContentStructure) its content
 *   assertPlanTransition          the only change a persisted plan may undergo
 *   supersedeNutritionPlan        that change, derived for a successor
 *   planOwnsDate                  which base plan a calendar date belongs to
 *   buildRepeatedPlanContent      the next week's base content, repeated
 *
 * Structure is not approval: a plan that passes these rules has the right
 * shape, and whether it is acceptable for a target is plan-validation policy,
 * decided on the server.
 */

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

export class NutritionPlanStructureError extends Error {
  readonly issues: readonly ZodIssue[];

  constructor(issues: readonly ZodIssue[]) {
    super("The value is not a structurally valid Nutrition plan.");
    this.name = "NutritionPlanStructureError";
    this.issues = issues;
  }
}

/** The plan, parsed, or a `NutritionPlanStructureError`. The input is not changed. */
export const assertNutritionPlanStructure = (value: unknown): NutritionPlan => {
  const parsed = nutritionPlanSchema.safeParse(value);
  if (!parsed.success) throw new NutritionPlanStructureError(parsed.error.issues);
  return parsed.data;
};

/**
 * A plan's base content alone, parsed by the same structural rules, or a
 * `NutritionPlanStructureError`. The result is a fresh copy; the input is not
 * changed.
 */
export const assertNutritionPlanContentStructure = (value: unknown): NutritionPlanContent => {
  const parsed = nutritionPlanContentSchema.safeParse(value);
  if (!parsed.success) throw new NutritionPlanStructureError(parsed.error.issues);
  return parsed.data;
};

/* ------------------------------------------------------------------ *
 * Transition
 * ------------------------------------------------------------------ */

export type NutritionPlanTransitionViolation =
  /** Either side is not a structurally valid plan. */
  | "malformed"
  /** Only an active plan can change, and only once. */
  | "notActive"
  /** The one change is to `superseded`. */
  | "notSuperseded"
  /** A field other than `lifecycle` differs. */
  | "immutableFieldChanged";

export class NutritionPlanTransitionError extends Error {
  readonly violation: NutritionPlanTransitionViolation;
  /** For `immutableFieldChanged`: the top-level field that differs. */
  readonly field: string | null;

  constructor(violation: NutritionPlanTransitionViolation, detail: string, field: string | null = null) {
    super(`Invalid NutritionPlan transition (${violation}): ${detail}`);
    this.name = "NutritionPlanTransitionError";
    this.violation = violation;
    this.field = field;
  }
}

/** Structural equality of two parsed JSON values; key order does not matter, `-0` is not `0`. */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => sameValue(item, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]))
  );
};

const parseForTransition = (value: unknown, side: string): NutritionPlan => {
  try {
    return assertNutritionPlanStructure(value);
  } catch {
    throw new NutritionPlanTransitionError("malformed", `the ${side} plan is not a valid NutritionPlan`);
  }
};

/**
 * The one change a persisted plan may undergo: `before` is active, `after` is
 * the same plan superseded, and nothing but `lifecycle` differs — not a date,
 * a slot, a meal, a value, the target, the source, the validation provenance
 * or a timestamp. A superseded plan never changes again: not back to active,
 * not to another `effectiveUntil` or successor.
 *
 * Throws a `NutritionPlanTransitionError`; returns nothing. Neither input is
 * changed.
 */
export const assertPlanTransition = (before: unknown, after: unknown): void => {
  const from = parseForTransition(before, "previous");
  const to = parseForTransition(after, "next");

  if (from.lifecycle.status !== "active") {
    throw new NutritionPlanTransitionError("notActive", "a superseded plan is final");
  }
  if (to.lifecycle.status !== "superseded") {
    throw new NutritionPlanTransitionError("notSuperseded", "an active plan can only become superseded");
  }

  const fields = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const field of fields) {
    if (field === "lifecycle") continue;
    if (!sameValue((from as Record<string, unknown>)[field], (to as Record<string, unknown>)[field])) {
      throw new NutritionPlanTransitionError("immutableFieldChanged", `${field} is immutable`, field);
    }
  }
};

/* ------------------------------------------------------------------ *
 * Superseding
 * ------------------------------------------------------------------ */

/** The successor a plan is superseded by: its id and its first date. */
export interface NutritionPlanSuccessor {
  planId: string;
  startDate: NutritionDate;
}

/**
 * The lifecycle `plan` takes when `successor` is activated: it keeps its dates
 * up to the day before the successor starts, and never beyond its own end.
 *
 *   effectiveUntil = min(plan.endDate, successor.startDate - 1 day)
 *
 * A successor starting tomorrow leaves the old plan today; a successor starting
 * after the old week leaves it the whole week. A successor that would leave it
 * no date at all (starting on or before its first date) is refused: two plans
 * never own the same date, and a plan never owns nothing.
 */
export const supersededLifecycleFor = (plan: NutritionPlan, successor: NutritionPlanSuccessor): NutritionPlanLifecycle => {
  if (plan.lifecycle.status !== "active") {
    throw new NutritionPlanTransitionError("notActive", "a superseded plan is final");
  }
  if (successor.planId === plan.planId) {
    throw new NutritionPlanTransitionError("notSuperseded", "a plan cannot supersede itself");
  }
  const dayBefore = addNutritionDays(assertNutritionDate(successor.startDate, "successor.startDate"), -1);
  const effectiveUntil = dayBefore < plan.endDate ? dayBefore : plan.endDate;
  if (effectiveUntil < plan.startDate) {
    throw new NutritionPlanTransitionError("notSuperseded", "the successor would leave the plan no date of its own");
  }
  return { status: "superseded", effectiveUntil, supersededByPlanId: successor.planId };
};

/**
 * `plan` superseded by `successor`: a new object with only the lifecycle
 * changed, checked by `assertPlanTransition`. `plan` is not changed.
 */
export const supersedeNutritionPlan = (plan: NutritionPlan, successor: NutritionPlanSuccessor): NutritionPlan => {
  const superseded = { ...plan, lifecycle: supersededLifecycleFor(plan, successor) };
  assertPlanTransition(plan, superseded);
  return superseded;
};

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

/**
 * The last calendar date a base plan owns: its `endDate` while active, its
 * `effectiveUntil` once superseded.
 */
export const planOwnedUntil = (plan: Pick<NutritionPlan, "endDate" | "lifecycle">): NutritionDate =>
  plan.lifecycle.status === "superseded" ? plan.lifecycle.effectiveUntil : plan.endDate;

/**
 * Whether `date` belongs to this base plan:
 *
 *   startDate <= date <= endDate, and, once superseded, date <= effectiveUntil
 *
 * Calendar dates only — Berlin `YYYY-MM-DD`, never a weekday or a browser-local
 * day. Slot heads, overrides and recorded entries are not consulted: an
 * override changes which meal a slot shows, never which plan owns the date.
 */
export const planOwnsDate = (
  plan: Pick<NutritionPlan, "startDate" | "endDate" | "lifecycle">,
  date: NutritionDate
): boolean => {
  assertNutritionDate(date);
  // YYYY-MM-DD: string order is calendar order.
  return date >= plan.startDate && date <= planOwnedUntil(plan);
};

/* ------------------------------------------------------------------ *
 * Repeat
 * ------------------------------------------------------------------ */

/** The first date of the week that repeats `source`: the day after it ends. */
export const repeatedPlanStartDate = (source: Pick<NutritionPlan, "endDate">): NutritionDate =>
  addNutritionDays(assertNutritionDate(source.endDate, "endDate"), 1);

/**
 * The BASE content of the week after `source`, repeated.
 *
 *   startDate  source.endDate + 1 day
 *   endDate    startDate + 6 days
 *   days       source day i on startDate + i, in order
 *   slotOrder  unchanged
 *   meals      each base planned meal copied field by field — mealId, slotId,
 *              name and the four values, nothing else
 *
 * Only the base plan is an input, so nothing else can be copied: no slot head,
 * no override or replacement, no recorded entry, no pending offline intent,
 * no generation state.
 *
 * Meal ids are kept. A meal id is unique within its plan and every reference to
 * a meal carries its plan id (a slot head is `{planId, date, slotId}`, a
 * recording carries `planId`), so the same id in the repeated plan names the
 * repeated plan's own meal and cannot be mistaken for the source's. This also
 * makes the content a pure function of the source: a retry or a replay builds
 * exactly the same week.
 *
 * `source` is not changed; the result shares no object with it.
 */
export const buildRepeatedPlanContent = (source: NutritionPlanContent): NutritionPlanContent => {
  if (source.days.length !== NUTRITION_PLAN_DAY_COUNT) {
    throw new RangeError(`a plan has exactly ${NUTRITION_PLAN_DAY_COUNT} days`);
  }
  const startDate = repeatedPlanStartDate(source);
  return {
    startDate,
    endDate: addNutritionDays(startDate, NUTRITION_PLAN_DAY_COUNT - 1),
    slotOrder: [...source.slotOrder],
    days: source.days.map((day, dayIndex) => ({
      date: addNutritionDays(startDate, dayIndex),
      meals: day.meals.map((meal) => ({
        mealId: meal.mealId,
        slotId: meal.slotId,
        name: meal.name,
        values: {
          kcal: meal.values.kcal,
          proteinG: meal.values.proteinG,
          carbsG: meal.values.carbsG,
          fatG: meal.values.fatG,
        },
      })),
    })),
  };
};

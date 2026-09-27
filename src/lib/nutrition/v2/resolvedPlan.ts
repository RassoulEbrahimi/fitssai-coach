import {
  isActiveRecordedEntry,
  planOwnsDate,
  selectedMealOverride,
  slotEntryId,
  slotHeadRevision,
  type MealOverride,
  type NutritionDate,
  type NutritionPlan,
  type NutritionSlotId,
  type NutritionValues,
  type RecordedEntry,
  type SlotHead,
} from "@shared/nutrition";

/**
 * The PLANNED view of a Nutrition V2 plan, derived — never fetched, never
 * stored. Pure: no Firestore, React or clock.
 *
 *   NutritionPlan + SlotHeads + date  →  ResolvedNutritionDay
 *
 * A resolved day is what the plan proposes for a date once that date's slot
 * overrides are applied. It is PLANNED, not eaten: nothing here reads a
 * recorded estimate into a planned value, and nothing here creates a
 * `RecordedEntry`. The plan and the heads are read, never edited; an override
 * stays an override and is never turned into a base meal.
 *
 * Recording coverage is a separate, structural question answered from
 * explicit slot entries only (see `nutritionRecordingStatus`).
 */

/* ------------------------------------------------------------------ *
 * Resolved meals and days
 * ------------------------------------------------------------------ */

interface ResolvedNutritionMealBase {
  planId: string;
  date: NutritionDate;
  slotId: NutritionSlotId;
  /**
   * The meal's own id: the plan's base meal, or the selected override's
   * server-stable meal. Never derived from a name.
   */
  mealId: string;
  /** The name shown for the slot. */
  name: string;
  /** Planned values, unrounded. */
  values: NutritionValues;
  /**
   * The slot head's revision (0 without a head): what a replacement or an
   * undo of this slot names as its expected revision (NUT-10).
   */
  slotRevision: number;
}

/**
 * What one slot of one date proposes. `base` is the plan's own meal;
 * `override` is the override the slot head selects, exactly as stored in the
 * head's immutable history.
 */
export type ResolvedNutritionMeal =
  | (ResolvedNutritionMealBase & { source: "base" })
  | (ResolvedNutritionMealBase & { source: "override"; override: MealOverride });

export type ResolvedNutritionMealSource = ResolvedNutritionMeal["source"];

export interface ResolvedNutritionDay {
  planId: string;
  date: NutritionDate;
  /** One per configured slot, in `plan.slotOrder`. */
  meals: ResolvedNutritionMeal[];
  /** Sum of the resolved meals' planned values, unrounded. Planned, not eaten. */
  planned: NutritionValues;
}

const ZERO: NutritionValues = Object.freeze({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });

/** Plain arithmetic over persisted values — not nutrition policy, not rounded. */
export const sumPlannedValues = (values: readonly NutritionValues[]): NutritionValues =>
  values.reduce<NutritionValues>(
    (sum, v) => ({
      kcal: sum.kcal + v.kcal,
      proteinG: sum.proteinG + v.proteinG,
      carbsG: sum.carbsG + v.carbsG,
      fatG: sum.fatG + v.fatG,
    }),
    { ...ZERO }
  );

const headKey = (date: NutritionDate, slotId: NutritionSlotId) => `${date}|${slotId}`;

/** Index heads by date and slot, refusing any that is not this plan's or is duplicated. */
const indexHeads = (plan: NutritionPlan, slotHeads: readonly SlotHead[]): Map<string, SlotHead> => {
  const heads = new Map<string, SlotHead>();
  for (const head of slotHeads) {
    if (head.planId !== plan.planId) {
      throw new Error(`slot head of plan ${head.planId} passed to plan ${plan.planId}`);
    }
    const key = headKey(head.date, head.slotId);
    if (heads.has(key)) throw new Error(`more than one slot head for ${head.date} ${head.slotId}`);
    heads.set(key, head);
  }
  return heads;
};

const resolveDay = (
  plan: NutritionPlan,
  heads: ReadonlyMap<string, SlotHead>,
  date: NutritionDate
): ResolvedNutritionDay | null => {
  const day = plan.days.find((d) => d.date === date);
  if (!day) return null;

  const meals = plan.slotOrder.map((slotId): ResolvedNutritionMeal => {
    const head = heads.get(headKey(date, slotId)) ?? null;
    const slotRevision = slotHeadRevision(head);
    // Only the override the selection names; the rest of the history is history.
    const override = selectedMealOverride(head);
    if (override) {
      const { mealId, name, values } = override.meal;
      return { source: "override", planId: plan.planId, date, slotId, mealId, name, values: { ...values }, slotRevision, override };
    }

    // No head, or a `base` selection: the plan's own meal.
    const base = day.meals.find((meal) => meal.slotId === slotId);
    if (!base) throw new Error(`plan ${plan.planId} has no meal for ${slotId} on ${date}`);
    return {
      source: "base",
      planId: plan.planId,
      date,
      slotId,
      mealId: base.mealId,
      name: base.name,
      values: { ...base.values },
      slotRevision,
    };
  });

  return { planId: plan.planId, date, meals, planned: sumPlannedValues(meals.map((meal) => meal.values)) };
};

/**
 * The planned view of `date`, or null when `date` is not one of the plan's
 * days. Days are matched by calendar date, never by weekday.
 */
export const resolveNutritionDay = (
  plan: NutritionPlan,
  slotHeads: readonly SlotHead[],
  date: NutritionDate
): ResolvedNutritionDay | null => resolveDay(plan, indexHeads(plan, slotHeads), date);

/* ------------------------------------------------------------------ *
 * Recording coverage
 * ------------------------------------------------------------------ */

/**
 * How many of a date's configured slots carry their explicit slot entry.
 *
 *   unrecorded  none
 *   partial     some, not all
 *   recorded    every one
 *
 * Coverage only — never a judgement of what was eaten. An active `skip` is an
 * explicit recording of its slot. A `removed` tombstone is history and covers
 * nothing. Extra entries, and entries of other dates or of slots the plan does
 * not configure, cover nothing. A slot without an active entry is not
 * recorded; it is never read as zero intake or as "eaten as planned".
 */
export type NutritionRecordingStatus = "unrecorded" | "partial" | "recorded";

export interface NutritionRecordingCoverage {
  status: NutritionRecordingStatus;
  recordedSlots: number;
  configuredSlots: number;
}

export const nutritionRecordingCoverage = (
  slotOrder: readonly NutritionSlotId[],
  date: NutritionDate,
  entries: readonly RecordedEntry[]
): NutritionRecordingCoverage => {
  const recordedIds = new Set(
    entries
      .filter((entry) => entry.kind === "slot" && entry.date === date && isActiveRecordedEntry(entry))
      .map((entry) => entry.entryId)
  );
  const recordedSlots = slotOrder.filter((slotId) => recordedIds.has(slotEntryId(date, slotId))).length;
  const configuredSlots = slotOrder.length;
  const status: NutritionRecordingStatus =
    recordedSlots === 0 ? "unrecorded" : recordedSlots === configuredSlots ? "recorded" : "partial";
  return { status, recordedSlots, configuredSlots };
};

/* ------------------------------------------------------------------ *
 * The plan week
 * ------------------------------------------------------------------ */

/** One dated row of the plan week: only what the Today/week shell shows. */
export interface NutritionWeekDay {
  date: NutritionDate;
  /** The base plan that owns this date — the one its planned values come from. */
  planId: string;
  /** This row is today's Berlin date. */
  isToday: boolean;
  recording: NutritionRecordingStatus;
  /** Planned kcal of the resolved day, unrounded. Planned, not eaten. */
  plannedKcal: number;
  /** Resolved meals on the day (one per configured slot). */
  mealCount: number;
}

export interface NutritionWeek {
  /** The plan whose week this is: the plan that owns today, or the latest plan outside of it. */
  planId: string;
  /** The week's first and last date: always that plan's own seven. */
  startDate: NutritionDate;
  endDate: NutritionDate;
  /** Seven dated rows, each resolved against the plan that owns its date. */
  days: NutritionWeekDay[];
  /** Today's resolved day, or null when today is not one of the week's dates. */
  today: ResolvedNutritionDay | null;
}

/** A base plan and its own slot heads. */
export interface NutritionWeekPlan {
  plan: NutritionPlan;
  slotHeads: readonly SlotHead[];
}

/**
 * The plan that owns the rest of `plan`'s week, or null when `plan` owns all
 * seven of its dates. A plan superseded by a successor that starts inside its
 * week (a regeneration from tomorrow) hands its later dates to that
 * successor, named by `supersededByPlanId`; one superseded by next week's
 * repeat keeps all seven.
 */
export const nutritionWeekSuccessorId = (plan: Pick<NutritionPlan, "endDate" | "lifecycle">): string | null =>
  plan.lifecycle.status === "superseded" && plan.lifecycle.effectiveUntil < plan.endDate
    ? plan.lifecycle.supersededByPlanId
    : null;

/**
 * The seven dates of `plan`'s week as the week shell shows them, each resolved
 * against the base plan that OWNS that date:
 *
 *   - the dates `plan` owns (all seven while it is active; through
 *     `effectiveUntil` once superseded) from `plan` and its slot heads;
 *   - any later date from `successor` — the plan that superseded it — and the
 *     successor's own slot heads, never `plan`'s meals beyond its ownership.
 *
 * Dates are compared as calendar dates, never weekdays, and two plans are
 * never combined by weekday. A date neither plan owns, a successor that is not
 * the one `plan` names, or a successor missing when one is needed, throws:
 * the week is always exactly seven rows, never a shorter guess. `today` is
 * the Berlin calendar date supplied by the caller. Recorded values are not
 * part of this model; coverage counts explicit entries only. Neither plan is
 * changed.
 */
export const buildNutritionWeek = ({
  plan,
  slotHeads,
  successor = null,
  entries,
  today,
}: {
  plan: NutritionPlan;
  slotHeads: readonly SlotHead[];
  /** Required exactly when `nutritionWeekSuccessorId(plan)` names a plan. */
  successor?: NutritionWeekPlan | null;
  entries: readonly RecordedEntry[];
  today: NutritionDate;
}): NutritionWeek => {
  const successorId = nutritionWeekSuccessorId(plan);
  if (successor && successor.plan.planId !== successorId) {
    throw new Error(`plan ${successor.plan.planId} does not own the rest of plan ${plan.planId}'s week`);
  }
  const owners = [
    { plan, heads: indexHeads(plan, slotHeads) },
    ...(successor ? [{ plan: successor.plan, heads: indexHeads(successor.plan, successor.slotHeads) }] : []),
  ];

  let todayDay: ResolvedNutritionDay | null = null;
  const days = plan.days.map((planDay): NutritionWeekDay => {
    const { date } = planDay;
    const owner = owners.find((candidate) => planOwnsDate(candidate.plan, date));
    if (!owner) throw new Error(`no plan of the week owns ${date}`);
    const resolved = resolveDay(owner.plan, owner.heads, date);
    if (!resolved) throw new Error(`plan ${owner.plan.planId} does not resolve its own day ${date}`);
    const isToday = date === today;
    if (isToday) todayDay = resolved;
    return {
      date,
      planId: owner.plan.planId,
      isToday,
      recording: nutritionRecordingCoverage(owner.plan.slotOrder, date, entries).status,
      plannedKcal: resolved.planned.kcal,
      mealCount: resolved.meals.length,
    };
  });

  return { planId: plan.planId, startDate: plan.startDate, endDate: plan.endDate, days, today: todayDay };
};

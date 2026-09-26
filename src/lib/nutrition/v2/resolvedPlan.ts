import {
  slotEntryId,
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
  /** The name shown for the slot. */
  name: string;
  /** Planned values, unrounded. */
  values: NutritionValues;
}

/**
 * What one slot of one date proposes. `base` names the plan's own meal by its
 * `mealId`; `override` carries the override as persisted and has no V2 meal
 * id of its own.
 */
export type ResolvedNutritionMeal =
  | (ResolvedNutritionMealBase & { source: "base"; mealId: string })
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
    const selection = heads.get(headKey(date, slotId))?.selection;
    if (selection?.kind === "override") {
      const { name, values } = selection.override.meal;
      return {
        source: "override",
        planId: plan.planId,
        date,
        slotId,
        name,
        values: { ...values },
        override: selection.override,
      };
    }

    // No head, or an explicit `base` selection: the plan's own meal.
    const base = day.meals.find((meal) => meal.slotId === slotId);
    if (!base) throw new Error(`plan ${plan.planId} has no meal for ${slotId} on ${date}`);
    return {
      source: "base",
      planId: plan.planId,
      date,
      slotId,
      name: base.name,
      values: { ...base.values },
      mealId: base.mealId,
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
 * Coverage only — never a judgement of what was eaten. A `skip` is an explicit
 * recording of its slot. Extra entries, and entries of other dates or of slots
 * the plan does not configure, cover nothing. A slot without an entry is not
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
    entries.filter((entry) => entry.kind === "slot" && entry.date === date).map((entry) => entry.entryId)
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
  /** This row is today's Berlin date. */
  isToday: boolean;
  recording: NutritionRecordingStatus;
  /** Planned kcal of the resolved day, unrounded. Planned, not eaten. */
  plannedKcal: number;
  /** Resolved meals on the day (one per configured slot). */
  mealCount: number;
}

export interface NutritionWeek {
  planId: string;
  startDate: NutritionDate;
  endDate: NutritionDate;
  /** The plan's days, in plan order. */
  days: NutritionWeekDay[];
  /** Today's resolved day, or null when today is not a day of the plan. */
  today: ResolvedNutritionDay | null;
}

/**
 * The seven plan days as the week shell shows them. `today` is the Berlin
 * calendar date supplied by the caller; it is compared by date, never by
 * weekday. Recorded values are not part of this model at all.
 */
export const buildNutritionWeek = ({
  plan,
  slotHeads,
  entries,
  today,
}: {
  plan: NutritionPlan;
  slotHeads: readonly SlotHead[];
  entries: readonly RecordedEntry[];
  today: NutritionDate;
}): NutritionWeek => {
  const heads = indexHeads(plan, slotHeads);
  let todayDay: ResolvedNutritionDay | null = null;

  const days = plan.days.map((planDay): NutritionWeekDay => {
    const resolved = resolveDay(plan, heads, planDay.date);
    if (!resolved) throw new Error(`plan ${plan.planId} does not resolve its own day ${planDay.date}`);
    const isToday = planDay.date === today;
    if (isToday) todayDay = resolved;
    return {
      date: planDay.date,
      isToday,
      recording: nutritionRecordingCoverage(plan.slotOrder, planDay.date, entries).status,
      plannedKcal: resolved.planned.kcal,
      mealCount: resolved.meals.length,
    };
  });

  return { planId: plan.planId, startDate: plan.startDate, endDate: plan.endDate, days, today: todayDay };
};

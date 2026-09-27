import { Timestamp } from "firebase-admin/firestore";
import {
  NUTRITION_SCHEMA_VERSION,
  addNutritionDays,
  type NutritionDate,
  type NutritionPlanContent,
  type NutritionSlotId,
  type NutritionStateRequest,
} from "../../../shared/nutrition";

/**
 * TEST FIXTURES ONLY: stored Nutrition V2 documents for the plan tests, as the
 * Admin SDK would hold them (timestamps are Admin `Timestamp`s). Meal names
 * and values are arbitrary and mean nothing.
 */

export const UID = "alice";
export const STATE_PATH = `users/${UID}/nutrition_v2_state/current`;
export const PLANS = `users/${UID}/nutrition_v2_plans/`;
export const TARGETS = `users/${UID}/nutrition_v2_targets/`;
export const planPath = (planId: string) => PLANS + planId;
export const targetPath = (targetVersionId: string) => TARGETS + targetVersionId;

export const requestId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ADULT_PROFILE = { age: 34, weight: 68.25, height: 172.5, biologicalSex: "female" };

/** A Wednesday. Plans are dated, never weekdays. */
export const SOURCE_START: NutritionDate = "2026-09-23";
export const SOURCE_END: NutritionDate = "2026-09-29";

export const CREATED = Timestamp.fromDate(new Date("2026-09-22T08:00:00.000Z"));

const SLOT_ORDER: NutritionSlotId[] = ["breakfast", "lunch", "dinner"];

export const makeContent = (startDate: NutritionDate = SOURCE_START, slotOrder = SLOT_ORDER): NutritionPlanContent => ({
  startDate,
  endDate: addNutritionDays(startDate, 6),
  slotOrder: [...slotOrder],
  days: Array.from({ length: 7 }, (_, dayIndex) => ({
    date: addNutritionDays(startDate, dayIndex),
    meals: slotOrder.map((slotId, slotIndex) => ({
      mealId: `m-${dayIndex}-${slotIndex}`,
      slotId,
      name: `Fixture ${slotId} ${dayIndex}`,
      values: { kcal: 100.25 + dayIndex + slotIndex, proteinG: 10.5, carbsG: 20.125, fatG: 5 },
    })),
  })),
});

export interface StoredPlanOptions {
  startDate?: NutritionDate;
  targetVersionId?: string;
  validation?: { policy: { id: string; version: number }; outcome: "accepted" };
  lifecycle?: Record<string, unknown>;
  source?: "generated" | "repeated";
  repeatedFromPlanId?: string | null;
}

/** An active generated plan as it is stored. */
export const storedPlan = (planId: string, options: StoredPlanOptions = {}): Record<string, unknown> => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  planId,
  ...makeContent(options.startDate ?? SOURCE_START),
  targetVersionId: options.targetVersionId ?? "target-1",
  source: options.source ?? "generated",
  repeatedFromPlanId: options.repeatedFromPlanId ?? null,
  generationRequestId: null,
  validation: options.validation ?? { policy: { id: "test-fixture-accept", version: 1 }, outcome: "accepted" },
  createdAt: CREATED,
  activatedAt: CREATED,
  lifecycle: options.lifecycle ?? { status: "active", effectiveUntil: null, supersededByPlanId: null },
});

export const storedTarget = (targetVersionId: string): Record<string, unknown> => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  targetVersionId,
  mode: "manual",
  values: { kcal: 1234.5, proteinG: 1, carbsG: 2, fatG: 3 },
  effectiveFrom: "2026-09-20",
  effectiveOrder: 1,
  policy: { id: "test-fixture-manual", version: 1 },
  profileFingerprint: { hash: "a".repeat(64), fields: ["manualTargetKcal"] },
  supersedesTargetVersionId: null,
  createdAt: CREATED,
});

export const storedState = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: NUTRITION_SCHEMA_VERSION,
  revision: 4,
  activePlanId: "plan-1",
  currentTargetVersionId: "target-1",
  activeGenerationRequestId: null,
  recentRequests: [] as NutritionStateRequest[],
  ...overrides,
});

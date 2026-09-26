import { describe, expect, it } from "vitest";
import {
  planNutritionEntryWrite,
  recordedEntrySchema,
  type NutritionEntryIntent,
  type RecordedEntry,
  type RecordedEntrySnapshot,
} from "@shared/nutrition";
import { buildCustomSlotRecording, buildExtraRecording, buildPlannedMealRecording, buildSkipRecording } from "./recording";
import type { ResolvedNutritionMeal } from "./resolvedPlan";
import {
  ACCEPTED_TRANSITIONS,
  DATE,
  EXTRA_UUID,
  PLAN_ID,
  VALID_CREATES,
  customSlotDoc,
  extraDoc,
  plannedMealDoc,
  skipDoc,
} from "../../../../rules-tests/nutritionEntryDocs";

/*
  NUT-06. The Firestore rules tests write literal documents, because the rules
  job cannot load zod. This suite pins those documents to the real client:
  each valid document is exactly what the canonical schema accepts and what
  the recording builders produce, and each accepted transition is exactly
  what the shared planner writes. If the planner or the contract changes,
  this fails until the rules fixtures — and so the rules tests — follow.
*/

const metaFree = (doc: Record<string, unknown>): RecordedEntrySnapshot => {
  const { revision: _revision, status: _status, appliedIntentIds: _ids, ...rest } = doc;
  return rest as RecordedEntrySnapshot;
};

describe("rules-test entry documents", () => {
  it.each(VALID_CREATES)("the %s document is a canonical RecordedEntry", (_label, make) => {
    const doc = make();
    expect(recordedEntrySchema.parse(doc)).toEqual(doc);
  });

  it("are what the recording builders produce", () => {
    const lunch: ResolvedNutritionMeal = {
      source: "base",
      mealId: "m-lunch",
      planId: PLAN_ID,
      date: DATE,
      slotId: "lunch",
      name: "Linsen-Curry",
      values: { kcal: 700.2, proteinG: 40, carbsG: 80, fatG: 20 },
    };
    expect(buildPlannedMealRecording(lunch, 1.5)).toEqual(metaFree(plannedMealDoc()));
    expect(buildSkipRecording({ date: DATE, slotId: "breakfast" })).toEqual(metaFree(skipDoc()));
    expect(
      buildCustomSlotRecording({
        date: DATE,
        slotId: "dinner",
        name: "Pizza beim Italiener",
        estimate: { kcal: 950, proteinG: null, carbsG: 110, fatG: null },
      })
    ).toEqual(metaFree(customSlotDoc()));
    expect(buildExtraRecording({ uuid: EXTRA_UUID, date: DATE, name: "Apfel", estimate: { kcal: 80 } })).toEqual(
      metaFree(extraDoc())
    );
  });

  it.each(ACCEPTED_TRANSITIONS.map((transition) => [transition.name, transition] as const))(
    "the planner writes exactly the accepted transition: %s",
    (_name, transition) => {
      const { intentId, op, expectedRevision } = transition.intent;
      const intent = (
        op === "remove"
          ? { intentId, entryId: transition.next.entryId, expectedRevision, op }
          : { intentId, entryId: transition.next.entryId, expectedRevision, op, desired: metaFree(transition.next) }
      ) as NutritionEntryIntent;

      const plan = planNutritionEntryWrite(transition.prev as RecordedEntry | null, intent);
      expect(plan).toEqual({ outcome: "apply", entry: transition.next });
    }
  );
});

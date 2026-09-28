import type { Firestore } from "../../functions/node_modules/firebase-admin/lib/firestore/index";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  recordedEntrySchema,
  slotHeadSchema,
  targetVersionSchema,
  type NutritionPlan,
  type NutritionUserState,
  type RecordedEntry,
  type SlotHead,
  type TargetVersion,
} from "../../shared/nutrition";

/**
 * What one emulator account has persisted for Nutrition V2, read with the
 * emulator Admin SDK and parsed through the same strict shared schemas the app
 * and the server use. A document that does not parse fails the test: nothing
 * here reinterprets a Firestore document by hand.
 */
export interface PersistedNutritionV2 {
  /** `users/{uid}` as stored, timestamps left out. */
  profile: Record<string, unknown> | null;
  state: NutritionUserState | null;
  targets: Record<string, TargetVersion>;
  plans: Record<string, NutritionPlan>;
  slots: Record<string, SlotHead>;
  entries: Record<string, RecordedEntry>;
  generationIds: string[];
  /** Every subcollection of `users/{uid}`, so an unexpected write shows up. */
  collections: string[];
}

const byId = async <T>(db: Firestore, uid: string, collection: string, parse: (data: unknown) => T): Promise<Record<string, T>> => {
  const snapshot = await db.collection("users").doc(uid).collection(collection).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [doc.id, parse(doc.data())]));
};

const withoutTimestamps = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => key !== "createdAt" && key !== "updatedAt"));

export const readPersistedNutritionV2 = async (db: Firestore, uid: string): Promise<PersistedNutritionV2> => {
  const user = db.collection("users").doc(uid);
  const [profile, state, targets, plans, slots, entries, generations, collections] = await Promise.all([
    user.get(),
    user.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID).get(),
    byId(db, uid, NUTRITION_V2_COLLECTIONS.targets, (data) => targetVersionSchema.parse(data)),
    byId(db, uid, NUTRITION_V2_COLLECTIONS.plans, (data) => nutritionPlanSchema.parse(data)),
    byId(db, uid, NUTRITION_V2_COLLECTIONS.slots, (data) => slotHeadSchema.parse(data)),
    byId(db, uid, NUTRITION_V2_COLLECTIONS.entries, (data) => recordedEntrySchema.parse(data)),
    user.collection(NUTRITION_V2_COLLECTIONS.generations).get(),
    user.listCollections(),
  ]);
  return {
    profile: profile.exists ? withoutTimestamps(profile.data() ?? {}) : null,
    state: state.exists ? nutritionUserStateSchema.parse(state.data()) : null,
    targets,
    plans,
    slots,
    entries,
    generationIds: generations.docs.map((doc) => doc.id),
    collections: collections.map((collection) => collection.id).sort(),
  };
};

/** The base meal a plan holds for a date and slot. */
export const baseMealOf = (plan: NutritionPlan, date: string, slotId: string) => {
  const meal = plan.days.find((day) => day.date === date)?.meals.find((candidate) => candidate.slotId === slotId);
  if (!meal) throw new Error(`plan ${plan.planId} has no ${slotId} on ${date}`);
  return meal;
};

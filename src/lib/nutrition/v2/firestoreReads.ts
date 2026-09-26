import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  type NutritionDate,
  type NutritionPlan,
  type NutritionUserState,
  type RecordedEntry,
  type SlotHead,
  type TargetVersion,
} from "@shared/nutrition";
import {
  assertNutritionV2DateSpan,
  parseNutritionV2Entries,
  parseNutritionV2Plan,
  parseNutritionV2SlotHeads,
  parseNutritionV2State,
  parseNutritionV2Target,
} from "./integrity";

/**
 * Nutrition V2 Firestore reads. Read-only: nothing here writes, and there is
 * no write path for Nutrition V2 on the client.
 *
 * Every path is `users/{uid}/…` for the authenticated uid the caller passes,
 * every collection name comes from `NUTRITION_V2_COLLECTIONS`, and every
 * document goes through the strict parsers in `./integrity` before it is
 * returned. The generation and server-only suggestion collections are not
 * read here.
 */

const requireUid = (uid: string): string => {
  if (typeof uid !== "string" || uid.length === 0) throw new Error("Nutrition V2 reads need an authenticated uid");
  return uid;
};

const v2Collection = (uid: string, name: keyof typeof NUTRITION_V2_COLLECTIONS) =>
  collection(db, "users", requireUid(uid), NUTRITION_V2_COLLECTIONS[name]);

const v2Doc = (uid: string, name: keyof typeof NUTRITION_V2_COLLECTIONS, id: string) =>
  doc(db, "users", requireUid(uid), NUTRITION_V2_COLLECTIONS[name], id);

/** `users/{uid}/nutrition_v2_state/current`, or null when V2 is not initialised. */
export const readNutritionV2State = async (uid: string): Promise<NutritionUserState | null> => {
  const snap = await getDoc(v2Doc(uid, "state", NUTRITION_V2_STATE_DOC_ID));
  return parseNutritionV2State({ exists: snap.exists(), data: snap.exists() ? snap.data() : undefined });
};

/** Exactly the target version a state pointer names. */
export const readNutritionV2Target = async (uid: string, targetVersionId: string): Promise<TargetVersion> => {
  const snap = await getDoc(v2Doc(uid, "targets", targetVersionId));
  return parseNutritionV2Target(targetVersionId, {
    id: snap.id,
    exists: snap.exists(),
    data: snap.exists() ? snap.data() : undefined,
  });
};

/** Exactly the plan a state pointer names. */
export const readNutritionV2Plan = async (uid: string, planId: string): Promise<NutritionPlan> => {
  const snap = await getDoc(v2Doc(uid, "plans", planId));
  return parseNutritionV2Plan(planId, { id: snap.id, exists: snap.exists(), data: snap.exists() ? snap.data() : undefined });
};

/** The slot heads stored for `plan`, and only for it. */
export const readNutritionV2SlotHeads = async (uid: string, plan: NutritionPlan): Promise<SlotHead[]> => {
  const snap = await getDocs(query(v2Collection(uid, "slots"), where("planId", "==", plan.planId)));
  return parseNutritionV2SlotHeads(
    plan,
    snap.docs.map((d) => ({ id: d.id, data: d.data() }))
  );
};

/** The entries recorded on `from`..`to` inclusive. `from === to` reads one day. */
export const readNutritionV2Entries = async (
  uid: string,
  from: NutritionDate,
  to: NutritionDate
): Promise<RecordedEntry[]> => {
  const span = assertNutritionV2DateSpan({ from, to });
  const constraints =
    span.from === span.to
      ? [where("date", "==", span.from)]
      : [where("date", ">=", span.from), where("date", "<=", span.to)];
  const snap = await getDocs(query(v2Collection(uid, "entries"), ...constraints));
  return parseNutritionV2Entries(
    span,
    snap.docs.map((d) => ({ id: d.id, data: d.data() }))
  );
};

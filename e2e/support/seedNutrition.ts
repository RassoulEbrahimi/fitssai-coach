import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "../../functions/node_modules/firebase-admin/lib/app/index";
import type { Firestore } from "../../functions/node_modules/firebase-admin/lib/firestore/index";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_STATE_DOC_ID,
  nutritionDateAt,
  nutritionPlanSchema,
  nutritionUserStateSchema,
  planOwnsDate,
  targetVersionSchema,
  type NutritionDate,
  type NutritionPlan,
  type NutritionSlotId,
  type NutritionValues,
} from "../../shared/nutrition";
import {
  TARGET_ALIGNMENT_POLICY_ID,
  TARGET_ALIGNMENT_POLICY_VERSION,
} from "../../functions/src/nutrition/planValidation/v1";
import { requireLocalEmulatorEnv, type LocalEmulatorEnv } from "./emulatorEnv";
import { callEmulatorCallable, createEmulatorAccount, emulatorIdToken, resetEmulators } from "./emulatorRest";
import { E2E_USERS, buildE2EPlanContent, e2ePlanStartDate, type E2EUser, type E2EUserKey } from "./nutritionFixture";

/**
 * Reset the local emulators and seed the Nutrition E2E accounts (NUT-13A).
 *
 * EMULATORS ONLY. `requireLocalEmulatorEnv` runs before anything else, so this
 * refuses to start unless the demo project and loopback/LAN emulator hosts are
 * named explicitly. Every request goes to those hosts; the Admin SDK is
 * initialised for the demo project with the emulator variables set and no
 * credentials, and the reset uses emulator-only endpoints.
 *
 * What is written goes through the application's own paths wherever one exists:
 *   - accounts: the Auth emulator's account API (email + password)
 *   - profile: `users/{uid}`, as onboarding writes it
 *   - TARGET: the real `nutritionSetTarget` callable on the Functions emulator,
 *     called with the account's own ID token — the signed TargetPolicy v1
 *   - active plan: the real `activateNutritionPlan` transaction with the
 *     production PlanValidationPolicy registry — the signed `target-alignment` v1
 * Nothing is recorded, no slot is replaced, and no generation request, AI log,
 * prompt or provider answer is created.
 */

export interface SeededNutritionUser {
  key: E2EUserKey;
  uid: string;
  email: string;
  nutrition: null | {
    targetVersionId: string;
    target: NutritionValues;
    planId: string;
    startDate: NutritionDate;
    endDate: NutritionDate;
    dates: NutritionDate[];
    /** Planned meal names per date, in slot order. */
    meals: Record<NutritionDate, Record<string, string>>;
    stateRevision: number;
  };
}

export interface NutritionSeedSummary {
  projectId: string;
  /** The Berlin date the seed ran on. */
  today: NutritionDate;
  users: Record<E2EUserKey, SeededNutritionUser>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The Functions workspace's own firebase-admin: the copy the activation core imports. */
const requireFromFunctions = createRequire(path.join(repoRoot, "functions", "package.json"));

const initAdmin = (env: LocalEmulatorEnv): { app: App; db: Firestore } => {
  // The Admin SDK reads these; they point it at the emulators and nowhere else.
  process.env.FIRESTORE_EMULATOR_HOST = env.firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.authHost;
  process.env.GCLOUD_PROJECT = env.projectId;
  // No credentials of any kind: the emulators need none, and production would refuse none.
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const { initializeApp, getApps } = requireFromFunctions("firebase-admin/app") as typeof import("../../functions/node_modules/firebase-admin/lib/app/index");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore") as typeof import("../../functions/node_modules/firebase-admin/lib/firestore/index");
  const name = "fitssai-nutrition-e2e-seed";
  const app = getApps().find((candidate) => candidate.name === name) ?? initializeApp({ projectId: env.projectId }, name);
  if (app.options.projectId !== env.projectId) throw new Error("Admin app is not the demo project");
  return { app, db: getFirestore(app) };
};

const seedProfile = async (db: Firestore, user: E2EUser) => {
  const { Timestamp } = requireFromFunctions("firebase-admin/firestore") as typeof import("../../functions/node_modules/firebase-admin/lib/firestore/index");
  const now = Timestamp.now();
  await db.collection("users").doc(user.uid).set({ ...user.profile, createdAt: now, updatedAt: now });
};

const seedNutrition = async (
  env: LocalEmulatorEnv,
  db: Firestore,
  user: E2EUser,
  password: string,
  today: NutritionDate
): Promise<SeededNutritionUser["nutrition"]> => {
  if (!user.nutrition) return null;
  const { planId, targetRequestId, catalog } = user.nutrition;
  const userRef = db.collection("users").doc(user.uid);

  // TARGET: the real callable, as the account itself.
  const idToken = await emulatorIdToken(env, user.uid, user.email, password);
  const setTarget = await callEmulatorCallable(env, "nutritionSetTarget", idToken, { mode: "calculated", requestId: targetRequestId });
  const setTargetResult = setTarget.body.result as { ok?: boolean; targetVersionId?: string } | undefined;
  if (setTarget.status !== 200 || setTargetResult?.ok !== true || typeof setTargetResult.targetVersionId !== "string") {
    throw new Error(`nutritionSetTarget for ${user.key} answered ${setTarget.status}: ${JSON.stringify(setTarget.body)}`);
  }
  const targetVersionId = setTargetResult.targetVersionId;
  const targetSnap = await userRef.collection(NUTRITION_V2_COLLECTIONS.targets).doc(targetVersionId).get();
  const target = targetVersionSchema.parse(targetSnap.data());

  // PLAN: the real activation transaction and the production validation policy.
  // Loaded only now, after the environment check: it needs the Functions workspace's firebase-admin.
  const { activateNutritionPlan } = await import("../../functions/src/nutrition/planActivation");
  const { productionPlanValidationPolicyRegistry } = await import("../../functions/src/nutrition/planValidation/registry");
  const content = buildE2EPlanContent(target.values, e2ePlanStartDate(today), catalog, planId);
  const activation = await activateNutritionPlan(
    { firestore: db, policies: productionPlanValidationPolicyRegistry },
    {
      uid: user.uid,
      planId,
      content,
      origin: { source: "generated", generationRequestId: null },
      targetVersionId,
      expectedActivePlanId: null,
      reusableValidation: null,
      request: null,
      now: new Date(),
    }
  );
  if (activation.kind !== "activated") throw new Error(`activation for ${user.key} was a replay`);

  // Read everything back through the same strict schemas the app uses.
  const state = nutritionUserStateSchema.parse(
    (await userRef.collection(NUTRITION_V2_COLLECTIONS.state).doc(NUTRITION_V2_STATE_DOC_ID).get()).data()
  );
  const plan: NutritionPlan = nutritionPlanSchema.parse((await userRef.collection(NUTRITION_V2_COLLECTIONS.plans).doc(planId).get()).data());
  if (state.activePlanId !== planId || state.currentTargetVersionId !== targetVersionId || state.activeGenerationRequestId !== null) {
    throw new Error(`state of ${user.key} does not point at the seeded target and plan`);
  }
  if (plan.validation.policy.id !== TARGET_ALIGNMENT_POLICY_ID || plan.validation.policy.version !== TARGET_ALIGNMENT_POLICY_VERSION) {
    throw new Error(`plan of ${user.key} was not accepted by target-alignment v1`);
  }
  if (!planOwnsDate(plan, today)) throw new Error(`plan of ${user.key} does not own ${today}`);
  const generations = await userRef.collection(NUTRITION_V2_COLLECTIONS.generations).limit(1).get();
  if (!generations.empty) throw new Error(`a generation request exists for ${user.key}`);

  const meals: Record<NutritionDate, Record<string, string>> = {};
  for (const day of plan.days) {
    meals[day.date] = Object.fromEntries(
      plan.slotOrder.map((slotId: NutritionSlotId) => [slotId, day.meals.find((meal) => meal.slotId === slotId)?.name ?? ""])
    );
  }
  return {
    targetVersionId,
    target: target.values,
    planId,
    startDate: plan.startDate,
    endDate: plan.endDate,
    dates: plan.days.map((day) => day.date),
    meals,
    stateRevision: state.revision,
  };
};

/**
 * Reset, then seed every E2E account. `password` is a local-only value for
 * the emulator accounts; it is never printed, logged or stored by this module.
 */
export const seedNutritionE2E = async ({
  env: rawEnv,
  password,
  now = new Date(),
}: {
  env: Record<string, string | undefined>;
  password: string;
  now?: Date;
}): Promise<NutritionSeedSummary> => {
  const env = requireLocalEmulatorEnv(rawEnv);
  if (typeof password !== "string" || password.length < 8) throw new Error("E2E_NUTRITION_PASSWORD must have at least 8 characters");

  await resetEmulators(env);
  const { app, db } = initAdmin(env);
  const today = nutritionDateAt(now);
  try {
    const users = {} as Record<E2EUserKey, SeededNutritionUser>;
    for (const user of Object.values(E2E_USERS)) {
      await createEmulatorAccount(env, user.uid, user.email, password);
      await seedProfile(db, user);
      users[user.key] = { key: user.key, uid: user.uid, email: user.email, nutrition: await seedNutrition(env, db, user, password, today) };
    }
    return { projectId: env.projectId, today, users };
  } finally {
    const { deleteApp } = requireFromFunctions("firebase-admin/app") as typeof import("../../functions/node_modules/firebase-admin/lib/app/index");
    await deleteApp(app);
  }
};

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import {
  NUTRITION_SLOT_REQUEST_RING_SIZE,
  NUTRITION_V2_SUGGESTIONS_COLLECTION,
  nutritionPlanSchema,
  planNutritionEntryWrite,
  recordedEntrySchema,
  replacementSuggestionSetSchema,
  selectedMealOverride,
  slotEntryId,
  slotHeadId,
  slotHeadSchema,
  type NutritionEntryIntent,
  type RecordedEntry,
  type SlotHead,
} from "../../../shared/nutrition";
import { fakeFirestore, type FakeFirestore } from "../testing/fakeFirestore";
import { FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY, fixturePlanValidationPolicyRegistry } from "../testing/fixturePlanValidationPolicies";
import {
  ADULT_PROFILE,
  STATE_PATH,
  UID,
  makeContent,
  planPath,
  requestId,
  storedPlan,
  storedState,
  storedTarget,
  targetPath,
} from "../testing/nutritionPlanFixtures";
import { FIXTURE_REPLACEMENT_VALIDATION, seedFixtureSuggestionSet } from "../testing/nutritionSuggestionFixtures";
import { NutritionSlotError, toNutritionHttpsError } from "./errors";
import { activateNutritionPlan } from "./planActivation";
import { storeReplacementSuggestionSet, suggestionSetDocId } from "./suggestionStore";
import { handleNutritionUpdateSlot } from "./updateSlot";

/*
  NUT-10: `nutritionUpdateSlot`, end to end against the in-memory Firestore.

  The fixture plan runs 23–29 Sep with breakfast, lunch and dinner; meal
  `m-{day}-{slotIndex}`, so 28 Sep's lunch is `m-5-1`. The clock is 28 Sep in
  Berlin. Suggestion sets are TEST FIXTURES from src/testing/: arbitrary
  meals under a fixture policy, with whatever expiry a test passes.
*/

/** 09:15 UTC on 28 Sep: Berlin's 28 Sep. */
const NOW = new Date("2026-09-28T09:15:00.000Z");
const TODAY = "2026-09-28";
const TOMORROW = "2026-09-29";
const YESTERDAY = "2026-09-27";
const BASE_LUNCH = "m-5-1";

const SLOTS = `users/${UID}/nutrition_v2_slots/`;
const ENTRIES = `users/${UID}/nutrition_v2_entries/`;
const headPath = (date = TODAY, slotId: "breakfast" | "lunch" | "dinner" | "snack_1" = "lunch", planId = "plan-1") =>
  SLOTS + slotHeadId(planId, date, slotId);
const entryPath = (date = TODAY, slotId: "lunch" | "dinner" = "lunch") => ENTRIES + slotEntryId(date, slotId);
const suggestionPath = (setId = "set-1", uid = UID) => `${NUTRITION_V2_SUGGESTIONS_COLLECTION}/${suggestionSetDocId(uid, setId)}`;

/** Server-minted ids, as `randomUUID` would produce them: lower-case v4. */
const minted = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

const setup = (
  options: {
    profile?: Record<string, unknown> | null;
    plans?: Record<string, Record<string, unknown>>;
    state?: Record<string, unknown>;
    now?: Date;
  } = {}
) => {
  const firestore = fakeFirestore();
  if (options.profile !== null) firestore.docs.set(`users/${UID}`, { ...(options.profile ?? ADULT_PROFILE) });
  firestore.docs.set(STATE_PATH, options.state ?? storedState());
  firestore.docs.set(targetPath("target-1"), storedTarget("target-1"));
  for (const [id, plan] of Object.entries(options.plans ?? { "plan-1": storedPlan("plan-1") })) {
    firestore.docs.set(planPath(id), plan);
  }

  let ids = 0;
  const clock = { now: options.now ?? NOW };
  const deps = { firestore, now: () => clock.now, newId: () => minted((ids += 1)) };
  const call = (data: unknown, uid: string | null = UID) =>
    handleNutritionUpdateSlot({ auth: uid === null ? null : { uid }, data }, deps);

  const address = (over: Record<string, unknown> = {}) => ({
    planId: "plan-1",
    date: TODAY,
    slotId: "lunch",
    expectedRevision: 0,
    ...over,
  });
  const commitPlanMeal = (n: number, sourceMealId = "m-2-1", over: Record<string, unknown> = {}) =>
    call({ action: "commit", requestId: requestId(n), ...address(over), replacement: { source: "planMeal", sourceMealId } });
  const commitSuggestion = (n: number, candidateId = "cand-1", over: Record<string, unknown> = {}, suggestionSetId = "set-1") =>
    call({
      action: "commit",
      requestId: requestId(n),
      ...address(over),
      replacement: { source: "aiSuggestion", suggestionSetId, candidateId },
    });
  const undo = (n: number, over: Record<string, unknown> = {}) =>
    call({ action: "undo", requestId: requestId(n), ...address(over) });

  const head = (path = headPath()): SlotHead | null => {
    const stored = firestore.docs.get(path);
    return stored === undefined ? null : slotHeadSchema.parse(stored);
  };
  const snapshot = () => new Map([...firestore.docs.entries()].map(([path, data]) => [path, JSON.stringify(data)]));

  return { firestore, deps, clock, call, commitPlanMeal, commitSuggestion, undo, head, snapshot };
};

const refusal = async (promise: Promise<unknown>): Promise<NutritionSlotError> => {
  const error = await promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(NutritionSlotError);
  return error as NutritionSlotError;
};

const expectRefusal = async (promise: Promise<unknown>, code: NutritionSlotError["code"]) =>
  expect((await refusal(promise)).code).toBe(code);

/** The fixture plan's own meal, as stored. */
const baseMeal = (planId: string, mealId: string, firestore: ReturnType<typeof setup>["firestore"]) => {
  const plan = nutritionPlanSchema.parse(firestore.docs.get(planPath(planId)));
  return plan.days.flatMap((day) => day.meals).find((meal) => meal.mealId === mealId);
};

/** A plan superseded by a successor that starts on `nextStart`. */
const supersededPlan = (planId: string, effectiveUntil: string, supersededByPlanId: string) =>
  storedPlan(planId, { lifecycle: { status: "superseded", effectiveUntil, supersededByPlanId } });

/* ------------------------------------------------------------------ *
 * Eligibility, dates and date ownership
 * ------------------------------------------------------------------ */

describe("who may change a slot", () => {
  it("an adult owner commits a replacement", async () => {
    const t = setup();
    const result = await t.commitPlanMeal(1);
    expect(result).toEqual({
      ok: true,
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      revision: 1,
      selection: { kind: "override", overrideId: minted(1) },
      replay: false,
    });
  });

  it("a signed-out caller is refused as unauthenticated and nothing is written", async () => {
    const t = setup();
    const before = t.snapshot();
    const data = {
      action: "commit",
      requestId: requestId(1),
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      expectedRevision: 0,
      replacement: { source: "planMeal", sourceMealId: "m-2-1" },
    };
    const error = await t.call(data, null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe("unauthenticated");
    // A uid in the payload is not an identity.
    await expect(t.call({ ...data, uid: UID }, null)).rejects.toBeInstanceOf(HttpsError);
    expect(t.snapshot()).toEqual(before);
  });

  it.each([
    ["a minor", { ...ADULT_PROFILE, age: 16 }, "minor"],
    ["a missing age", { weight: 70 }, "missingAge"],
    ["an unusable age", { ...ADULT_PROFILE, age: "thirty" }, "missingAge"],
  ])("%s is NOT_ELIGIBLE, with the reason and never the age", async (_label, profile, reason) => {
    const t = setup({ profile });
    const error = await refusal(t.commitPlanMeal(1));
    expect(error.code).toBe("NOT_ELIGIBLE");
    expect(error.details).toEqual({ reason });
    expect(JSON.stringify(toNutritionHttpsError(error).details)).not.toMatch(/16|thirty/);
    expect(t.head()).toBeNull();
  });

  it("no profile at all is NOT_ELIGIBLE", async () => {
    await expectRefusal(setup({ profile: null }).commitPlanMeal(1), "NOT_ELIGIBLE");
  });
});

/**
 * Firestore's optimistic transaction, emulated over the serialised fake. Each
 * attempt records every document it reads and buffers its writes. `interleave`
 * runs once, after the first attempt has read everything and before it would
 * commit — a concurrent write that lands first. If any document the attempt
 * READ has changed by then, the attempt is discarded and the body runs again
 * against the new state, as Firestore retries a contended transaction. A
 * document the handler read outside the transaction is not in the read set,
 * so a change to it would not stop the commit.
 */
const withOptimisticRetry = (firestore: ReturnType<typeof setup>["firestore"], interleave: () => void) => {
  type Ref = { path?: string; where?: unknown };
  type Tx = {
    get: (ref: Ref) => Promise<unknown>;
    create: (ref: Ref, value: Record<string, unknown>) => void;
    set: (ref: Ref, value: Record<string, unknown>) => void;
    update: (ref: Ref, value: Record<string, unknown>) => void;
  };
  const fake = firestore as unknown as FakeFirestore;
  const serialised = fake.runTransaction.bind(fake) as unknown as <T>(body: (tx: Tx) => Promise<T>) => Promise<T>;
  const readSets: string[][] = [];
  let interleaved = false;
  const current = (path: string) => JSON.stringify(firestore.docs.get(path) ?? null);

  (fake as unknown as { runTransaction: unknown }).runTransaction = <T>(body: (tx: Tx) => Promise<T>) =>
    serialised(async (tx: Tx) => {
      for (;;) {
        const seen = new Map<string, string>();
        const writes: Array<() => void> = [];
        const result = await body({
          get: async (ref) => {
            // Document reads join the read set; query reads are covered by the documents they return.
            if (typeof ref.where !== "function" && ref.path) seen.set(ref.path, current(ref.path));
            return tx.get(ref);
          },
          create: (ref, value) => writes.push(() => tx.create(ref, value)),
          set: (ref, value) => writes.push(() => tx.set(ref, value)),
          update: (ref, value) => writes.push(() => tx.update(ref, value)),
        });
        readSets.push([...seen.keys()]);
        if (!interleaved) {
          interleaved = true;
          interleave();
        }
        if ([...seen].some(([path, value]) => current(path) !== value)) continue; // contended: retry
        for (const write of writes) write();
        return result;
      }
    });
  return { readSets };
};

describe("eligibility is judged inside the slot transaction", () => {
  const PROFILE_PATH = `users/${UID}`;
  const untouched = (t: ReturnType<typeof setup>) =>
    [...t.firestore.docs.entries()].filter(([path]) => path !== PROFILE_PATH).map(([path, data]) => [path, JSON.stringify(data)]);

  it.each([
    ["turns 17", { ...ADULT_PROFILE, age: 17 }, "minor"],
    ["removes the age", { weight: 68.25, height: 172.5 }, "missingAge"],
    ["stores an unusable age", { ...ADULT_PROFILE, age: "thirty" }, "missingAge"],
  ])("a profile that %s while the commit is in flight wins: NOT_ELIGIBLE, nothing written", async (_label, profile, reason) => {
    const t = setup();
    const before = untouched(t);
    const { readSets } = withOptimisticRetry(t.firestore, () => t.firestore.docs.set(PROFILE_PATH, profile));

    const error = await refusal(t.commitPlanMeal(1));
    expect([error.code, error.details]).toEqual(["NOT_ELIGIBLE", { reason }]);
    // The first attempt read the profile inside the transaction, passed, and was
    // retried because the profile it read changed; the retry refused.
    expect(readSets).toHaveLength(1);
    expect(readSets[0]).toContain(PROFILE_PATH);
    expect(t.head()).toBeNull();
    expect(untouched(t)).toEqual(before);
  });

  it("a suggestion commit refused this way consumes no candidate", async () => {
    const t = setup();
    await seedFixtureSuggestionSet(t.firestore, {
      uid: UID,
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      createdAt: new Date("2026-09-28T09:00:00.000Z"),
      expiresAt: new Date("2026-09-28T10:00:00.000Z"),
    });
    const before = untouched(t);
    withOptimisticRetry(t.firestore, () => t.firestore.docs.set(PROFILE_PATH, { ...ADULT_PROFILE, age: 16 }));

    await expectRefusal(t.commitSuggestion(1, "cand-1"), "NOT_ELIGIBLE");
    expect(replacementSuggestionSetSchema.parse(t.firestore.docs.get(suggestionPath())).candidates.map((c) => c.consumedByRequestId)).toEqual([null, null]);
    expect(untouched(t)).toEqual(before);
  });

  it("an undo refused this way leaves the head as it was", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    const before = untouched(t);
    withOptimisticRetry(t.firestore, () => t.firestore.docs.set(PROFILE_PATH, { ...ADULT_PROFILE, age: 15 }));

    await expectRefusal(t.undo(2, { expectedRevision: 1 }), "NOT_ELIGIBLE");
    expect(t.head()?.revision).toBe(1);
    expect(untouched(t)).toEqual(before);
  });

  it("an uncontended adult commit reads the profile in the same transaction as the head and the entry", async () => {
    const t = setup();
    const { readSets } = withOptimisticRetry(t.firestore, () => undefined);
    await t.commitPlanMeal(1);
    expect(readSets).toEqual([[PROFILE_PATH, headPath(), entryPath()]]);
    expect(t.head()?.revision).toBe(1);
  });

  it("the handler reads the profile nowhere but inside the transaction", () => {
    const source = readFileSync(join(__dirname, "updateSlot.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const transaction = source.slice(source.indexOf(".runTransaction("));
    expect(source.slice(0, source.indexOf(".runTransaction("))).not.toMatch(/userRef\.get\(|getNutritionEligibility\(/);
    expect([...source.matchAll(/getNutritionEligibility\(/g)]).toHaveLength(1);
    expect(transaction).toMatch(/getNutritionEligibility\(\s*parseNutritionProfile\(\(\(await tx\.get\(userRef\)\)/);
  });
});

describe("dates", () => {
  it("today and a later date the plan owns can be changed", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await t.commitPlanMeal(2, "m-2-1", { date: TOMORROW });
    expect(t.head()?.revision).toBe(1);
    expect(t.head(headPath(TOMORROW))?.revision).toBe(1);
  });

  it("yesterday is DATE_FROZEN, for a commit and for an undo", async () => {
    const t = setup();
    await expectRefusal(t.commitPlanMeal(1, "m-2-1", { date: YESTERDAY }), "DATE_FROZEN");
    await expectRefusal(t.undo(2, { date: YESTERDAY }), "DATE_FROZEN");
    expect(t.head(headPath(YESTERDAY))).toBeNull();
  });

  it("uses the server's Berlin day, not a UTC date slice", async () => {
    // 22:30 UTC on 27 Sep is already 00:30 on 28 Sep in Berlin.
    const t = setup({ now: new Date("2026-09-27T22:30:00.000Z") });
    await expectRefusal(t.commitPlanMeal(1, "m-2-1", { date: YESTERDAY }), "DATE_FROZEN");
    await expect(t.commitPlanMeal(2)).resolves.toMatchObject({ revision: 1 });
  });

  it("a head committed for today is frozen once the day has passed", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    t.clock.now = new Date("2026-09-29T08:00:00.000Z");
    await expectRefusal(t.undo(2, { expectedRevision: 1 }), "DATE_FROZEN");
    expect(t.head()?.revision).toBe(1);
  });
});

describe("the plan that owns the date (NUT-09)", () => {
  it("refuses a plan that does not own the date", async () => {
    const t = setup({ plans: { "plan-1": storedPlan("plan-1"), "plan-2": storedPlan("plan-2", { startDate: "2026-09-30" }) } });
    await expectRefusal(t.commitPlanMeal(1, "m-2-1", { planId: "plan-2" }), "PLAN_CHANGED_FOR_DATE");
    await expectRefusal(t.commitPlanMeal(2, "m-2-1", { planId: "plan-404" }), "PLAN_CHANGED_FOR_DATE");
    // 5 Oct is past plan-1's end, and no plan owns it.
    await expectRefusal(t.commitPlanMeal(3, "m-2-1", { date: "2026-10-05" }), "PLAN_CHANGED_FOR_DATE");
    expect(t.firestore.under(SLOTS)).toEqual([]);
  });

  it("a future successor as state.activePlanId leaves the predecessor editing the dates it still owns", async () => {
    // Next week's repeat is already active from 30 Sep; plan-1 owns 23–29 Sep.
    const t = setup({
      plans: {
        "plan-1": supersededPlan("plan-1", TOMORROW, "plan-2"),
        "plan-2": storedPlan("plan-2", { startDate: "2026-09-30", source: "repeated", repeatedFromPlanId: "plan-1" }),
      },
      state: storedState({ activePlanId: "plan-2" }),
    });
    const plansBefore = [JSON.stringify(t.firestore.docs.get(planPath("plan-1"))), JSON.stringify(t.firestore.docs.get(planPath("plan-2")))];

    await expect(t.commitPlanMeal(1)).resolves.toMatchObject({ planId: "plan-1", revision: 1 });
    expect(t.head()?.planId).toBe("plan-1");
    // The active pointer's plan does not own today …
    await expectRefusal(t.commitPlanMeal(2, "m-2-1", { planId: "plan-2" }), "PLAN_CHANGED_FOR_DATE");
    // … and the predecessor does not own the successor's dates.
    await expectRefusal(t.commitPlanMeal(3, "m-2-1", { date: "2026-09-30" }), "PLAN_CHANGED_FOR_DATE");
    await expect(t.commitPlanMeal(4, "m-2-1", { planId: "plan-2", date: "2026-09-30" })).resolves.toMatchObject({ revision: 1 });
    expect(t.firestore.under(SLOTS).map(([path]) => path).sort()).toEqual(
      [headPath(), headPath("2026-09-30", "lunch", "plan-2")].sort()
    );
    // No plan document changed.
    expect([JSON.stringify(t.firestore.docs.get(planPath("plan-1"))), JSON.stringify(t.firestore.docs.get(planPath("plan-2")))]).toEqual(plansBefore);
  });

  it("an activation that takes the date first makes the replacement PLAN_CHANGED_FOR_DATE, never a write into the stale plan", async () => {
    const t = setup();
    const activation = activateNutritionPlan(
      { firestore: t.firestore, policies: fixturePlanValidationPolicyRegistry([FIXTURE_ACCEPT_PLAN_VALIDATION_POLICY]) },
      {
        uid: UID,
        planId: "plan-2",
        content: makeContent(TOMORROW),
        origin: { source: "generated", generationRequestId: null },
        targetVersionId: "target-1",
        expectedActivePlanId: "plan-1",
        reusableValidation: null,
        request: null,
        now: NOW,
      }
    );
    // Issued together; the activation's transaction commits first.
    const [activated, tomorrow, today] = await Promise.allSettled([
      activation,
      t.commitPlanMeal(1, "m-2-1", { date: TOMORROW }),
      t.commitPlanMeal(2, "m-2-1"),
    ]);
    expect(activated.status).toBe("fulfilled");
    expect(tomorrow.status === "rejected" && (tomorrow.reason as NutritionSlotError).code).toBe("PLAN_CHANGED_FOR_DATE");
    // plan-1 still owns today.
    expect(today.status).toBe("fulfilled");
    expect(t.head(headPath(TOMORROW))).toBeNull();
    expect(t.head()?.planId).toBe("plan-1");
  });

  it("refuses a slot the plan does not configure", async () => {
    const t = setup();
    await expectRefusal(t.commitPlanMeal(1, "m-2-1", { slotId: "snack_1" }), "SLOT_NOT_CONFIGURED");
    await expectRefusal(t.undo(2, { slotId: "snack_1" }), "SLOT_NOT_CONFIGURED");
  });

  it("a plan whose base meal is missing is an integrity failure, not an empty slot", async () => {
    const broken = storedPlan("plan-1") as { days: Array<{ meals: Array<{ slotId: string }> }> };
    broken.days[5].meals = broken.days[5].meals.filter((meal) => meal.slotId !== "lunch");
    const t = setup({ plans: { "plan-1": broken as unknown as Record<string, unknown> } });
    await expectRefusal(t.commitPlanMeal(1), "INTERNAL");
    expect(t.head()).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The request
 * ------------------------------------------------------------------ */

describe("the request carries ids only", () => {
  const valid = {
    action: "commit",
    requestId: requestId(1),
    planId: "plan-1",
    date: TODAY,
    slotId: "lunch",
    expectedRevision: 0,
    replacement: { source: "planMeal", sourceMealId: "m-2-1" },
  };

  it.each([
    ["a uid", { ...valid, uid: "mallory" }],
    ["a meal name", { ...valid, name: "Schnitzel" }],
    ["kcal", { ...valid, kcal: 1 }],
    ["a meal object", { ...valid, meal: { name: "x", values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 } } }],
    ["an override id", { ...valid, overrideId: minted(9) }],
    ["a new meal id", { ...valid, replacement: { ...valid.replacement, mealId: "chosen-by-client" } }],
    ["values in the replacement", { ...valid, replacement: { ...valid.replacement, values: { kcal: 1 } } }],
    ["a head", { ...valid, head: { revision: 9 } }],
    ["a profile field", { ...valid, age: 40 }],
    ["an unknown action", { ...valid, action: "replace" }],
    ["an unknown source", { ...valid, replacement: { source: "user", sourceMealId: "m-2-1" } }],
    ["an upper-case request id", { ...valid, requestId: "3F2B8C1E-9A4D-4E6F-8B21-7C5D0E9A1B34" }],
    ["a negative revision", { ...valid, expectedRevision: -1 }],
    ["a fractional revision", { ...valid, expectedRevision: 0.5 }],
    ["a malformed date", { ...valid, date: "28.09.2026" }],
    ["an undo with a replacement", { ...valid, action: "undo" }],
    ["nothing", undefined],
  ])("refuses %s as INVALID_REQUEST and writes nothing", async (_label, data) => {
    const t = setup();
    await expectRefusal(t.call(data), "INVALID_REQUEST");
    expect(t.firestore.under(SLOTS)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Revisions and idempotency
 * ------------------------------------------------------------------ */

describe("compare-and-set and request idempotency", () => {
  it("an absent head is revision 0; the first commit creates revision 1", async () => {
    const t = setup();
    expect(t.head()).toBeNull();
    await t.commitPlanMeal(1);
    const head = t.head() as SlotHead;
    expect(head).toMatchObject({ schemaVersion: 2, planId: "plan-1", date: TODAY, slotId: "lunch", revision: 1 });
    expect(head.appliedRequestIds).toEqual([requestId(1)]);
    expect(Object.keys(head.overrides)).toEqual([minted(1)]);
    // Stored with server timestamps.
    const stored = t.firestore.docs.get(headPath()) as { updatedAt: unknown; overrides: Record<string, { createdAt: unknown }> };
    expect(stored.updatedAt).toBeInstanceOf(Timestamp);
    expect(stored.overrides[minted(1)].createdAt).toBeInstanceOf(Timestamp);
    expect(head.updatedAt).toEqual({ seconds: Timestamp.fromDate(NOW).seconds, nanoseconds: 0 });
  });

  it("the matching revision applies and moves it by exactly one", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await expect(t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 })).resolves.toMatchObject({ revision: 2 });
    expect(t.head()?.revision).toBe(2);
  });

  it("a stale revision is refused with the current revision and changes nothing", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    const before = t.snapshot();
    const error = await refusal(t.commitPlanMeal(2, "m-3-1", { expectedRevision: 0 }));
    expect(error.code).toBe("STALE_REVISION");
    expect(error.details).toEqual({ currentRevision: 1 });
    const https = toNutritionHttpsError(error);
    expect([https.code, https.message, https.details]).toEqual(["aborted", "STALE_REVISION", { currentRevision: 1 }]);
    expect(t.snapshot()).toEqual(before);

    // An absent head is at 0: naming anything else is stale too.
    const fresh = setup();
    expect((await refusal(fresh.commitPlanMeal(1, "m-2-1", { expectedRevision: 3 }))).details).toEqual({ currentRevision: 0 });
  });

  it("never retries the action against the newer revision", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await expectRefusal(t.commitPlanMeal(2, "m-3-1", { expectedRevision: 0 }), "STALE_REVISION");
    expect(t.head()?.appliedRequestIds).toEqual([requestId(1)]);
    expect(Object.keys(t.head()?.overrides ?? {})).toHaveLength(1);
  });

  it("a replayed request id answers before the revision is compared, and writes nothing", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 });
    const before = t.snapshot();

    // Still names revision 0: a replay is a success, never STALE_REVISION.
    await expect(t.commitPlanMeal(1)).resolves.toEqual({
      ok: true,
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      revision: 2,
      selection: { kind: "override", overrideId: minted(3) },
      replay: true,
    });
    expect(t.snapshot()).toEqual(before);
    expect(Object.keys(t.head()?.overrides ?? {})).toHaveLength(2);
  });

  it("keeps a bounded ring of request ids, evicting the oldest", async () => {
    const t = setup();
    const total = NUTRITION_SLOT_REQUEST_RING_SIZE + 5;
    for (let n = 1; n <= total; n += 1) {
      // Alternate commit and undo so every request applies.
      if (n % 2 === 1) await t.commitPlanMeal(n, "m-2-1", { expectedRevision: n - 1 });
      else await t.undo(n, { expectedRevision: n - 1 });
    }
    const head = t.head() as SlotHead;
    expect(head.revision).toBe(total);
    expect(head.appliedRequestIds).toHaveLength(NUTRITION_SLOT_REQUEST_RING_SIZE);
    expect(head.appliedRequestIds[0]).toBe(requestId(6));
    expect(head.appliedRequestIds.at(-1)).toBe(requestId(total));
    // The history keeps every override.
    expect(Object.keys(head.overrides)).toHaveLength(Math.ceil(total / 2));
  });
});

/* ------------------------------------------------------------------ *
 * Plan-meal replacements
 * ------------------------------------------------------------------ */

describe("a replacement from the plan's own base meals", () => {
  it("copies the server's base meal under a new server meal id", async () => {
    const t = setup();
    await t.commitPlanMeal(1, "m-2-1");
    const override = selectedMealOverride(t.head());
    const source = baseMeal("plan-1", "m-2-1", t.firestore);
    expect(override).toEqual({
      overrideId: minted(1),
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      baseMealId: BASE_LUNCH,
      previousOverrideId: null,
      meal: { mealId: minted(2), slotId: "lunch", name: source?.name, values: source?.values },
      source: { kind: "planMeal", sourceMealId: "m-2-1" },
      createdAtRevision: 1,
      createdAt: { seconds: Timestamp.fromDate(NOW).seconds, nanoseconds: 0 },
    });
    // The new meal id is minted, never the source's or the base meal's.
    expect(override?.meal.mealId).not.toBe("m-2-1");
    expect(override?.meal.mealId).not.toBe(BASE_LUNCH);
  });

  it.each([
    ["a meal that does not exist", "m-404"],
    ["a meal of another slot", "m-2-0"],
    ["the date's own base meal (Undo returns to it)", BASE_LUNCH],
  ])("refuses %s as INVALID_SOURCE_MEAL", async (_label, sourceMealId) => {
    const t = setup();
    await expectRefusal(t.commitPlanMeal(1, sourceMealId), "INVALID_SOURCE_MEAL");
    expect(t.head()).toBeNull();
  });

  it("refuses a meal of another plan", async () => {
    const other = storedPlan("plan-2", { startDate: "2026-09-30" }) as { days: Array<{ meals: Array<{ mealId: string }> }> };
    other.days[0].meals[1].mealId = "only-in-plan-2";
    const t = setup({ plans: { "plan-1": storedPlan("plan-1"), "plan-2": other as unknown as Record<string, unknown> } });
    await expectRefusal(t.commitPlanMeal(1, "only-in-plan-2"), "INVALID_SOURCE_MEAL");
  });

  it("never replaces from an override: a replacement's own meal id is not a source", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await expectRefusal(t.commitPlanMeal(3, minted(2), { expectedRevision: 1 }), "INVALID_SOURCE_MEAL");
  });

  it("changes no plan, target, state or entry", async () => {
    const t = setup();
    const untouched = () =>
      [...t.firestore.docs.entries()].filter(([path]) => !path.startsWith(SLOTS)).map(([path, data]) => [path, JSON.stringify(data)]);
    const before = untouched();
    await t.commitPlanMeal(1);
    await t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 });
    await t.undo(3, { expectedRevision: 2 });
    expect(untouched()).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Undo
 * ------------------------------------------------------------------ */

describe("undo", () => {
  it("returns a first override to the base meal and keeps it in the history", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    const committed = t.head() as SlotHead;
    await expect(t.undo(2, { expectedRevision: 1 })).resolves.toMatchObject({ revision: 2, selection: { kind: "base" } });
    const head = t.head() as SlotHead;
    expect(head.selection).toEqual({ kind: "base" });
    expect(head.overrides).toEqual(committed.overrides);
    expect(head.appliedRequestIds).toEqual([requestId(1), requestId(2)]);
  });

  it("walks back through the history one override at a time", async () => {
    const t = setup();
    await t.commitPlanMeal(1, "m-2-1"); // A = minted(1), rev 1
    await t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 }); // B = minted(3), rev 2
    const history = (t.head() as SlotHead).overrides;
    expect(history[minted(3)].previousOverrideId).toBe(minted(1));

    await expect(t.undo(3, { expectedRevision: 2 })).resolves.toMatchObject({
      revision: 3,
      selection: { kind: "override", overrideId: minted(1) },
    });
    await expect(t.undo(4, { expectedRevision: 3 })).resolves.toMatchObject({ revision: 4, selection: { kind: "base" } });
    await expectRefusal(t.undo(5, { expectedRevision: 4 }), "NOTHING_TO_UNDO");
    expect((t.head() as SlotHead).overrides).toEqual(history);
    expect(t.head()?.revision).toBe(4);
  });

  it("a replayed undo does not move the revision again", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await t.undo(2, { expectedRevision: 1 });
    const before = t.snapshot();
    await expect(t.undo(2, { expectedRevision: 1 })).resolves.toMatchObject({ revision: 2, replay: true });
    expect(t.snapshot()).toEqual(before);
  });

  it("a stale undo is refused", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    await t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 });
    const error = await refusal(t.undo(3, { expectedRevision: 1 }));
    expect([error.code, error.details]).toEqual(["STALE_REVISION", { currentRevision: 2 }]);
  });

  it("an absent head has nothing to undo", async () => {
    const t = setup();
    await expectRefusal(t.undo(1), "NOTHING_TO_UNDO");
    expect(t.head()).toBeNull();
  });

  it("is blocked when the plan no longer owns the date", async () => {
    const t = setup();
    await t.commitPlanMeal(1, "m-2-1", { date: TOMORROW });
    t.firestore.docs.set(planPath("plan-1"), supersededPlan("plan-1", TODAY, "plan-2"));
    t.firestore.docs.set(planPath("plan-2"), storedPlan("plan-2", { startDate: TOMORROW }));
    await expectRefusal(t.undo(2, { date: TOMORROW, expectedRevision: 1 }), "PLAN_CHANGED_FOR_DATE");
  });
});

/* ------------------------------------------------------------------ *
 * Recorded entries
 * ------------------------------------------------------------------ */

const intentUuid = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;

/** A NUT-06 intent recording `meal` as eaten for today's lunch, made against `expectedRevision`. */
const recordIntent = (n: number, meal: { name: string; values: Record<string, number> }, expectedRevision = 0): NutritionEntryIntent => ({
  intentId: intentUuid(n),
  entryId: slotEntryId(TODAY, "lunch"),
  op: "record",
  expectedRevision,
  desired: {
    schemaVersion: 2,
    entryId: slotEntryId(TODAY, "lunch"),
    kind: "slot",
    date: TODAY,
    slotId: "lunch",
    recording: "plannedMeal",
    planId: "plan-1",
    name: meal.name,
    estimateBasis: "planMealTimesPortion",
    portion: 1,
    nutritionEstimate: { kcal: meal.values.kcal, proteinG: meal.values.proteinG, carbsG: meal.values.carbsG, fatG: meal.values.fatG },
  },
});

/**
 * The NUT-06/NUT-07 entry write, as the client transaction and offline replay
 * run it: read the entry, ask the one shared planner, write exactly its answer.
 */
const writeEntry = (firestore: ReturnType<typeof setup>["firestore"], intent: NutritionEntryIntent) =>
  (firestore as unknown as FakeFirestore).runTransaction(async (tx) => {
    const ref = { path: ENTRIES + intent.entryId };
    const snap = await tx.get(ref);
    const current = snap.exists ? (recordedEntrySchema.parse(snap.data()) as RecordedEntry) : null;
    const plan = planNutritionEntryWrite(current, intent);
    if (plan.outcome === "apply") tx.set(ref, plan.entry as unknown as Record<string, unknown>);
    return plan.outcome;
  });

describe("an active recorded entry blocks the slot", () => {
  it("refuses commit and undo with SLOT_HAS_RECORD and touches neither head nor entry", async () => {
    const t = setup();
    await t.commitPlanMeal(1);
    const meal = baseMeal("plan-1", BASE_LUNCH, t.firestore) as { name: string; values: Record<string, number> };
    expect(await writeEntry(t.firestore, recordIntent(1, meal))).toBe("apply");
    const before = t.snapshot();

    await expectRefusal(t.commitPlanMeal(2, "m-3-1", { expectedRevision: 1 }), "SLOT_HAS_RECORD");
    await expectRefusal(t.undo(3, { expectedRevision: 1 }), "SLOT_HAS_RECORD");
    expect(t.snapshot()).toEqual(before);
  });

  it("a removed tombstone, an entry of another slot, or no entry does not block", async () => {
    const t = setup();
    const meal = baseMeal("plan-1", BASE_LUNCH, t.firestore) as { name: string; values: Record<string, number> };
    await writeEntry(t.firestore, recordIntent(1, meal));
    await writeEntry(t.firestore, { intentId: intentUuid(2), entryId: slotEntryId(TODAY, "lunch"), op: "remove", expectedRevision: 1 });
    expect(t.firestore.docs.get(entryPath())).toMatchObject({ status: "removed" });
    await expect(t.commitPlanMeal(1)).resolves.toMatchObject({ revision: 1 });

    t.firestore.docs.set(entryPath(TODAY, "dinner"), { ...(t.firestore.docs.get(entryPath()) as object), entryId: slotEntryId(TODAY, "dinner"), slotId: "dinner", status: "active" });
    await expect(t.undo(2, { expectedRevision: 1 })).resolves.toMatchObject({ revision: 2 });
  });

  it("a malformed entry is an integrity failure, not a missing one", async () => {
    const t = setup();
    t.firestore.docs.set(entryPath(), { schemaVersion: 2, entryId: slotEntryId(TODAY, "lunch"), status: "active" });
    await expectRefusal(t.commitPlanMeal(1), "INTERNAL");
  });
});

/* ------------------------------------------------------------------ *
 * Races (§37)
 * ------------------------------------------------------------------ */

describe("races", () => {
  it("A. two commits against the same revision: exactly one applies, the other is STALE_REVISION", async () => {
    const t = setup();
    await t.commitPlanMeal(1); // revision N = 1
    const results = await Promise.allSettled([
      t.commitPlanMeal(2, "m-2-1", { expectedRevision: 1 }),
      t.commitPlanMeal(3, "m-3-1", { expectedRevision: 1 }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as NutritionSlotError).code).toBe("STALE_REVISION");

    const head = t.head() as SlotHead;
    expect(head.revision).toBe(2);
    expect(Object.keys(head.overrides)).toHaveLength(2);
    // No last-write-wins: the loser's request left no trace.
    expect(head.appliedRequestIds).toEqual([requestId(1), requestId(2)]);
    expect(selectedMealOverride(head)?.source).toEqual({ kind: "planMeal", sourceMealId: "m-2-1" });
  });

  it("B. the recording commits first: the replacement is SLOT_HAS_RECORD and the head is untouched", async () => {
    const t = setup();
    const meal = baseMeal("plan-1", BASE_LUNCH, t.firestore) as { name: string; values: Record<string, number> };
    const [recorded, replaced] = await Promise.allSettled([writeEntry(t.firestore, recordIntent(1, meal)), t.commitPlanMeal(1)]);
    expect(recorded).toEqual({ status: "fulfilled", value: "apply" });
    expect(replaced.status === "rejected" && (replaced.reason as NutritionSlotError).code).toBe("SLOT_HAS_RECORD");
    expect(t.head()).toBeNull();
  });

  it("C. the replacement commits first: the queued recording still replays its captured Meal A under the entry CAS", async () => {
    const t = setup();
    // Captured offline while Meal A (the base meal) was planned.
    const mealA = baseMeal("plan-1", BASE_LUNCH, t.firestore) as { name: string; values: Record<string, number> };
    const captured = recordIntent(1, mealA);

    await t.commitPlanMeal(1, "m-2-1"); // Meal B is planned now.
    expect(await writeEntry(t.firestore, captured)).toBe("apply");

    const entry = recordedEntrySchema.parse(t.firestore.docs.get(entryPath()));
    expect(entry).toMatchObject({ recording: "plannedMeal", name: mealA.name, nutritionEstimate: mealA.values, revision: 1 });
    const mealB = baseMeal("plan-1", "m-2-1", t.firestore);
    expect(selectedMealOverride(t.head())?.meal).toMatchObject({ name: mealB?.name, values: mealB?.values });
    // A replay of the same intent is alreadyApplied, not a second recording.
    expect(await writeEntry(t.firestore, captured)).toBe("alreadyApplied");
  });

  it("§43: a recording of Meal A stays Meal A through commit A→B, undo back to base, and a later override C", async () => {
    const t = setup();
    const mealA = baseMeal("plan-1", BASE_LUNCH, t.firestore) as { name: string; values: Record<string, number> };
    const captured = recordIntent(1, mealA);
    const snapshotOf = () => {
      const entry = recordedEntrySchema.parse(t.firestore.docs.get(entryPath()));
      return entry.recording === "plannedMeal" ? [entry.name, entry.portion, entry.nutritionEstimate] : null;
    };

    await t.commitPlanMeal(1, "m-2-1"); // A → B
    await writeEntry(t.firestore, captured); // the recording of A lands afterwards
    const recorded = snapshotOf();
    expect(recorded).toEqual([mealA.name, 1, mealA.values]);

    // While it is active the slot is frozen …
    await expectRefusal(t.undo(2, { expectedRevision: 1 }), "SLOT_HAS_RECORD");
    // … once taken back, the planned side can move on; the tombstone keeps its snapshot.
    await writeEntry(t.firestore, { intentId: intentUuid(2), entryId: slotEntryId(TODAY, "lunch"), op: "remove", expectedRevision: 1 });
    await t.undo(3, { expectedRevision: 1 }); // B → base (A)
    await t.commitPlanMeal(4, "m-3-1", { expectedRevision: 2 }); // → C
    expect(selectedMealOverride(t.head())?.source).toEqual({ kind: "planMeal", sourceMealId: "m-3-1" });
    expect(snapshotOf()).toEqual(recorded);
    expect(t.firestore.docs.get(entryPath())).toMatchObject({ status: "removed", revision: 2 });
  });
});

/* ------------------------------------------------------------------ *
 * Server-held suggestions
 * ------------------------------------------------------------------ */

const LATER = new Date("2026-09-28T10:00:00.000Z");

describe("a replacement from a server-held suggestion", () => {
  const seed = (t: ReturnType<typeof setup>, over: Partial<Parameters<typeof seedFixtureSuggestionSet>[1]> = {}) =>
    seedFixtureSuggestionSet(t.firestore, {
      uid: UID,
      planId: "plan-1",
      date: TODAY,
      slotId: "lunch",
      createdAt: new Date("2026-09-28T09:00:00.000Z"),
      expiresAt: LATER,
      ...over,
    });

  it("commits the candidate's server meal, its provenance, and consumes it in the same transaction", async () => {
    const t = setup();
    const set = await seed(t);
    await expect(t.commitSuggestion(1, "cand-2")).resolves.toMatchObject({ revision: 1, selection: { kind: "override", overrideId: minted(1) } });

    const override = selectedMealOverride(t.head());
    expect(override?.meal).toEqual(set.candidates[1].meal);
    expect(override?.source).toEqual({
      kind: "aiSuggestion",
      suggestionSetId: "set-1",
      candidateId: "cand-2",
      validation: FIXTURE_REPLACEMENT_VALIDATION,
    });
    const stored = replacementSuggestionSetSchema.parse(t.firestore.docs.get(suggestionPath()));
    expect(stored.candidates.map((candidate) => candidate.consumedByRequestId)).toEqual([null, requestId(1)]);
    // Only the consumption changed.
    expect({ ...stored, candidates: stored.candidates.map((c) => ({ ...c, consumedByRequestId: null })) }).toEqual(set);
  });

  it("keeps the snapshot after the set is deleted", async () => {
    const t = setup();
    const set = await seed(t);
    await t.commitSuggestion(1, "cand-1");
    t.firestore.docs.delete(suggestionPath());
    expect(selectedMealOverride(t.head())?.meal).toEqual(set.candidates[0].meal);
    // Undo and a new plan-meal commit do not need the set either.
    await t.undo(2, { expectedRevision: 1 });
    expect(t.head()?.overrides[minted(1)].meal).toEqual(set.candidates[0].meal);
  });

  it("refuses candidate content from the client", async () => {
    const t = setup();
    await seed(t);
    await expectRefusal(
      t.call({
        action: "commit",
        requestId: requestId(1),
        planId: "plan-1",
        date: TODAY,
        slotId: "lunch",
        expectedRevision: 0,
        replacement: { source: "aiSuggestion", suggestionSetId: "set-1", candidateId: "cand-1", meal: { name: "Pizza" } },
      }),
      "INVALID_REQUEST"
    );
  });

  it.each([
    ["an unknown set", {}, "set-404", "cand-1", "SUGGESTION_NOT_FOUND"],
    ["a set for another slot", { slotId: "dinner" as const }, "set-1", "cand-1", "SUGGESTION_NOT_FOUND"],
    ["a set for another date", { date: TOMORROW }, "set-1", "cand-1", "SUGGESTION_NOT_FOUND"],
    ["an unknown candidate", {}, "set-1", "cand-9", "CANDIDATE_NOT_FOUND"],
  ])("refuses %s", async (_label, over, setId, candidateId, code) => {
    const t = setup();
    await seed(t, over);
    await expectRefusal(t.commitSuggestion(1, candidateId, {}, setId), code as NutritionSlotError["code"]);
    expect(t.head()).toBeNull();
  });

  it("refuses another account's set, even when a caller names its id", async () => {
    const t = setup();
    await seed(t, { uid: "bob" });
    expect(t.firestore.docs.has(suggestionPath("set-1", "bob"))).toBe(true);
    await expectRefusal(t.commitSuggestion(1), "SUGGESTION_NOT_FOUND");
    // A set filed under alice's id that names another owner is not alice's either.
    t.firestore.docs.set(suggestionPath(), { ...(t.firestore.docs.get(suggestionPath("set-1", "bob")) as object) });
    await expectRefusal(t.commitSuggestion(2), "SUGGESTION_NOT_FOUND");
  });

  it("refuses an expired set (expiresAt <= now)", async () => {
    const atExpiry = setup();
    await seed(atExpiry, { expiresAt: NOW });
    await expectRefusal(atExpiry.commitSuggestion(1), "SUGGESTION_EXPIRED");

    const afterExpiry = setup();
    await seed(afterExpiry);
    afterExpiry.clock.now = new Date(LATER.getTime() + 1);
    await expectRefusal(afterExpiry.commitSuggestion(1), "SUGGESTION_EXPIRED");
    expect(afterExpiry.head()).toBeNull();
    expect(replacementSuggestionSetSchema.parse(afterExpiry.firestore.docs.get(suggestionPath())).candidates[0].consumedByRequestId).toBeNull();
  });

  it("a consumed candidate is refused for another request, and a replay of the consuming request succeeds", async () => {
    const t = setup();
    await seed(t);
    await t.commitSuggestion(1, "cand-1");
    await t.undo(2, { expectedRevision: 1 });
    // Undo does not unconsume.
    const afterUndo = replacementSuggestionSetSchema.parse(t.firestore.docs.get(suggestionPath()));
    expect(afterUndo.candidates[0].consumedByRequestId).toBe(requestId(1));

    await expectRefusal(t.commitSuggestion(3, "cand-1", { expectedRevision: 2 }), "SUGGESTION_ALREADY_CONSUMED");
    const before = t.snapshot();
    await expect(t.commitSuggestion(1, "cand-1")).resolves.toMatchObject({ replay: true, revision: 2 });
    expect(t.snapshot()).toEqual(before);
    // Another candidate of the same set is still available.
    await expect(t.commitSuggestion(4, "cand-2", { expectedRevision: 2 })).resolves.toMatchObject({ revision: 3 });
  });

  it("a malformed set is an integrity failure", async () => {
    const t = setup();
    t.firestore.docs.set(suggestionPath(), { schemaVersion: 2, ownerUid: UID, suggestionSetId: "set-1" });
    await expectRefusal(t.commitSuggestion(1), "INTERNAL");
  });
});

describe("the suggestion storage helper", () => {
  const input = {
    uid: UID,
    suggestionSetId: "set-1",
    planId: "plan-1",
    date: TODAY,
    slotId: "lunch" as const,
    candidates: [{ candidateId: "c-1", meal: { mealId: "s-meal-1", slotId: "lunch" as const, name: "Fixture", values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 } } }],
    validation: { policy: { id: "test-fixture-replacement-accept", version: 1 }, outcome: "accepted" as const },
    createdAt: NOW,
    expiresAt: LATER,
  };

  it("stores a complete, unconsumed, server-only set under {uid}__{setId}, with Timestamps", async () => {
    const t = setup();
    await storeReplacementSuggestionSet(t.firestore, input);
    const stored = t.firestore.docs.get(suggestionPath()) as Record<string, unknown>;
    expect(stored.expiresAt).toBeInstanceOf(Timestamp);
    expect(replacementSuggestionSetSchema.parse(stored)).toMatchObject({ ownerUid: UID, candidates: [{ consumedByRequestId: null }] });
    expect(t.firestore.under(`users/${UID}/`).some(([path]) => /suggest/i.test(path))).toBe(false);
  });

  it.each([
    ["no expiry", { expiresAt: undefined as unknown as Date }],
    ["an expiry not after creation", { expiresAt: NOW }],
    ["a candidate for another slot", { candidates: [{ ...input.candidates[0], meal: { ...input.candidates[0].meal, slotId: "dinner" as const } }] }],
    ["no candidates", { candidates: [] }],
    ["duplicate candidate ids", { candidates: [input.candidates[0], { ...input.candidates[0], meal: { ...input.candidates[0].meal, mealId: "s-meal-2" } }] }],
    ["an invalid meal", { candidates: [{ ...input.candidates[0], meal: { ...input.candidates[0].meal, values: { kcal: -1, proteinG: 1, carbsG: 1, fatG: 1 } } }] }],
  ])("refuses %s and stores nothing", async (_label, over) => {
    const t = setup();
    await expectRefusal(storeReplacementSuggestionSet(t.firestore, { ...input, ...over }), "INTERNAL");
    expect(t.firestore.docs.has(suggestionPath())).toBe(false);
  });

  it("never overwrites an existing set", async () => {
    const t = setup();
    await storeReplacementSuggestionSet(t.firestore, input);
    await expect(storeReplacementSuggestionSet(t.firestore, input)).rejects.toThrow();
  });
});

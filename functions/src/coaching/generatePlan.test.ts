import { describe, it, expect } from "vitest";
import { handleGenerateWorkoutPlan, type PlanGenerationDeps } from "./generatePlan";
import { createFirestoreQuotaStore, QUOTA_COLLECTION, quotaPeriod } from "../quota/firestoreQuotaStore";
import { createFirestoreOperationStore, OPERATION_COLLECTION } from "../idempotency";
import { AI_LOG_COLLECTION } from "../logging/firestoreAiLogWriter";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import { fakeFirestore, type FakeFirestore } from "../testing/fakeFirestore";
import type { GeminiProvider, ProviderResult, TokenUsage } from "./providers/gemini";
import { AiError } from "../errors";

/*
  The whole pipeline, without a network or an emulator.

  What these tests are really about is money and trust: that the provider is
  not called when the request can be refused for free, that a user cannot be
  charged twice for one click, and that nothing invalid ever reaches a user's
  plan collection.
*/

const UID = "alice";
const REQUEST_ID = "3f1a6f28-9c4e-4a1b-8f2d-77c0b5e1a9d4";
const NOW = new Date("2026-08-27T10:00:00.000Z");

const COMPLETE_PROFILE = {
  fullName: "Alice Beispiel",
  email: "alice@example.com",
  fitnessGoal: "gainMuscle",
  experienceLevel: "intermediate",
  equipment: ["dumbbells", "pullup_bar"],
  daysPerWeek: 3,
  sessionMinutes: 60,
  role: "user",
};

const DAY_LABELS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/**
 * A plan that matches the profile above: three training days, and only
 * exercises the profile's equipment (dumbbells, pull-up bar) can do.
 *
 * The shared fixture is not reused here because it prescribes Bankdrücken,
 * which needs a barbell — the semantic check rejects it against this profile,
 * correctly, which is the subject of its own test below.
 */
const validPlanWeek = () =>
  DAY_LABELS.map((day, index) =>
    index === 0 || index === 2 || index === 4
      ? {
          day,
          exercises: [
            { name: "Kurzhantel-Schulterdrücken", sets: 4, reps: "8-10" },
            { name: "Klimmzüge", sets: 3, reps: "6-8" },
          ],
        }
      : { day, exercises: [] }
  );

const validPlan = () => ({
  "Week 1": validPlanWeek(),
  "Week 2": validPlanWeek(),
  "Week 3": validPlanWeek(),
  "Week 4": validPlanWeek(),
});

interface Harness {
  db: FakeFirestore & ReturnType<typeof fakeFirestore>;
  deps: PlanGenerationDeps;
  providerCalls: Array<{ repair: string | undefined }>;
  logs: Array<Record<string, unknown>>;
}

const harness = (options: {
  profile?: Record<string, unknown> | null;
  responses?: Array<unknown | Error>;
  usage?: Array<TokenUsage>;
  failWrites?: (path: string) => boolean;
} = {}): Harness => {
  const db = fakeFirestore({ failWrites: options.failWrites });
  if (options.profile !== null) {
    db.docs.set("users/" + UID, { ...(options.profile ?? COMPLETE_PROFILE) });
  }

  const responses = options.responses ?? [validPlan()];
  const providerCalls: Array<{ repair: string | undefined }> = [];
  const logs: Array<Record<string, unknown>> = [];

  const provider: GeminiProvider = {
    id: "google-gemini",
    generatePlanWithUsage: async (_input, repair): Promise<ProviderResult> => {
      const index = providerCalls.length;
      providerCalls.push({ repair });
      const response = responses[Math.min(index, responses.length - 1)];
      if (response instanceof Error) throw response;
      return { output: response, usage: options.usage?.[index] ?? {} };
    },
    generatePlan: async () => undefined,
    summariseWeeklyReview: async () => undefined,
  };

  const deps: PlanGenerationDeps = {
    firestore: db,
    provider,
    quota: createFirestoreQuotaStore({ firestore: db, now: () => NOW }),
    operations: createFirestoreOperationStore(db, () => NOW),
    log: async (entry) => {
      logs.push({ ...entry });
    },
    now: () => NOW,
    newPlanId: () => "plan-1",
  };

  return { db, deps, providerCalls, logs };
};

const call = (h: Harness, over: Record<string, unknown> = {}) =>
  handleGenerateWorkoutPlan(
    { auth: { uid: UID }, data: { requestId: REQUEST_ID }, ...over },
    h.deps
  );

const quotaCount = (h: Harness): number => {
  const doc = h.db.docs.get(
    `${QUOTA_COLLECTION}/${UID}__plan_generation__${quotaPeriod(NOW)}`
  );
  return (doc?.count as number) ?? 0;
};

const plans = (h: Harness) => h.db.under(`users/${UID}/workout_plans`);

describe("authentication and request shape", () => {
  it("refuses an unauthenticated call before anything else happens", async () => {
    const h = harness();

    await expect(call(h, { auth: undefined })).rejects.toThrow(/Authentication required/);
    expect(h.providerCalls).toHaveLength(0);
    expect(quotaCount(h)).toBe(0);
  });

  it("believes the token, not a uid in the payload", async () => {
    const h = harness();
    h.db.docs.set("users/victim", { ...COMPLETE_PROFILE });

    await call(h, { data: { requestId: REQUEST_ID, uid: "victim", userId: "victim" } });

    // The plan landed under the authenticated user, not the claimed one.
    expect(plans(h).map(([path]) => path)).toEqual([`users/${UID}/workout_plans/plan-1`]);
    expect(h.db.under("users/victim/workout_plans")).toHaveLength(0);
  });

  it.each([undefined, "", "not-a-uuid", "3f1a6f289c4e4a1b8f2d77c0b5e1a9d4", 42])(
    "rejects a malformed requestId (%j)",
    async (requestId) => {
      const h = harness();

      await expect(call(h, { data: { requestId } })).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
      expect(h.providerCalls).toHaveLength(0);
    }
  );
});

describe("an incomplete profile costs nothing", () => {
  it("names the missing fields and never calls the provider", async () => {
    const h = harness({ profile: { fullName: "Alice" } });

    await expect(call(h)).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
      details: {
        missingFields: [
          "fitnessGoal",
          "experienceLevel",
          "equipment",
          "daysPerWeek",
          "sessionMinutes",
        ],
      },
    });
    expect(h.providerCalls).toHaveLength(0);
    expect(quotaCount(h)).toBe(0);
  });

  it("refuses a profile that does not exist at all", async () => {
    const h = harness({ profile: null });

    await expect(call(h)).rejects.toMatchObject({ code: "PROFILE_INCOMPLETE" });
  });

  it("guesses nothing for a partially answered profile", async () => {
    const h = harness({
      profile: { fitnessGoal: "gainMuscle", equipment: ["dumbbells"] },
    });

    await expect(call(h)).rejects.toMatchObject({
      details: { missingFields: ["experienceLevel", "daysPerWeek", "sessionMinutes"] },
    });
  });

  it("logs the refusal as an attempt that cost nothing", async () => {
    const h = harness({ profile: { fullName: "Alice" } });

    await call(h).catch(() => undefined);

    expect(h.logs[0]).toMatchObject({ status: "error", providerCalled: false });
    expect(h.logs[0].provider).toBeUndefined();
  });

  it("accepts a legacy goal spelling rather than calling it missing", async () => {
    const h = harness({ profile: { ...COMPLETE_PROFILE, fitnessGoal: "muscle_gain" } });

    await expect(call(h)).resolves.toMatchObject({ ok: true });
  });
});

describe("what reaches the provider", () => {
  it("is built from the profile, never from the request", async () => {
    const h = harness();
    let seen: unknown;
    h.deps.provider.generatePlanWithUsage = async (input) => {
      seen = input;
      return { output: validPlan(), usage: {} };
    };

    await call(h, { data: { requestId: REQUEST_ID, daysPerWeek: 7, equipment: ["full_gym"] } });

    expect(seen).toEqual({
      goal: "gainMuscle",
      experienceLevel: "intermediate",
      equipment: ["dumbbells", "pullup_bar"],
      daysPerWeek: 3,
      sessionMinutes: 60,
    });
  });

  it("carries no name, email or role even though the profile has them", async () => {
    const h = harness();
    let seen: unknown;
    h.deps.provider.generatePlanWithUsage = async (input) => {
      seen = input;
      return { output: validPlan(), usage: {} };
    };

    await call(h);

    const serialised = JSON.stringify(seen);
    expect(serialised).not.toContain("Alice");
    expect(serialised).not.toContain("example.com");
    expect(serialised).not.toContain("role");
  });
});

describe("quota", () => {
  it("charges exactly one for a successful generation", async () => {
    const h = harness();

    await call(h);

    expect(quotaCount(h)).toBe(1);
  });

  it("charges nothing when the provider fails", async () => {
    const h = harness({ responses: [new AiError("PROVIDER_UNAVAILABLE", "down")] });

    await expect(call(h)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(quotaCount(h)).toBe(0);
  });

  it("charges nothing when the output stays invalid after the repair", async () => {
    const h = harness({ responses: [{ nope: true }, { still: "wrong" }] });

    await expect(call(h)).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
    expect(quotaCount(h)).toBe(0);
  });

  it("charges nothing when persistence fails", async () => {
    const h = harness({ failWrites: (path) => path.includes("workout_plans") });

    await expect(call(h)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(quotaCount(h)).toBe(0);
    expect(plans(h)).toHaveLength(0);
  });

  it("refuses the fourth generation in a month", async () => {
    const h = harness();
    const limit = DEFAULT_QUOTA_LIMITS.plan_generation;
    expect(limit).toBe(3);

    for (let i = 0; i < limit; i += 1) {
      h.deps.newPlanId = () => `plan-${i}`;
      await handleGenerateWorkoutPlan(
        { auth: { uid: UID }, data: { requestId: REQUEST_ID.replace(/^./, String(i)) } },
        h.deps
      );
    }

    const callsBefore = h.providerCalls.length;
    await expect(
      handleGenerateWorkoutPlan(
        { auth: { uid: UID }, data: { requestId: REQUEST_ID.replace(/^./, "9") } },
        h.deps
      )
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED", details: { limit: 3 } });

    // Refused before the money is spent.
    expect(h.providerCalls).toHaveLength(callsBefore);
  });

  it("reports what is left", async () => {
    const h = harness();

    const result = await call(h);

    expect(result.quota).toEqual({ remaining: 2, limit: 3, period: "2026-08" });
  });

  it("cannot be exceeded by concurrent requests", async () => {
    const h = harness();
    h.deps.newPlanId = () => `plan-${Math.random()}`;

    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];

    const results = await Promise.allSettled(
      ids.map((requestId) =>
        handleGenerateWorkoutPlan({ auth: { uid: UID }, data: { requestId } }, h.deps)
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(3);
    expect(quotaCount(h)).toBe(3);
  });

  it("is independent per user", async () => {
    const h = harness();
    h.db.docs.set("users/bob", { ...COMPLETE_PROFILE });

    await call(h);
    await handleGenerateWorkoutPlan(
      { auth: { uid: "bob" }, data: { requestId: REQUEST_ID } },
      { ...h.deps, newPlanId: () => "plan-bob" }
    );

    expect(quotaCount(h)).toBe(1);
    expect(
      h.db.docs.get(`${QUOTA_COLLECTION}/bob__plan_generation__2026-08`)?.count
    ).toBe(1);
  });

  it("starts a new period in a new month", async () => {
    const august = harness();
    await call(august);
    expect(quotaCount(august)).toBe(1);

    const september = new Date("2026-09-01T00:00:00.000Z");
    august.deps.quota = createFirestoreQuotaStore({
      firestore: august.db,
      now: () => september,
    });
    august.deps.newPlanId = () => "plan-sept";

    const result = await handleGenerateWorkoutPlan(
      { auth: { uid: UID }, data: { requestId: "99999999-9999-4999-8999-999999999999" } },
      august.deps
    );

    expect(result.quota.period).toBe("2026-09");
    expect(result.quota.remaining).toBe(2);
  });
});

describe("idempotency", () => {
  it("calls the provider once for a repeated request id", async () => {
    const h = harness();

    const first = await call(h);
    const second = await call(h);

    expect(h.providerCalls).toHaveLength(1);
    expect(second.planId).toBe(first.planId);
    expect(second.replay).toBe(true);
  });

  it("charges the replay nothing", async () => {
    const h = harness();

    await call(h);
    await call(h);

    expect(quotaCount(h)).toBe(1);
  });

  it("writes exactly one plan for a repeated request id", async () => {
    const h = harness();

    await call(h);
    await call(h);

    expect(plans(h)).toHaveLength(1);
  });

  it("isolates one user's request id from another's", async () => {
    const h = harness();
    h.db.docs.set("users/bob", { ...COMPLETE_PROFILE });

    await call(h);
    const bob = await handleGenerateWorkoutPlan(
      { auth: { uid: "bob" }, data: { requestId: REQUEST_ID } },
      { ...h.deps, newPlanId: () => "plan-bob" }
    );

    // Same id, different namespace: bob generates rather than reading alice's.
    expect(bob.replay).toBe(false);
    expect(bob.planId).toBe("plan-bob");
    expect(h.providerCalls).toHaveLength(2);
  });

  it("lets a failed attempt be retried with the same id", async () => {
    const h = harness({ responses: [new AiError("PROVIDER_UNAVAILABLE", "down"), validPlan()] });

    await expect(call(h)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    const retry = await call(h);

    // Nothing was persisted or charged the first time, so there is nothing to
    // reuse — the id is free to try again.
    expect(retry.ok).toBe(true);
    expect(quotaCount(h)).toBe(1);
  });

  it("records the operation under a namespaced id, not a client-chosen one", async () => {
    const h = harness();

    await call(h);

    const [[path]] = h.db.under(OPERATION_COLLECTION);
    expect(path).toBe(`${OPERATION_COLLECTION}/${UID}__${REQUEST_ID}`);
    expect(plans(h)[0][0]).not.toContain(REQUEST_ID);
  });
});

describe("validation and the single repair", () => {
  it("repairs once when the first attempt is invalid", async () => {
    const h = harness({ responses: [{ garbage: true }, validPlan()] });

    const result = await call(h);

    expect(h.providerCalls).toHaveLength(2);
    expect(h.providerCalls[1].repair).toMatch(/ungültig/);
    expect(result.ok).toBe(true);
  });

  it("gives up after exactly one repair", async () => {
    const h = harness({ responses: [{ a: 1 }, { b: 2 }, validPlan()] });

    await expect(call(h)).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
    expect(h.providerCalls).toHaveLength(2);
  });

  it("persists nothing when validation never passes", async () => {
    const h = harness({ responses: [{ a: 1 }, { b: 2 }] });

    await call(h).catch(() => undefined);

    expect(plans(h)).toHaveLength(0);
  });

  it("rejects a structurally valid plan with the wrong number of training days", async () => {
    // Five training days for a profile that asked for three: passes Zod,
    // fails the semantic check, and is not what the user asked for.
    const week = validPlanWeek().map((day, index) =>
      index < 5 ? { ...day, exercises: [{ name: "Kurzhantel-Rudern", sets: 3, reps: "10" }] } : { ...day, exercises: [] }
    );
    const wrong = { "Week 1": week, "Week 2": week, "Week 3": week, "Week 4": week };
    const h = harness({ responses: [wrong, wrong] });

    await expect(call(h)).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
  });

  it("tells the model what was wrong, concisely", async () => {
    const h = harness({ responses: [{ "Week 1": [] }, validPlan()] });

    await call(h);

    const repair = h.providerCalls[1].repair as string;
    expect(repair).toContain("Week 1");
    expect(repair.split("\n").length).toBeLessThan(20);
  });
});

describe("persistence", () => {
  it("writes the plan in the shape the client already reads", async () => {
    const h = harness();

    await call(h);

    const [, plan] = plans(h)[0];
    expect(plan.content).toBeDefined();
    expect(plan.createdAt).toEqual(NOW);
    expect(plan.updatedAt).toEqual(NOW);
    expect(plan.source).toBe("ai");
  });

  it("never overwrites an existing plan", async () => {
    const h = harness();
    h.db.docs.set(`users/${UID}/workout_plans/existing`, { content: { keep: true } });

    await call(h);

    expect(h.db.docs.get(`users/${UID}/workout_plans/existing`)).toEqual({
      content: { keep: true },
    });
    expect(plans(h)).toHaveLength(2);
  });
});

describe("logging", () => {
  it("records a success with the model and the plan, and no prompt", async () => {
    const h = harness({ usage: [{ inputTokens: 100, outputTokens: 900 }] });

    await call(h);

    const log = h.logs.at(-1) as Record<string, unknown>;
    expect(log).toMatchObject({
      uid: UID,
      action: "plan_generation",
      status: "success",
      provider: "google-gemini",
      model: "gemini-3.7-flash",
      providerCalled: true,
      planId: "plan-1",
    });
    expect(JSON.stringify(log)).not.toMatch(/prompt|Erstelle einen Trainingsplan|response/i);
  });

  it("captures token usage when the provider reported it", async () => {
    const h = harness({ usage: [{ inputTokens: 100, outputTokens: 900 }] });

    await call(h);

    expect(h.logs.at(-1)).toMatchObject({ inputTokens: 100, outputTokens: 900 });
  });

  it("leaves token usage undefined when the provider reported none", async () => {
    const h = harness();

    await call(h);

    // Undefined here, and dropped entirely by the writer — see its own test.
    // "Not reported" and "zero tokens" must stay different facts.
    expect(h.logs.at(-1)?.inputTokens).toBeUndefined();
    expect(h.logs.at(-1)?.outputTokens).toBeUndefined();
  });

  it("marks whether the repair was used", async () => {
    const h = harness({ responses: [{ bad: true }, validPlan()] });

    await call(h);

    expect(h.logs.at(-1)).toMatchObject({ schemaRepairUsed: true });
  });

  it("categorises a quota refusal without calling it a provider error", async () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) {
      h.deps.newPlanId = () => `p${i}`;
      await handleGenerateWorkoutPlan(
        { auth: { uid: UID }, data: { requestId: REQUEST_ID.replace(/^./, String(i)) } },
        h.deps
      ).catch(() => undefined);
    }

    await handleGenerateWorkoutPlan(
      { auth: { uid: UID }, data: { requestId: "88888888-8888-4888-8888-888888888888" } },
      h.deps
    ).catch(() => undefined);

    expect(h.logs.at(-1)).toMatchObject({
      status: "error",
      errorCategory: "quota_exceeded",
      providerCalled: false,
    });
  });

  it("writes logs where a client cannot reach them", () => {
    expect(AI_LOG_COLLECTION).toBe("_ai_logs");
    expect(AI_LOG_COLLECTION.startsWith("_")).toBe(true);
  });
});

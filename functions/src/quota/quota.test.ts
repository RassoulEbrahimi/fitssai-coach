import { describe, it, expect } from "vitest";
import {
  DEFAULT_QUOTA_LIMITS,
  QUOTA_ACTIONS,
  createNullQuotaStore,
  createQuotaService,
  type QuotaAction,
  type QuotaStore,
} from "./index";

/*
  Quota decides whether money is spent, so the only acceptable authority is the
  server. These tests pin that: the uid comes from the caller's verified
  identity, the counts come from the store, and nothing a browser could send
  appears anywhere in the decision.
*/

const memoryStore = (): QuotaStore & { counts: Map<string, number> } => {
  const counts = new Map<string, number>();
  const key = (uid: string, action: QuotaAction) => `${uid}:${action}`;
  return {
    counts,
    getUsage: async (uid, action) => counts.get(key(uid, action)) ?? 0,
    increment: async (uid, action) => {
      counts.set(key(uid, action), (counts.get(key(uid, action)) ?? 0) + 1);
    },
  };
};

describe("quota decisions", () => {
  it("allows an action below the limit", async () => {
    const service = createQuotaService({ store: memoryStore() });

    const decision = await service.check("user-1", "plan_generation");

    expect(decision).toMatchObject({
      allowed: true,
      action: "plan_generation",
      used: 0,
      limit: DEFAULT_QUOTA_LIMITS.plan_generation,
      remaining: DEFAULT_QUOTA_LIMITS.plan_generation,
    });
  });

  it("refuses once the limit is reached, with a machine-readable reason", async () => {
    const store = memoryStore();
    const service = createQuotaService({ store, limits: { plan_generation: 1, weekly_summary: 1 } });

    await service.consume("user-1", "plan_generation");
    const decision = await service.check("user-1", "plan_generation");

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("limit_reached");
    expect(decision.remaining).toBe(0);
  });

  it("never reports negative remaining calls", async () => {
    const store = memoryStore();
    store.counts.set("user-1:plan_generation", 99);
    const service = createQuotaService({ store });

    expect((await service.check("user-1", "plan_generation")).remaining).toBe(0);
  });

  it("counts per user and per action", async () => {
    const store = memoryStore();
    const service = createQuotaService({ store });

    await service.consume("user-1", "plan_generation");

    expect((await service.check("user-2", "plan_generation")).used).toBe(0);
    expect((await service.check("user-1", "weekly_summary")).used).toBe(0);
  });

  it("does not consume when the call is already refused", async () => {
    const store = memoryStore();
    const service = createQuotaService({ store, limits: { plan_generation: 1, weekly_summary: 1 } });

    await service.consume("user-1", "plan_generation");
    await service.consume("user-1", "plan_generation");

    expect(store.counts.get("user-1:plan_generation")).toBe(1);
  });
});

describe("server authority", () => {
  it.each(["", "   "])("refuses to decide without an authenticated uid (%j)", async (uid) => {
    const service = createQuotaService({ store: memoryStore() });

    await expect(service.check(uid, "plan_generation")).rejects.toThrow(/authenticated uid/);
  });

  it("takes no quota value from a caller", async () => {
    // The service's only inputs are a uid and an action. There is no argument
    // through which a browser could assert its own remaining balance.
    const service = createQuotaService({ store: memoryStore() });

    expect(service.check.length).toBe(2);
    expect(service.consume.length).toBe(2);
  });

  it("covers exactly the actions that will cost money", () => {
    expect([...QUOTA_ACTIONS]).toEqual(["plan_generation", "weekly_summary"]);
    expect(Object.keys(DEFAULT_QUOTA_LIMITS).sort()).toEqual([...QUOTA_ACTIONS].sort());
  });
});

describe("the null store", () => {
  it("reports nothing spent, which is true", async () => {
    expect(await createNullQuotaStore().getUsage("user-1", "plan_generation")).toBe(0);
  });

  it("refuses to pretend an increment happened", async () => {
    // A chargeable action running against a store that silently forgets would
    // grant unlimited calls in production. It fails loudly instead.
    await expect(createNullQuotaStore().increment("user-1", "plan_generation")).rejects.toThrow(
      /must not run without one/
    );
  });
});

import { describe, it, expect } from "vitest";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

const { nutrition, nutritionLegacy } = queryKeys;

/** Every V2 key an account can have, for one owner. */
const v2Keys = (uid: string): QueryKey[] => [
  nutrition.all(uid),
  nutrition.state(uid),
  nutrition.targets.all(uid),
  nutrition.targets.current(uid),
  nutrition.targets.byId(uid, "target-1"),
  nutrition.plans.all(uid),
  nutrition.plans.active(uid),
  nutrition.plans.byId(uid, "plan-1"),
  nutrition.slots.byPlan(uid, "plan-1"),
  nutrition.entries.all(uid),
  nutrition.entries.byDate(uid, "2026-10-25"),
  nutrition.entries.range(uid, "2026-10-19", "2026-10-25"),
  nutrition.generation.all(uid),
  nutrition.generation.active(uid),
  nutrition.generation.byId(uid, "req-1"),
  nutrition.suggestionsAll(uid),
  nutrition.suggestions(uid, "plan-1", "2026-10-25", "lunch"),
];

/** Seed a client with every V2 and legacy key for both owners. */
const seededClient = () => {
  const client = new QueryClient();
  for (const uid of ["alice", "bob"]) {
    for (const key of [...v2Keys(uid), nutritionLegacy.latest(uid)]) {
      client.setQueryData(key, { seeded: true });
    }
  }
  return client;
};

const invalidated = (client: QueryClient) =>
  client
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => query.queryKey);

describe("Nutrition V2 query keys", () => {
  it("all live under the account's V2 root", () => {
    for (const key of v2Keys("alice")) {
      expect(key.slice(0, 2)).toEqual(["nutrition-v2", "alice"]);
    }
  });

  it("are distinct from one another", () => {
    const serialised = v2Keys("alice").map((key) => JSON.stringify(key));
    expect(new Set(serialised).size).toBe(serialised.length);
  });

  it("do not let an active-plan lookup collide with a plan called 'active'", () => {
    expect(nutrition.plans.byId("alice", "active")).not.toEqual(nutrition.plans.active("alice"));
  });

  it("invalidating one owner's V2 root leaves the other owner alone", async () => {
    const client = seededClient();

    await client.invalidateQueries({ queryKey: nutrition.all("alice"), refetchType: "none" });

    const keys = invalidated(client);
    expect(keys).toHaveLength(v2Keys("alice").length);
    for (const key of keys) {
      expect(key[1]).toBe("alice");
    }
  });

  it("V2 invalidation never touches legacy Nutrition", async () => {
    const client = seededClient();

    await client.invalidateQueries({ queryKey: nutrition.all("alice"), refetchType: "none" });
    await client.invalidateQueries({ queryKey: nutrition.all("bob"), refetchType: "none" });

    for (const uid of ["alice", "bob"]) {
      expect(client.getQueryState(nutritionLegacy.latest(uid))?.isInvalidated).toBe(false);
    }
  });

  it("legacy invalidation never touches V2", async () => {
    const client = seededClient();

    await client.invalidateQueries({ queryKey: nutritionLegacy.latest("alice"), refetchType: "none" });

    expect(invalidated(client)).toEqual([nutritionLegacy.latest("alice")]);
  });

  it("has no resolved-day key: a resolved day is derived, not fetched", () => {
    expect(Object.keys(nutrition)).not.toContain("resolvedDay");
    expect(Object.keys(nutrition)).not.toContain("day");
  });
});

describe("legacy Nutrition query key", () => {
  it("keeps the key legacy Nutrition has always used", () => {
    expect(nutritionLegacy.latest("alice")).toEqual(["nutrition-plan", "alice"]);
  });

  it("does not share a root with V2", () => {
    expect(nutritionLegacy.latest("alice")[0]).not.toBe(nutrition.all("alice")[0]);
  });
});

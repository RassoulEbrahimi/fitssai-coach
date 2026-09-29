import React, { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, dehydrate, useIsRestoring, useQueryClient, type QueryKey } from "@tanstack/react-query";

/*
  NUT-07. The persisted, account-owned query cache keeps what it kept before
  — recorded Nutrition entries and every Training family included — but never
  Nutrition plan-generation requests or replacement suggestions. The filter
  uses the key registry's prefixes; the storage key stays per account.

  NUT-14: the deployed backend's live status is ephemeral too. A stored
  `true` could outlive a backend rollback, so it is never written — and a
  snapshot that holds one anyway is dropped on restore.
*/

const auth = vi.hoisted(() => ({ user: { uid: "A" } as { uid: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

import { QueryProvider } from "@/components/providers/QueryProvider";
import { accountStorageKey } from "@/lib/accountIdentity";
import { queryKeys } from "@/lib/queryKeys";
import { isEphemeralQueryKey, removeRestoredEphemeralQueries, shouldPersistQuery } from "./queryPersistence";

const persisted = (uid: string): QueryKey[] =>
  [
    queryKeys.nutrition.entries.byDate(uid, "2026-09-26"),
    queryKeys.nutrition.entries.range(uid, "2026-09-23", "2026-09-29"),
    queryKeys.nutrition.state(uid),
    queryKeys.nutrition.plans.byId(uid, "plan-1"),
    queryKeys.nutrition.slots.byPlan(uid, "plan-1"),
    queryKeys.nutrition.targets.byId(uid, "target-1"),
    queryKeys.nutritionLegacy.latest(uid),
    queryKeys.plans.byUser(uid),
    queryKeys.logs.byPlan("plan-1", uid),
    queryKeys.sets.byDay("plan-1", "Week 1", 0),
    queryKeys.completion.byWeek("plan-1", "Week 1"),
    queryKeys.history.list(uid),
    queryKeys.profile.me(uid),
  ] as QueryKey[];

const ephemeral = (uid: string): QueryKey[] => [
  queryKeys.nutrition.generation.active(uid),
  queryKeys.nutrition.generation.byId(uid, "req-1"),
  queryKeys.nutrition.suggestions(uid, "plan-1", "2026-09-26", "lunch"),
  queryKeys.backend.status(uid),
];

describe("which queries persist", () => {
  it("recognises only the generation, suggestion and backend-status families as ephemeral", () => {
    for (const key of ephemeral("A")) expect(isEphemeralQueryKey(key), JSON.stringify(key)).toBe(true);
    for (const key of persisted("A")) expect(isEphemeralQueryKey(key), JSON.stringify(key)).toBe(false);
    // Prefixes, not substrings: a plan or slot named like a family is not one.
    expect(isEphemeralQueryKey(queryKeys.nutrition.plans.byId("A", "generation"))).toBe(false);
    expect(isEphemeralQueryKey(queryKeys.nutrition.slots.byPlan("A", "suggestions"))).toBe(false);
    expect(isEphemeralQueryKey(queryKeys.nutrition.plans.byId("A", "coach-backend"))).toBe(false);
    // Another account's status is still a status.
    expect(isEphemeralQueryKey(queryKeys.backend.status("B"))).toBe(true);
  });

  it("drops every restored ephemeral query and keeps everything else", () => {
    const client = new QueryClient();
    for (const key of [...persisted("A"), ...ephemeral("A")]) client.setQueryData(key, { restored: true });
    removeRestoredEphemeralQueries(client);

    const left = client.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey)).sort();
    expect(left).toEqual(persisted("A").map((key) => JSON.stringify(key)).sort());
    expect(client.getQueryData(queryKeys.backend.status("A"))).toBeUndefined();
  });

  it("dehydrates entries and Training, but not generation or suggestions, and still only successful queries", () => {
    const client = new QueryClient();
    for (const key of [...persisted("A"), ...ephemeral("A")]) client.setQueryData(key, { seeded: true });
    const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
    const hashes = state.queries.map((query) => JSON.stringify(query.queryKey)).sort();

    expect(hashes).toEqual(persisted("A").map((key) => JSON.stringify(key)).sort());
    expect(shouldPersistQuery({ queryKey: queryKeys.nutrition.entries.all("A"), state: { status: "pending" } })).toBe(false);
    expect(shouldPersistQuery({ queryKey: queryKeys.nutrition.entries.all("A"), state: { status: "error" } })).toBe(false);
  });
});

const Seed = ({ uid }: { uid: string }) => {
  const client = useQueryClient();
  // Changes are persisted once the stored cache has been restored and the
  // provider has subscribed - in its own effect, which runs after this one.
  const restoring = useIsRestoring();
  useEffect(() => {
    if (restoring) return;
    const timer = setTimeout(() => {
      for (const key of [...persisted(uid), ...ephemeral(uid)]) client.setQueryData(key, { owner: uid });
    }, 0);
    return () => clearTimeout(timer);
  }, [client, restoring, uid]);
  return null;
};

describe("the account's persisted cache", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.user = { uid: "A" };
  });

  it("writes entries and Training under the account's own key, and never generation or suggestions", async () => {
    const view = render(
      <QueryProvider>
        <Seed uid="A" />
      </QueryProvider>
    );
    const keyA = accountStorageKey("REACT_QUERY_OFFLINE_CACHE", "A");
    await waitFor(() => expect(localStorage.getItem(keyA)).toContain('"entries"'), { timeout: 3000 });

    const stored = JSON.parse(localStorage.getItem(keyA)!) as { clientState: { queries: { queryKey: QueryKey }[] } };
    const keys = stored.clientState.queries.map((query) => JSON.stringify(query.queryKey)).sort();
    expect(keys).toEqual(persisted("A").map((key) => JSON.stringify(key)).sort());
    expect(localStorage.getItem(keyA)).not.toMatch(/"generation"|"suggestions"|"coach-backend"/);
    expect(localStorage.getItem("REACT_QUERY_OFFLINE_CACHE")).toBeNull();

    // Account B gets its own key; A's stays A's.
    view.unmount();
    auth.user = { uid: "B" };
    render(
      <QueryProvider>
        <Seed uid="B" />
      </QueryProvider>
    );
    const keyB = accountStorageKey("REACT_QUERY_OFFLINE_CACHE", "B");
    await waitFor(() => expect(localStorage.getItem(keyB)).toContain('"entries"'), { timeout: 3000 });
    expect(localStorage.getItem(keyB)).not.toContain('"A"');
    expect(localStorage.getItem(keyA)).not.toContain('"B"');
  });
});

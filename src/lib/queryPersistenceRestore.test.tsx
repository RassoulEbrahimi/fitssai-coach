import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, dehydrate, onlineManager, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

/*
  NUT-13B-FIX-01. The persisted account cache is an acceleration, never the
  authority:

  - a change is not lost when the page goes away inside the persister's save
    throttle (it is flushed on pagehide / hidden), and
  - a restored read is refetched as soon as it is used online, however recent
    its stored fetch time, while offline it stays on screen untouched.

  Both are what a reload right after a recording, a replacement or a profile
  save needs (the NUT-13B browser regression), and neither may cross accounts.
*/

const auth = vi.hoisted(() => ({ user: { uid: "A" } as { uid: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

import { QueryProvider } from "@/components/providers/QueryProvider";
import { accountStorageKey } from "@/lib/accountIdentity";
import { queryKeys } from "@/lib/queryKeys";
import { PERSIST_THROTTLE_MS, createAccountPersister } from "./queryPersistence";

const BUSTER = "account-owned-v1";
const storageKey = (uid: string) => accountStorageKey("REACT_QUERY_OFFLINE_CACHE", uid);
const entriesKey = (uid: string): QueryKey => queryKeys.nutrition.entries.range(uid, "2026-09-25", "2026-10-01");
const profileKey = (uid: string): QueryKey => queryKeys.profile.me(uid);

/** A stored cache for `uid`, as the persister writes it, fetched `ageMs` ago (fresh by default). */
const storeCache = (uid: string, data: Record<string, unknown>, ageMs = 1_000) => {
  const client = new QueryClient();
  client.setQueryData(entriesKey(uid), data.entries, { updatedAt: Date.now() - ageMs });
  client.setQueryData(profileKey(uid), data.profile, { updatedAt: Date.now() - ageMs });
  localStorage.setItem(storageKey(uid), JSON.stringify({ buster: BUSTER, timestamp: Date.now(), clientState: dehydrate(client) }));
};

const storedQueries = (uid: string): { queryKey: QueryKey; state: { data: unknown } }[] =>
  JSON.parse(localStorage.getItem(storageKey(uid)) ?? '{"clientState":{"queries":[]}}').clientState.queries;

const storedData = (uid: string, key: QueryKey) =>
  storedQueries(uid).find((query) => JSON.stringify(query.queryKey) === JSON.stringify(key))?.state.data;

/** Reads one query like a screen does; the server answers `server[uid]`. */
const Reader = ({ uid, server, fetches }: { uid: string; server: Record<string, unknown>; fetches: string[] }) => {
  const query = useQuery({
    queryKey: entriesKey(uid),
    queryFn: async () => {
      fetches.push(uid);
      return server[uid];
    },
  });
  return <p data-testid="shown">{JSON.stringify(query.data ?? null)}</p>;
};

describe("createAccountPersister", () => {
  const snapshot = (n: number) => ({ buster: BUSTER, timestamp: n, clientState: { mutations: [], queries: [] } });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("writes the latest snapshot at most once per throttle window", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const persister = createAccountPersister({ storage: localStorage, key: "k" });
    void persister.persistClient(snapshot(1));
    void persister.persistClient(snapshot(2));
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PERSIST_THROTTLE_MS);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("k")!).timestamp).toBe(2);
    setItem.mockRestore();
  });

  it("flush writes the waiting snapshot at once, and only once", () => {
    const persister = createAccountPersister({ storage: localStorage, key: "k" });
    void persister.persistClient(snapshot(3));
    persister.flush();
    expect(JSON.parse(localStorage.getItem("k")!).timestamp).toBe(3);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.advanceTimersByTime(PERSIST_THROTTLE_MS);
    persister.flush();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("flush with nothing waiting never overwrites what is stored", () => {
    localStorage.setItem("k", JSON.stringify(snapshot(9)));
    createAccountPersister({ storage: localStorage, key: "k" }).flush();
    expect(JSON.parse(localStorage.getItem("k")!).timestamp).toBe(9);
  });

  it("restores and removes like the sync persister; remove drops a waiting snapshot", async () => {
    localStorage.setItem("k", JSON.stringify(snapshot(4)));
    const persister = createAccountPersister({ storage: localStorage, key: "k" });
    expect((await persister.restoreClient())?.timestamp).toBe(4);
    void persister.persistClient(snapshot(5));
    await persister.removeClient();
    persister.flush();
    vi.advanceTimersByTime(PERSIST_THROTTLE_MS);
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("stores nothing without storage, and survives a full storage", () => {
    const none = createAccountPersister({ storage: undefined, key: undefined });
    void none.persistClient(snapshot(6));
    none.flush();
    expect(localStorage.length).toBe(0);

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const full = createAccountPersister({ storage: localStorage, key: "k" });
    void full.persistClient(snapshot(7));
    expect(() => full.flush()).not.toThrow();
    setItem.mockRestore();
  });
});

describe("QueryProvider: restored reads are not the authority", () => {
  beforeEach(() => {
    localStorage.clear();
    auth.user = { uid: "A" };
    onlineManager.setOnline(true);
  });
  afterEach(() => onlineManager.setOnline(true));

  it("online: a restored read inside staleTime is shown at once and refetched from the server", async () => {
    // Stored 1 s ago, i.e. "fresh" for the 5 min staleTime; the server has changed since.
    storeCache("A", { entries: ["stale"], profile: { age: null } });
    const fetches: string[] = [];
    render(
      <QueryProvider>
        <Reader uid="A" server={{ A: ["server"] }} fetches={fetches} />
      </QueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["server"]'));
    expect(fetches).toEqual(["A"]);
  });

  it("offline: the restored read stays on screen, nothing is cleared, and it refetches once online", async () => {
    storeCache("A", { entries: ["cached"], profile: { age: 30 } });
    const stored = localStorage.getItem(storageKey("A"));
    onlineManager.setOnline(false);
    const fetches: string[] = [];
    render(
      <QueryProvider>
        <Reader uid="A" server={{ A: ["server"] }} fetches={fetches} />
      </QueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["cached"]'));
    await act(() => new Promise((resolve) => setTimeout(resolve, PERSIST_THROTTLE_MS + 200)));
    expect(fetches).toEqual([]);
    expect(screen.getByTestId("shown").textContent).toBe('["cached"]');
    // The stored cache is still there, with every restored read.
    expect(storedData("A", entriesKey("A"))).toEqual(["cached"]);
    expect(storedData("A", profileKey("A"))).toEqual({ age: 30 });
    expect(localStorage.getItem(storageKey("A"))).not.toBeNull();
    expect(stored).not.toBeNull();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["server"]'));
    expect(fetches).toEqual(["A"]);
  });

  it.each([
    ["pagehide", () => window.dispatchEvent(new Event("pagehide"))],
    [
      "visibilitychange to hidden",
      () => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      },
    ],
  ])("a change inside the save throttle is written on %s, before the page goes away", async (_name, leave) => {
    let client: QueryClient | null = null;
    const Capture = () => {
      client = useQueryClient();
      return null;
    };
    render(
      <QueryProvider>
        <Capture />
      </QueryProvider>
    );
    // Restored (nothing stored) and subscribed.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await waitFor(() => expect(client).not.toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    act(() => client!.setQueryData(entriesKey("A"), ["slot:2026-09-28:breakfast"]));
    // Inside the throttle window nothing is written yet…
    expect(storedData("A", entriesKey("A"))).toBeUndefined();
    // …but leaving the page writes it synchronously.
    act(() => leave());
    expect(storedData("A", entriesKey("A"))).toEqual(["slot:2026-09-28:breakfast"]);
    Reflect.deleteProperty(document, "visibilityState");
  });
});

describe("QueryProvider: restore and refetch stay within the account", () => {
  beforeEach(() => {
    localStorage.clear();
    onlineManager.setOnline(true);
  });

  it("A → B → A: each account restores and refetches only its own cache", async () => {
    storeCache("A", { entries: ["A-cached"], profile: { owner: "A" } });
    const fetches: string[] = [];
    const server = { A: ["A-server"], B: ["B-server"] };

    auth.user = { uid: "A" };
    const first = render(
      <QueryProvider>
        <Reader uid="A" server={server} fetches={fetches} />
      </QueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["A-server"]'));
    first.unmount();

    // B has nothing stored: nothing of A is shown, restored or fetched for B.
    auth.user = { uid: "B" };
    const shownForB: string[] = [];
    const Observe = () => {
      const text = JSON.stringify(useQueryClient().getQueryData(entriesKey("A")) ?? null);
      shownForB.push(text);
      return null;
    };
    const second = render(
      <QueryProvider>
        <Reader uid="B" server={server} fetches={fetches} />
        <Observe />
      </QueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["B-server"]'));
    expect(shownForB.every((text) => text === "null")).toBe(true);
    second.unmount();
    expect(localStorage.getItem(storageKey("B"))).not.toContain("A-");
    expect(localStorage.getItem(storageKey("A"))).not.toContain("B-");

    // A again: A's own (now server) state, refetched as A.
    auth.user = { uid: "A" };
    render(
      <QueryProvider>
        <Reader uid="A" server={server} fetches={fetches} />
      </QueryProvider>
    );
    await waitFor(() => expect(screen.getByTestId("shown").textContent).toBe('["A-server"]'));
    expect(fetches).toEqual(["A", "B", "A"]);
    expect(storedData("A", entriesKey("A"))).toEqual(["A-server"]);
  });
});

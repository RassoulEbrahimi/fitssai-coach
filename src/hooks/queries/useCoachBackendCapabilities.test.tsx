import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-14: the live capability read. One `coachBackendStatus` per account and
  session, fail-closed, keyed by uid; nothing here reaches a network.
*/

const session = vi.hoisted(() => ({ user: { uid: "alice" } as { uid: string } | null }));
const backend = vi.hoisted(() => ({ fetchCoachBackendStatus: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/lib/backend", () => backend);

import { queryKeys } from "@/lib/queryKeys";
import { useCoachBackendCapabilities } from "./useCoachBackendCapabilities";

const status = (uid: string, nutritionTargets: boolean, nutritionGeneration: boolean) => ({
  ok: true,
  backend: "fitssai-coach",
  region: "europe-west3",
  uid,
  capabilities: { planGeneration: true, weeklySummaryAI: true, nutritionTargets, nutritionGeneration },
});

const setup = (options?: { enabled?: boolean }) => {
  // The app's own defaults: the hook must not rely on them.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, staleTime: 0, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useCoachBackendCapabilities(options), { wrapper }) };
};

const CLOSED = { nutritionTargets: false, nutritionGeneration: false };

beforeEach(() => {
  session.user = { uid: "alice" };
  backend.fetchCoachBackendStatus.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("useCoachBackendCapabilities", () => {
  it("asks nothing while signed out or disabled", async () => {
    session.user = null;
    expect(setup().result.current).toEqual(CLOSED);
    session.user = { uid: "alice" };
    expect(setup({ enabled: false }).result.current).toEqual(CLOSED);
    await act(async () => undefined);
    expect(backend.fetchCoachBackendStatus).not.toHaveBeenCalled();
  });

  it("is closed while pending, and answers the backend's literal booleans once it has answered", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    backend.fetchCoachBackendStatus.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = setup();
    expect(result.current).toEqual(CLOSED);

    await act(async () => resolve(status("alice", true, false)));
    await waitFor(() => expect(result.current).toEqual({ nutritionTargets: true, nutritionGeneration: false }));
  });

  it("an error is closed and not retried, even when the client's default retries", async () => {
    backend.fetchCoachBackendStatus.mockRejectedValue(new Error("unavailable"));
    const { result, client } = setup();
    await waitFor(() => expect(client.getQueryState(queryKeys.backend.status("alice"))?.status).toBe("error"));
    expect(result.current).toEqual(CLOSED);
    expect(backend.fetchCoachBackendStatus).toHaveBeenCalledTimes(1);
  });

  it("an answer for another account, or a malformed one, is closed", async () => {
    for (const answer of [status("mallory", true, true), { ok: true, uid: "alice" }, null]) {
      backend.fetchCoachBackendStatus.mockReset();
      backend.fetchCoachBackendStatus.mockResolvedValue(answer);
      const { result, client } = setup();
      await waitFor(() => expect(client.getQueryState(queryKeys.backend.status("alice"))?.status).toBe("error"));
      expect(result.current).toEqual(CLOSED);
    }
  });

  it("keeps the session's answer across remounts, and only an invalidation asks again", async () => {
    backend.fetchCoachBackendStatus.mockResolvedValue(status("alice", true, true));
    const { result, client, rerender, unmount } = setup();
    await waitFor(() => expect(result.current).toEqual({ nutritionTargets: true, nutritionGeneration: true }));
    rerender();
    unmount();
    // Another view of the same session.
    const again = renderHook(() => useCoachBackendCapabilities(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(again.result.current).toEqual({ nutritionTargets: true, nutritionGeneration: true });
    expect(backend.fetchCoachBackendStatus).toHaveBeenCalledTimes(1);

    // A rollback, seen through an explicit refresh.
    backend.fetchCoachBackendStatus.mockResolvedValue(status("alice", false, false));
    await act(() => client.invalidateQueries({ queryKey: queryKeys.backend.all("alice") }));
    await waitFor(() => expect(again.result.current).toEqual(CLOSED));
    expect(backend.fetchCoachBackendStatus).toHaveBeenCalledTimes(2);
  });

  it("is keyed by the account", async () => {
    backend.fetchCoachBackendStatus.mockResolvedValue(status("alice", true, true));
    const { client, result } = setup();
    await waitFor(() => expect(result.current.nutritionGeneration).toBe(true));
    expect(client.getQueryData(queryKeys.backend.status("alice"))).toMatchObject({ uid: "alice" });
    expect(client.getQueryData(queryKeys.backend.status("bob"))).toBeUndefined();
  });
});

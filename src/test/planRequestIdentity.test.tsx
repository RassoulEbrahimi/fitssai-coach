import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/*
  The browser's half of duplicate protection.

  The server can only recognise a retry as the same logical request if the
  browser sends the same request id, so what is pinned here is when an id is
  kept and when it is thrown away. Keeping it too eagerly would replay an old
  plan instead of making the new one somebody asked for; throwing it away too
  eagerly turns every lost response into a second generation and a second
  charge, which is the failure this whole change exists to remove.
*/

const sent: string[] = [];
const outcomes: Array<{ kind: "ok"; replay?: boolean } | { kind: "error"; code: string }> = [];

vi.mock("@/lib/backend/planGeneration", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend/planGeneration")>(
    "@/lib/backend/planGeneration"
  );
  return {
    ...actual,
    generateWorkoutPlan: vi.fn(async (requestId: string) => {
      sent.push(requestId);
      const outcome = outcomes.shift() ?? { kind: "ok" as const };
      if (outcome.kind === "error") {
        throw new actual.PlanGenerationError(outcome.code as never);
      }
      return {
        ok: true as const,
        planId: "plan-1",
        quota: { remaining: 2, limit: 3, period: "2026-08" },
        replay: outcome.replay === true,
      };
    }),
  };
});

vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  getDocs: async () => ({ empty: true, docs: [] }),
  query: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  doc: () => ({}),
  setDoc: async () => undefined,
  Timestamp: { now: () => ({}) },
}));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: { uid: "u1" } } }));

const session = { uid: "u1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: session.uid, id: session.uid } }),
}));

const toasts: Array<{ level: "success" | "error"; title: string }> = [];
vi.mock("sonner", () => ({
  toast: {
    success: (title: string) => toasts.push({ level: "success", title }),
    error: (title: string) => toasts.push({ level: "error", title }),
  },
}));

import { useWorkoutPlan } from "@/hooks/queries/useWorkoutPlan";
import {
  PENDING_REQUEST_TTL_MS,
  beginPlanRequest,
  isUncertainOutcome,
  settlePlanRequest,
} from "@/lib/backend/planRequestId";
import { AI_ERROR_CODES } from "@/lib/backend/planGeneration";

beforeEach(() => {
  sent.length = 0;
  outcomes.length = 0;
  toasts.length = 0;
  session.uid = "u1";
  localStorage.clear();
  settlePlanRequest("u1");
  settlePlanRequest("u2");
});

const mount = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWorkoutPlan(), { wrapper });
};

const press = async (hook: ReturnType<typeof mount>) => {
  await act(async () => {
    await hook.result.current.generatePlan().catch(() => undefined);
  });
};

describe("an uncertain attempt keeps its identity", () => {
  it("retries a lost response as the same logical request", async () => {
    // A callable that gave up, or a response that never arrived, both surface
    // as INTERNAL — and the server may well have finished the generation.
    outcomes.push({ kind: "error", code: "INTERNAL" });
    const hook = mount();

    await press(hook);
    await press(hook);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]).toBe(sent[1]);
  });

  it("keeps the id when the server says the request is still running", async () => {
    outcomes.push({ kind: "error", code: "REQUEST_IN_PROGRESS" });
    const hook = mount();

    await press(hook);
    await press(hook);

    expect(sent[0]).toBe(sent[1]);
  });

  /*
    The finalisation transaction commits the plan, the completed record and the
    charge together — and then the acknowledgement is lost. The function's
    `catch` around that transaction cannot tell that apart from a refused
    commit, so it reports PERSISTENCE_FAILED for a request that in fact
    succeeded. Treating that as definitive threw the id away and made the next
    press a second generation, a second plan and a second charge.
  */
  it("keeps the id when persistence could not be acknowledged", async () => {
    outcomes.push({ kind: "error", code: "PERSISTENCE_FAILED" });
    const hook = mount();

    await press(hook);
    await press(hook);

    expect(sent[1]).toBe(sent[0]);
  });

  it("reconciles a persistence failure that had actually committed", async () => {
    outcomes.push({ kind: "error", code: "PERSISTENCE_FAILED" }, { kind: "ok", replay: true });
    const hook = mount();

    await press(hook);
    await press(hook);

    // Same logical request, so the server answers with the plan it already
    // made rather than making a second one.
    expect(sent[1]).toBe(sent[0]);
    expect(toasts.at(-1)).toEqual({ level: "success", title: "Dein Trainingsplan ist fertig" });
    // And only once it has been reconciled does the next press start afresh.
    await press(hook);
    expect(sent[2]).not.toBe(sent[0]);
  });

  it("survives a reload, so a reopened tab reconciles instead of regenerating", async () => {
    outcomes.push({ kind: "error", code: "INTERNAL" });
    const hook = mount();
    await press(hook);

    // A reload keeps nothing in memory; the account's own storage key is all
    // that carries the pending id across it.
    const afterReload = beginPlanRequest("u1");

    expect(afterReload).toBe(sent[0]);
  });

  it("treats a replayed completion as the success it is", async () => {
    outcomes.push({ kind: "error", code: "INTERNAL" }, { kind: "ok", replay: true });
    const hook = mount();

    await press(hook);
    await press(hook);

    expect(sent[0]).toBe(sent[1]);
    expect(toasts.at(-1)).toEqual({ level: "success", title: "Dein Trainingsplan ist fertig" });
    expect(toasts.filter((t) => t.level === "error")).toHaveLength(1);
  });
});

describe("a settled attempt gives its identity up", () => {
  it("starts a new request after a generation finished", async () => {
    const hook = mount();

    await press(hook);
    await press(hook);

    expect(sent[0]).not.toBe(sent[1]);
    expect(toasts.at(-1)?.title).toBe("Neuer Trainingsplan erstellt");
  });

  it.each([
    "PROFILE_INCOMPLETE",
    "QUOTA_EXCEEDED",
    "MODEL_OUTPUT_INVALID",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_RATE_LIMITED",
    "UNAUTHENTICATED",
    "INVALID_REQUEST",
  ])("starts a new request after %s, which persisted nothing", async (code) => {
    outcomes.push({ kind: "error", code });
    const hook = mount();

    await press(hook);
    await press(hook);

    expect(sent[0]).not.toBe(sent[1]);
  });

  it("stops reusing an id once it is far too old to reconcile anything", () => {
    const first = beginPlanRequest("u1", 0);

    expect(beginPlanRequest("u1", PENDING_REQUEST_TTL_MS - 1)).toBe(first);
    expect(beginPlanRequest("u1", PENDING_REQUEST_TTL_MS + 1)).not.toBe(first);
  });

  it("classifies every backend code as settled or uncertain, deliberately", () => {
    const uncertain = AI_ERROR_CODES.filter(isUncertainOutcome);

    // Growing this list is a decision, not an accident: anything uncertain
    // keeps its request id and will be retried against the same server record.
    expect([...uncertain].sort()).toEqual([
      "INTERNAL",
      "PERSISTENCE_FAILED",
      "REQUEST_IN_PROGRESS",
    ]);
  });
});

describe("a request id belongs to one account", () => {
  it("does not hand one account's pending id to another", async () => {
    outcomes.push({ kind: "error", code: "INTERNAL" });
    const hook = mount();
    await press(hook);

    expect(beginPlanRequest("u2")).not.toBe(sent[0]);
    // And the first account still has its own.
    expect(beginPlanRequest("u1")).toBe(sent[0]);
  });

  it("stores it under the account's own key, never a shared one", async () => {
    outcomes.push({ kind: "error", code: "INTERNAL" });
    const hook = mount();
    await press(hook);

    const keys = Object.keys(localStorage).filter((key) => key.includes("AI_PLAN_REQUEST"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("u1");
    expect(localStorage.getItem("AI_PLAN_REQUEST")).toBeNull();
  });

  it("ignores a stored value that is not a pending request", () => {
    localStorage.setItem("AI_PLAN_REQUEST:u1", '{"requestId":42}');

    expect(beginPlanRequest("u1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});

describe("the browser waits as long as the server may take", () => {
  it("asks the callable for the server's own budget rather than the SDK default", () => {
    const client = readFileSync("src/lib/backend/planGeneration.ts", "utf-8");
    const server = readFileSync("functions/src/index.ts", "utf-8");

    const budget = Number(
      /timeoutSeconds:\s*(\d+)/.exec(server.slice(server.indexOf("generateWorkoutPlan")))?.[1]
    );
    const timeout = Number(/CALLABLE_TIMEOUT_MS = ([\d_]+)/.exec(client)?.[1].replace(/_/g, ""));

    expect(budget).toBe(180);
    // The SDK's default is 70s, which abandons calls that are still running.
    expect(timeout).toBeGreaterThan(budget * 1000);
    expect(client).toContain("{ timeout: CALLABLE_TIMEOUT_MS }");
  });
});

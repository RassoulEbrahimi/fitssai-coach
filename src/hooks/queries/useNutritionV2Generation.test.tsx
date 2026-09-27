import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-11. The generation request read model: the state's active pointer is
  read exactly by id and strictly — a missing or malformed request is an
  integrity error, never "no generation". Account-scoped, gated on
  eligibility, read-only, and never written to the persisted cache.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  query: vi.fn(),
  getDoc: vi.fn(async (ref: { path: string; id: string }) => {
    const data = store.docs.get(ref.path);
    return { id: ref.id, exists: () => data !== undefined, data: () => data };
  }),
  getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));

import { useActiveNutritionV2Generation, useNutritionV2GenerationRequest } from "./useNutritionV2";
import { queryKeys } from "@/lib/queryKeys";
import { shouldPersistQuery } from "@/lib/queryPersistence";
import { NutritionV2IntegrityError } from "@/lib/nutrition/v2/integrity";
import type { NutritionV2Read } from "@/lib/nutrition/v2/readStatus";
import { NUTRITION_V2_COLLECTIONS, type GenerationRequest } from "@shared/nutrition";
import { makeState } from "@/test/nutritionV2Fixtures";

const C = NUTRITION_V2_COLLECTIONS;
const RID = "00000000-0000-4000-8000-000000000011";
const statePath = (uid = "alice") => `users/${uid}/${C.state}/current`;
const requestPath = (id = RID, uid = "alice") => `users/${uid}/${C.generations}/${id}`;
const put = (path: string, data: unknown) => store.docs.set(path, data);

const running = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  schemaVersion: 2,
  requestId: RID,
  idempotencyKey: `nutritionPlan:${RID}`,
  kind: "regenerate",
  basePlanId: "plan-1",
  targetVersionId: "target-1",
  payloadFingerprint: "c".repeat(64),
  status: "running",
  resultPlanId: null,
  errorCode: null,
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
  finishedAt: null,
  acknowledgedAt: null,
  ...overrides,
});

const mount = <T,>(hook: () => T) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(hook, { wrapper }) };
};

const settled = async (read: () => NutritionV2Read<unknown>) => waitFor(() => expect(["success", "error"]).toContain(read().status));
const readPaths = () => firestore.getDoc.mock.calls.map(([ref]) => (ref as { path: string }).path);

const integrityCode = (read: NutritionV2Read<unknown>) => {
  expect(read.status).toBe("error");
  const error = read.status === "error" ? read.error : null;
  expect(error).toBeInstanceOf(NutritionV2IntegrityError);
  return (error as NutritionV2IntegrityError).code;
};

beforeEach(() => {
  store.docs.clear();
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
});

afterEach(() => {
  for (const spy of [firestore.setDoc, firestore.addDoc, firestore.updateDoc, firestore.deleteDoc, firestore.writeBatch, firestore.runTransaction]) {
    expect(spy).not.toHaveBeenCalled();
  }
  expect(firestore.getDocs).not.toHaveBeenCalled();
  vi.clearAllMocks();
});

describe("useActiveNutritionV2Generation", () => {
  it("is null, and reads no request, while the state names none", async () => {
    put(statePath(), makeState({ activeGenerationRequestId: null }));
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([statePath()]);
  });

  it("is null without a state document", async () => {
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(result.current).toEqual({ status: "success", data: null });
  });

  it("reads exactly the request the pointer names, strictly, under generation.byId", async () => {
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(), running());
    const { result, client } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: running() });
    expect(readPaths()).toEqual([statePath(), requestPath()]);
    const cached = client.getQueryCache().find({ queryKey: queryKeys.nutrition.generation.byId("alice", RID), exact: true });
    expect(cached?.state.data).toEqual(running());
    // Generation reads are ephemeral: never written to the persisted cache.
    expect(shouldPersistQuery({ queryKey: queryKeys.nutrition.generation.byId("alice", RID), state: { status: "success" } })).toBe(false);
  });

  it.each([
    ["terminal", running({ status: "failed", errorCode: "PROVIDER_FAILED", finishedAt: { seconds: 1_790_000_100, nanoseconds: 0 } })],
    ["succeeded", running({ status: "succeeded", resultPlanId: "plan-2", finishedAt: { seconds: 1_790_000_100, nanoseconds: 0 } })],
  ])("parses a %s request as it is", async (_label, request) => {
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(), request);
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(result.current).toEqual({ status: "success", data: request });
  });

  it("errors — never 'no generation' — when the named request does not exist", async () => {
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(integrityCode(result.current)).toBe("missingDocument");
  });

  it.each([
    ["a cancelled status", { ...running(), status: "cancelled" }],
    ["a prompt", { ...running(), prompt: "never stored" }],
    ["a provider response", { ...running(), providerResponse: {} }],
    ["a succeeded request without its plan", { ...running(), status: "succeeded", finishedAt: { seconds: 1_790_000_100, nanoseconds: 0 } }],
    ["a failed request with a plan", running({ status: "failed", errorCode: "PROVIDER_FAILED", resultPlanId: "plan-2", finishedAt: { seconds: 1_790_000_100, nanoseconds: 0 } })],
    ["a running request that finished", running({ finishedAt: { seconds: 1_790_000_100, nanoseconds: 0 } })],
    ["a string timestamp", { ...running(), createdAt: "2026-09-28T09:15:00Z" }],
    ["schemaVersion 1", { ...running(), schemaVersion: 1 }],
  ])("errors on %s instead of defaulting", async (_label, bad) => {
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(), bad);
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(integrityCode(result.current)).toBe("malformed");
  });

  it("errors when the document carries another request id", async () => {
    const other = "00000000-0000-4000-8000-000000000012";
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(), running({ requestId: other, idempotencyKey: `nutritionPlan:${other}` }));
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(integrityCode(result.current)).toBe("idMismatch");
  });

  it.each([
    ["signed out", () => (session.user = null)],
    ["a minor", () => (session.profile = { status: "success", data: { id: "alice", age: 17 } })],
    ["a missing age", () => (session.profile = { status: "success", data: { id: "alice" } })],
  ])("reads nothing for %s", async (_label, arrange) => {
    arrange();
    put(statePath(), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(), running());
    const { result } = mount(() => useActiveNutritionV2Generation());
    expect(result.current.status).toBe("disabled");
    expect(readPaths()).toEqual([]);
  });

  it("is account-scoped: another account's request is never read", async () => {
    session.user = { uid: "bob", id: "bob" };
    session.profile = { status: "success", data: { id: "bob", age: 30 } };
    put(statePath("bob"), makeState({ activeGenerationRequestId: RID }));
    put(requestPath(RID, "alice"), running());
    const { result } = mount(() => useActiveNutritionV2Generation());
    await settled(() => result.current);
    expect(integrityCode(result.current)).toBe("missingDocument");
    expect(readPaths()).toEqual([statePath("bob"), requestPath(RID, "bob")]);
  });
});

describe("useNutritionV2GenerationRequest", () => {
  it("reads a request by the id a call answered with, and nothing when asked for none", async () => {
    put(requestPath(), running());
    const { result } = mount(() => ({ some: useNutritionV2GenerationRequest(RID), none: useNutritionV2GenerationRequest(null) }));
    await settled(() => result.current.some);
    expect(result.current.some).toEqual({ status: "success", data: running() });
    expect(result.current.none).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([requestPath()]);
  });
});

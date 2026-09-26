import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-04. The legacy hook reads the owner's latest `nutrition_plans` document
  and nothing else: no Nutrition V2 collection, no write path.
*/

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({ ref, constraints })),
  orderBy: vi.fn((field: string, direction: string) => ({ orderBy: [field, direction] })),
  limit: vi.fn((n: number) => ({ limit: n })),
  getDocs: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: { fixture: "db" } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "alice", id: "alice" } }) }));

import { useLegacyNutritionPlan } from "./useLegacyNutritionPlan";
import { queryKeys } from "@/lib/queryKeys";
import { NUTRITION_LEGACY_PLANS_COLLECTION, NUTRITION_V2_COLLECTIONS } from "@shared/nutrition/collections";

const snapshot = (docs: { id: string; data: unknown }[]) => ({
  empty: docs.length === 0,
  docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
});

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useLegacyNutritionPlan(), { wrapper }) };
};

const writeSpies = () => [
  firestore.setDoc,
  firestore.addDoc,
  firestore.updateDoc,
  firestore.deleteDoc,
  firestore.writeBatch,
  firestore.runTransaction,
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLegacyNutritionPlan", () => {
  it("caches under queryKeys.nutritionLegacy.latest(uid) and nowhere else", async () => {
    firestore.getDocs.mockResolvedValue(snapshot([]));
    const { client, result } = mount();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryCache().findAll().map((q) => q.queryKey)).toEqual([
      queryKeys.nutritionLegacy.latest("alice"),
    ]);
  });

  it("reads only the owner's latest legacy plan from the legacy collection constant", async () => {
    firestore.getDocs.mockResolvedValue(snapshot([]));
    const { result } = mount();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(firestore.collection.mock.calls).toEqual([
      [{ fixture: "db" }, "users", "alice", NUTRITION_LEGACY_PLANS_COLLECTION],
    ]);
    expect(firestore.orderBy.mock.calls).toEqual([["createdAt", "desc"]]);
    expect(firestore.limit.mock.calls).toEqual([[1]]);
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
    expect(firestore.getDocs.mock.calls[0][0]).toEqual({
      ref: { path: `users/alice/${NUTRITION_LEGACY_PLANS_COLLECTION}` },
      constraints: [{ orderBy: ["createdAt", "desc"] }, { limit: 1 }],
    });
  });

  it("returns null when no legacy plan exists", async () => {
    firestore.getDocs.mockResolvedValue(snapshot([]));
    const { result } = mount();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it("returns the latest legacy plan through the tolerant adapter", async () => {
    firestore.getDocs.mockResolvedValue(
      snapshot([
        {
          id: "legacy-7",
          data: {
            content: { breakfast: [{ meal: "Porridge", description: "Hafer", calories: 420 }], lunch: "broken" },
            createdAt: { seconds: 1 },
          },
        },
      ])
    );
    const { result } = mount();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      id: "legacy-7",
      buckets: [{ key: "breakfast", meals: [{ meal: "Porridge", description: "Hafer", caloriesText: "420" }] }],
    });
  });

  it("never writes and never queries a Nutrition V2 collection", async () => {
    firestore.getDocs.mockResolvedValue(
      snapshot([{ id: "legacy-7", data: { content: { breakfast: [{ meal: "A", description: "" }] } } }])
    );
    const { result } = mount();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const spy of writeSpies()) {
      expect(spy).not.toHaveBeenCalled();
    }
    const paths = firestore.collection.mock.calls.flatMap((call) => call.slice(1));
    for (const name of Object.values(NUTRITION_V2_COLLECTIONS)) {
      expect(paths).not.toContain(name);
    }
    expect(paths.some((segment) => String(segment).startsWith("nutrition_v2"))).toBe(false);
  });

  it("has no write or mutation path in its source", () => {
    const source = readFileSync(resolve(__dirname, "useLegacyNutritionPlan.ts"), "utf8");

    expect(source).not.toMatch(/\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|useMutation)\b/);
    expect(source).not.toMatch(/nutrition_v2|NUTRITION_V2/);
    // The collection name comes from the shared constant, never a literal.
    expect(source).not.toMatch(/["']nutrition_plans["']/);
  });
});

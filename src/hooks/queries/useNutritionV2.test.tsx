import React from "react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-05. The first Nutrition V2 client reads: read-only, account-scoped,
  gated on eligibility, and strict — a malformed or mismatched V2 document is
  an error, never an empty or defaulted result.

  Firestore is an in-memory double keyed by document path, so each test states
  exactly which documents exist and asserts exactly which paths were read.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => {
  type Where = { field: string; op: string; value: unknown };
  const matches = (data: unknown, constraints: Where[]) =>
    constraints.every(({ field, op, value }) => {
      const actual = (data as Record<string, string> | null)?.[field];
      if (op === "==") return actual === value;
      if (op === ">=") return actual >= (value as string);
      if (op === "<=") return actual <= (value as string);
      throw new Error(`unsupported op ${op}`);
    });
  return {
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({
      path: segments.join("/"),
      id: segments[segments.length - 1],
    })),
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    query: vi.fn((ref: { path: string }, ...constraints: Where[]) => ({ ref, constraints })),
    getDoc: vi.fn(async (ref: { path: string; id: string }) => {
      const data = store.docs.get(ref.path);
      return { id: ref.id, exists: () => data !== undefined, data: () => data };
    }),
    getDocs: vi.fn(async (q: { ref: { path: string }; constraints: Where[] }) => {
      const prefix = `${q.ref.path}/`;
      const docs = [...store.docs.entries()]
        .filter(([path, data]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && matches(data, q.constraints))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
      return { empty: docs.length === 0, docs };
    }),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
  };
});

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: { fixture: "db" } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));

import {
  useActiveNutritionV2Plan,
  useCurrentNutritionV2Target,
  useNutritionV2Access,
  useNutritionV2EntriesByDate,
  useNutritionV2EntriesRange,
  useNutritionV2Slots,
  useNutritionV2State,
} from "./useNutritionV2";
import { queryKeys } from "@/lib/queryKeys";
import { NutritionV2IntegrityError } from "@/lib/nutrition/v2/integrity";
import type { NutritionV2Read } from "@/lib/nutrition/v2/readStatus";
import { NUTRITION_V2_COLLECTIONS, NUTRITION_V2_SUGGESTIONS_COLLECTION, slotHeadId } from "@shared/nutrition";
import {
  PLAN_END,
  PLAN_ID,
  PLAN_START,
  extraEntry,
  makePlan,
  makeSlotHead,
  makeState,
  makeTarget,
  plannedMealEntry,
  skipEntry,
  slotHeadDocId,
} from "@/test/nutritionV2Fixtures";

const C = NUTRITION_V2_COLLECTIONS;
const statePath = (uid: string) => `users/${uid}/${C.state}/current`;
const put = (path: string, data: unknown) => store.docs.set(path, data);

/** Signs `uid` in with an adult profile, or with exactly the `age` given (even `undefined`). */
const signIn = (uid: string, ...age: [unknown?]) => {
  session.user = { uid, id: uid };
  session.profile = { status: "success", data: { id: uid, age: age.length ? age[0] : 30 } };
};

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const mount = <T,>(hook: () => T, client = makeClient()) => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(hook, { wrapper }) };
};

const settled = async (read: () => NutritionV2Read<unknown>) =>
  waitFor(() => expect(["success", "error"]).toContain(read().status));

const readPaths = () => firestore.getDoc.mock.calls.map(([ref]) => (ref as { path: string }).path);
const queriedPaths = () => firestore.getDocs.mock.calls.map(([q]) => (q as { ref: { path: string } }).ref.path);

const integrityError = (read: NutritionV2Read<unknown>) => {
  expect(read.status).toBe("error");
  const error = read.status === "error" ? read.error : null;
  expect(error).toBeInstanceOf(NutritionV2IntegrityError);
  return error as NutritionV2IntegrityError;
};

const writeSpies = () => [
  firestore.setDoc,
  firestore.addDoc,
  firestore.updateDoc,
  firestore.deleteDoc,
  firestore.writeBatch,
  firestore.runTransaction,
];

beforeEach(() => {
  store.docs.clear();
  signIn("alice");
});

afterEach(() => {
  vi.clearAllMocks();
  for (const spy of writeSpies()) expect(spy).not.toHaveBeenCalled();
});

/* ------------------------------------------------------------------ */

describe("Nutrition V2 access gate", () => {
  it("is eligible for a signed-in adult", () => {
    const { result } = mount(() => useNutritionV2Access());
    expect(result.current).toEqual({ status: "eligible", uid: "alice" });
  });

  it("uses the NUT-03 age policy: under 18 is a minor, missing or unusable age is missingAge", () => {
    for (const [age, reason] of [
      [17, "minor"],
      [null, "missingAge"],
      [undefined, "missingAge"],
      ["30", "missingAge"],
      [0, "missingAge"],
    ] as const) {
      signIn("alice", age);
      const { result, unmount } = mount(() => useNutritionV2Access());
      expect(result.current).toEqual({ status: "ineligible", reason });
      unmount();
    }

    signIn("alice", 18);
    expect(mount(() => useNutritionV2Access()).result.current).toEqual({ status: "eligible", uid: "alice" });
  });

  it("treats a missing profile document as missingAge", () => {
    session.profile = { status: "success", data: null };
    expect(mount(() => useNutritionV2Access()).result.current).toEqual({ status: "ineligible", reason: "missingAge" });
  });

  it("is pending while the profile loads, and never uses another account's profile", () => {
    session.profile = { status: "pending", data: undefined };
    expect(mount(() => useNutritionV2Access()).result.current).toEqual({ status: "pending" });

    session.profile = { status: "success", data: { id: "bob", age: 40 } };
    expect(mount(() => useNutritionV2Access()).result.current).toEqual({ status: "pending" });
  });

  it("reports a failed profile read as an error, not as eligible", () => {
    session.profile = { status: "error", data: undefined };
    expect(mount(() => useNutritionV2Access()).result.current).toEqual({ status: "error" });
  });

  it("reads nothing while signed out, ineligible or pending", async () => {
    put(statePath("alice"), makeState());
    const cases: (() => void)[] = [
      () => {
        session.user = null;
      },
      () => signIn("alice", 16),
      () => signIn("alice", null),
      () => {
        session.profile = { status: "pending", data: undefined };
      },
    ];
    for (const arrange of cases) {
      arrange();
      const { result, client, unmount } = mount(() => ({
        state: useNutritionV2State(),
        plan: useActiveNutritionV2Plan(),
        target: useCurrentNutritionV2Target(),
        slots: useNutritionV2Slots(makePlan()),
        byDate: useNutritionV2EntriesByDate(PLAN_START),
        range: useNutritionV2EntriesRange(PLAN_START, PLAN_END),
      }));
      await new Promise((r) => setTimeout(r, 0));

      for (const read of Object.values(result.current)) expect(read.status).toBe("disabled");
      expect(client.getQueryCache().findAll().every((q) => q.state.fetchStatus === "idle")).toBe(true);
      unmount();
    }
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe("useNutritionV2State", () => {
  it("returns null when the state document is absent (V2 not initialised)", async () => {
    const { result, client } = mount(() => useNutritionV2State());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([statePath("alice")]);
    expect(client.getQueryData(queryKeys.nutrition.state("alice"))).toBeNull();
  });

  it("parses a valid state document", async () => {
    put(statePath("alice"), makeState({ activeGenerationRequestId: "gen-1" }));
    const { result } = mount(() => useNutritionV2State());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: makeState({ activeGenerationRequestId: "gen-1" }) });
  });

  it("errors on a malformed state document instead of defaulting it", async () => {
    for (const bad of [
      { ...makeState(), schemaVersion: 1 },
      { ...makeState(), activePlanId: undefined },
      { ...makeState(), extra: true },
      { ...makeState(), activePlanId: "has space" },
      "garbage",
    ]) {
      store.docs.clear();
      put(statePath("alice"), bad);
      const { result, unmount } = mount(() => useNutritionV2State());
      await settled(() => result.current);

      expect(integrityError(result.current).code).toBe("malformed");
      unmount();
    }
  });

  it("does not read the generation request the state points to", async () => {
    put(statePath("alice"), makeState({ activeGenerationRequestId: "gen-1" }));
    const { result } = mount(() => ({ state: useNutritionV2State(), plan: useActiveNutritionV2Plan() }));
    put(`users/alice/${C.plans}/${PLAN_ID}`, makePlan());
    await settled(() => result.current.plan);

    const paths = [...readPaths(), ...queriedPaths()];
    expect(paths.some((path) => path.includes(C.generations))).toBe(false);
    expect(paths.some((path) => path.includes(NUTRITION_V2_SUGGESTIONS_COLLECTION))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("useActiveNutritionV2Plan", () => {
  it("does not read a plan when activePlanId is null", async () => {
    put(statePath("alice"), makeState({ activePlanId: null }));
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([statePath("alice")]);
  });

  it("does not read a plan when V2 is not initialised", async () => {
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([statePath("alice")]);
  });

  it("reads exactly the pointed-to plan document under its plan key", async () => {
    put(statePath("alice"), makeState());
    put(`users/alice/${C.plans}/${PLAN_ID}`, makePlan());
    put(`users/alice/${C.plans}/plan-2`, makePlan({ planId: "plan-2" }));
    const { result, client } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: makePlan() });
    expect(readPaths()).toEqual([statePath("alice"), `users/alice/${C.plans}/${PLAN_ID}`]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.nutrition.plans.byId("alice", PLAN_ID))).toEqual(makePlan());
  });

  it("errors when the pointed-to plan does not exist, rather than reporting no plan", async () => {
    put(statePath("alice"), makeState());
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    const error = integrityError(result.current);
    expect(error.code).toBe("missingDocument");
    expect(error.documentPath).toBe(`${C.plans}/${PLAN_ID}`);
    // Deterministic failures are not retried.
    expect(readPaths().filter((path) => path.includes(C.plans))).toHaveLength(1);
  });

  it("errors on a malformed plan", async () => {
    put(statePath("alice"), makeState());
    const plan = makePlan();
    put(`users/alice/${C.plans}/${PLAN_ID}`, { ...plan, days: plan.days.slice(0, 6) });
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("malformed");
  });

  it("errors when the Firestore id is not the plan's planId", async () => {
    put(statePath("alice"), makeState());
    put(`users/alice/${C.plans}/${PLAN_ID}`, makePlan({ planId: "plan-2" }));
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("idMismatch");
  });

  it("propagates a state error instead of reading a plan", async () => {
    put(statePath("alice"), { broken: true });
    const { result } = mount(() => useActiveNutritionV2Plan());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("malformed");
    expect(readPaths()).toEqual([statePath("alice")]);
  });
});

/* ------------------------------------------------------------------ */

describe("useCurrentNutritionV2Target", () => {
  it("is null without reading a target when the pointer is null", async () => {
    put(statePath("alice"), makeState({ currentTargetVersionId: null }));
    const { result } = mount(() => useCurrentNutritionV2Target());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: null });
    expect(readPaths()).toEqual([statePath("alice")]);
  });

  it("reads and parses exactly the pointed-to target under the current-target key", async () => {
    put(statePath("alice"), makeState());
    put(`users/alice/${C.targets}/target-1`, makeTarget());
    put(`users/alice/${C.targets}/target-2`, makeTarget("target-2"));
    const { result, client } = mount(() => useCurrentNutritionV2Target());
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: makeTarget() });
    expect(readPaths()).toEqual([statePath("alice"), `users/alice/${C.targets}/target-1`]);
    expect(client.getQueryData(queryKeys.nutrition.targets.current("alice"))).toEqual(makeTarget());
  });

  it("errors when the pointed-to target does not exist", async () => {
    put(statePath("alice"), makeState());
    const { result } = mount(() => useCurrentNutritionV2Target());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("missingDocument");
  });

  it("errors when the Firestore id is not the targetVersionId", async () => {
    put(statePath("alice"), makeState());
    put(`users/alice/${C.targets}/target-1`, makeTarget("target-9"));
    const { result } = mount(() => useCurrentNutritionV2Target());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("idMismatch");
  });

  it("errors on a malformed target", async () => {
    put(statePath("alice"), makeState());
    put(`users/alice/${C.targets}/target-1`, { ...makeTarget(), values: { kcal: -1, proteinG: 0, carbsG: 0, fatG: 0 } });
    const { result } = mount(() => useCurrentNutritionV2Target());
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("malformed");
  });
});

/* ------------------------------------------------------------------ */

describe("useNutritionV2Slots", () => {
  const slotsPath = `users/alice/${C.slots}`;
  const putHead = (head: ReturnType<typeof makeSlotHead>, id = slotHeadDocId(head)) => put(`${slotsPath}/${id}`, head);

  it("queries only the active plan's slot heads, under the plan's slot key", async () => {
    const override = makeSlotHead("2026-09-25", "lunch");
    const base = makeSlotHead("2026-09-26", "dinner", null);
    putHead(override);
    putHead(base);
    // Another plan's head is never returned by the planId constraint.
    const foreign = makeSlotHead("2026-09-25", "lunch", undefined, "plan-2");
    putHead(foreign);

    const { result, client } = mount(() => useNutritionV2Slots(makePlan()));
    await settled(() => result.current);

    expect(firestore.where.mock.calls).toEqual([["planId", "==", PLAN_ID]]);
    expect(queriedPaths()).toEqual([slotsPath]);
    expect(result.current.status).toBe("success");
    expect(result.current.status === "success" && result.current.data).toEqual([override, base]);
    expect(client.getQueryData(queryKeys.nutrition.slots.byPlan("alice", PLAN_ID))).toEqual([override, base]);
  });

  it("allows a plan without any slot head", async () => {
    const { result } = mount(() => useNutritionV2Slots(makePlan()));
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: [] });
  });

  it("reads nothing without a plan", async () => {
    const { result } = mount(() => useNutritionV2Slots(null));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current).toEqual({ status: "disabled" });
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  const returning = (docs: { id: string; data: unknown }[]) =>
    firestore.getDocs.mockImplementationOnce(async () => ({
      empty: docs.length === 0,
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    }));

  it.each([
    ["an invalid slot head", () => ({ ...makeSlotHead("2026-09-25", "lunch"), selection: { kind: "swap" } }), "malformed"],
    ["a head of another plan", () => makeSlotHead("2026-09-25", "lunch", undefined, "plan-2"), "outOfScope"],
    ["a head dated outside the plan", () => makeSlotHead("2026-09-30", "lunch"), "outOfScope"],
    ["a head for an unconfigured slot", () => makeSlotHead("2026-09-25", "snack_1"), "outOfScope"],
  ])("errors on %s", async (_label, head, code) => {
    const data = head() as { planId: string; date: string; slotId: string };
    const id = data.planId && data.date && data.slotId ? slotHeadId(data.planId, data.date, data.slotId as never) : "x";
    returning([{ id, data }]);
    const { result } = mount(() => useNutritionV2Slots(makePlan()));
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe(code);
  });

  it("errors when the Firestore id is not slotHeadId(planId, date, slotId)", async () => {
    const head = makeSlotHead("2026-09-25", "lunch");
    putHead(head, slotHeadId(PLAN_ID, "2026-09-26", "lunch"));
    const { result } = mount(() => useNutritionV2Slots(makePlan()));
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("idMismatch");
  });
});

/* ------------------------------------------------------------------ */

describe("Nutrition V2 entry reads", () => {
  const entriesPath = (uid: string) => `users/${uid}/${C.entries}`;
  const putEntry = (uid: string, entry: { entryId?: string }, id = entry.entryId) => put(`${entriesPath(uid)}/${id}`, entry);

  it("reads one date with an equality query under the by-date key", async () => {
    const lunch = plannedMealEntry("2026-09-25", "lunch");
    putEntry("alice", lunch);
    putEntry("alice", skipEntry("2026-09-26", "lunch"));
    const { result, client } = mount(() => useNutritionV2EntriesByDate("2026-09-25"));
    await settled(() => result.current);

    expect(result.current).toEqual({ status: "success", data: [lunch] });
    expect(queriedPaths()).toEqual([entriesPath("alice")]);
    expect(firestore.where.mock.calls).toEqual([["date", "==", "2026-09-25"]]);
    expect(client.getQueryData(queryKeys.nutrition.entries.byDate("alice", "2026-09-25"))).toEqual([lunch]);
  });

  it("reads a date range with a bounded query under the range key", async () => {
    const inside = [plannedMealEntry(PLAN_START, "breakfast"), skipEntry(PLAN_END, "dinner"), extraEntry("2026-09-24")];
    for (const entry of inside) putEntry("alice", entry);
    putEntry("alice", skipEntry("2026-09-30", "dinner"));
    const { result, client } = mount(() => useNutritionV2EntriesRange(PLAN_START, PLAN_END));
    await settled(() => result.current);

    expect(result.current.status === "success" && result.current.data).toEqual(inside);
    expect(firestore.where.mock.calls).toEqual([
      ["date", ">=", PLAN_START],
      ["date", "<=", PLAN_END],
    ]);
    expect(client.getQueryData(queryKeys.nutrition.entries.range("alice", PLAN_START, PLAN_END))).toEqual(inside);
  });

  it("is account-scoped: another account reads its own path under its own keys", async () => {
    putEntry("alice", plannedMealEntry("2026-09-25", "lunch"));
    const bobs = skipEntry("2026-09-25", "dinner");
    putEntry("bob", bobs);
    signIn("bob");

    const { result, client } = mount(() => ({
      byDate: useNutritionV2EntriesByDate("2026-09-25"),
      range: useNutritionV2EntriesRange(PLAN_START, PLAN_END),
    }));
    await settled(() => result.current.byDate);
    await settled(() => result.current.range);

    expect(result.current.byDate).toEqual({ status: "success", data: [bobs] });
    expect(result.current.range).toEqual({ status: "success", data: [bobs] });
    expect(new Set(queriedPaths())).toEqual(new Set([entriesPath("bob")]));
    const keys = client.getQueryCache().findAll().map((q) => q.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        queryKeys.nutrition.entries.byDate("bob", "2026-09-25"),
        queryKeys.nutrition.entries.range("bob", PLAN_START, PLAN_END),
      ])
    );
    expect(keys.every((key) => key[1] === "bob")).toBe(true);
  });

  it("errors on a malformed entry", async () => {
    // A field the contract does not name is rejected, not carried along.
    const malformed = { ...plannedMealEntry("2026-09-25", "lunch"), actualCalories: 500 };
    putEntry("alice", malformed);
    const { result } = mount(() => useNutritionV2EntriesRange(PLAN_START, PLAN_END));
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("malformed");
  });

  it("errors when the Firestore id is not the entryId", async () => {
    putEntry("alice", plannedMealEntry("2026-09-25", "lunch"), "slot:2026-09-25:dinner");
    const { result } = mount(() => useNutritionV2EntriesByDate("2026-09-25"));
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("idMismatch");
  });

  it("errors on an entry returned outside the requested dates", async () => {
    const outside = skipEntry("2026-09-30", "lunch");
    firestore.getDocs.mockImplementationOnce(async () => ({
      empty: false,
      docs: [{ id: outside.entryId, data: () => outside }],
    }));
    const { result } = mount(() => useNutritionV2EntriesRange(PLAN_START, PLAN_END));
    await settled(() => result.current);

    expect(integrityError(result.current).code).toBe("outOfScope");
  });

  it("reads nothing for an invalid date or an inverted range", async () => {
    const { result } = mount(() => ({
      badDate: useNutritionV2EntriesByDate("2026-02-30"),
      noDate: useNutritionV2EntriesByDate(null),
      inverted: useNutritionV2EntriesRange(PLAN_END, PLAN_START),
    }));
    await new Promise((r) => setTimeout(r, 0));

    for (const read of Object.values(result.current)) expect(read).toEqual({ status: "disabled" });
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */

describe("account isolation", () => {
  it("switching account never serves the previous account's V2 cache entry", async () => {
    put(statePath("alice"), makeState());
    put(statePath("bob"), makeState({ activePlanId: null }));
    const client = makeClient();

    const { result, rerender } = mount(() => useNutritionV2State(), client);
    await waitFor(() => expect(result.current).toEqual({ status: "success", data: makeState() }));

    signIn("bob");
    rerender();
    await waitFor(() => expect(result.current).toEqual({ status: "success", data: makeState({ activePlanId: null }) }));

    expect(readPaths()).toEqual([statePath("alice"), statePath("bob")]);
    expect(client.getQueryData(queryKeys.nutrition.state("alice"))).toEqual(makeState());
    expect(client.getQueryData(queryKeys.nutrition.state("bob"))).toEqual(makeState({ activePlanId: null }));
  });
});

/* ------------------------------------------------------------------ */

describe("Nutrition V2 read sources", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
  const sources = {
    hooks: read("useNutritionV2.ts"),
    readers: read("../../lib/nutrition/v2/firestoreReads.ts"),
    integrity: read("../../lib/nutrition/v2/integrity.ts"),
  };

  it("have no write or mutation API", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(
        /\b(setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction|useMutation|deleteField|serverTimestamp)\b/
      );
    }
  });

  it("never spell a collection name, and never name generations or suggestions", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/["'`]_?nutrition_v2_\w*["'`]/);
      expect(source, name).not.toMatch(/\bgenerations\b|SUGGESTIONS/);
    }
  });

  it("never cast Firestore data to a V2 contract type", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(
        /\bas\s+(NutritionPlan|RecordedEntry|SlotHead|TargetVersion|NutritionUserState)\b/
      );
    }
  });

  it("never import legacy Nutrition", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toMatch(/nutrition\/legacy|useLegacyNutritionPlan|NUTRITION_LEGACY/);
    }
  });
});

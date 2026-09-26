import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
  NUT-06/NUT-07. Recording is gated exactly like the V2 reads — a signed-in
  adult with a known age. A submit is one explicit action with one new intent
  id, written online or queued (NUT-07: offline, behind an older intent for
  the same entry, or after a connectivity failure — always the same intent).
  A commit (or a conflict, which means the cache was stale) refetches the
  account's entry queries and nothing else.
*/

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
}));

const writer = vi.hoisted(() => ({ writeNutritionV2Entry: vi.fn() }));
const reads = vi.hoisted(() => ({ readNutritionV2Entries: vi.fn() }));

vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: {
    get currentUser() {
      return session.user;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/lib/nutrition/v2/entryWriter", () => writer);
vi.mock("@/lib/nutrition/v2/firestoreReads", () => reads);

import {
  NutritionV2RecordingUnavailableError,
  useNutritionV2Recording,
} from "./useNutritionV2Recording";
import { NutritionEntryConflictError } from "@/lib/nutrition/v2/entryTransaction";
import { NutritionV2IntegrityError } from "@/lib/nutrition/v2/integrity";
import { resetNutritionHandoffForTests } from "@/lib/nutrition/v2/entryHandoff";
import { groupNutritionConflicts, readOwnerNutritionQueue } from "@/lib/nutrition/v2/nutritionWriteIntents";
import {
  NutritionRecordingInputError,
  buildCustomSlotRecording,
  buildSkipRecording,
  type NutritionRecordingCommand,
} from "@/lib/nutrition/v2/recording";
import { AccountChangedError } from "@/lib/accountIdentity";
import { enqueue, loadQueue, updateEntry, type OfflineMutationEntry } from "@/lib/offlineQueue";
import { queryKeys } from "@/lib/queryKeys";
import {
  addNutritionDays,
  nutritionDateAt,
  slotEntryId,
  type NutritionEntryIntent,
  type RecordedEntry,
} from "@shared/nutrition";
import { intentUuid, plannedMealEntry, removedEntry, skipEntry } from "@/test/nutritionV2Fixtures";

const STORAGE = "FITSSAI_OFFLINE_QUEUE";

const today = () => nutritionDateAt(new Date());
const skipToday = (): NutritionRecordingCommand => ({
  kind: "save",
  current: null,
  desired: buildSkipRecording({ date: today(), slotId: "breakfast" }),
});

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useNutritionV2Recording(), { wrapper }) };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

/** Seeds a query under `key` so its invalidation can be observed. */
const seedQuery = (client: QueryClient, key: readonly unknown[]) => client.setQueryData(key, ["seeded"]);
const invalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;

beforeEach(() => {
  localStorage.clear();
  resetNutritionHandoffForTests();
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  reads.readNutritionV2Entries.mockReset();
  writer.writeNutritionV2Entry.mockReset();
  writer.writeNutritionV2Entry.mockImplementation(async (_uid: string, intent: { desired: unknown }) => ({
    outcome: "applied",
    entry: intent.desired,
  }));
});

afterEach(() => {
  // Restore jsdom's own navigator.onLine.
  delete (navigator as { onLine?: boolean }).onLine;
  vi.restoreAllMocks();
});

describe("availability", () => {
  it("is available for a signed-in adult who is online", () => {
    expect(mount().result.current.availability).toEqual({ status: "available" });
  });

  it.each([
    ["signed out", () => (session.user = null), "signedOut"],
    ["the profile is loading", () => (session.profile = { status: "pending", data: undefined }), "pending"],
    ["the profile read failed", () => (session.profile = { status: "error", data: undefined }), "error"],
    ["the age is missing", () => (session.profile = { status: "success", data: { id: "alice" } }), "ineligible"],
    ["the age is unusable", () => (session.profile = { status: "success", data: { id: "alice", age: "30" } }), "ineligible"],
    ["the person is 17", () => (session.profile = { status: "success", data: { id: "alice", age: 17 } }), "ineligible"],
  ])("is unavailable when %s, and a submit never starts a write", async (_label, arrange, reason) => {
    arrange();
    const { result } = mount();

    expect(result.current.availability).toEqual({ status: "unavailable", reason });
    await expect(result.current.submit(skipToday())).rejects.toMatchObject({ reason });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("stays available offline and reports the connection separately", () => {
    const { result } = mount();
    act(() => setOnline(false));

    expect(result.current.availability).toEqual({ status: "available" });
    expect(result.current.online).toBe(false);
    act(() => setOnline(true));
    expect(result.current.online).toBe(true);
  });

  it("refuses offline too when the account is not eligible, and queues nothing", async () => {
    session.profile = { status: "success", data: { id: "alice", age: 17 } };
    const { result } = mount();
    act(() => setOnline(false));

    await expect(result.current.submit(skipToday())).rejects.toBeInstanceOf(NutritionV2RecordingUnavailableError);
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });
});

describe("submit", () => {
  it("writes nothing on mount or render", () => {
    const { rerender } = mount();
    rerender();
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("writes with the authenticated uid and a fresh intent id per action", async () => {
    const { result } = mount();

    await act(async () => {
      expect(await result.current.submit(skipToday())).toMatchObject({ status: "committed", result: { outcome: "applied" } });
    });
    await act(() => result.current.submit(skipToday()));

    const calls = writer.writeNutritionV2Entry.mock.calls;
    expect(calls.map(([uid]) => uid)).toEqual(["alice", "alice"]);
    const [first, second] = calls.map(([, intent]) => intent);
    expect(first).toMatchObject({ op: "skip", expectedRevision: 0, entryId: `slot:${today()}:breakfast` });
    expect(first.intentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second.intentId).not.toBe(first.intentId);
  });

  it("refuses a future Berlin date before any write, and allows an earlier one", async () => {
    const { result } = mount();
    const tomorrow = addNutritionDays(today(), 1);

    await expect(
      result.current.submit({ kind: "save", current: null, desired: buildSkipRecording({ date: tomorrow, slotId: "lunch" }) })
    ).rejects.toMatchObject({ reason: "futureDate" });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();

    // No lower bound is invented: the writer may take an earlier date.
    const earlier = addNutritionDays(today(), -30);
    await act(() =>
      result.current.submit({ kind: "save", current: null, desired: buildSkipRecording({ date: earlier, slotId: "lunch" }) })
    );
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });

  it("names the revision the person saw when removing", async () => {
    const { result } = mount();
    const current = { ...plannedMealEntry(today(), "lunch"), revision: 3 };

    await act(() => result.current.submit({ kind: "remove", current }));
    expect(writer.writeNutritionV2Entry.mock.calls[0][1]).toMatchObject({ op: "remove", expectedRevision: 3, entryId: current.entryId });
  });
});

describe("cache convergence", () => {
  const seedAll = (client: QueryClient) => {
    const keys = {
      byDate: queryKeys.nutrition.entries.byDate("alice", today()),
      range: queryKeys.nutrition.entries.range("alice", "2026-09-23", "2026-09-29"),
      state: queryKeys.nutrition.state("alice"),
      plan: queryKeys.nutrition.plans.byId("alice", "plan-1"),
      slots: queryKeys.nutrition.slots.byPlan("alice", "plan-1"),
      bobEntries: queryKeys.nutrition.entries.byDate("bob", today()),
      legacy: queryKeys.nutritionLegacy.latest("alice"),
      trainingPlans: queryKeys.plans.byUser("alice"),
      trainingLogs: queryKeys.logs.byPlan("plan-1", "alice"),
    };
    for (const key of Object.values(keys)) seedQuery(client, key);
    return keys;
  };

  it("after a write, invalidates only this account's V2 entry queries", async () => {
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(() => result.current.submit(skipToday()));

    expect(invalidated(client, keys.byDate)).toBe(true);
    expect(invalidated(client, keys.range)).toBe(true);
    for (const key of [keys.state, keys.plan, keys.slots, keys.bobEntries, keys.legacy, keys.trainingPlans, keys.trainingLogs]) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
    }
  });

  it("after a conflict, refetches the entries too and surfaces the typed conflict", async () => {
    const conflict = new NutritionEntryConflictError({
      reason: "staleRevision",
      entryId: `slot:${today()}:breakfast`,
      expectedRevision: 0,
      currentRevision: 2,
      current: null,
    });
    writer.writeNutritionV2Entry.mockRejectedValueOnce(conflict);
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(async () => {
      await expect(result.current.submit(skipToday())).rejects.toBe(conflict);
    });

    expect(invalidated(client, keys.byDate)).toBe(true);
    expect(invalidated(client, keys.legacy)).toBe(false);
    // The conflict is not retried with a newer revision.
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });

  it("after any other failure, invalidates nothing and does not retry", async () => {
    writer.writeNutritionV2Entry.mockRejectedValueOnce(new Error("unavailable"));
    const { client, result } = mount();
    const keys = seedAll(client);

    await act(async () => {
      await expect(result.current.submit(skipToday())).rejects.toThrow("unavailable");
    });

    expect(invalidated(client, keys.byDate)).toBe(false);
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * NUT-07: write or queue
 * ------------------------------------------------------------------ */

const lunch = () => slotEntryId(today(), "lunch");
const pizzaToday = (kcal = 900, slotId: "lunch" | "dinner" = "lunch") =>
  buildCustomSlotRecording({ date: today(), slotId, name: "Pizza", estimate: { kcal } });
const recordLunch = (kcal = 900): NutritionRecordingCommand => ({ kind: "save", current: null, desired: pizzaToday(kcal) });

const queued = () => loadQueue() as OfflineMutationEntry<"NUTRITION_ENTRY_WRITE">[];
const queuedIntents = () => queued().map((entry) => entry.payload.intent);
const writtenIntents = () => writer.writeNutritionV2Entry.mock.calls.map(([, intent]) => intent as NutritionEntryIntent);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const firestoreError = (code: string) => Object.assign(new Error(code), { name: "FirebaseError", code });

describe("write or queue", () => {
  it("offline: queues the canonical intent for this account, writes nothing and says queued", async () => {
    const { client, result } = mount();
    const byDate = queryKeys.nutrition.entries.byDate("alice", today());
    seedQuery(client, byDate);
    act(() => setOnline(false));

    let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined;
    await act(async () => {
      outcome = await result.current.submit(recordLunch());
    });

    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(queued()).toHaveLength(1);
    expect(outcome).toEqual({ status: "queued", queueEntryId: queued()[0].id });
    expect(queued()[0]).toMatchObject({
      ownerUid: "alice",
      type: "NUTRITION_ENTRY_WRITE",
      status: "pending",
      payload: { date: today(), intent: { op: "record", entryId: lunch(), expectedRevision: 0, desired: pizzaToday() } },
    });
    expect(queued()[0].dependsOn).toBeUndefined();
    // Not saved on the server, so nothing to refetch.
    expect(invalidated(client, byDate)).toBe(false);
  });

  it("online behind an older queued intent for the same entry: queues after it, depending on it", async () => {
    const { result } = mount();
    act(() => setOnline(false));
    await act(() => result.current.submit(recordLunch()));
    const first = queued()[0];
    act(() => setOnline(true));

    // The person saw the projected entry (revision 1) and corrects it.
    const projected = { ...pizzaToday(), revision: 1, status: "active", appliedIntentIds: [first.payload.intent.intentId] } as RecordedEntry;
    await act(async () => {
      expect(await result.current.submit({ kind: "save", current: projected, desired: pizzaToday(700) })).toMatchObject({ status: "queued" });
    });

    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(queuedIntents().map((intent) => [intent.op, intent.expectedRevision])).toEqual([
      ["record", 0],
      ["correct", 1],
    ]);
    expect(queued()[1].dependsOn).toBe(first.id);
  });

  it("online: an older queued intent for another entry does not hold this one", async () => {
    enqueue("NUTRITION_ENTRY_WRITE", { intent: skipDinner(1), date: today() }, "alice");
    const { result } = mount();

    await act(async () => {
      expect(await result.current.submit(recordLunch())).toMatchObject({ status: "committed" });
    });
    expect(writtenIntents()).toHaveLength(1);
    expect(queued()).toHaveLength(1);
  });

  it("online: neither a quarantined intent nor another account's pending one holds the entry", async () => {
    const own = enqueue("NUTRITION_ENTRY_WRITE", { intent: recordIntentFor(1), date: today() }, "alice").entry;
    updateEntry(own.id, { status: "quarantined" });
    const stored = JSON.parse(localStorage.getItem(STORAGE)!);
    localStorage.setItem(STORAGE, JSON.stringify([...stored, { ...stored[0], id: "bobs", ownerUid: "bob", status: "pending" }]));
    const { result } = mount();

    await act(async () => {
      expect(await result.current.submit(recordLunch())).toMatchObject({ status: "committed" });
    });
    expect(writtenIntents()).toHaveLength(1);
  });

  it("queues the SAME intent when the online write cannot reach the server", async () => {
    writer.writeNutritionV2Entry.mockRejectedValueOnce(firestoreError("unavailable"));
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    const { result } = mount();

    await act(async () => {
      expect(await result.current.submit(recordLunch())).toMatchObject({ status: "queued" });
    });

    expect(writtenIntents()).toHaveLength(1);
    expect(queuedIntents()).toEqual([writtenIntents()[0]]);
    expect(queuedIntents()[0].intentId).toBe(writtenIntents()[0].intentId);
    // One id for the intent, one for the queue entry: the intent is never rebuilt.
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a conflict", () => new NutritionEntryConflictError({ reason: "staleRevision", entryId: lunch(), expectedRevision: 0, currentRevision: 1, current: null })],
    ["a permission refusal", () => firestoreError("permission-denied")],
    ["no authentication", () => firestoreError("unauthenticated")],
    ["a malformed server document", () => new NutritionV2IntegrityError("malformed", "users/alice/x/y", "bad")],
    ["an account change", () => new AccountChangedError()],
    ["an invalid input", () => new NutritionRecordingInputError("bad")],
    ["an unknown failure", () => new Error("boom")],
  ])("never queues after %s", async (_label, makeError) => {
    const error = makeError();
    writer.writeNutritionV2Entry.mockRejectedValueOnce(error);
    const { result } = mount();

    await act(async () => {
      await expect(result.current.submit(recordLunch())).rejects.toBe(error);
    });
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });

  it("keeps one entry's actions in order: a later one waits and queues behind an earlier one that got queued", async () => {
    const first = deferred<never>();
    writer.writeNutritionV2Entry.mockImplementationOnce(() => first.promise);
    const { result } = mount();

    let firstOutcome: Promise<unknown> = Promise.resolve();
    let secondOutcome: Promise<unknown> = Promise.resolve();
    act(() => {
      firstOutcome = result.current.submit(recordLunch(900));
      secondOutcome = result.current.submit(recordLunch(800));
    });
    await act(async () => {
      await Promise.resolve();
    });
    // The second has not started: it waits for the first to settle.
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(firestoreError("unavailable"));
      await firstOutcome;
      await secondOutcome;
    });
    expect(writer.writeNutritionV2Entry).toHaveBeenCalledTimes(1);
    expect(queuedIntents().map((intent) => (intent as { desired: { nutritionEstimate: { kcal: number } } }).desired.nutritionEstimate.kcal)).toEqual([900, 800]);
  });

  it("does not make an unrelated entry wait", async () => {
    const held = deferred<never>();
    writer.writeNutritionV2Entry.mockImplementationOnce(() => held.promise);
    const { result } = mount();

    act(() => {
      void result.current.submit(recordLunch()).catch(() => undefined);
    });
    await act(async () => {
      await result.current.submit({ kind: "save", current: null, desired: pizzaToday(500, "dinner") });
    });

    expect(writtenIntents().map((intent) => intent.entryId)).toEqual([lunch(), slotEntryId(today(), "dinner")]);
    await act(async () => {
      held.reject(new Error("later"));
    });
  });
});

/* ------------------------------------------------------------------ *
 * NUT-07: conflicts
 * ------------------------------------------------------------------ */

function recordIntentFor(n: number, kcal = 900): NutritionEntryIntent {
  return { intentId: intentUuid(n), entryId: lunch(), expectedRevision: 0, op: "record", desired: pizzaToday(kcal) };
}
function skipDinner(n: number): NutritionEntryIntent {
  return { intentId: intentUuid(n), entryId: slotEntryId(today(), "dinner"), expectedRevision: 0, op: "skip", desired: buildSkipRecording({ date: today(), slotId: "dinner" }) };
}

const quarantine = (intent: NutritionEntryIntent, uid = "alice") => {
  const { entry } = enqueue("NUTRITION_ENTRY_WRITE", { intent, date: today() }, "alice");
  updateEntry(entry.id, { status: "quarantined", rejection: { code: "staleRevision", message: "changed" } });
  if (uid !== "alice") {
    const stored = JSON.parse(localStorage.getItem(STORAGE)!) as { id: string }[];
    localStorage.setItem(STORAGE, JSON.stringify(stored.map((item) => (item.id === entry.id ? { ...item, ownerUid: uid } : item))));
  }
  return entry.id;
};

const conflictsOf = (uid = "alice") => groupNutritionConflicts(readOwnerNutritionQueue(loadQueue(), uid).rejected);

describe("apply again", () => {
  it("makes a NEW intent against the server's current revision, and retires the rejected one after", async () => {
    const rejectedId = quarantine(recordIntentFor(1, 800));
    const current = { ...skipEntry(today(), "lunch"), revision: 2, appliedIntentIds: [intentUuid(40), intentUuid(41)] };
    reads.readNutritionV2Entries.mockResolvedValue([current]);
    const { result } = mount();
    const [conflict] = conflictsOf();

    await act(async () => {
      expect(await result.current.applyAgain(conflict)).toMatchObject({ status: "committed" });
    });

    expect(reads.readNutritionV2Entries).toHaveBeenCalledWith("alice", today(), today());
    expect(writtenIntents()).toHaveLength(1);
    const replacement = writtenIntents()[0];
    expect(replacement.intentId).not.toBe(intentUuid(1));
    expect(replacement).toMatchObject({ op: "correct", entryId: lunch(), expectedRevision: 2, desired: pizzaToday(800) });
    expect(loadQueue().some((entry) => entry.id === rejectedId)).toBe(false);
    expect(conflictsOf()).toEqual([]);
  });

  it("keeps the rejected change until the replacement is accepted, and keeps it if the replacement fails", async () => {
    const rejectedId = quarantine(recordIntentFor(1));
    reads.readNutritionV2Entries.mockResolvedValue([]);
    const write = deferred<never>();
    writer.writeNutritionV2Entry.mockImplementationOnce(() => write.promise);
    const { result } = mount();
    const [conflict] = conflictsOf();

    let outcome: Promise<unknown> = Promise.resolve();
    act(() => {
      outcome = result.current.applyAgain(conflict);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadQueue().map((entry) => entry.id)).toEqual([rejectedId]);

    const conflictAgain = new NutritionEntryConflictError({ reason: "alreadyActive", entryId: lunch(), expectedRevision: 0, currentRevision: 1, current: null });
    await act(async () => {
      write.reject(conflictAgain);
      await expect(outcome).rejects.toBe(conflictAgain);
    });
    expect(loadQueue()).toMatchObject([{ id: rejectedId, status: "quarantined" }]);
  });

  it("retires the rejected change once the replacement is durably queued, never replaying the old intent", async () => {
    const rejectedId = quarantine(recordIntentFor(1));
    reads.readNutritionV2Entries.mockResolvedValue([]);
    writer.writeNutritionV2Entry.mockRejectedValueOnce(firestoreError("unavailable"));
    const { result } = mount();

    await act(async () => {
      expect(await result.current.applyAgain(conflictsOf()[0])).toMatchObject({ status: "queued" });
    });

    expect(loadQueue().some((entry) => entry.id === rejectedId)).toBe(false);
    expect(queuedIntents()).toHaveLength(1);
    expect(queuedIntents()[0].intentId).not.toBe(intentUuid(1));
    expect(queuedIntents()[0]).toMatchObject({ op: "record", expectedRevision: 0 });
  });

  it("re-evaluates a rejected remove: nothing to apply once the entry is no longer active", async () => {
    const removal: NutritionEntryIntent = { intentId: intentUuid(1), entryId: lunch(), expectedRevision: 1, op: "remove" };
    quarantine(removal);
    reads.readNutritionV2Entries.mockResolvedValue([removedEntry({ ...plannedMealEntry(today(), "lunch") })]);
    const { result } = mount();

    await act(async () => {
      expect(await result.current.applyAgain(conflictsOf()[0])).toEqual({ status: "nothingToApply" });
    });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(conflictsOf()).toEqual([]);
  });

  it("re-evaluates a rejected remove against an entry that is active now", async () => {
    quarantine({ intentId: intentUuid(1), entryId: lunch(), expectedRevision: 1, op: "remove" });
    reads.readNutritionV2Entries.mockResolvedValue([{ ...plannedMealEntry(today(), "lunch"), revision: 3, appliedIntentIds: [intentUuid(7), intentUuid(8), intentUuid(9)] }]);
    const { result } = mount();

    await act(() => result.current.applyAgain(conflictsOf()[0]));
    expect(writtenIntents()).toMatchObject([{ op: "remove", expectedRevision: 3 }]);
    expect(writtenIntents()[0].intentId).not.toBe(intentUuid(1));
  });

  it("is refused offline, reading and removing nothing", async () => {
    const rejectedId = quarantine(recordIntentFor(1));
    const { result } = mount();
    act(() => setOnline(false));

    await expect(result.current.applyAgain(conflictsOf()[0])).rejects.toMatchObject({ reason: "offline" });
    expect(reads.readNutritionV2Entries).not.toHaveBeenCalled();
    expect(loadQueue().map((entry) => entry.id)).toEqual([rejectedId]);
  });
});

describe("dismiss", () => {
  it("removes only that conflict's local records and writes nothing", async () => {
    quarantine(recordIntentFor(1));
    quarantine({ ...recordIntentFor(2), expectedRevision: 1, op: "correct" });
    const dinner = skipDinner(3);
    quarantine(dinner);
    quarantine(recordIntentFor(4), "bob");
    const { result } = mount();
    const [lunchConflict] = conflictsOf();
    expect(lunchConflict.queueEntryIds).toHaveLength(2);

    act(() => result.current.dismiss(lunchConflict));

    expect(conflictsOf().map((conflict) => conflict.entryId)).toEqual([slotEntryId(today(), "dinner")]);
    expect(conflictsOf("bob")).toHaveLength(1);
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(reads.readNutritionV2Entries).not.toHaveBeenCalled();
  });

  it("cannot remove another account's rejected change", () => {
    quarantine(recordIntentFor(1), "bob");
    const { result } = mount();
    const [bobs] = conflictsOf("bob");

    act(() => result.current.dismiss(bobs));
    expect(conflictsOf("bob")).toHaveLength(1);
  });

  it("is refused while signed out", () => {
    quarantine(recordIntentFor(1));
    const [conflict] = conflictsOf();
    session.user = null;
    const { result } = mount();

    expect(() => result.current.dismiss(conflict)).toThrow(NutritionV2RecordingUnavailableError);
    expect(conflictsOf()).toHaveLength(1);
  });
});

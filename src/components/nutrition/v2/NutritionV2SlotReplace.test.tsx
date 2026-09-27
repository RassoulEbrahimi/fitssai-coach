import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-10. Replacing today's planned meal, through the real container, the real
  hook and the real callable module. Firestore reads use an in-memory double;
  behind `httpsCallable` sits a fake server that applies the real shared
  planners to the same store — so what the row shows can only come from a
  refetch of what the "server" wrote, never from the click.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, value = "asc") => ({ field, op: "orderBy", value })),
  limit: vi.fn((value: number) => ({ field: "", op: "limit", value })),
  query: vi.fn((ref: { path: string }, ...constraints: { field: string; op: string; value: string }[]) => ({ ref, constraints })),
  getDoc: vi.fn(async (ref: { path: string; id: string }) => {
    const data = store.docs.get(ref.path);
    return { id: ref.id, exists: () => data !== undefined, data: () => structuredClone(data) };
  }),
  getDocs: vi.fn(async (q: { ref: { path: string }; constraints: { field: string; op: string; value: string }[] }) => {
    const prefix = `${q.ref.path}/`;
    const filters = q.constraints.filter(({ op }) => op !== "orderBy" && op !== "limit");
    let rows = [...store.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter(([, data]) =>
        filters.every(({ field, op, value }) => {
          const actual = (data as Record<string, string>)[field];
          return op === "==" ? actual === value : op === ">=" ? actual >= value : actual <= value;
        })
      );
    for (const { field, op, value } of q.constraints) {
      const at = (data: unknown) => (data as Record<string, string>)[field];
      if (op === "orderBy") rows = [...rows].sort(([, a], [, b]) => (at(a) < at(b) ? -1 : 1) * (value === "desc" ? -1 : 1));
      if (op === "limit") rows = rows.slice(0, Number(value));
    }
    const docs = rows.map(([path, data]) => ({ id: path.slice(prefix.length), data: () => structuredClone(data) }));
    return { empty: docs.length === 0, docs };
  }),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
  today: "2026-09-26",
}));

/** The fake server behind every callable: tests replace `handle`. */
const server = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; payload: unknown }>,
  handle: (async () => ({})) as (name: string, payload: unknown) => Promise<unknown>,
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: (_functions: unknown, name: string) => async (payload: unknown) => {
    server.calls.push({ name, payload: structuredClone(payload) });
    return { data: await server.handle(name, payload) };
  },
}));
vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: {
    get currentUser() {
      return session.user;
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile, useUpdateProfile: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));
vi.mock("@/lib/nutrition/v2/entryWriter", () => ({ writeNutritionV2Entry: vi.fn() }));

import { NutritionV2TodayContainer } from "./NutritionV2TodayContainer";
import { useNutritionV2SlotOverride, isNutritionV2SlotOverrideUnavailableError } from "@/hooks/queries/useNutritionV2SlotOverride";
import { enqueue, loadQueue } from "@/lib/offlineQueue";
import { queryKeys } from "@/lib/queryKeys";
import {
  NUTRITION_UPDATE_SLOT_CALLABLE,
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_ENABLED,
  baseMealFor,
  planSlotHeadCommit,
  planSlotHeadUndo,
  slotHeadId,
  slotHeadSchema,
  type NutritionPlan,
  type NutritionSlotId,
  type NutritionUpdateSlotRequest,
  type SlotHead,
  type SlotHeadCommitInput,
  type SlotHeadUndoInput,
} from "@shared/nutrition";
import { PLAN_ID, intentUuid, makePlan, makeSlotHead, makeState, plannedMealEntry } from "@/test/nutritionV2Fixtures";

const C = NUTRITION_V2_COLLECTIONS;
const TODAY = "2026-09-26"; // day 3 of the 23–29 Sep fixture plan
const plan = makePlan();
const put = (path: string, data: unknown) => store.docs.set(path, data);
const headPath = (slotId: NutritionSlotId, planId = PLAN_ID, date = TODAY) => `users/alice/${C.slots}/${slotHeadId(planId, date, slotId)}`;
const storedHead = (slotId: NutritionSlotId, planId = PLAN_ID, date = TODAY) => {
  const data = store.docs.get(headPath(slotId, planId, date));
  return data === undefined ? null : slotHeadSchema.parse(data);
};

let minted = 0;
const mint = () => `00000000-0000-4000-b000-${String((minted += 1)).padStart(12, "0")}`;

/** What `nutritionUpdateSlot` does, in memory, with the real shared planners. */
const applyOnServer = (payload: NutritionUpdateSlotRequest, owner: NutritionPlan = plan) => {
  const current = storedHead(payload.slotId, payload.planId, payload.date);
  const now = { seconds: 1_790_100_000, nanoseconds: 0 };
  const base = baseMealFor(owner, payload.date, payload.slotId);
  if (!base) throw new Error("fixture");
  const outcome =
    payload.action === "undo"
      ? planSlotHeadUndo(current, { ...payload, now } as SlotHeadUndoInput)
      : planSlotHeadCommit(current, {
          ...payload,
          now,
          baseMealId: base.mealId,
          overrideId: mint(),
          meal: (() => {
            if (payload.replacement.source !== "planMeal") throw new Error("fixture server serves plan meals only");
            const source = owner.days.flatMap((day) => day.meals).find((meal) => meal.mealId === (payload.replacement as { sourceMealId: string }).sourceMealId);
            if (!source) throw new Error("fixture");
            return { ...source, mealId: mint() };
          })(),
          source: { kind: "planMeal", sourceMealId: payload.replacement.sourceMealId },
        } as SlotHeadCommitInput);
  if (outcome.outcome !== "apply") throw new Error(`fixture server: ${outcome.outcome}`);
  put(headPath(payload.slotId, payload.planId, payload.date), outcome.head);
  return {
    ok: true,
    planId: payload.planId,
    date: payload.date,
    slotId: payload.slotId,
    revision: outcome.head.revision,
    selection: outcome.head.selection,
    replay: false,
  };
};

/** A callable refusal as the Functions SDK surfaces it. */
const refusal = (code: string, details?: unknown) => Object.assign(new Error(code), { code: "functions/aborted", details });

const slotCalls = () => server.calls.filter((call) => call.name === NUTRITION_UPDATE_SLOT_CALLABLE);

const renderContainer = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={client}>
      <NutritionV2TodayContainer />
    </QueryClientProvider>
  );
  return { ...utils, client, invalidate };
};

const slotRow = async (slotId: string) => {
  await waitFor(() => expect(screen.getAllByTestId("nutrition-v2-slot")).toHaveLength(3));
  return screen.getAllByTestId("nutrition-v2-slot").find((row) => row.dataset.slotId === slotId) as HTMLElement;
};

const openReplace = async (user: ReturnType<typeof userEvent.setup>, slotId = "lunch") => {
  const label = { breakfast: "Frühstück", lunch: "Mittagessen", dinner: "Abendessen" }[slotId as "lunch"];
  await slotRow(slotId);
  await user.click(screen.getByRole("button", { name: `${label} ersetzen` }));
  return screen.findByRole("dialog", { name: `${label} ersetzen` });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
  store.docs.clear();
  localStorage.clear();
  minted = 0;
  server.calls.length = 0;
  server.handle = async (name, payload) => {
    if (name !== NUTRITION_UPDATE_SLOT_CALLABLE) throw new Error(`unexpected callable ${name}`);
    return applyOnServer(payload as NutritionUpdateSlotRequest);
  };
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  session.today = TODAY;
  put(`users/alice/${C.state}/current`, makeState());
  put(`users/alice/${C.plans}/${PLAN_ID}`, plan);
});

afterEach(() => {
  vi.useRealTimers();
  if (Object.prototype.hasOwnProperty.call(navigator, "onLine")) {
    delete (navigator as { onLine?: boolean }).onLine;
    window.dispatchEvent(new Event("online"));
  }
  vi.clearAllMocks();
});

describe("the replacement surface", () => {
  it("keeps V2 unreachable", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });

  it("offers only other BASE meals of the same slot from the plan that owns today — never an override, another plan's meal or an AI option", async () => {
    const user = userEvent.setup();
    // An override on another day is not a source; another plan's meals are not either.
    put(headPath("lunch", PLAN_ID, "2026-09-24"), makeSlotHead("2026-09-24", "lunch", { name: "Override elsewhere", values: { kcal: 1, proteinG: 1, carbsG: 1, fatG: 1 } }));
    put(`users/alice/${C.plans}/plan-2`, { ...makePlan({ planId: "plan-2", startDate: "2026-09-30" }), days: makePlan({ planId: "plan-2", startDate: "2026-09-30" }).days.map((day) => ({ ...day, meals: day.meals.map((meal) => ({ ...meal, name: `Other ${meal.name}` })) })) });
    renderContainer();

    const sheet = await openReplace(user);
    const options = within(sheet).getAllByRole("radio");
    expect(options.map((option) => (option as HTMLInputElement).value)).toEqual(
      [0, 1, 2, 4, 5, 6].map((i) => `m-${i}-lunch`)
    );
    expect(within(sheet).getByText("Aus dem Plan")).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/Override elsewhere|Other |breakfast|dinner|KI|AI|Vorschlag/);
    expect(within(sheet).getByTestId("nutrition-v2-replace-current")).toHaveTextContent("Geplant: lunch 3 · 703 kcal");
  });

  it("writes nothing when the sheet opens, an option is chosen, or the sheet closes", async () => {
    const user = userEvent.setup();
    renderContainer();

    const sheet = await openReplace(user);
    await user.click(within(sheet).getByRole("radio", { name: /lunch 0/ }));
    await user.click(within(sheet).getByRole("radio", { name: /lunch 5/ }));
    await user.click(within(sheet).getByRole("button", { name: "Abbrechen" }));
    await settle();

    expect(server.calls).toEqual([]);
    expect(storedHead("lunch")).toBeNull();
    expect(within(await slotRow("lunch")).queryByTestId("nutrition-v2-slot-replaced")).toBeNull();
  });

  it("confirming sends one request of ids only, keeps the old meal while pending, and shows the new one only after the refetch", async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    server.handle = async (_name, payload) => {
      await pending.promise;
      return applyOnServer(payload as NutritionUpdateSlotRequest);
    };
    const { invalidate } = renderContainer();

    const sheet = await openReplace(user);
    await user.click(within(sheet).getByRole("radio", { name: /lunch 5/ }));
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));

    // Pending: exactly one request, and the row still shows the base meal.
    await waitFor(() => expect(slotCalls()).toHaveLength(1));
    expect(within(sheet).getByRole("button", { name: "Wird ersetzt …" })).toBeDisabled();
    const row = await slotRow("lunch");
    expect(row).toHaveTextContent("lunch 3");
    expect(row).not.toHaveTextContent("lunch 5");

    const [{ payload }] = slotCalls();
    expect(Object.keys(payload as object).sort()).toEqual(["action", "date", "expectedRevision", "planId", "replacement", "requestId", "slotId"]);
    expect(payload).toEqual({
      action: "commit",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      planId: PLAN_ID,
      date: TODAY,
      slotId: "lunch",
      expectedRevision: 0,
      replacement: { source: "planMeal", sourceMealId: "m-5-lunch" },
    });
    expect(JSON.stringify(payload)).not.toMatch(/kcal|proteinG|name|values|uid|overrideId|mealId"/);

    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = await slotRow("lunch");
    expect(after).toHaveTextContent("lunch 5");
    expect(within(after).getByTestId("nutrition-v2-slot-replaced")).toHaveTextContent("Ersetzt");
    // Exactly the plan's slot heads were refetched — nothing else.
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([queryKeys.nutrition.slots.byPlan("alice", PLAN_ID)]);
  });

  it("never shows a replacement the server did not store: the row follows the refetched head, not the answer", async () => {
    const user = userEvent.setup();
    // The server answers ok but (in this fixture) stores nothing.
    server.handle = async (_name, payload) => {
      const request = payload as NutritionUpdateSlotRequest;
      return { ok: true, planId: request.planId, date: request.date, slotId: request.slotId, revision: 1, selection: { kind: "base" }, replay: true };
    };
    renderContainer();

    const sheet = await openReplace(user);
    await user.click(within(sheet).getByRole("radio", { name: /lunch 5/ }));
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await slotRow("lunch")).toHaveTextContent("lunch 3");
  });

  it("STALE_REVISION: refetches the slot, shows the server's meal and the neutral message, and never retries", async () => {
    const user = userEvent.setup();
    const { invalidate } = renderContainer();
    const sheet = await openReplace(user);

    // Meanwhile another device replaced lunch (revision 1).
    applyOnServer({ action: "commit", requestId: intentUuid(900), planId: PLAN_ID, date: TODAY, slotId: "lunch", expectedRevision: 0, replacement: { source: "planMeal", sourceMealId: "m-6-lunch" } });
    server.handle = async () => {
      throw refusal("STALE_REVISION", { currentRevision: 1 });
    };

    await user.click(within(sheet).getByRole("radio", { name: /lunch 0/ }));
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Der Plan wurde inzwischen geändert.");
    await waitFor(async () => expect(await slotRow("lunch")).toHaveTextContent("lunch 6"));
    expect(within(sheet).getByTestId("nutrition-v2-replace-current")).toHaveTextContent("Geplant: lunch 6");
    expect(slotCalls()).toHaveLength(1);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([queryKeys.nutrition.slots.byPlan("alice", PLAN_ID)]);

    // A second attempt is a new, explicit confirmation — against the revision now shown.
    server.handle = async (_name, payload) => applyOnServer(payload as NutritionUpdateSlotRequest);
    await settle();
    expect(slotCalls()).toHaveLength(1);
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));
    await waitFor(() => expect(slotCalls()).toHaveLength(2));
    const [first, second] = slotCalls().map((call) => call.payload as NutritionUpdateSlotRequest);
    expect([first.expectedRevision, second.expectedRevision]).toEqual([0, 1]);
    expect(second.requestId).not.toBe(first.requestId);
    await waitFor(async () => expect(await slotRow("lunch")).toHaveTextContent("lunch 0"));
  });

  it("SLOT_HAS_RECORD: changes nothing planned, explains it, and refetches the entries", async () => {
    const user = userEvent.setup();
    server.handle = async () => {
      throw refusal("SLOT_HAS_RECORD");
    };
    const { invalidate } = renderContainer();
    const sheet = await openReplace(user);
    // Another device records lunch meanwhile.
    put(`users/alice/${C.entries}/slot:${TODAY}:lunch`, plannedMealEntry(TODAY, "lunch"));

    await user.click(within(sheet).getByRole("radio", { name: /lunch 0/ }));
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Diese Mahlzeit ist bereits erfasst.");
    expect(storedHead("lunch")).toBeNull();
    expect(await slotRow("lunch")).toHaveTextContent("lunch 3");
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([queryKeys.nutrition.entries.all("alice")]);
    // Now that the recording is known, the sheet says so and offers nothing.
    expect(await within(sheet).findByTestId("nutrition-v2-replace-blocked")).toHaveTextContent("bereits erfasst");
    expect(within(sheet).getByRole("button", { name: "Ersetzen" })).toBeDisabled();
  });
});

describe("when replacing is unavailable", () => {
  it("a recorded slot cannot be replaced or undone", async () => {
    const user = userEvent.setup();
    put(headPath("lunch"), makeSlotHead(TODAY, "lunch"));
    put(`users/alice/${C.entries}/slot:${TODAY}:lunch`, plannedMealEntry(TODAY, "lunch"));
    renderContainer();

    const sheet = await openReplace(user);
    expect(within(sheet).getByTestId("nutrition-v2-replace-blocked")).toHaveTextContent(
      "Diese Mahlzeit ist bereits erfasst. Danach kann das geplante Gericht nicht mehr geändert werden."
    );
    for (const radio of within(sheet).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Ersetzen" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Rückgängig" })).toBeDisabled();
  });

  it("a recording still waiting on this device blocks it too", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
    enqueue(
      "NUTRITION_ENTRY_WRITE",
      {
        date: TODAY,
        intent: {
          intentId: intentUuid(1),
          entryId: `slot:${TODAY}:lunch`,
          op: "skip",
          expectedRevision: 0,
          desired: { schemaVersion: 2, entryId: `slot:${TODAY}:lunch`, kind: "slot", date: TODAY, slotId: "lunch", recording: "skip", estimateBasis: "none", nutritionEstimate: null },
        },
      },
      "alice"
    );
    renderContainer();

    const sheet = await openReplace(user);
    expect(within(sheet).getByTestId("nutrition-v2-replace-blocked")).toHaveTextContent(/bereits erfasst|synchronisiert/);
    expect(within(sheet).getByRole("button", { name: "Ersetzen" })).toBeDisabled();
  });

  it("offline, it says so, offers no confirmation, and nothing is queued", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
    renderContainer();

    const sheet = await openReplace(user);
    expect(within(sheet).getByTestId("nutrition-v2-replace-blocked")).toHaveTextContent("Ersetzen ist nur mit Internetverbindung möglich.");
    expect(within(sheet).getByRole("button", { name: "Ersetzen" })).toBeDisabled();
    expect(server.calls).toEqual([]);
    // Nothing is stored for later either: the offline queue stays empty.
    expect(loadQueue()).toEqual([]);
  });

  it("the hook refuses signed-out, ineligible, offline and past-date actions before sending anything", async () => {
    const run = async () => {
      const client = new QueryClient();
      const { result } = renderHook(() => useNutritionV2SlotOverride(), {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
      });
      return result.current;
    };
    const target = { planId: PLAN_ID, date: TODAY, slotId: "lunch" as const, expectedRevision: 0 };
    const reasonOf = (promise: Promise<unknown>) =>
      promise.then(
        () => "sent",
        (error: unknown) => (isNutritionV2SlotOverrideUnavailableError(error) ? error.reason : "other")
      );

    session.user = null;
    expect(await reasonOf((await run()).commitPlanMeal(target, "m-0-lunch"))).toBe("signedOut");
    session.user = { uid: "alice", id: "alice" };
    session.profile = { status: "success", data: { id: "alice", age: 16 } };
    expect(await reasonOf((await run()).undo(target))).toBe("ineligible");
    session.profile = { status: "success", data: { id: "alice", age: 30 } };
    expect(await reasonOf((await run()).commitPlanMeal({ ...target, date: "2026-09-25" }, "m-0-lunch"))).toBe("pastDate");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    expect(await reasonOf((await run()).commitSuggestion(target, { suggestionSetId: "s", candidateId: "c" }))).toBe("offline");
    expect(server.calls).toEqual([]);
  });
});

describe("undo", () => {
  it("is offered only for a replaced slot, is explicit, keeps the override while pending, and refetches on success", async () => {
    const user = userEvent.setup();
    applyOnServer({ action: "commit", requestId: intentUuid(900), planId: PLAN_ID, date: TODAY, slotId: "lunch", expectedRevision: 0, replacement: { source: "planMeal", sourceMealId: "m-6-lunch" } });
    const pending = deferred<void>();
    server.handle = async (_name, payload) => {
      await pending.promise;
      return applyOnServer(payload as NutritionUpdateSlotRequest);
    };
    renderContainer();

    // Dinner has no override: nothing to undo there.
    const dinner = await openReplace(user, "dinner");
    expect(within(dinner).queryByRole("button", { name: "Rückgängig" })).toBeNull();
    await user.click(within(dinner).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const sheet = await openReplace(user);
    expect(server.calls).toEqual([]);
    await user.click(within(sheet).getByRole("button", { name: "Rückgängig" }));
    await waitFor(() => expect(slotCalls()).toHaveLength(1));
    expect(slotCalls()[0].payload).toEqual({
      action: "undo",
      requestId: expect.any(String),
      planId: PLAN_ID,
      date: TODAY,
      slotId: "lunch",
      expectedRevision: 1,
    });
    expect(await slotRow("lunch")).toHaveTextContent("lunch 6");

    await act(async () => pending.resolve());
    await waitFor(async () => expect(await slotRow("lunch")).toHaveTextContent("lunch 3"));
    expect(within(await slotRow("lunch")).queryByTestId("nutrition-v2-slot-replaced")).toBeNull();
    const head = storedHead("lunch") as SlotHead;
    expect([head.revision, head.selection, Object.keys(head.overrides).length]).toEqual([2, { kind: "base" }, 1]);
  });
});

describe("the plan that owns today (NUT-09)", () => {
  it("replaces on the predecessor that owns today while a future successor is state.activePlanId", async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
    session.today = "2026-09-28";
    const source = { ...plan, lifecycle: { status: "superseded" as const, effectiveUntil: "2026-09-29", supersededByPlanId: "plan-2" } };
    const next = makePlan({ planId: "plan-2", startDate: "2026-09-30" });
    put(`users/alice/${C.state}/current`, makeState({ activePlanId: "plan-2", revision: 5 }));
    put(`users/alice/${C.plans}/${PLAN_ID}`, source);
    put(`users/alice/${C.plans}/plan-2`, next);
    server.handle = async (_name, payload) => applyOnServer(payload as NutritionUpdateSlotRequest, source);
    renderContainer();

    const sheet = await openReplace(user);
    expect(within(sheet).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(
      [0, 1, 2, 3, 4, 6].map((i) => `m-${i}-lunch`)
    );
    await user.click(within(sheet).getByRole("radio", { name: /lunch 1/ }));
    await user.click(within(sheet).getByRole("button", { name: "Ersetzen" }));
    await waitFor(() => expect(slotCalls()).toHaveLength(1));
    expect(slotCalls()[0].payload).toMatchObject({ planId: PLAN_ID, date: "2026-09-28", slotId: "lunch" });
    await waitFor(async () => expect(await slotRow("lunch")).toHaveTextContent("lunch 1"));
    expect(storedHead("lunch", PLAN_ID, "2026-09-28")?.revision).toBe(1);
    expect([...store.docs.keys()].filter((path) => path.includes(C.slots))).toEqual([headPath("lunch", PLAN_ID, "2026-09-28")]);
  });
});

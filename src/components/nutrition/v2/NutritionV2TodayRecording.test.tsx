import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-06. Online recording for today's slots and extra meals, through the real
  container. Nothing is written because the shell renders, the plan exists,
  the sheet opens or a portion changes — only "Speichern" or "Entfernen"
  writes. PLANNED and RECORDED stay visibly apart, recorded values read as
  estimates ("ca."), and the week rows keep no controls.

  Firestore reads use an in-memory double; the online writer is replaced by
  one that runs the real shared planner against the same store.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  query: vi.fn((ref: { path: string }, ...constraints: { field: string; op: string; value: string }[]) => ({
    ref,
    constraints,
  })),
  getDoc: vi.fn(async (ref: { path: string; id: string }) => {
    const data = store.docs.get(ref.path);
    return { id: ref.id, exists: () => data !== undefined, data: () => structuredClone(data) };
  }),
  getDocs: vi.fn(
    async (q: { ref: { path: string }; constraints: { field: string; op: string; value: string }[] }) => {
      const prefix = `${q.ref.path}/`;
      const docs = [...store.docs.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .filter(([, data]) =>
          q.constraints.every(({ field, op, value }) => {
            const actual = (data as Record<string, string>)[field];
            return op === "==" ? actual === value : op === ">=" ? actual >= value : actual <= value;
          })
        )
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => structuredClone(data) }));
      return { empty: docs.length === 0, docs };
    }
  ),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
  today: "2026-09-26",
}));

const writer = vi.hoisted(() => ({ writeNutritionV2Entry: vi.fn() }));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));
vi.mock("@/lib/nutrition/v2/entryWriter", () => writer);

import { NutritionV2TodayContainer } from "./NutritionV2TodayContainer";
import { NutritionEntryConflictError } from "@/lib/nutrition/v2/entryTransaction";
import {
  NUTRITION_V2_COLLECTIONS,
  NUTRITION_V2_ENABLED,
  planNutritionEntryWrite,
  type NutritionEntryIntent,
  type RecordedEntry,
} from "@shared/nutrition";
import {
  PLAN_ID,
  customSlotEntry,
  extraEntry,
  makePlan,
  makeState,
  plannedMealEntry,
  removedEntry,
  skipEntry,
} from "@/test/nutritionV2Fixtures";

const C = NUTRITION_V2_COLLECTIONS;
const TODAY = "2026-09-26";
const plan = makePlan();
const entryPath = (entryId: string) => `users/alice/${C.entries}/${entryId}`;
const put = (path: string, data: unknown) => store.docs.set(path, data);
const putEntry = (entry: RecordedEntry) => put(entryPath(entry.entryId), entry);
const stored = (entryId: string) => store.docs.get(entryPath(entryId)) as RecordedEntry | undefined;

/** The intents the writer received, in order. */
const intents = () => writer.writeNutritionV2Entry.mock.calls.map(([, intent]) => intent as NutritionEntryIntent);

const renderContainer = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NutritionV2TodayContainer />
    </QueryClientProvider>
  );
};

const slotRow = async (slotId: string) => {
  await waitFor(() => expect(screen.getAllByTestId("nutrition-v2-slot")).toHaveLength(3));
  return screen.getAllByTestId("nutrition-v2-slot").find((row) => row.dataset.slotId === slotId) as HTMLElement;
};

const openSlot = async (user: ReturnType<typeof userEvent.setup>, slotId: string, action: "erfassen" | "bearbeiten") => {
  const label = { breakfast: "Frühstück", lunch: "Mittagessen", dinner: "Abendessen" }[slotId as "lunch"];
  await slotRow(slotId);
  await user.click(screen.getByRole("button", { name: `${label} ${action}` }));
  return screen.findByRole("dialog", { name: `${label} erfassen` });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
  store.docs.clear();
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { id: "alice", age: 30 } };
  session.today = TODAY;
  put(`users/alice/${C.state}/current`, makeState());
  put(`users/alice/${C.plans}/${PLAN_ID}`, plan);

  writer.writeNutritionV2Entry.mockReset();
  writer.writeNutritionV2Entry.mockImplementation(async (uid: string, intent: NutritionEntryIntent) => {
    const path = `users/${uid}/${C.entries}/${intent.entryId}`;
    const result = planNutritionEntryWrite((store.docs.get(path) as RecordedEntry | undefined) ?? null, intent);
    if (result.outcome === "conflict") throw new NutritionEntryConflictError(result);
    if (result.outcome === "apply") {
      store.docs.set(path, result.entry);
      return { outcome: "applied", entry: result.entry };
    }
    return result;
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (navigator as { onLine?: boolean }).onLine;
  vi.clearAllMocks();
});

describe("today's recording surface", () => {
  it("shows each slot's planned meal apart from what was recorded, and writes nothing on render", async () => {
    putEntry(plannedMealEntry(TODAY, "breakfast", { kcal: 301.8, proteinG: 15, carbsG: 37.5, fatG: 7.5 }));
    putEntry(skipEntry(TODAY, "lunch"));
    renderContainer();

    const breakfast = await slotRow("breakfast");
    expect(breakfast).toHaveTextContent("Frühstück");
    expect(breakfast).toHaveTextContent("breakfast 3");
    expect(breakfast).toHaveTextContent("403 kcal geplant");
    expect(within(breakfast).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent("Erfasst · ca. 302 kcal");
    expect(within(await slotRow("lunch")).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent("Ausgelassen");
    expect(within(await slotRow("dinner")).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent("Nicht erfasst");
    expect(screen.getByText("Erfasste Werte sind Schätzungen.")).toBeInTheDocument();

    await settle();
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("keeps the seven week rows free of controls, and planned kcal labelled as planned", async () => {
    renderContainer();
    await slotRow("lunch");

    const rows = screen.getAllByTestId("nutrition-v2-week-row");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(0);
      expect(row).toHaveTextContent(/kcal geplant$/);
      expect(row).not.toHaveTextContent(/Erfassen|Bearbeiten|Ausgelassen|Gegessen/);
    }
  });

  it("writes nothing when the sheet opens, a portion or mode changes, or the sheet closes", async () => {
    const user = userEvent.setup();
    renderContainer();

    const sheet = await openSlot(user, "lunch", "erfassen");
    await user.click(within(sheet).getByRole("button", { name: "1,5" }));
    await user.click(within(sheet).getByRole("button", { name: "0,5" }));
    await user.clear(within(sheet).getByLabelText("Portion"));
    await user.type(within(sheet).getByLabelText("Portion"), "1,3");
    await user.click(within(sheet).getByRole("button", { name: "Anderes gegessen" }));
    await user.click(within(sheet).getByRole("button", { name: "Ausgelassen" }));
    await user.click(within(sheet).getByRole("button", { name: "Abbrechen" }));
    await settle();

    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    expect(stored(`slot:${TODAY}:lunch`)).toBeUndefined();
  });

  it("records the planned meal eaten at the chosen portion, once, on confirmation", async () => {
    const user = userEvent.setup();
    renderContainer();

    const sheet = await openSlot(user, "lunch", "erfassen");
    expect(within(sheet).getByText("Geplant: lunch 3 · 703 kcal")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Gegessen" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet).getByRole("button", { name: "0,75" }));
    expect(within(sheet).getByTestId("nutrition-v2-estimate-preview")).toHaveTextContent("Erfasst wird ca. 527 kcal");
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(intents()).toHaveLength(1);
    expect(intents()[0]).toMatchObject({
      op: "record",
      expectedRevision: 0,
      entryId: `slot:${TODAY}:lunch`,
      desired: {
        recording: "plannedMeal",
        planId: PLAN_ID,
        name: "lunch 3",
        portion: 0.75,
        nutritionEstimate: { kcal: 703.2 * 0.75, proteinG: 30, carbsG: 60, fatG: 15 },
      },
    });
    // Cache convergence: the refetched entries show the recording.
    await waitFor(() =>
      expect(within(screen.getAllByTestId("nutrition-v2-slot")[1]).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent(
        "Erfasst · 0,75 Portion · ca. 527 kcal"
      )
    );
  });

  it("records an explicit skip", async () => {
    const user = userEvent.setup();
    renderContainer();

    const sheet = await openSlot(user, "breakfast", "erfassen");
    await user.click(within(sheet).getByRole("button", { name: "Ausgelassen" }));
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({ op: "skip", desired: { recording: "skip", nutritionEstimate: null } });
    await waitFor(() => expect(screen.getAllByTestId("nutrition-v2-week-row")[3]).toHaveTextContent("Teilweise erfasst"));
  });

  it("records something else eaten: kcal required, unknown macros left unknown", async () => {
    const user = userEvent.setup();
    renderContainer();

    const sheet = await openSlot(user, "dinner", "erfassen");
    await user.click(within(sheet).getByRole("button", { name: "Anderes gegessen" }));
    await user.type(within(sheet).getByLabelText("Bezeichnung"), "Pizza");
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    expect(within(sheet).getByText("Gib die Kalorien ein.")).toBeInTheDocument();
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();

    await user.type(within(sheet).getByLabelText("Kalorien (kcal)"), "950");
    await user.type(within(sheet).getByLabelText("Kohlenhydrate in g (optional)"), "110,5");
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({
      op: "record",
      desired: {
        recording: "custom",
        name: "Pizza",
        estimateBasis: "userStated",
        nutritionEstimate: { kcal: 950, proteinG: null, carbsG: 110.5, fatG: null },
      },
    });
  });

  it("adds an extra meal under a UUID id chosen once, never from its name", async () => {
    const user = userEvent.setup();
    const uuid = "3f2b8c1e-9a4d-4e6f-8b21-7c5d0e9a1b34";
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(uuid);
    renderContainer();
    await slotRow("lunch");

    await user.click(screen.getByRole("button", { name: "Eigene Mahlzeit" }));
    const sheet = await screen.findByRole("dialog", { name: "Eigene Mahlzeit" });
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
    await user.type(within(sheet).getByLabelText("Bezeichnung"), "Apfel");
    await user.type(within(sheet).getByLabelText("Kalorien (kcal)"), "80");
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({
      op: "record",
      entryId: `extra:${uuid}`,
      desired: { kind: "extra", slotId: null, name: "Apfel", nutritionEstimate: { kcal: 80, proteinG: null, carbsG: null, fatG: null } },
    });
    expect(intents()[0].intentId).not.toBe(uuid);
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("nutrition-v2-extra")).toHaveTextContent("Erfasst · ca. 80 kcal");
    // An extra covers no configured slot.
    expect(screen.getAllByTestId("nutrition-v2-week-row")[3]).toHaveTextContent("Nicht erfasst");
  });

  it("corrects an active entry at the revision it showed", async () => {
    const user = userEvent.setup();
    putEntry({ ...customSlotEntry(TODAY, "dinner"), revision: 4, appliedIntentIds: ["00000000-0000-4000-8000-000000000001"] });
    renderContainer();

    const sheet = await openSlot(user, "dinner", "bearbeiten");
    expect(within(sheet).getByTestId("nutrition-v2-current-entry")).toHaveTextContent(
      "Aktuell: Erfasst: Pizza beim Italiener · ca. 950 kcal"
    );
    expect(within(sheet).getByRole("button", { name: "Anderes gegessen" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByLabelText("Kalorien (kcal)")).toHaveValue("950");
    await user.clear(within(sheet).getByLabelText("Kalorien (kcal)"));
    await user.type(within(sheet).getByLabelText("Kalorien (kcal)"), "800");
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({ op: "correct", expectedRevision: 4, desired: { nutritionEstimate: { kcal: 800 } } });
    expect(stored(`slot:${TODAY}:dinner`)).toMatchObject({ revision: 5, status: "active" });
  });

  it("removes an active entry as a tombstone, after which the slot is not recorded", async () => {
    const user = userEvent.setup();
    putEntry(plannedMealEntry(TODAY, "lunch"));
    renderContainer();

    const sheet = await openSlot(user, "lunch", "bearbeiten");
    await user.click(within(sheet).getByRole("button", { name: "Entfernen" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({ op: "remove", expectedRevision: 1, entryId: `slot:${TODAY}:lunch` });
    expect(stored(`slot:${TODAY}:lunch`)).toMatchObject({ status: "removed", revision: 2, recording: "plannedMeal" });
    await waitFor(() =>
      expect(within(screen.getAllByTestId("nutrition-v2-slot")[1]).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent(
        "Nicht erfasst"
      )
    );
  });

  it("treats a removed entry as not recorded and records it again as its next revision", async () => {
    const user = userEvent.setup();
    putEntry(removedEntry(plannedMealEntry(TODAY, "lunch")));
    renderContainer();

    expect(within(await slotRow("lunch")).getByTestId("nutrition-v2-slot-recorded")).toHaveTextContent("Nicht erfasst");
    expect(screen.getAllByTestId("nutrition-v2-week-row")[3]).toHaveTextContent("Nicht erfasst");

    const sheet = await openSlot(user, "lunch", "erfassen");
    expect(within(sheet).getByText("Der frühere Eintrag wurde entfernt und zählt nicht als erfasst.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Entfernen" })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(intents()).toHaveLength(1));
    expect(intents()[0]).toMatchObject({ op: "record", expectedRevision: 2 });
    expect(stored(`slot:${TODAY}:lunch`)).toMatchObject({ status: "active", revision: 3 });
  });

  it("shows a conflict truthfully, keeps the sheet open and loads the current entry", async () => {
    const user = userEvent.setup();
    putEntry(plannedMealEntry(TODAY, "lunch"));
    renderContainer();

    const sheet = await openSlot(user, "lunch", "bearbeiten");
    // Another device changes the entry after it was shown.
    putEntry({ ...skipEntry(TODAY, "lunch"), revision: 2, appliedIntentIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"] });
    await user.click(within(sheet).getByRole("button", { name: "0,5" }));
    await user.click(within(sheet).getByRole("button", { name: "Speichern" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Dieser Eintrag wurde inzwischen geändert.");
    expect(stored(`slot:${TODAY}:lunch`)).toMatchObject({ recording: "skip", revision: 2 });
    await waitFor(() => expect(within(sheet).getByTestId("nutrition-v2-current-entry")).toHaveTextContent("Aktuell: Ausgelassen"));
    expect(intents()).toHaveLength(1);
  });

  it("disables recording offline and says why, without writing", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    renderContainer();
    await slotRow("lunch");

    expect(screen.getByText("Du bist offline. Erfassen ist nur mit Internetverbindung möglich.")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(writer.writeNutritionV2Entry).not.toHaveBeenCalled();
  });

  it("offers no recording surface to an ineligible account", async () => {
    session.profile = { status: "success", data: { id: "alice", age: 17 } };
    renderContainer();

    expect(await screen.findByText("Ernährung ist ab 18 Jahren verfügbar")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-v2-today-recording")).toBeNull();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("offers no recording surface when today is outside the plan", async () => {
    session.today = "2026-10-05";
    renderContainer();

    expect(await screen.findByText("Heute ist kein Tag deines aktiven Ernährungsplans.")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-v2-today-recording")).toBeNull();
  });

  it("keeps Nutrition V2 switched off", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });
});

describe("recorded extras", () => {
  it("lists only active extras of today", async () => {
    putEntry(extraEntry(TODAY));
    putEntry(removedEntry(extraEntry(TODAY, "9b2d8f5e-1c3a-4e7b-9a6d-2f4c8e1b3a5d")));
    renderContainer();
    await slotRow("lunch");

    const extras = await screen.findAllByTestId("nutrition-v2-extra");
    expect(extras).toHaveLength(1);
    expect(extras[0]).toHaveTextContent("Apfel");
    expect(extras[0]).toHaveTextContent("Erfasst · ca. 80 kcal");
  });
});

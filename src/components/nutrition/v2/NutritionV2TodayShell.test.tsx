import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-05. The Nutrition V2 Today/week shell is read-only: each row shows the
  day, its recording status and its PLANNED kcal — no macros, no recorded
  values, no controls — and every data state is neutral. The container reads
  nothing unless the account is an eligible adult.
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
    return { id: ref.id, exists: () => data !== undefined, data: () => data };
  }),
  getDocs: vi.fn(
    async (q: { ref: { path: string }; constraints: { field: string; op: string; value: string }[] }) => {
      const prefix = `${q.ref.path}/`;
      const docs = [...store.docs.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .filter(([, data]) =>
          q.constraints.every(({ field, op, value }) => {
            const actual = (data as Record<string, string>)[field];
            return op === "==" ? actual === value : op === ">=" ? actual >= value : actual <= value;
          })
        )
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
      return { empty: docs.length === 0, docs };
    }
  ),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
  today: "2026-09-26",
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));

import { NutritionV2TodayShell } from "./NutritionV2TodayShell";
import { NutritionV2TodayContainer } from "./NutritionV2TodayContainer";
import { buildNutritionWeek } from "@/lib/nutrition/v2/resolvedPlan";
import type { NutritionV2TodayView } from "@/lib/nutrition/v2/todayView";
import { NUTRITION_V2_COLLECTIONS, NUTRITION_V2_ENABLED } from "@shared/nutrition";
import {
  PLAN_ID,
  aiOverride,
  makePlan,
  makeSlotHead,
  makeState,
  plannedMealEntry,
  skipEntry,
  slotHeadDocId,
  values,
} from "@/test/nutritionV2Fixtures";

const plan = makePlan();
const TODAY = "2026-09-26";
const OVERRIDE_DAY = "2026-09-25";

/** A week with an override, a recorded day and a partially recorded day. */
const week = (today = TODAY) =>
  buildNutritionWeek({
    plan,
    slotHeads: [makeSlotHead(OVERRIDE_DAY, "lunch", aiOverride("Linsen-Curry", 900))],
    entries: [
      ...plan.slotOrder.map((slotId) => plannedMealEntry("2026-09-23", slotId, values(5000, 321, 432, 99))),
      skipEntry(TODAY, "breakfast"),
    ],
    today,
  });

const renderShell = (view: NutritionV2TodayView) => render(<NutritionV2TodayShell view={view} />);
const rows = () => screen.queryAllByTestId("nutrition-v2-week-row");

/** Nothing the shell renders may be operable. */
const expectNothingInteractive = (container: HTMLElement) => {
  expect(screen.queryAllByRole("button")).toEqual([]);
  expect(screen.queryAllByRole("link")).toEqual([]);
  expect(screen.queryAllByRole("checkbox")).toEqual([]);
  expect(container.querySelectorAll("a, button, input, select, textarea, [tabindex], [onclick], [role='button']")).toHaveLength(0);
};

describe("NutritionV2TodayShell", () => {
  it("shows a loading state", () => {
    renderShell({ status: "loading" });
    const status = screen.getByRole("status", { name: "Ernährung wird geladen" });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(rows()).toEqual([]);
  });

  it("shows a read error as an alert", () => {
    const { container } = renderShell({ status: "error" });
    expect(screen.getByRole("alert")).toHaveTextContent("Ernährung konnte nicht geladen werden");
    expect(rows()).toEqual([]);
    expectNothingInteractive(container);
  });

  it("shows 'not initialised' and 'no active plan' as distinct neutral states", () => {
    const first = renderShell({ status: "notInitialized" });
    expect(screen.getByRole("status")).toHaveTextContent("Ernährung ist noch nicht eingerichtet");
    first.unmount();

    const { container } = renderShell({ status: "noActivePlan" });
    expect(screen.getByRole("status")).toHaveTextContent("Kein aktiver Ernährungsplan");
    expect(screen.getByRole("status")).not.toHaveTextContent("eingerichtet");
    expectNothingInteractive(container);
  });

  it("promises and offers no plan in any empty state", () => {
    for (const view of [{ status: "notInitialized" }, { status: "noActivePlan" }] as NutritionV2TodayView[]) {
      const { container, unmount } = renderShell(view);
      expect(container).not.toHaveTextContent(/generier|erstell|bald|wird .* erstellt/i);
      unmount();
    }
  });

  it("shows an under-18 state without controls", () => {
    const { container } = renderShell({ status: "ineligible", reason: "minor" });
    expect(screen.getByRole("status")).toHaveTextContent("Ernährung ist ab 18 Jahren verfügbar");
    expect(screen.getByRole("status")).toHaveTextContent("Training und alle anderen Bereiche bleiben für dich verfügbar");
    expectNothingInteractive(container);
  });

  it("shows a missing-age state without controls", () => {
    const { container } = renderShell({ status: "ineligible", reason: "missingAge" });
    expect(screen.getByRole("status")).toHaveTextContent("Ernährung ist ohne Altersangabe nicht verfügbar");
    expectNothingInteractive(container);
  });

  it("shows seven dated plan rows for this week with today identifiable", () => {
    renderShell({ status: "today", week: week() });

    expect(screen.getByRole("region", { name: "Diese Woche" })).toBeInTheDocument();
    expect(rows().map((row) => row.dataset.date)).toEqual(plan.days.map((day) => day.date));

    const current = rows().filter((row) => row.getAttribute("aria-current") === "date");
    expect(current.map((row) => row.dataset.date)).toEqual([TODAY]);
    expect(current[0]).toHaveTextContent(/^Heute · Sa\.?, 26\. Sept?\.?/);
    // Other rows carry their own date, not a weekday alone.
    expect(rows()[0]).toHaveTextContent(/^Mi\.?, 23\. Sept?\.?/);
  });

  it("labels every row's calories as planned, rounded for display", () => {
    renderShell({ status: "today", week: week() });

    // 402.4 + 900 (override) + 602.3 = 1904.7 on the override day.
    const overrideRow = rows().find((row) => row.dataset.date === OVERRIDE_DAY) as HTMLElement;
    expect(within(overrideRow).getByText("1.905 kcal geplant")).toBeInTheDocument();
    for (const row of rows()) expect(row).toHaveTextContent(/\d[\d.]* kcal geplant$/);
  });

  it("shows recording status per row and never recorded intake as planned intake", () => {
    renderShell({ status: "today", week: week() });

    const byDate = Object.fromEntries(rows().map((row) => [row.dataset.date, row]));
    expect(byDate["2026-09-23"]).toHaveTextContent("Erfasst");
    expect(byDate[TODAY]).toHaveTextContent("Teilweise erfasst");
    expect(byDate["2026-09-24"]).toHaveTextContent("Nicht erfasst");

    // The fully recorded day still shows its planned kcal, not the 3 × 5000 recorded.
    expect(byDate["2026-09-23"]).toHaveTextContent("1.701 kcal geplant");
    expect(document.body).not.toHaveTextContent(/5\.?000|15\.?000/);
    expect(document.body).not.toHaveTextContent(/gegessen|verzehrt|konsumiert|aufgenommen/i);
  });

  it("shows no macros in the rows", () => {
    renderShell({ status: "today", week: week() });

    for (const row of rows()) {
      expect(row).not.toHaveTextContent(/Protein|Kohlenhydrat|Fett|Eiweiß|\d\s?g\b/i);
    }
  });

  it("has no log, replace, generate or other control, and a decorative chevron only", () => {
    const { container } = renderShell({ status: "today", week: week() });

    expectNothingInteractive(container);
    expect(container).not.toHaveTextContent(/Erfassen|Loggen|Ersetzen|Tauschen|Generieren|Neu erstellen|Rezept|Einkauf/i);
    for (const row of rows()) {
      const icons = row.querySelectorAll("svg");
      expect(icons).toHaveLength(1);
      expect(icons[0]).toHaveAttribute("aria-hidden", "true");
      expect(row.closest("a, button")).toBeNull();
    }
  });

  it("shows the plan week with a neutral note when today is outside the plan", () => {
    renderShell({ status: "outsidePlan", week: week("2026-10-05") });

    expect(screen.getByText("Heute ist kein Tag deines aktiven Ernährungsplans.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Aktiver Plan" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Diese Woche" })).toBeNull();
    expect(rows()).toHaveLength(7);
    expect(rows().some((row) => row.hasAttribute("aria-current"))).toBe(false);
    for (const row of rows()) expect(row).not.toHaveTextContent(/^Heute/);
  });
});

/* ------------------------------------------------------------------ */

describe("NutritionV2TodayContainer", () => {
  const C = NUTRITION_V2_COLLECTIONS;
  const put = (path: string, data: unknown) => store.docs.set(path, data);

  const renderContainer = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <NutritionV2TodayContainer />
      </QueryClientProvider>
    );
  };

  const seedWeek = () => {
    put(`users/alice/${C.state}/current`, makeState());
    put(`users/alice/${C.plans}/${PLAN_ID}`, plan);
    const head = makeSlotHead(OVERRIDE_DAY, "lunch", aiOverride("Linsen-Curry", 900));
    put(`users/alice/${C.slots}/${slotHeadDocId(head)}`, head);
    const entry = skipEntry(TODAY, "breakfast");
    put(`users/alice/${C.entries}/${entry.entryId}`, entry);
  };

  beforeEach(() => {
    store.docs.clear();
    session.user = { uid: "alice", id: "alice" };
    session.profile = { status: "success", data: { id: "alice", age: 30 } };
    session.today = TODAY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the week for an eligible adult and shows today's row", async () => {
    seedWeek();
    renderContainer();

    await waitFor(() => expect(rows()).toHaveLength(7));
    const today = rows().find((row) => row.getAttribute("aria-current") === "date");
    expect(today?.dataset.date).toBe(TODAY);
    expect(today).toHaveTextContent("Teilweise erfasst");
    expect(rows().find((row) => row.dataset.date === OVERRIDE_DAY)).toHaveTextContent("1.905 kcal geplant");
  });

  it.each([
    ["under 18", 17, "Ernährung ist ab 18 Jahren verfügbar"],
    ["missing age", null, "Ernährung ist ohne Altersangabe nicht verfügbar"],
  ])("shows the %s state and starts no V2 read", async (_label, age, text) => {
    seedWeek();
    session.profile = { status: "success", data: { id: "alice", age } };
    renderContainer();

    expect(await screen.findByText(text)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it("renders nothing and reads nothing while signed out", async () => {
    session.user = null;
    const { container } = renderContainer();
    await new Promise((r) => setTimeout(r, 0));

    expect(container).toBeEmptyDOMElement();
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });

  it("shows not initialised when the state document is absent", async () => {
    renderContainer();
    expect(await screen.findByText("Ernährung ist noch nicht eingerichtet")).toBeInTheDocument();
  });

  it("shows no active plan without reading a plan", async () => {
    put(`users/alice/${C.state}/current`, makeState({ activePlanId: null }));
    renderContainer();

    expect(await screen.findByText("Kein aktiver Ernährungsplan")).toBeInTheDocument();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it("shows the outside-plan state when today is not a plan day", async () => {
    seedWeek();
    session.today = "2026-10-05";
    renderContainer();

    expect(await screen.findByText("Heute ist kein Tag deines aktiven Ernährungsplans.")).toBeInTheDocument();
    expect(rows()).toHaveLength(7);
  });

  it("shows an error, not a partial week, for a malformed V2 document", async () => {
    seedWeek();
    put(`users/alice/${C.slots}/garbage`, { planId: PLAN_ID, nonsense: true });
    renderContainer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Ernährung konnte nicht geladen werden");
    expect(rows()).toEqual([]);
  });
});

describe("feature flag", () => {
  it("keeps Nutrition V2 switched off", () => {
    expect(NUTRITION_V2_ENABLED).toBe(false);
  });
});

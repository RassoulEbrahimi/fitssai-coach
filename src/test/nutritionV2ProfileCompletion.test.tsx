import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-12D.1 product integration: Nutrition profile completion and the empty
  state, on the real Dashboard with the REAL profile hooks (useProfile,
  useUpdateProfile) over an in-memory Firestore. The profile document
  `users/alice` is the only thing a completion reads or writes; Nutrition V2
  documents are read only once the saved age makes the account eligible.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

const firestore = vi.hoisted(() => {
  class Timestamp {
    static now() {
      return new Timestamp();
    }
    toDate() {
      return new Date("2026-09-26T08:00:00Z");
    }
  }
  return {
    Timestamp,
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
    collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    orderBy: vi.fn((field: string, value = "asc") => ({ field, op: "orderBy", value })),
    limit: vi.fn((value: number) => ({ field: "", op: "limit", value })),
    query: vi.fn((ref: { path: string }, ...constraints: unknown[]) => ({ ref, constraints })),
    getDoc: vi.fn(async (ref: { path: string; id: string }) => {
      const data = store.docs.get(ref.path);
      return { id: ref.id, exists: () => data !== undefined, data: () => data };
    }),
    getDocs: vi.fn(async (q: { ref: { path: string } }) => {
      const prefix = `${q.ref.path}/`;
      const docs = [...store.docs.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
      return { empty: docs.length === 0, docs };
    }),
    setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      store.docs.set(ref.path, options?.merge ? { ...(store.docs.get(ref.path) ?? {}), ...data } : data);
    }),
  };
});

const callables = vi.hoisted(() => ({
  httpsCallable: vi.fn(() => vi.fn()),
  getFunctions: vi.fn(),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  today: "2026-09-26",
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("firebase/functions", () => callables);

/** Every callable asked for, by name, except the read-only backend status probe (NUT-14). */
const nutritionCallables = () =>
  (callables.httpsCallable.mock.calls as unknown as unknown[][]).map((args) => args[1]).filter((name) => name !== "coachBackendStatus");
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));

vi.mock("@/hooks/queries/useWorkoutPlan", () => ({ useWorkoutPlan: () => ({ data: null, isLoading: true }) }));
vi.mock("@/hooks/queries/useWorkoutLogs", () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false, toggleDay: vi.fn() }) }));
vi.mock("@/hooks/queries/useLegacyNutritionPlan", () => ({
  useLegacyNutritionPlan: () => ({ data: { id: "legacy", content: { breakfast: [{ meal: "LEGACY FOOD", calories: 999 }] } }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/useWeeklyActivity", () => ({ useWeeklyActivity: () => ({}) }));
vi.mock("@/contexts/TrainingSessionContext", () => ({
  useTrainingSession: () => ({ validateSessionAgainstPlan: vi.fn(), rejectionNotice: null, clearRejectionNotice: vi.fn() }),
}));
vi.mock("@/components/OfflineBanner", () => ({ OfflineBanner: () => null }));
vi.mock("@/views/HomeView", () => ({ default: () => <h1>Home fixture</h1> }));
vi.mock("@/views/WorkoutView", () => ({ default: () => <h1>Workout fixture</h1> }));
vi.mock("@/views/ProfileView", () => ({ default: () => <h1>Profile fixture</h1> }));

import Dashboard from "@/components/Dashboard";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { FocusModeProvider } from "@/contexts/FocusModeContext";
import { ThemeProvider } from "@/hooks/useTheme";
import { NUTRITION_V2_COLLECTIONS as C, NUTRITION_V2_ENABLED } from "@shared/nutrition";
import { intentUuid, makePlan, makeState, makeTarget } from "./nutritionV2Fixtures";

configure({ asyncUtilTimeout: 5000 });

const profilePath = "users/alice";

/** An account from before the Nutrition questions: the shared onboarding answers only. */
const LEGACY_PROFILE = {
  fullName: "Alice",
  age: 30,
  height: 177,
  weight: 75,
  fitnessGoal: "loseFat",
  dietaryPreference: "vegetarian",
  experienceLevel: "beginner",
};

const COMPLETE_PROFILE = {
  ...LEGACY_PROFILE,
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  mealsPerDay: 3,
};

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PreferencesProvider>
          <FocusModeProvider>
            <Dashboard />
          </FocusModeProvider>
        </PreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return { client, ...render(tree()) };
};

const put = (collection: string, id: string, data: unknown) =>
  store.docs.set(`users/alice/${collection}/${id}`, data as Record<string, unknown>);

/** Every Firestore path read so far, profile reads included. */
const readPaths = () => [
  ...firestore.getDoc.mock.calls.map(([ref]) => (ref as { path: string }).path),
  ...firestore.getDocs.mock.calls.map(([q]) => (q as { ref: { path: string } }).ref.path),
];
const v2Reads = () => readPaths().filter((path) => path !== profilePath);

const completion = () => screen.findByRole("region", { name: "Ernährungsprofil vervollständigen" });
const openSheet = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Angaben (ergänzen|ändern)/ }));
  return screen.findByRole("dialog", { name: "Ernährungsprofil" });
};
const choose = (dialog: HTMLElement, group: string, option: string) =>
  fireEvent.click(within(within(dialog).getByRole("group", { name: group })).getByRole("button", { name: option }));
const pressed = (dialog: HTMLElement, group: string) =>
  within(within(dialog).getByRole("group", { name: group }))
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

/** What each profile save wrote, without the save's own timestamp. */
const writes = () =>
  firestore.setDoc.mock.calls.map(([ref, data, options]) => {
    const { updatedAt, ...fields } = data as Record<string, unknown>;
    expect(updatedAt).toBeInstanceOf(firestore.Timestamp);
    return { path: (ref as { path: string }).path, fields, options };
  });

beforeEach(() => {
  store.docs.clear();
  vi.clearAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "#/nutrition");
  session.user = { uid: "alice", id: "alice" };
  session.today = "2026-09-26";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rollout", () => {
  // The server capabilities and the AI gate are pinned by backend.test and the Functions suite;
  // what the live backend status exposes is nutritionV2Enablement.test's.
  it("runs against the enabled V2 UI", () => {
    expect(NUTRITION_V2_ENABLED).toBe(true);
  });
});

describe("A: a legacy account completes its Nutrition profile", () => {
  it("prefills existing answers, writes only the new ones and becomes complete without a reload", async () => {
    store.docs.set(profilePath, { ...LEGACY_PROFILE });
    mount();

    const card = await completion();
    expect(within(card).getByTestId("nutrition-v2-profile-open-fields")).toHaveTextContent(
      "Noch offen: Biologisches Geschlecht, Aktivität im Alltag, Mahlzeiten pro Tag"
    );
    // One journey: no second "not set up" message, no empty target, no plan status.
    expect(screen.queryByText("Ernährung ist noch nicht eingerichtet")).toBeNull();
    expect(screen.queryByText("Du hast noch kein Ernährungsziel festgelegt.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Planstatus" })).toBeNull();

    const dialog = await openSheet();
    expect(within(dialog).getByLabelText("Alter")).toHaveValue("30");
    expect(within(dialog).getByLabelText("Größe (cm)")).toHaveValue("177");
    expect(within(dialog).getByLabelText("Gewicht (kg)")).toHaveValue("75");
    expect(pressed(dialog, "Fitnessziel")).toEqual(["Fett verlieren"]);
    expect(pressed(dialog, "Ernährungsform")).toEqual(["Vegetarisch"]);
    expect(pressed(dialog, "Biologisches Geschlecht")).toEqual([]);
    expect(pressed(dialog, "Aktivität im Alltag")).toEqual([]);
    expect(pressed(dialog, "Mahlzeiten pro Tag")).toEqual([]);
    // Only the unanswered fields are marked open.
    expect(within(dialog).queryByTestId("nutrition-v2-profile-age-open")).toBeNull();
    expect(within(dialog).getByTestId("nutrition-v2-profile-biologicalSex-open")).toHaveTextContent("Noch offen");

    choose(dialog, "Biologisches Geschlecht", "Keine Angabe");
    choose(dialog, "Aktivität im Alltag", "Mäßig aktiv");
    choose(dialog, "Mahlzeiten pro Tag", "4");
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    expect(await screen.findByText("Dein Ernährungsprofil ist vollständig.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("region", { name: "Ernährungsprofil vervollständigen" })).toBeNull();
    expect(writes()).toEqual([
      {
        path: profilePath,
        fields: { biologicalSex: "notSpecified", activityLevel: "moderatelyActive", mealsPerDay: 4 },
        options: { merge: true },
      },
    ]);
    // Nothing else in the document changed, and nothing else was written.
    expect(store.docs.get(profilePath)).toMatchObject({ ...LEGACY_PROFILE, biologicalSex: "notSpecified", mealsPerDay: 4 });
    expect([...store.docs.keys()]).toEqual([profilePath]);
    expect(callables.httpsCallable).not.toHaveBeenCalled();
  });

  it("refuses an out-of-range change before any write", async () => {
    store.docs.set(profilePath, { ...LEGACY_PROFILE });
    mount();
    const dialog = await openSheet();

    fireEvent.change(within(dialog).getByLabelText("Gewicht (kg)"), { target: { value: "12" } });
    fireEvent.change(within(dialog).getByLabelText("Alter"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    expect(await within(dialog).findByText("Das Gewicht muss mindestens 30 kg betragen.")).toBeInTheDocument();
    // Emptying an answered field is refused rather than silently clearing it.
    expect(within(dialog).getByText("Bitte gib dein Alter ein.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Gewicht (kg)")).toHaveAttribute("aria-invalid", "true");
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("closes without writing when nothing changed", async () => {
    store.docs.set(profilePath, { ...LEGACY_PROFILE });
    mount();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe("B: an account without any profile answers", () => {
  it("reaches the completion with empty fields and reads no Nutrition V2 data", async () => {
    mount();

    const card = await completion();
    expect(card).toHaveTextContent("Ernährung richtet sich an Erwachsene und braucht dafür dein Alter.");
    expect(screen.queryByText("Ernährung ist ohne Altersangabe nicht verfügbar")).toBeNull();
    const dialog = await openSheet();
    for (const label of ["Alter", "Größe (cm)", "Gewicht (kg)"]) expect(within(dialog).getByLabelText(label)).toHaveValue("");
    expect(pressed(dialog, "Fitnessziel")).toEqual([]);
    expect(v2Reads()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
  });
});

describe("C: a missing age", () => {
  it("keeps the completion reachable and starts Nutrition reads only after an adult age is saved", async () => {
    const { age: _age, ...withoutAge } = LEGACY_PROFILE;
    store.docs.set(profilePath, withoutAge);
    put(C.state, "current", makeState({ activePlanId: null, currentTargetVersionId: null }));
    mount();

    await completion();
    expect(v2Reads()).toEqual([]);

    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Alter"), { target: { value: "34" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    // Eligible now: the state is read, and the prompt no longer asks for the age.
    await waitFor(() => expect(v2Reads()).toContain(`users/alice/${C.state}/current`));
    const card = await completion();
    expect(card).toHaveTextContent("Ergänze deine Angaben, damit FitssAI dein Ernährungsziel");
    expect(card).not.toHaveTextContent("braucht dafür dein Alter");
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeInTheDocument();
    expect(writes()).toEqual([{ path: profilePath, fields: { age: 34 }, options: { merge: true } }]);
    expect(firestore.setDoc.mock.invocationCallOrder[0]).toBeLessThan(
      firestore.getDoc.mock.invocationCallOrder[firestore.getDoc.mock.calls.findIndex(([ref]) => (ref as { path: string }).path !== profilePath)]
    );
  });
});

describe("D: a minor", () => {
  it("may correct the profile and still reads nothing from Nutrition V2 while under 18", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE, age: 16 });
    mount();

    expect(await screen.findByText("Ernährung ist ab 18 Jahren verfügbar")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ernährungsprofil vervollständigen" })).toBeNull();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Alter"), { target: { value: "17" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(writes()).toEqual([{ path: profilePath, fields: { age: 17 }, options: { merge: true } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Ernährung ist ab 18 Jahren verfügbar")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(v2Reads()).toEqual([]);
  });
});

describe("E: a complete profile", () => {
  it("shows one ready message and no completion prompt when there is no target or plan", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE });
    mount();

    const ready = await screen.findByRole("region", { name: "Dein Ernährungsprofil ist vollständig." });
    expect(ready).toHaveTextContent("sobald diese Funktion verfügbar ist");
    expect(screen.queryByRole("button", { name: "Angaben ergänzen" })).toBeNull();
    expect(screen.queryByText("Ernährung ist noch nicht eingerichtet")).toBeNull();
    expect(screen.queryByRole("region", { name: "Ziel" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ziel festlegen/ })).toBeNull();
    expect(screen.getByTestId("nutrition-v2-today")).not.toHaveTextContent(/in dieser Version|nicht freigeschaltet/);
  });

  it("shows no profile section at all next to an existing target and plan", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE });
    put(C.state, "current", makeState());
    put(C.plans, "plan-1", makePlan());
    put(C.targets, "target-1", makeTarget());
    mount();

    await waitFor(() => expect(screen.getAllByTestId("nutrition-v2-week-row")).toHaveLength(7));
    expect(screen.getByTestId("nutrition-v2-target")).toBeInTheDocument();
    expect(screen.queryByTestId("nutrition-v2-profile-completion")).toBeNull();
    expect(screen.queryByRole("button", { name: /Angaben/ })).toBeNull();
  });
});

describe("F: plan status", () => {
  it("is absent without a generation request", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE });
    put(C.state, "current", makeState({ activePlanId: null }));
    put(C.targets, "target-1", makeTarget());
    mount();

    expect(await screen.findByText("Kein aktiver Ernährungsplan")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Planstatus" })).toBeNull();
    expect(screen.queryByText("Keine aktive Plananfrage.")).toBeNull();
  });

  it("is shown, read only, for the request the state names", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE });
    const requestId = intentUuid(7);
    put(C.state, "current", makeState({ activePlanId: null, currentTargetVersionId: null, activeGenerationRequestId: requestId }));
    put(C.generations, requestId, {
      schemaVersion: 2, requestId, idempotencyKey: `nutritionPlan:${requestId}`, kind: "initial", basePlanId: null,
      targetVersionId: "target-1", payloadFingerprint: "a".repeat(64), status: "queued", resultPlanId: null,
      errorCode: null, createdAt: { seconds: 1790000000, nanoseconds: 0 }, finishedAt: null, acknowledgedAt: null,
    });
    mount();

    const status = await screen.findByRole("region", { name: "Planstatus" });
    await waitFor(() => expect(status).toHaveTextContent("Dein Ernährungsplan wartet auf die Erstellung."));
    expect(within(status).queryByRole("button")).toBeNull();
    expect(nutritionCallables()).toEqual([]);
  });
});

describe("G: refresh", () => {
  it("is one compact header action that refetches only this account's Nutrition V2 reads and the backend status", async () => {
    store.docs.set(profilePath, { ...COMPLETE_PROFILE });
    const { client } = mount();
    await screen.findByText("Dein Ernährungsprofil ist vollständig.");

    const refresh = screen.getAllByRole("button", { name: "Aktualisieren" });
    expect(refresh).toHaveLength(1);
    expect(refresh[0]).toHaveTextContent("");
    expect(refresh[0].closest("[data-testid='nutrition-v2-today']")).not.toBeNull();

    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(refresh[0]);
    await waitFor(() => expect(refresh[0]).not.toBeDisabled());
    expect(invalidate.mock.calls).toEqual([[{ queryKey: ["nutrition-v2", "alice"] }], [{ queryKey: ["coach-backend", "alice"] }]]);
    expect(nutritionCallables()).toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

describe("H and I: isolation and write safety", () => {
  it("never falls back to the legacy plan, and a profile save writes no Nutrition V2 document", async () => {
    store.docs.set(profilePath, { ...LEGACY_PROFILE });
    mount();
    await completion();
    expect(screen.queryByTestId("legacy-nutrition-plan")).toBeNull();
    expect(screen.queryByText("LEGACY FOOD")).toBeNull();

    const dialog = await openSheet();
    choose(dialog, "Biologisches Geschlecht", "Männlich");
    fireEvent.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(firestore.setDoc).toHaveBeenCalledTimes(1));

    const written = firestore.setDoc.mock.calls.map(([ref]) => (ref as { path: string }).path);
    expect(written).toEqual([profilePath]);
    for (const path of written) expect(path).not.toMatch(/nutrition_v2_(state|targets|plans|generations)/);
    expect([...store.docs.keys()]).toEqual([profilePath]);
    expect(screen.queryByText("LEGACY FOOD")).toBeNull();
  });
});

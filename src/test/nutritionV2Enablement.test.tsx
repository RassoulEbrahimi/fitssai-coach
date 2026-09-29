import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-14 product integration: the Nutrition TARGET setup and the explicit
  plan-generation action, offered only while the DEPLOYED backend's
  `coachBackendStatus` says so — on the real Dashboard with the real profile,
  V2 read, target and generation hooks over an in-memory Firestore. Every
  callable is scripted here (`backend.handlers`); nothing reaches a network, a
  Functions emulator or Vertex AI.
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

/** The scripted backend: every callable by name. A missing handler is an INTERNAL failure. */
const backend = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; payload: unknown }>,
  handlers: {} as Record<string, (payload: unknown) => Promise<unknown>>,
}));

const callables = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn((_functions: unknown, name: string) => async (payload: unknown) => {
    backend.calls.push({ name, payload: payload === undefined ? undefined : structuredClone(payload) });
    const handler = backend.handlers[name];
    if (!handler) throw Object.assign(new Error("internal"), { code: "functions/internal" });
    return { data: await handler(payload) };
  }),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  today: "2026-09-26",
}));

vi.mock("firebase/firestore", () => firestore);
vi.mock("firebase/functions", () => callables);
vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user, loading: false }) }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));

vi.mock("@/hooks/queries/useWorkoutPlan", () => ({ useWorkoutPlan: () => ({ data: null, isLoading: true }) }));
vi.mock("@/hooks/queries/useWorkoutLogs", () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false, toggleDay: vi.fn() }) }));
vi.mock("@/hooks/queries/useLegacyNutritionPlan", () => ({
  useLegacyNutritionPlan: () => ({ data: null, isLoading: false, isError: false }),
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
import { QueryProvider } from "@/components/providers/QueryProvider";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { FocusModeProvider } from "@/contexts/FocusModeContext";
import { ThemeProvider } from "@/hooks/useTheme";
import { accountStorageKey } from "@/lib/accountIdentity";
import { webSha256Hex } from "@/lib/nutrition/v2/sha256";
import {
  NUTRITION_V2_COLLECTIONS as C,
  computeNutritionTargetFingerprint,
  type NutritionRequestPlanResult,
  type TargetVersion,
} from "@shared/nutrition";
import { intentUuid, makePlan, makeState, makeTarget } from "./nutritionV2Fixtures";

configure({ asyncUtilTimeout: 5000 });

const TODAY = "2026-09-26";

/** A complete adult Nutrition profile with a manual 2 200 kcal target mode. */
const PROFILE = {
  fullName: "Alice",
  age: 30,
  height: 172,
  weight: 68,
  fitnessGoal: "loseFat",
  dietaryPreference: "vegetarian",
  biologicalSex: "female",
  activityLevel: "moderatelyActive",
  mealsPerDay: 3,
  nutritionTargetMode: "manual",
  manualTargetKcal: 2200,
  experienceLevel: "beginner",
};

const uidOf = () => session.user?.uid ?? "nobody";
const pathOf = (uid: string, collection: string, id: string) => `users/${uid}/${collection}/${id}`;
const put = (collection: string, id: string, data: unknown, uid = "alice") =>
  store.docs.set(pathOf(uid, collection, id), data as Record<string, unknown>);

/** The live answer of `coachBackendStatus` for the signed-in account. */
const status = (nutritionTargets: boolean, nutritionGeneration: boolean, uid?: string) => ({
  ok: true,
  backend: "fitssai-coach",
  region: "europe-west3",
  uid: uid ?? uidOf(),
  capabilities: { planGeneration: true, weeklySummaryAI: true, nutritionTargets, nutritionGeneration },
});
const answerStatus = (nutritionTargets: boolean, nutritionGeneration: boolean) => {
  backend.handlers.coachBackendStatus = async () => status(nutritionTargets, nutritionGeneration);
};

/** A target whose profile fingerprint matches PROFILE: fresh. */
const freshTarget = async (targetVersionId = "target-1", manualTargetKcal = PROFILE.manualTargetKcal): Promise<TargetVersion> => {
  const policy = { id: "manual-target", version: 1 };
  const profileFingerprint = await computeNutritionTargetFingerprint(
    { mode: "manual", policy, fields: ["manualTargetKcal"], values: { manualTargetKcal } },
    webSha256Hex
  );
  return makeTarget(targetVersionId, { mode: "manual", policy, profileFingerprint, effectiveFrom: TODAY });
};

const seedProfile = (profile: Record<string, unknown> = PROFILE, uid = "alice") => store.docs.set(`users/${uid}`, { ...profile });

/** A complete profile, a fresh current target and no plan. */
const seedTargetOnly = async (uid = "alice") => {
  seedProfile(PROFILE, uid);
  put(C.state, "current", makeState({ activePlanId: null }), uid);
  put(C.targets, "target-1", await freshTarget(), uid);
};

/** A complete profile, a fresh current target and an active plan owning today. */
const seedTargetAndPlan = async () => {
  seedProfile();
  put(C.state, "current", makeState());
  put(C.targets, "target-1", await freshTarget());
  put(C.plans, "plan-1", makePlan());
};

const providers = (children: React.ReactNode) => (
  <ThemeProvider>
    <PreferencesProvider>
      <FocusModeProvider>{children}</FocusModeProvider>
    </PreferencesProvider>
  </ThemeProvider>
);

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}>{providers(<Dashboard />)}</QueryClientProvider>) };
};

const callsOf = (name: string) => backend.calls.filter((call) => call.name === name);
const statusCalls = () => callsOf("coachBackendStatus");
const generationCalls = () => callsOf("nutritionRequestPlan");
const targetCalls = () => callsOf("nutritionSetTarget");

const today = () => screen.findByTestId("nutrition-v2-today");
/** Settle every pending read, then look. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const generationButton = () => screen.queryByRole("button", { name: /Ernährungsplan erstellen|Neuen Plan erstellen/ });

const answer = (overrides: Partial<NutritionRequestPlanResult>): NutritionRequestPlanResult => ({
  ok: true,
  requestId: intentUuid(1),
  status: "running",
  resultPlanId: null,
  errorCode: null,
  replay: false,
  ...overrides,
});

/** A refusal as the Functions SDK throws it: the stable code in the message. */
const refusal = (code: string) => Object.assign(new Error(code), { code: "functions/failed-precondition" });

const goOffline = () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  window.dispatchEvent(new Event("offline"));
};

beforeEach(() => {
  store.docs.clear();
  backend.calls.length = 0;
  backend.handlers = {};
  vi.clearAllMocks();
  localStorage.clear();
  history.replaceState(null, "", "#/nutrition");
  session.user = { uid: "alice", id: "alice" };
  session.today = TODAY;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(async () => {
  // TanStack's onlineManager must not stay offline for later tests. It only
  // listens while a client is mounted, so go back online before unmounting.
  delete (navigator as { onLine?: boolean }).onLine;
  window.dispatchEvent(new Event("online"));
  onlineManager.setOnline(true);
  cleanup();
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * Release order
 * ------------------------------------------------------------------ */

describe("release order: the new frontend against the backend that still says false", () => {
  it("complete profile, no target: the ready message stays, and no setup or generation action exists", async () => {
    seedProfile();
    answerStatus(false, false);
    mount();

    expect(await screen.findByText("Dein Ernährungsprofil ist vollständig.")).toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.getByText(/sobald diese Funktion verfügbar ist/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ziel festlegen" })).toBeNull();
    expect(generationButton()).toBeNull();
    expect(targetCalls()).toEqual([]);
    expect(generationCalls()).toEqual([]);
  });

  it("target and plan: the target, Today and the week keep working; no 'change target' and no generation", async () => {
    await seedTargetAndPlan();
    answerStatus(false, false);
    mount();

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toHaveTextContent("2.200 kcal");
    expect(await screen.findAllByTestId("nutrition-v2-week-row")).toHaveLength(7);
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
    expect(generationButton()).toBeNull();
    expect((await today()).getAttribute("data-view")).toBe("today");
  });
});

/* ------------------------------------------------------------------ *
 * The capability read
 * ------------------------------------------------------------------ */

describe("the live capability read fails closed", () => {
  it("pending: no action, and the target is still shown", async () => {
    await seedTargetOnly();
    backend.handlers.coachBackendStatus = () => new Promise(() => undefined);
    mount();

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toBeInTheDocument();
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
    expect(generationButton()).toBeNull();
  });

  it("error: no action, no error view — and an explicit refresh asks again and can expose them", async () => {
    await seedTargetOnly();
    backend.handlers.coachBackendStatus = async () => {
      throw Object.assign(new Error("unavailable"), { code: "functions/unavailable" });
    };
    mount();

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect((await today()).getAttribute("data-view")).not.toBe("error");
    expect(screen.queryByText(/Ernährung konnte nicht geladen werden/)).toBeNull();
    expect(generationButton()).toBeNull();
    // Not retried on its own.
    await settle();
    expect(statusCalls()).toHaveLength(1);

    answerStatus(true, true);
    fireEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
    expect(await screen.findByRole("button", { name: "Ernährungsplan erstellen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ziel ändern" })).toBeInTheDocument();
    expect(statusCalls()).toHaveLength(2);
    expect(generationCalls()).toEqual([]);
  });

  it("an answer for another account is refused", async () => {
    await seedTargetOnly();
    backend.handlers.coachBackendStatus = async () => status(true, true, "mallory");
    mount();

    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
    expect(generationButton()).toBeNull();
  });

  it("anything but a literal true is false", async () => {
    await seedTargetOnly();
    backend.handlers.coachBackendStatus = async () => ({ ...status(true, true), capabilities: { nutritionTargets: "true", nutritionGeneration: 1 } });
    mount();

    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
    expect(generationButton()).toBeNull();
  });

  it("each capability exposes only its own action", async () => {
    await seedTargetOnly();
    answerStatus(true, false);
    const first = mount();
    expect(await screen.findByRole("button", { name: "Ziel ändern" })).toBeInTheDocument();
    await settle();
    expect(generationButton()).toBeNull();
    first.unmount();

    answerStatus(false, true);
    mount();
    expect(await screen.findByRole("button", { name: "Ernährungsplan erstellen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
  });

  it("is read once per session: re-renders, tab changes and the target read do not ask again", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    mount();
    expect(await screen.findByRole("button", { name: "Ernährungsplan erstellen" })).toBeInTheDocument();

    history.replaceState(null, "", "#/home");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await settle();
    history.replaceState(null, "", "#/nutrition");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("button", { name: "Ernährungsplan erstellen" })).toBeInTheDocument();
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(statusCalls()).toHaveLength(1);
  });

  it("is never asked for an ineligible account", async () => {
    for (const profile of [{ ...PROFILE, age: 17 }, { ...PROFILE, age: null }]) {
      cleanup();
      backend.calls.length = 0;
      store.docs.clear();
      seedProfile(profile);
      answerStatus(true, true);
      mount();
      expect(await screen.findByTestId("nutrition-v2-today")).toHaveAttribute("data-view", "ineligible");
      await settle();
      expect(statusCalls()).toEqual([]);
      expect(screen.queryByRole("button", { name: "Ziel festlegen" })).toBeNull();
      expect(generationButton()).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Target setup
 * ------------------------------------------------------------------ */

describe("target setup", () => {
  it("complete profile, no target, nutritionTargets true: the setup is the next action, and generation waits for it", async () => {
    seedProfile();
    answerStatus(true, true);
    mount();

    expect(await screen.findByText(/Als Nächstes legst du dein Ernährungsziel fest/)).toBeInTheDocument();
    expect(await screen.findByText("Du hast noch kein Ernährungsziel festgelegt.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ziel festlegen" })).toBeInTheDocument();
    expect(screen.queryByText(/sobald diese Funktion verfügbar ist/)).toBeNull();
    await settle();
    expect(generationButton()).toBeNull();
  });

  it("an incomplete profile is completed first: no target setup yet", async () => {
    seedProfile({ ...PROFILE, mealsPerDay: null });
    answerStatus(true, true);
    mount();

    expect(await screen.findByRole("region", { name: "Ernährungsprofil vervollständigen" })).toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel festlegen" })).toBeNull();
    expect(generationButton()).toBeNull();
  });

  it.each([
    ["calculated", "Berechnen"],
    ["manual", "Selbst festlegen"],
  ] as const)("a %s target is set through the existing flow and read back; then generation is offered", async (mode, modeLabel) => {
    seedProfile();
    answerStatus(true, true);
    backend.handlers.nutritionSetTarget = async () => {
      // The "server" writes the target and the state; the browser only reads them back.
      put(C.state, "current", makeState({ activePlanId: null, currentTargetVersionId: "target-9" }));
      put(C.targets, "target-9", await freshTarget("target-9"));
      return { ok: true, targetVersionId: "target-9", replay: false };
    };
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Ziel festlegen" }));
    const dialog = await screen.findByRole("dialog", { name: "Ziel festlegen" });
    fireEvent.click(within(dialog).getByRole("button", { name: modeLabel }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Ziel festlegen" }));

    await waitFor(() => expect(targetCalls()).toHaveLength(1));
    const [{ payload }] = targetCalls();
    expect(Object.keys(payload as object).sort()).toEqual(["mode", "requestId"]);
    expect((payload as { mode: string }).mode).toBe(mode);
    // No target value was computed or sent by the browser.
    expect(JSON.stringify(payload)).not.toMatch(/kcal|protein|2200/i);

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toHaveTextContent("2.200 kcal");
    expect(await screen.findByRole("button", { name: "Ernährungsplan erstellen" })).toBeInTheDocument();
    expect(generationCalls()).toEqual([]);
  });

  it("TARGET_INFEASIBLE is said neutrally, without values or bounds", async () => {
    seedProfile();
    answerStatus(true, true);
    backend.handlers.nutritionSetTarget = async () => {
      throw refusal("TARGET_INFEASIBLE");
    };
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Ziel festlegen" }));
    const dialog = await screen.findByRole("dialog", { name: "Ziel festlegen" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ziel festlegen" }));

    const message = await within(dialog).findByTestId("nutrition-v2-target-setup-message");
    expect(message).toHaveAttribute("data-outcome", "infeasible");
    expect(message).toHaveTextContent("Mit diesen Angaben lässt sich kein unterstütztes Tagesziel festlegen.");
    expect(message).not.toHaveTextContent(/TARGET_INFEASIBLE|1200|6000|Fehler/);
  });

  it("a stale target offers its review when setup is available, and generation waits for it", async () => {
    seedProfile();
    put(C.state, "current", makeState({ activePlanId: null }));
    // Set for 1 800 kcal; the profile now says 2 200.
    put(C.targets, "target-1", await freshTarget("target-1", 1800));
    answerStatus(true, true);
    mount();

    expect(await screen.findByTestId("nutrition-v2-target-freshness")).toHaveAttribute("data-freshness", "stale");
    expect(screen.getByRole("button", { name: "Ziel prüfen" })).toBeInTheDocument();
    expect(await screen.findByText("Prüfe zuerst dein Ernährungsziel. Danach kannst du einen neuen Plan erstellen.")).toBeInTheDocument();
    expect(generationButton()).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

describe("plan generation", () => {
  it("no target: no generation action, even with generation available", async () => {
    seedProfile();
    put(C.state, "current", makeState({ activePlanId: null, currentTargetVersionId: null }));
    answerStatus(false, true);
    mount();

    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(generationButton()).toBeNull();
  });

  it("one click is exactly one { requestId } request; a second click in between sends nothing", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    let release: (value: NutritionRequestPlanResult) => void = () => undefined;
    backend.handlers.nutritionRequestPlan = () => new Promise((resolve) => (release = resolve));
    mount();

    const button = await screen.findByRole("button", { name: "Ernährungsplan erstellen" });
    // Mounting and rendering asked for nothing.
    expect(generationCalls()).toEqual([]);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(await screen.findByText("Dein Ernährungsplan wird erstellt …")).toBeInTheDocument();
    expect(generationButton()).toBeNull();
    expect(generationCalls()).toHaveLength(1);
    const [{ payload }] = generationCalls();
    expect(Object.keys(payload as object)).toEqual(["requestId"]);
    expect((payload as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () => release(answer({ requestId: (payload as { requestId: string }).requestId, status: "failed", errorCode: "PROVIDER_FAILED" })));
    expect(await screen.findByTestId("nutrition-v2-generation-outcome")).toHaveTextContent(
      "Der Plan konnte gerade nicht erstellt werden. Dein bisheriger Plan bleibt erhalten."
    );
    // Nothing retried by itself.
    await settle();
    expect(generationCalls()).toHaveLength(1);
  });

  it("a succeeded request shows the activated plan through the normal reads", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    backend.handlers.nutritionRequestPlan = async (payload) => {
      const { requestId } = payload as { requestId: string };
      put(C.plans, "gen-plan-1", makePlan({ planId: "gen-plan-1", startDate: TODAY }));
      put(C.state, "current", makeState({ activePlanId: "gen-plan-1", revision: 2 }));
      return answer({ requestId, status: "succeeded", resultPlanId: "gen-plan-1" });
    };
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Ernährungsplan erstellen" }));
    expect(await screen.findByTestId("nutrition-v2-generation-outcome")).toHaveTextContent("Dein Ernährungsplan ist fertig.");
    const rows = await screen.findAllByTestId("nutrition-v2-week-row");
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveAttribute("data-plan-id", "gen-plan-1");
    // The browser wrote no plan and no state itself.
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(generationCalls()).toHaveLength(1);
  });

  it.each([
    ["QUOTA_EXCEEDED", "Du hast die Anzahl neuer Ernährungspläne für diesen Monat erreicht."],
    ["DIETARY_PREFERENCE_NOT_SUPPORTED", "Für die Ernährungsform Keto können derzeit keine Ernährungspläne erstellt werden."],
    ["NUTRITION_AI_DISABLED", "Die Planerstellung ist vorübergehend nicht verfügbar."],
    ["NO_CURRENT_TARGET", "Lege zuerst dein Ernährungsziel fest."],
    ["INTERNAL", "Der Plan konnte gerade nicht erstellt werden. Bitte versuche es später noch einmal."],
  ])("%s is said as fixed German copy", async (code, copy) => {
    await seedTargetOnly();
    answerStatus(true, true);
    backend.handlers.nutritionRequestPlan = async () => {
      throw refusal(code);
    };
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Ernährungsplan erstellen" }));
    const outcome = await screen.findByTestId("nutrition-v2-generation-outcome");
    expect(outcome).toHaveTextContent(copy);
    expect(outcome).toHaveAttribute("role", "alert");
    expect(outcome).not.toHaveTextContent(new RegExp(`${code}|functions/|Error`));
    expect(outcome).not.toHaveTextContent(/\d+ ?\/ ?\d+|Kontingent: \d/);
  });

  it("a raw provider or SDK message never reaches the screen", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    backend.handlers.nutritionRequestPlan = async () => {
      throw Object.assign(new Error("Vertex 500: model gemini overloaded at stack frame"), { code: "functions/internal" });
    };
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Ernährungsplan erstellen" }));
    const outcome = await screen.findByTestId("nutrition-v2-generation-outcome");
    expect(outcome).toHaveTextContent("Bitte versuche es später noch einmal.");
    expect(document.body.textContent).not.toMatch(/Vertex|gemini|overloaded|stack/);
  });

  it("offline: the action is unavailable, says why, and sends nothing", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    mount();
    await screen.findByRole("button", { name: "Ernährungsplan erstellen" });

    act(() => goOffline());
    const button = await screen.findByRole("button", { name: "Ernährungsplan erstellen" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByText("Ein Ernährungsplan kann nur mit Internetverbindung erstellt werden.")).toBeInTheDocument();
    fireEvent.click(button);
    await settle();
    expect(generationCalls()).toEqual([]);
  });

  it("a queued or running request is shown, and no second action is offered", async () => {
    await seedTargetOnly();
    const requestId = intentUuid(7);
    put(C.state, "current", makeState({ activePlanId: null, activeGenerationRequestId: requestId }));
    put(C.generations, requestId, {
      schemaVersion: 2, requestId, idempotencyKey: `nutritionPlan:${requestId}`, kind: "initial", basePlanId: null,
      targetVersionId: "target-1", payloadFingerprint: "a".repeat(64), status: "running", resultPlanId: null,
      errorCode: null, createdAt: { seconds: 1790000000, nanoseconds: 0 }, finishedAt: null, acknowledgedAt: null,
    });
    answerStatus(true, true);
    mount();

    const statusRegion = await screen.findByRole("region", { name: "Planstatus" });
    await waitFor(() => expect(statusRegion).toHaveTextContent("Dein Ernährungsplan wird erstellt."));
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(generationButton()).toBeNull();
    expect(generationCalls()).toEqual([]);
  });

  it("regeneration is explicit: it asks once more, and cancelling sends nothing", async () => {
    await seedTargetAndPlan();
    answerStatus(true, true);
    backend.handlers.nutritionRequestPlan = async (payload) =>
      answer({ requestId: (payload as { requestId: string }).requestId, status: "running" });
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Neuen Plan erstellen" }));
    expect(screen.getByText(/gilt ab morgen und ersetzt die kommenden Tage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await settle();
    expect(generationCalls()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Neuen Plan erstellen" }));
    const section = screen.getByTestId("nutrition-v2-generation");
    fireEvent.click(within(section).getByRole("button", { name: "Neuen Plan erstellen" }));
    await waitFor(() => expect(generationCalls()).toHaveLength(1));
    expect(Object.keys(generationCalls()[0].payload as object)).toEqual(["requestId"]);
    expect(await screen.findByTestId("nutrition-v2-generation-outcome")).toHaveTextContent("Dein Ernährungsplan wird gerade erstellt.");
  });

  it("a plan that has not started yet cannot be regenerated: no action", async () => {
    seedProfile();
    put(C.state, "current", makeState({ activePlanId: "plan-next" }));
    put(C.targets, "target-1", await freshTarget());
    put(C.plans, "plan-next", makePlan({ planId: "plan-next", startDate: "2026-09-27" }));
    answerStatus(true, true);
    mount();

    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(generationButton()).toBeNull();
  });

  it("keto: says generation does not support it, and offers no action", async () => {
    seedProfile({ ...PROFILE, dietaryPreference: "keto" });
    put(C.state, "current", makeState({ activePlanId: null }));
    put(C.targets, "target-1", await freshTarget());
    answerStatus(true, true);
    mount();

    expect(await screen.findByText("Für die Ernährungsform Keto können derzeit keine Ernährungspläne erstellt werden.")).toBeInTheDocument();
    expect(generationButton()).toBeNull();
  });

  it("refresh reads only: no target, no generation, no request id", async () => {
    await seedTargetOnly();
    answerStatus(true, true);
    mount();
    await screen.findByRole("button", { name: "Ernährungsplan erstellen" });

    fireEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
    await waitFor(() => expect(statusCalls()).toHaveLength(2));
    await settle();
    expect(backend.calls.map((call) => call.name)).toEqual(["coachBackendStatus", "coachBackendStatus"]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Accounts and persistence
 * ------------------------------------------------------------------ */

describe("account isolation and persistence", () => {
  const mountWithAccounts = () =>
    render(<QueryProvider>{providers(<Dashboard />)}</QueryProvider>);

  it("account B never sees account A's capability or outcome, and the status is never stored", async () => {
    await seedTargetOnly("alice");
    await seedTargetOnly("bob");
    // Each account is answered its own status: A may generate, B may not.
    backend.handlers.coachBackendStatus = async () => status(true, uidOf() === "alice");
    backend.handlers.nutritionRequestPlan = async () => {
      throw refusal("QUOTA_EXCEEDED");
    };
    const view = mountWithAccounts();

    fireEvent.click(await screen.findByRole("button", { name: "Ernährungsplan erstellen" }));
    expect(await screen.findByTestId("nutrition-v2-generation-outcome")).toBeInTheDocument();

    // The status is operational state: it is never written to the account's cache.
    window.dispatchEvent(new Event("pagehide"));
    const storedA = localStorage.getItem(accountStorageKey("REACT_QUERY_OFFLINE_CACHE", "alice"));
    expect(storedA).not.toBeNull();
    expect(storedA).not.toContain("coach-backend");
    expect(storedA).toContain("nutrition-v2");

    session.user = { uid: "bob", id: "bob" };
    view.rerender(<QueryProvider>{providers(<Dashboard />)}</QueryProvider>);

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toHaveLength(2));
    await settle();
    expect(generationButton()).toBeNull();
    expect(screen.queryByTestId("nutrition-v2-generation-outcome")).toBeNull();
    expect(screen.getByRole("button", { name: "Ziel ändern" })).toBeInTheDocument();
  });

  it("a stored status from an older snapshot is never restored: the backend is asked live", async () => {
    await seedTargetOnly();
    const key = accountStorageKey("REACT_QUERY_OFFLINE_CACHE", "alice");
    localStorage.setItem(
      key,
      JSON.stringify({
        buster: "account-owned-v1",
        timestamp: Date.now(),
        clientState: {
          mutations: [],
          queries: [
            {
              queryKey: ["coach-backend", "alice", "status"],
              queryHash: JSON.stringify(["coach-backend", "alice", "status"]),
              state: {
                data: status(true, true, "alice"),
                dataUpdateCount: 1,
                dataUpdatedAt: Date.now(),
                error: null,
                errorUpdateCount: 0,
                errorUpdatedAt: 0,
                fetchFailureCount: 0,
                fetchFailureReason: null,
                fetchMeta: null,
                isInvalidated: false,
                status: "success",
                fetchStatus: "idle",
              },
            },
          ],
        },
      })
    );
    // The live backend has been rolled back.
    answerStatus(false, false);
    mountWithAccounts();

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toBeInTheDocument();
    await waitFor(() => expect(statusCalls()).toHaveLength(1));
    await settle();
    expect(screen.queryByRole("button", { name: "Ziel ändern" })).toBeNull();
    expect(generationButton()).toBeNull();
  });
});

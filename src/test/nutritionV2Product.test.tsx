import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-12D product integration. NUT-05. The Nutrition V2 Today/week shell is read-only: each row shows the
  day, its recording status and its PLANNED kcal — no macros, no recorded
  values, no controls — and every data state is neutral. The container reads
  nothing unless the account is an eligible adult. NUT-06 recording lives in a
  separate section the container passes in (NutritionV2TodayRecording.test.tsx);
  the shell itself stays read-only.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, value = "asc") => ({ field, op: "orderBy", value })),
  limit: vi.fn((value: number) => ({ field: "", op: "limit", value })),
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
      const filters = q.constraints.filter(({ op }) => op !== "orderBy" && op !== "limit");
      let rows = [...store.docs.entries()]
        .filter(([path]) => path.startsWith(prefix))
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
      const docs = rows.map(([path, data]) => ({ id: path.slice(prefix.length), data: () => data }));
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
vi.mock("@/hooks/queries/useProfile", () => ({ useProfile: () => session.profile, useUpdateProfile: () => ({ mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/useBerlinToday", () => ({ useBerlinToday: () => session.today }));

vi.mock('@/hooks/queries/useWorkoutPlan', () => ({ useWorkoutPlan: () => ({ data: null, isLoading: true }) }));
vi.mock('@/hooks/queries/useWorkoutLogs', () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false, toggleDay: vi.fn() }) }));
vi.mock('@/hooks/queries/useLegacyNutritionPlan', () => ({ useLegacyNutritionPlan: () => ({ data: { id: 'legacy', content: { breakfast: [{ meal: 'LEGACY FOOD', calories: 999 }] } }, isLoading: true, isError: true }) }));
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({}) }));
vi.mock('@/contexts/TrainingSessionContext', () => ({ useTrainingSession: () => ({ validateSessionAgainstPlan: vi.fn(), rejectionNotice: null, clearRejectionNotice: vi.fn() }) }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/views/HomeView', () => ({ default: () => <h1>Home fixture</h1> }));
vi.mock('@/views/WorkoutView', () => ({ default: () => <h1>Workout fixture</h1> }));
vi.mock('@/views/ProfileView', () => ({ default: () => <h1>Profile fixture</h1> }));

import Dashboard from '@/components/Dashboard';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import { ThemeProvider } from '@/hooks/useTheme';
import { NUTRITION_V2_COLLECTIONS as C, NUTRITION_V2_ENABLED } from '@shared/nutrition';
import { makePlan, makeState, makeTarget, skipEntry, intentUuid } from './nutritionV2Fixtures';

// Lazy Dashboard chunks may take longer in the complete client suite.
configure({ asyncUtilTimeout: 5000 });

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => <QueryClientProvider client={client}><ThemeProvider><PreferencesProvider><FocusModeProvider><Dashboard /></FocusModeProvider></PreferencesProvider></ThemeProvider></QueryClientProvider>;
  return { client, tree, ...render(tree()) };
};
const put = (collection: string, id: string, data: unknown) => store.docs.set(`users/alice/${collection}/${id}`, data);
const seed = () => {
  put(C.state, 'current', makeState());
  put(C.plans, 'plan-1', makePlan());
  put(C.targets, 'target-1', makeTarget());
  const entry = skipEntry(session.today, 'breakfast');
  put(C.entries, entry.entryId, entry);
};

beforeEach(() => {
  store.docs.clear();
  vi.clearAllMocks();
  localStorage.clear();
  history.replaceState(null, '', '#/nutrition');
  session.user = { uid: 'alice', id: 'alice' };
  session.profile = { status: 'success', data: { id: 'alice', age: 30 } };
  session.today = '2026-09-26';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('ships the real V2 empty state independently of legacy and workout query states', async () => {
  expect(NUTRITION_V2_ENABLED).toBe(true);
  mount();
  expect(await screen.findByText('Ernährung ist noch nicht eingerichtet')).toBeInTheDocument();
  expect(screen.getByText(/Neue Ziele und KI-Ernährungspläne sind/)).toBeInTheDocument();
  expect(screen.queryByTestId('legacy-nutrition-plan')).toBeNull();
  expect(screen.queryByText('LEGACY FOOD')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ziel festlegen' })).toBeNull();
  expect(store.docs.size).toBe(0);
});

it('renders existing target, real meals, recorded state and seven plan dates', async () => {
  seed();
  mount();
  await waitFor(() => expect(screen.getAllByTestId('nutrition-v2-week-row')).toHaveLength(7));
  expect(await screen.findByTestId('nutrition-v2-target-kcal')).toHaveTextContent('2.200 kcal');
  expect(screen.getByText('lunch 3')).toBeInTheDocument();
  expect(screen.getByTestId('nutrition-v2-today')).toHaveTextContent('Teilweise erfasst');
  expect(screen.queryByTestId('legacy-nutrition-plan')).toBeNull();
  expect(screen.queryByRole('button', { name: /Ziel ändern|Ziel festlegen/ })).toBeNull();
  expect(store.docs.size).toBe(4);
});

it('shows profile loading, then eligibility without V2 reads for a minor', async () => {
  session.profile = { status: 'pending', data: undefined };
  const view = mount();
  expect(await screen.findByRole('status', { name: 'Ernährung wird geladen' })).toBeInTheDocument();
  expect(firestore.getDoc).not.toHaveBeenCalled();
  session.profile = { status: 'success', data: { id: 'alice', age: 17 } };
  view.rerender(view.tree());
  expect(await screen.findByText('Ernährung ist ab 18 Jahren verfügbar')).toBeInTheDocument();
  expect(firestore.getDoc).not.toHaveBeenCalled();
  expect(firestore.getDocs).not.toHaveBeenCalled();
});

it('shows corrupt V2 data as error and recovers through scoped refresh', async () => {
  put(C.state, 'current', { broken: true });
  const { client } = mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Ernährung konnte nicht geladen werden');
  expect(screen.queryByTestId('legacy-nutrition-plan')).toBeNull();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  store.docs.clear();
  fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
  expect(await screen.findByText('Ernährung ist noch nicht eingerichtet')).toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['nutrition-v2', 'alice'] });
});

it('does not show the previous account plan after an account switch', async () => {
  seed();
  const view = mount();
  expect(await screen.findByText('lunch 3')).toBeInTheDocument();
  session.user = { uid: 'bob', id: 'bob' };
  session.profile = { status: 'success', data: { id: 'bob', age: 30 } };
  view.rerender(view.tree());
  expect(screen.queryByText('lunch 3')).toBeNull();
  expect(await screen.findByText('Ernährung ist noch nicht eingerichtet')).toBeInTheDocument();
});

it('reads an existing generation status and refreshes it without starting a request', async () => {
  const requestId = intentUuid(42);
  put(C.state, 'current', makeState({ activePlanId: null, currentTargetVersionId: null, activeGenerationRequestId: requestId }));
  const request = {
    schemaVersion: 2, requestId, idempotencyKey: `nutritionPlan:${requestId}`, kind: 'initial', basePlanId: null,
    targetVersionId: 'target-1', payloadFingerprint: 'a'.repeat(64), status: 'running', resultPlanId: null,
    errorCode: null, createdAt: { seconds: 1790000000, nanoseconds: 0 }, finishedAt: null, acknowledgedAt: null,
  };
  put(C.generations, requestId, request);
  mount();
  expect(await screen.findByText('Deine Plananfrage wird bearbeitet.')).toBeInTheDocument();
  put(C.generations, requestId, { broken: true });
  fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
  expect(await screen.findByText(/Der Planstatus konnte nicht geladen werden/)).toBeInTheDocument();
  expect(screen.getByText('Kein aktiver Ernährungsplan')).toBeInTheDocument();
  expect(store.docs.size).toBe(2);
});


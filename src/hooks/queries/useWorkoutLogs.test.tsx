import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rows, writes, control, resetWorkoutFirestore, logPath } from "@/test/mocks/workoutFirestore";
import { queryKeys } from "@/lib/queryKeys";
import type { WorkoutLog } from "@/lib/types";

vi.mock("firebase/firestore", async () => (await import("@/test/mocks/workoutFirestore")).firestore);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "u1", id: "u1" } }) }));
vi.mock("@/lib/firebase", () => ({ db: {}, auth: { currentUser: { uid: "u1" } } }));
// Control transport retry/queueing; keep the production action and optimistic update.
vi.mock("@/hooks/useSupabaseAction", () => ({
  useSupabaseAction: (options: { action: (variables: unknown) => Promise<unknown>;
    onMutate: (variables: unknown) => Promise<unknown>; onError: () => void }) => useMutation({
    mutationFn: options.action, onMutate: options.onMutate, onError: options.onError,
  }),
}));
import { useWorkoutLogs } from "./useWorkoutLogs";
import { handlers } from "@/lib/offlineHandlers";

const identity = { planId: "plan-1", workoutDay: "2026-09-07", weekKey: "Week 1", dayIndex: 0 };
const exercise = { ...identity, exerciseIndex: 0, completed: false };
beforeEach(resetWorkoutFirestore);

describe("day writes across online and offline handlers", () => {
  it.each([false, true])("online day toggle protects exercises (existing day: %s)", async existingDay => {
    rows.set(logPath("a-exercise"), exercise);
    if (existingDay) rows.set(logPath("z-day"), { ...identity, completed: false, durationSec: 400 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useWorkoutLogs(identity.planId), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    let release!: () => void;
    control.beforeCommit = () => new Promise<void>(resolve => { release = resolve; });
    act(() => result.current.toggleDay({ workoutDateStr: identity.workoutDay, completed: true,
      weekKey: identity.weekKey, dayIndex: identity.dayIndex }));
    await waitFor(() => expect(release).toBeDefined());
    const cached = client.getQueryData<WorkoutLog[]>(queryKeys.logs.byPlan(identity.planId, "u1"))!;
    expect(cached.find(row => row.id === "a-exercise")?.completed).toBe(false);
    expect(cached.filter(row => row.completed)).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(result.current.isToggling).toBe(false));
    expect(rows.get(logPath("a-exercise"))).toEqual(exercise);
    expect(writes).toHaveLength(1);
    if (existingDay) {
      expect(writes[0].path).toBe(logPath("z-day"));
      expect(rows.get(logPath("z-day"))?.durationSec).toBe(400);
    }
  });

  it.each([false, true])("offline replay protects exercise and malformed rows (existing day: %s)", async existingDay => {
    rows.set(logPath("a-exercise"), exercise);
    const malformed = { ...identity, exerciseIndex: "bad", completed: false };
    rows.set(logPath("b-malformed"), malformed);
    if (existingDay) rows.set(logPath("z-day"), { ...identity, completed: false });
    await handlers.TOGGLE_DAY({ ...identity, completed: true });
    await handlers.TOGGLE_DAY({ ...identity, completed: true });
    expect(rows.get(logPath("a-exercise"))).toEqual(exercise);
    expect(rows.get(logPath("b-malformed"))).toEqual(malformed);
    expect(rows.size).toBe(3);
    expect(new Set(writes.map(write => write.path)).size).toBe(1);
    if (existingDay) expect(writes[0].path).toBe(logPath("z-day"));
  });
});

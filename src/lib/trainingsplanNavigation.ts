import type { PlanDayRef } from "@/lib/trainingsplanModel";
import type { HistorySessionKey } from "@/lib/workoutHistory";

/**
 * The Trainingsplan's pushed screens as stored in `history.state`.
 *
 * Main is the implicit root and is never stored. Each history entry carries
 * the whole stack above it, so Back and Forward restore a screen - and where
 * it was opened from - without any other bookkeeping. Anything that does not
 * read as a valid stack for the loaded plan reads as Main.
 */
export type PushedScreen =
  | { kind: "detail"; day: PlanDayRef }
  | { kind: "edit"; day: PlanDayRef }
  | { kind: "plan" }
  /** Verlauf: the user's completed sessions, whichever plan they belong to. */
  | { kind: "history" }
  /** One completed session, addressed as its day-session record is. */
  | { kind: "session"; session: HistorySessionKey };

export const trainingsplanHistoryKey = "trainingsplanV2";

/**
 * The scope the tab's screens are stored under while no plan is active. Not a
 * possible plan id (Firestore ids cannot contain "/"), and only History and
 * its sessions are valid under it - they belong to the user, not to a plan.
 */
export const NO_PLAN_SCOPE = "/no-plan";

interface StoredNavigation {
  planId: string;
  stack: PushedScreen[];
}

const isDay = (value: unknown): value is PlanDayRef => {
  const day = value as Partial<PlanDayRef> | null;
  return (
    !!day &&
    typeof day.weekKey === "string" &&
    /^Week \d+$/.test(day.weekKey) &&
    typeof day.dayIndex === "number" &&
    Number.isInteger(day.dayIndex) &&
    day.dayIndex >= 0 &&
    day.dayIndex <= 6 &&
    typeof day.workoutDay === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day.workoutDay)
  );
};

const isSessionKey = (value: unknown): value is HistorySessionKey => {
  const key = value as Partial<HistorySessionKey> | null;
  return (
    !!key &&
    typeof key.planId === "string" &&
    key.planId.trim() !== "" &&
    !key.planId.includes("/") &&
    typeof key.workoutDay === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(key.workoutDay)
  );
};

const readScreen = (value: unknown): PushedScreen | null => {
  const screen = value as { kind?: unknown; day?: unknown; session?: unknown } | null;
  if (!screen) return null;
  if (screen.kind === "plan") return { kind: "plan" };
  if (screen.kind === "history") return { kind: "history" };
  if (screen.kind === "session" && isSessionKey(screen.session)) {
    const { planId, workoutDay } = screen.session;
    return { kind: "session", session: { planId, workoutDay } };
  }
  if ((screen.kind === "detail" || screen.kind === "edit") && isDay(screen.day)) {
    const { weekKey, dayIndex, workoutDay } = screen.day;
    return { kind: screen.kind, day: { weekKey, dayIndex, workoutDay } };
  }
  return null;
};

/** The stack stored in a history entry for this plan, or `[]` (Main). */
export const readTrainingsplanStack = (state: unknown, planId: string | null | undefined): PushedScreen[] => {
  const stored = (state as Record<string, unknown> | null)?.[trainingsplanHistoryKey] as Partial<StoredNavigation> | undefined;
  if (!stored || !planId || stored.planId !== planId || !Array.isArray(stored.stack)) return [];
  const screens = stored.stack.map(readScreen);
  if (screens.some((screen) => screen === null)) return [];
  const valid = (screens as PushedScreen[]).every((screen, index, all) => {
    const below = all[index - 1];
    // Without a plan only History and its sessions exist.
    if (planId === NO_PLAN_SCOPE && screen.kind !== "history" && screen.kind !== "session") return false;
    switch (screen.kind) {
      // Editing only ever sits directly on its own day.
      case "edit":
        return below?.kind === "detail" && below.day.workoutDay === screen.day.workoutDay;
      // History opens from Main only.
      case "history":
        return index === 0;
      /*
        A session opens from History, from Today, or from its own completed
        day. Outside History it is always this plan's own day; nothing is
        opened on top of it.
      */
      case "session":
        if (index !== all.length - 1) return false;
        if (below?.kind === "history") return true;
        if (screen.session.planId !== planId) return false;
        return !below || (below.kind === "detail" && below.day.workoutDay === screen.session.workoutDay);
      default:
        return true;
    }
  });
  return valid ? (screens as PushedScreen[]) : [];
};

/** A history state carrying `stack`, keeping whatever else the entry holds. */
export const withTrainingsplanStack = (
  state: unknown,
  planId: string | null | undefined,
  stack: PushedScreen[]
): Record<string, unknown> => {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  if (!planId || stack.length === 0) {
    delete base[trainingsplanHistoryKey];
    return base;
  }
  base[trainingsplanHistoryKey] = { planId, stack } satisfies StoredNavigation;
  return base;
};

import type { PlanDayRef } from "@/lib/trainingsplanModel";

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
  | { kind: "plan" };

export const trainingsplanHistoryKey = "trainingsplanV2";

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

const readScreen = (value: unknown): PushedScreen | null => {
  const screen = value as { kind?: unknown; day?: unknown } | null;
  if (!screen) return null;
  if (screen.kind === "plan") return { kind: "plan" };
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
  // Editing only ever sits directly on its own day.
  const valid = screens.every((screen, index) => {
    if (screen!.kind !== "edit") return true;
    const below = screens[index - 1];
    return below?.kind === "detail" && below.day.workoutDay === screen!.day.workoutDay;
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

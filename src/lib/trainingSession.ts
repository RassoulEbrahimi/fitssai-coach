/**
 * Persistence for a running workout session.
 *
 * A session is bound to exactly one plan day. Before PR7 only two booleans
 * were stored — "started" and "start_time" — with no record of *which* day
 * had been started, so a reload silently re-attached a stale session to
 * whatever day the UI happened to be showing (usually today). This module
 * stores the binding and refuses to resume one that no longer matches the
 * current plan.
 */

/** Canonical, namespaced key. Replaces the two legacy keys below. */
export const SESSION_STORAGE_KEY = "fitssai.training.session";

/** Pre-PR7 keys. Read once for migration, then removed. */
export const LEGACY_SESSION_STARTED_KEY = "fitssai.training.session.started";
export const LEGACY_SESSION_START_TIME_KEY = "fitssai.training.session.start_time";

/** Bump when the payload shape changes incompatibly. */
export const SESSION_PAYLOAD_VERSION = 1;

export interface TrainingSessionPayload {
  version: number;
  planId: string;
  weekKey: string;
  dayIndex: number;
  /** Epoch milliseconds. */
  startedAt: number;
}

/** Why a stored session could not be resumed — used to explain it to the user. */
export type SessionRejectionReason =
  | "none"
  | "malformed"
  | "version"
  | "plan-mismatch"
  | "day-missing";

export interface SessionReadResult {
  session: TrainingSessionPayload | null;
  reason: SessionRejectionReason;
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Shape check only — plan validity is a separate, later decision. */
export const parseSessionPayload = (raw: string | null): TrainingSessionPayload | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TrainingSessionPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.planId !== "string" || parsed.planId === "") return null;
    if (typeof parsed.weekKey !== "string" || parsed.weekKey === "") return null;
    if (!isPositiveInt(parsed.dayIndex) || parsed.dayIndex > 6) return null;
    if (!isPositiveInt(parsed.startedAt) || parsed.startedAt === 0) return null;
    if (typeof parsed.version !== "number") return null;
    return parsed as TrainingSessionPayload;
  } catch {
    return null;
  }
};

/**
 * Migrate the two legacy keys into the versioned payload.
 *
 * The legacy format recorded no plan binding, so there is nothing truthful to
 * migrate *to* — a resumed session would have to guess its day. The legacy
 * keys are therefore cleared rather than reinterpreted, and only those two
 * keys are touched.
 */
export const migrateLegacySession = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const started = window.localStorage.getItem(LEGACY_SESSION_STARTED_KEY);
    const startTime = window.localStorage.getItem(LEGACY_SESSION_START_TIME_KEY);
    if (started === null && startTime === null) return false;

    window.localStorage.removeItem(LEGACY_SESSION_STARTED_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_START_TIME_KEY);
    return started === "true";
  } catch {
    return false;
  }
};

export const readStoredSession = (): TrainingSessionPayload | null => {
  if (typeof window === "undefined") return null;
  try {
    return parseSessionPayload(window.localStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const writeStoredSession = (session: TrainingSessionPayload): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Persisting is best-effort; the in-memory session still runs.
  }
};

export const clearStoredSession = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore blocked storage.
  }
};

export interface SessionPlanContext {
  planId: string | null | undefined;
  /** Returns true when the plan still contains this exact week/day. */
  hasDay: (weekKey: string, dayIndex: number) => boolean;
}

/**
 * Decide whether a stored session may be resumed.
 *
 * Every rejection path returns `session: null` with a reason — the caller must
 * not fall back to "today". Rebinding a stale session to a different day is
 * exactly the behaviour this replaces.
 */
export const resolveStoredSession = (
  stored: TrainingSessionPayload | null,
  plan: SessionPlanContext
): SessionReadResult => {
  if (!stored) return { session: null, reason: "none" };
  if (stored.version !== SESSION_PAYLOAD_VERSION) {
    return { session: null, reason: "version" };
  }
  if (!plan.planId || stored.planId !== plan.planId) {
    return { session: null, reason: "plan-mismatch" };
  }
  if (!plan.hasDay(stored.weekKey, stored.dayIndex)) {
    return { session: null, reason: "day-missing" };
  }
  return { session: stored, reason: "none" };
};

/** Short German explanation for a discarded session; null when nothing to say. */
export const describeSessionRejection = (
  reason: SessionRejectionReason
): string | null => {
  switch (reason) {
    case "plan-mismatch":
      return "Dein laufendes Training gehörte zu einem anderen Plan und wurde beendet.";
    case "day-missing":
      return "Der Trainingstag deiner Session ist nicht mehr im Plan. Die Session wurde beendet.";
    case "version":
    case "malformed":
      return "Deine gespeicherte Session konnte nicht wiederhergestellt werden und wurde beendet.";
    default:
      return null;
  }
};

export const createSessionPayload = (
  planId: string,
  weekKey: string,
  dayIndex: number,
  startedAt: number = Date.now()
): TrainingSessionPayload => ({
  version: SESSION_PAYLOAD_VERSION,
  planId,
  weekKey,
  dayIndex,
  startedAt,
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  SESSION_STORAGE_KEY,
  LEGACY_SESSION_STARTED_KEY,
  LEGACY_SESSION_START_TIME_KEY,
  SESSION_PAYLOAD_VERSION,
  createSessionPayload,
  withFinishAttempt,
  withoutFinishAttempt,
  clearStoredSession,
  describeSessionRejection,
  migrateLegacySession,
  parseSessionPayload,
  readStoredSession,
  resolveStoredSession,
  writeStoredSession,
  type SessionPlanContext,
} from "./trainingSession";
import { computeDurationSec } from "./workoutLog";

const PLAN_ID = "plan-abc";

/** A plan that has Week 1..4 with 7 days each. */
const plan: SessionPlanContext = {
  planId: PLAN_ID,
  hasDay: (weekKey, dayIndex) =>
    /^Week [1-4]$/.test(weekKey) && dayIndex >= 0 && dayIndex <= 6,
};

const validSession = createSessionPayload(PLAN_ID, "Week 2", 3, 1_700_000_000_000);

beforeEach(() => {
  localStorage.clear();
});

describe("session payload", () => {
  it("round-trips through storage", () => {
    writeStoredSession(validSession);
    expect(readStoredSession()).toEqual(validSession);
  });

  it("preserves the original start time across a reload", () => {
    // The measured duration is only truthful if a refresh mid-session does not
    // restart the clock. Writing then re-reading stands in for the reload.
    const startedAt = 1_700_000_000_000;
    writeStoredSession(createSessionPayload(PLAN_ID, "Week 2", 3, startedAt));

    const resumed = readStoredSession();

    expect(resumed?.startedAt).toBe(startedAt);
  });

  it("measures elapsed time from the persisted start, not from the reload", () => {
    const startedAt = 1_700_000_000_000;
    writeStoredSession(createSessionPayload(PLAN_ID, "Week 2", 3, startedAt));

    // Session began 25 minutes ago; the page reloaded somewhere in between.
    const resumed = readStoredSession();
    const endedAt = startedAt + 25 * 60 * 1000;

    expect(computeDurationSec(resumed?.startedAt ?? null, endedAt)).toBe(1500);
  });

  it("uses one canonical namespaced key", () => {
    writeStoredSession(validSession);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeTruthy();
    expect(localStorage.getItem(LEGACY_SESSION_STARTED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SESSION_START_TIME_KEY)).toBeNull();
  });

  it("clears cleanly", () => {
    writeStoredSession(validSession);
    clearStoredSession();
    expect(readStoredSession()).toBeNull();
  });

  it("rejects malformed payloads instead of throwing", () => {
    expect(parseSessionPayload(null)).toBeNull();
    expect(parseSessionPayload("not json")).toBeNull();
    expect(parseSessionPayload("{}")).toBeNull();
    expect(parseSessionPayload(JSON.stringify({ ...validSession, planId: "" }))).toBeNull();
    expect(parseSessionPayload(JSON.stringify({ ...validSession, dayIndex: 9 }))).toBeNull();
    expect(parseSessionPayload(JSON.stringify({ ...validSession, dayIndex: -1 }))).toBeNull();
    expect(parseSessionPayload(JSON.stringify({ ...validSession, startedAt: 0 }))).toBeNull();
  });

  it("keeps day index 0 (falsy but valid)", () => {
    const atDayZero = createSessionPayload(PLAN_ID, "Week 1", 0);
    expect(parseSessionPayload(JSON.stringify(atDayZero))?.dayIndex).toBe(0);
  });
});

describe("resume rules", () => {
  it("resumes a valid session into the exact same plan/week/day", () => {
    const { session, reason } = resolveStoredSession(validSession, plan);
    expect(reason).toBe("none");
    expect(session).toEqual(validSession);
    expect(session?.weekKey).toBe("Week 2");
    expect(session?.dayIndex).toBe(3);
  });

  it("does not rebind a stale session to today", () => {
    // Every rejection path must yield null — never a different day.
    const otherPlan: SessionPlanContext = { ...plan, planId: "plan-xyz" };
    const stale = resolveStoredSession(validSession, otherPlan);

    expect(stale.session).toBeNull();
    expect(stale.reason).toBe("plan-mismatch");
  });

  it("rejects a session whose plan no longer exists", () => {
    const noPlan: SessionPlanContext = { planId: null, hasDay: () => true };
    expect(resolveStoredSession(validSession, noPlan).reason).toBe("plan-mismatch");
  });

  it("rejects a session whose day is missing from the plan", () => {
    const shrunk: SessionPlanContext = {
      planId: PLAN_ID,
      hasDay: (weekKey) => weekKey === "Week 1",
    };
    const result = resolveStoredSession(validSession, shrunk);

    expect(result.session).toBeNull();
    expect(result.reason).toBe("day-missing");
  });

  it("rejects an unknown payload version", () => {
    const future = { ...validSession, version: SESSION_PAYLOAD_VERSION + 1 };
    const result = resolveStoredSession(future, plan);

    expect(result.session).toBeNull();
    expect(result.reason).toBe("version");
  });

  it("treats no stored session as nothing to report", () => {
    const result = resolveStoredSession(null, plan);
    expect(result.session).toBeNull();
    expect(result.reason).toBe("none");
  });

  it("explains every rejection to the user except 'none'", () => {
    expect(describeSessionRejection("plan-mismatch")).toBeTruthy();
    expect(describeSessionRejection("day-missing")).toBeTruthy();
    expect(describeSessionRejection("version")).toBeTruthy();
    expect(describeSessionRejection("malformed")).toBeTruthy();
    expect(describeSessionRejection("none")).toBeNull();
  });
});

describe("legacy key migration", () => {
  it("removes the legacy keys and reports whether one was running", () => {
    localStorage.setItem(LEGACY_SESSION_STARTED_KEY, "true");
    localStorage.setItem(LEGACY_SESSION_START_TIME_KEY, String(Date.now()));

    expect(migrateLegacySession()).toBe(true);
    expect(localStorage.getItem(LEGACY_SESSION_STARTED_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SESSION_START_TIME_KEY)).toBeNull();
  });

  it("does not invent a plan binding from legacy data", () => {
    // The legacy format had no plan/week/day, so nothing may be resumed.
    localStorage.setItem(LEGACY_SESSION_STARTED_KEY, "true");
    localStorage.setItem(LEGACY_SESSION_START_TIME_KEY, String(Date.now()));

    migrateLegacySession();

    expect(readStoredSession()).toBeNull();
  });

  it("is a no-op when no legacy keys exist", () => {
    expect(migrateLegacySession()).toBe(false);
  });

  it("does not touch unrelated storage", () => {
    localStorage.setItem(LEGACY_SESSION_STARTED_KEY, "true");
    localStorage.setItem("fitssai.theme", "dark");
    localStorage.setItem("fitssai.training.cache", "{}");

    migrateLegacySession();

    expect(localStorage.getItem("fitssai.theme")).toBe("dark");
    expect(localStorage.getItem("fitssai.training.cache")).toBe("{}");
  });
});

describe("the frozen finish instant", () => {
  const T1 = 1_700_000_100_000;
  const T2 = T1 + 3_600_000;

  it("stamps the first finish attempt", () => {
    expect(withFinishAttempt(validSession, T1).endedAt).toBe(T1);
  });

  it("keeps the first stamp when a retry attempts again later", () => {
    const first = withFinishAttempt(validSession, T1);

    // The value a retry reuses, so the wait is never billed to the workout.
    expect(withFinishAttempt(first, T2).endedAt).toBe(T1);
    expect(withFinishAttempt(first, T2)).toBe(first);
  });

  it("survives a round trip through storage", () => {
    writeStoredSession(withFinishAttempt(validSession, T1));

    expect(readStoredSession()?.endedAt).toBe(T1);
  });

  it("drops the stamp when the user goes back to training", () => {
    const resumed = withoutFinishAttempt(withFinishAttempt(validSession, T1));

    expect(resumed.endedAt).toBeUndefined();
    expect("endedAt" in resumed).toBe(false);
    expect(resumed).toEqual(validSession);
  });

  it("leaves an unstamped session alone", () => {
    expect(withoutFinishAttempt(validSession)).toBe(validSession);
  });

  it("rejects a stored session whose stamp is unusable", () => {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...validSession, endedAt: "later" })
    );

    expect(readStoredSession()).toBeNull();
  });

  it("still reads a pre-PR62 session that carries no stamp", () => {
    writeStoredSession(validSession);

    expect(readStoredSession()).toEqual(validSession);
  });
});

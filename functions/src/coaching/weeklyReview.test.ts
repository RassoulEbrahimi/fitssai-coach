import { describe, it, expect } from "vitest";
import { handleGenerateWeeklyReview, type WeeklyReviewDeps } from "./weeklyReview";
import {
  berlinDayNumber,
  mondayIndex,
  readPlanWeek,
  resolveReviewWeek,
} from "./weeklyReviewData";
import { fakeFirestore, FakeFirestore } from "../testing/fakeFirestore";
import { createFirestoreQuotaStore } from "../quota/firestoreQuotaStore";
import { DEFAULT_QUOTA_LIMITS } from "../quota";
import type { WeeklyReviewLogEntry } from "../logging/firestoreAiLogWriter";
import type { ProviderResult } from "./providers/gemini";

/*
  The weekly review is the surface where a model gets closest to a user's
  training. These tests exist mostly to pin down what it may not do: it may not
  write to a plan, it may not decide a category, it may not produce a metric,
  and it may not leave the user with nothing when the provider is down.
*/

const UID = "user-1";
const PLAN_ID = "plan-1";
/** A Wednesday, so the plan's Week 1 starts on the Monday before it. */
const PLAN_CREATED = new Date("2026-08-05T09:00:00Z");
/** Thursday of the plan's Week 2. */
const DURING_WEEK_2 = new Date("2026-08-13T18:00:00Z");

const trainingDay = () => ({ day: "Montag", exercises: [{ name: "Kniebeuge", sets: 3, reps: "8" }] });
const restDay = () => ({ day: "Dienstag", exercises: [] });

/** Monday, Wednesday and Friday are training days; the rest are rest days. */
const threeDayWeek = () =>
  Array.from({ length: 7 }, (_, index) => (index % 2 === 0 && index < 5 ? trainingDay() : restDay()));

const everyDayWeek = () => Array.from({ length: 7 }, () => trainingDay());

const planContent = (week: () => unknown[] = threeDayWeek) => ({
  "Week 1": week(),
  "Week 2": week(),
  "Week 3": week(),
  "Week 4": week(),
});

interface HarnessOptions {
  /** Completed plan positions, as `[weekKey, dayIndex]`. */
  completed?: Array<[string, number]>;
  durations?: Record<number, number | null>;
  content?: Record<string, unknown> | null;
  profile?: Record<string, unknown> | null;
  response?: unknown | Error;
  usedQuota?: number;
  /** Logs missing plan position, as legacy documents have. */
  legacyLogs?: number;
  /** Extra log documents, written verbatim. Exercise rows, junk, anything. */
  rawLogs?: Record<string, unknown>[];
  /** When the review runs. Defaults to a Thursday in Week 2. */
  at?: Date;
}

const harness = (options: HarnessOptions = {}) => {
  const db = fakeFirestore();
  const store = db as unknown as FakeFirestore;

  if (options.profile !== null) {
    store.docs.set(`users/${UID}`, options.profile ?? {
      fitnessGoal: "gainMuscle",
      experienceLevel: "intermediate",
      // Deliberately present, and deliberately never read.
      email: "someone@example.com",
      name: "Someone",
      weight: 82,
    });
  }

  if (options.content !== null) {
    store.docs.set(`users/${UID}/workout_plans/${PLAN_ID}`, {
      content: options.content ?? planContent(),
      createdAt: PLAN_CREATED,
    });
  }

  (options.completed ?? []).forEach(([weekKey, dayIndex], index) => {
    store.docs.set(`users/${UID}/workout_logs/log-${index}`, {
      planId: PLAN_ID,
      weekKey,
      dayIndex,
      completed: true,
      ...(options.durations?.[dayIndex] === undefined
        ? {}
        : { durationSec: options.durations[dayIndex] }),
    });
  });

  for (let index = 0; index < (options.legacyLogs ?? 0); index += 1) {
    store.docs.set(`users/${UID}/workout_logs/legacy-${index}`, {
      planId: PLAN_ID,
      workoutDay: "2026-08-12",
      completed: true,
    });
  }

  (options.rawLogs ?? []).forEach((log, index) => {
    store.docs.set(`users/${UID}/workout_logs/raw-${index}`, { planId: PLAN_ID, ...log });
  });

  const at = options.at ?? DURING_WEEK_2;
  const quota = createFirestoreQuotaStore({ firestore: db, now: () => at });
  const logs: WeeklyReviewLogEntry[] = [];
  const providerCalls: unknown[] = [];

  const deps: WeeklyReviewDeps = {
    firestore: db,
    quota,
    now: () => at,
    log: async (entry) => {
      logs.push(entry);
    },
    provider: {
      summariseWeeklyReviewWithUsage: async (input): Promise<ProviderResult> => {
        providerCalls.push(input);
        if (options.response instanceof Error) throw options.response;
        return { output: options.response, usage: { inputTokens: 120, outputTokens: 40 } };
      },
    },
  };

  const seed = async () => {
    for (let index = 0; index < (options.usedQuota ?? 0); index += 1) {
      await quota.increment(UID, "weekly_summary");
    }
  };

  return { db: store, deps, logs, providerCalls, seed };
};

const aiAnswer = (category: string) => ({
  category,
  headline: "Deine Woche",
  message: "Du hast einen Teil deiner geplanten Einheiten abgeschlossen und bist auf einem guten Weg.",
  reason: "Die Zahlen dieser Woche stammen aus deinen abgeschlossenen Trainingstagen.",
});

const run = async (options: HarnessOptions = {}) => {
  const h = harness(options);
  await h.seed();
  const result = await handleGenerateWeeklyReview({ auth: { uid: UID } }, h.deps);
  return { ...h, result };
};

describe("who may ask", () => {
  it("refuses an unauthenticated caller", async () => {
    const { deps } = harness();

    await expect(handleGenerateWeeklyReview({}, deps)).rejects.toThrow(/Authentication required/);
  });

  it("ignores a uid in the payload", async () => {
    const { deps } = harness({ completed: [["Week 2", 0]] });

    const result = await handleGenerateWeeklyReview(
      { auth: { uid: UID }, data: { uid: "somebody-else" } },
      deps
    );

    // Read under the token's uid, so the payload's uid changed nothing.
    expect(result.metrics.completedDays).toBe(1);
  });
});

describe("the week is placed by the plan, in Berlin time", () => {
  it("anchors Week 1 on the Monday of the plan's creation week", () => {
    // Created on a Wednesday; the Monday before it is day 0 of Week 1.
    expect(resolveReviewWeek(PLAN_CREATED, new Date("2026-08-03T22:30:00Z")).weekKey).toBe("Week 1");
    expect(resolveReviewWeek(PLAN_CREATED, DURING_WEEK_2).weekKey).toBe("Week 2");
    expect(resolveReviewWeek(PLAN_CREATED, DURING_WEEK_2).previousWeekKey).toBe("Week 1");
  });

  it("reads a late-evening UTC instant as the next Berlin day", () => {
    // 23:30 UTC on Sunday is 01:30 Monday in Berlin, i.e. already Week 2.
    expect(resolveReviewWeek(PLAN_CREATED, new Date("2026-08-09T23:30:00Z")).weekKey).toBe("Week 2");
    expect(resolveReviewWeek(PLAN_CREATED, new Date("2026-08-09T21:30:00Z")).weekKey).toBe("Week 1");
  });

  it("counts calendar days across a daylight-saving change", () => {
    // Europe/Berlin leaves summer time on 2026-10-25; the day either side of
    // it is still one day, not 23 or 25 hours.
    const before = berlinDayNumber(new Date("2026-10-24T12:00:00Z"));
    const after = berlinDayNumber(new Date("2026-10-26T12:00:00Z"));

    expect(after - before).toBe(2);
  });

  it("knows which epoch day is a Monday", () => {
    // 2026-08-03 was a Monday.
    expect(mondayIndex(berlinDayNumber(new Date("2026-08-03T10:00:00Z")))).toBe(0);
    expect(mondayIndex(berlinDayNumber(new Date("2026-08-09T10:00:00Z")))).toBe(6);
  });

  it("has no Week 5", () => {
    const past = resolveReviewWeek(PLAN_CREATED, new Date("2026-09-10T10:00:00Z"));

    expect(past.weekKey).toBeNull();
    expect(past.planFinished).toBe(true);
  });

  it("resolves nothing for a date before the plan starts", () => {
    const early = resolveReviewWeek(PLAN_CREATED, new Date("2026-07-20T10:00:00Z"));

    expect(early.weekKey).toBeNull();
    expect(early.planFinished).toBe(false);
  });
});

describe("A. no sessions completed", () => {
  it("reports a real 0 of 3 and asks for consistency", async () => {
    const { result } = await run({ response: aiAnswer("consistency") });

    expect(result.metrics.scheduledDays).toBe(3);
    expect(result.metrics.completedDays).toBe(0);
    expect(result.metrics.completionPercent).toBe(0);
    expect(result.recommendation.category).toBe("consistency");
  });

  it("changes nothing about the plan", async () => {
    const { db, result } = await run({ response: aiAnswer("consistency") });

    expect(db.docs.get(`users/${UID}/workout_plans/${PLAN_ID}`)?.content).toEqual(planContent());
    expect(result.aiStatus).toBe("ai");
  });
});

describe("B. two of three sessions completed", () => {
  it("reports 2 of 3 at 67 % and keeps the plan as it is", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });

    expect(result.metrics.completedDays).toBe(2);
    expect(result.metrics.missedDays).toBe(1);
    expect(result.metrics.completionPercent).toBe(67);
    expect(result.recommendation.category).toBe("maintain");
  });

  it("counts only the reviewed week's completions", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 1", 0], ["Week 1", 2], ["Week 1", 4]],
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.completedDays).toBe(1);
    expect(result.metrics.previousWeek).toEqual({ weekKey: "Week 1", completionPercent: 100 });
  });
});

describe("C. every session completed", () => {
  it("reports 100 % and does not escalate the plan by itself", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]],
      response: aiAnswer("maintain"),
    });

    expect(result.metrics.completionPercent).toBe(100);
    expect(result.metrics.missedDays).toBe(0);
    // One full week is not a trend, so the suggestion is to hold, not to add.
    expect(result.recommendation.category).toBe("maintain");
  });

  it("stays on maintain after a second full week rather than escalating", async () => {
    const { db, result, providerCalls } = await run({
      completed: [
        ["Week 2", 0], ["Week 2", 2], ["Week 2", 4],
        ["Week 1", 0], ["Week 1", 2], ["Week 1", 4],
      ],
      response: aiAnswer("maintain"),
    });

    /*
      Two full weeks is adherence, not readiness. The app records no effort, no
      fatigue and no recovery, so "train more" would be a verdict on a body it
      has never measured. The wording angle changes; the conclusion does not.
    */
    expect(result.recommendation.category).toBe("maintain");
    expect((providerCalls[0] as { focus: string }).focus).toBe("week-complete-repeat");
    expect(db.docs.get(`users/${UID}/workout_plans/${PLAN_ID}`)?.content).toEqual(planContent());
  });

  it("names a seven-day plan as dense, without a claim about the person", async () => {
    const { result } = await run({
      content: planContent(everyDayWeek),
      completed: [0, 1, 2, 3, 4, 5, 6].map((day) => ["Week 2", day] as [string, number]),
      response: aiAnswer("dense-schedule"),
    });

    expect(result.metrics.scheduledDays).toBe(7);
    expect(result.recommendation.category).toBe("dense-schedule");
  });
});

describe("D. duration is never invented", () => {
  it("reports no duration at all when none was measured", async () => {
    const { result, providerCalls } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });

    expect(result.metrics.measuredDurationSec).toBeNull();
    expect(result.metrics.durationCoverage).toBe("none");
    // Nothing about time reaches the model either, so it cannot mention one.
    expect(providerCalls[0]).not.toHaveProperty("measuredDurationMinutes");
    expect(result.recommendation.reason).not.toMatch(/Min\.|Std\./);
  });

  it("marks a partly measured week as partial rather than complete", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      durations: { 0: 2700, 2: null },
      response: aiAnswer("maintain"),
    });

    expect(result.metrics.measuredDurationSec).toBe(2700);
    expect(result.metrics.durationCoverage).toBe("partial");
  });
});

describe("B2. every completion ratio, end to end", () => {
  /*
    The same states the shared rules are tested against, but travelling the
    whole path: Firestore documents in, metrics and a recommendation out. What
    is checked is that nothing between the two invents, rounds away or loses a
    session.
  */

  const ratios: ReadonlyArray<{
    label: string;
    completed: Array<[string, number]>;
    completedDays: number;
    percent: number;
    category: string;
    focus: string;
  }> = [
    /*
      Week 1 is untouched in this fixture, so a second low week is exactly what
      the rules see — and `schedule-fit` is the wording that goes with it: a
      question about whether the plan fits the person's week, never a verdict
      that they trained too much.
    */
    { label: "1 of 3", completed: [["Week 2", 0]], completedDays: 1, percent: 33, category: "consistency", focus: "schedule-fit" },
    { label: "2 of 3", completed: [["Week 2", 0], ["Week 2", 2]], completedDays: 2, percent: 67, category: "maintain", focus: "on-track" },
    { label: "3 of 3", completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]], completedDays: 3, percent: 100, category: "maintain", focus: "week-complete" },
  ];

  ratios.forEach((ratio) => {
    it(`reports ${ratio.label} exactly, and advises without prescribing`, async () => {
      const { result, providerCalls } = await run({ completed: ratio.completed });

      expect(result.metrics.completedDays).toBe(ratio.completedDays);
      expect(result.metrics.scheduledDays).toBe(3);
      expect(result.metrics.completionPercent).toBe(ratio.percent);
      expect(result.recommendation.category).toBe(ratio.category);
      // The model is asked to phrase the conclusion the rules already reached.
      expect(providerCalls[0]).toMatchObject({
        completedDays: ratio.completedDays,
        completionPercent: ratio.percent,
        category: ratio.category,
        focus: ratio.focus,
      });
    });
  });

  it("reports 1 of 3 after a strong week as catch-up, not as a schedule problem", async () => {
    const { result, providerCalls } = await run({
      completed: [["Week 1", 0], ["Week 1", 2], ["Week 1", 4], ["Week 2", 0]],
    });

    expect(result.metrics.completionPercent).toBe(33);
    expect(providerCalls[0]).toMatchObject({ focus: "catch-up", category: "consistency" });
    // One quiet week is not evidence the plan is wrong, and is not read as it.
    expect(result.recommendation.message).toMatch(/entscheidest du/);
  });

  it("reports 3 of 4 as on track, on a four-day week", async () => {
    const fourDayWeek = () =>
      Array.from({ length: 7 }, (_, index) => (index < 4 ? trainingDay() : restDay()));
    const { result } = await run({
      content: planContent(fourDayWeek),
      completed: [["Week 2", 0], ["Week 2", 1], ["Week 2", 2]],
    });

    expect(result.metrics).toMatchObject({
      scheduledDays: 4,
      completedDays: 3,
      missedDays: 1,
      completionPercent: 75,
    });
    expect(result.recommendation.category).toBe("maintain");
  });

  it("keeps two full weeks running on maintain", async () => {
    const { result, providerCalls } = await run({
      completed: [
        ["Week 1", 0], ["Week 1", 2], ["Week 1", 4],
        ["Week 2", 0], ["Week 2", 2], ["Week 2", 4],
      ],
    });

    expect(result.metrics.completionPercent).toBe(100);
    expect(result.metrics.previousWeek).toEqual({ weekKey: "Week 1", completionPercent: 100 });
    expect(result.recommendation.category).toBe("maintain");
    expect(providerCalls[0]).toMatchObject({ focus: "week-complete-repeat" });
    // Progression appears as the reader's own decision or not at all.
    expect(result.recommendation.message).toMatch(/kannst du selbst entscheiden/);
  });
});

describe("B3. weeks do not bleed into each other", () => {
  /*
    The failure this guards against is silent: a review that counts last week's
    sessions as this week's is still a plausible-looking screen. The plan is
    anchored on the Monday of its creation week, so these dates are chosen to
    sit either side of a real boundary.
  */

  /** Sunday of Week 1, and the Monday of Week 2 one day later. */
  const SUNDAY_WEEK_1 = new Date("2026-08-09T18:00:00Z");
  const MONDAY_WEEK_2 = new Date("2026-08-10T07:00:00Z");

  const bothWeeks: Array<[string, number]> = [
    ["Week 1", 0], ["Week 1", 2], ["Week 1", 4],
    ["Week 2", 0],
  ];

  it("reads Sunday as the end of Week 1", async () => {
    const { result } = await run({ completed: bothWeeks, at: SUNDAY_WEEK_1 });

    expect(result.metrics.weekKey).toBe("Week 1");
    expect(result.metrics.completedDays).toBe(3);
    // Week 2's single completion is not in this week's numbers.
    expect(result.metrics.completionPercent).toBe(100);
    expect(result.metrics.previousWeek).toBeNull();
  });

  it("reads the next morning as the start of Week 2", async () => {
    const { result } = await run({ completed: bothWeeks, at: MONDAY_WEEK_2 });

    expect(result.metrics.weekKey).toBe("Week 2");
    // One day into the new week: one of three, not four of six.
    expect(result.metrics.completedDays).toBe(1);
    expect(result.metrics.completionPercent).toBe(33);
  });

  it("keeps the finished week available as history, not as this week", async () => {
    const { result } = await run({ completed: bothWeeks, at: MONDAY_WEEK_2 });

    expect(result.metrics.previousWeek).toEqual({ weekKey: "Week 1", completionPercent: 100 });
    // History shapes the wording; it never joins the current week's fraction.
    expect(result.metrics.completedDays).toBe(1);
  });

  it("starts a fresh week at zero rather than carrying anything over", async () => {
    const { result } = await run({
      completed: [["Week 1", 0], ["Week 1", 2], ["Week 1", 4]],
      at: MONDAY_WEEK_2,
    });

    expect(result.metrics).toMatchObject({
      weekKey: "Week 2",
      completedDays: 0,
      completionPercent: 0,
      measuredDurationSec: null,
    });
    expect(result.recommendation.category).toBe("consistency");
  });

  it("reviews a historical week without inventing a current one", async () => {
    // Thursday of Week 4, with Week 3 completed and Week 4 untouched.
    const { result } = await run({
      completed: [["Week 3", 0], ["Week 3", 2], ["Week 3", 4]],
      at: new Date("2026-08-27T18:00:00Z"),
    });

    expect(result.metrics.weekKey).toBe("Week 4");
    expect(result.metrics.completedDays).toBe(0);
    expect(result.metrics.previousWeek).toEqual({ weekKey: "Week 3", completionPercent: 100 });
  });

  it("stops rather than wrapping once the four weeks are over", async () => {
    const { result, providerCalls } = await run({
      completed: [["Week 4", 0], ["Week 4", 2], ["Week 4", 4]],
      at: new Date("2026-09-01T09:00:00Z"),
    });

    // Not Week 5, and above all not Week 1 with a month-old set of logs.
    expect(result.metrics.hasPlan).toBe(false);
    expect(result.planFinished).toBe(true);
    expect(result.aiStatus).toBe("not_applicable");
    // Nothing to phrase means nothing to pay for.
    expect(providerCalls).toHaveLength(0);
  });
});

describe("D2. a week is measured in sessions, not in log rows", () => {
  /*
    Production writes one day document per training day and one document per
    exercise. Counting rows made a fully timed week call its own total a floor
    — a small untruth on a screen whose entire promise is that it does not tell
    small untruths.
  */

  /** Four exercise rows per completed day, as ticking sets produces. */
  const exerciseRows = (weekKey: string, dayIndexes: number[]) =>
    dayIndexes.flatMap((dayIndex) =>
      Array.from({ length: 4 }, (_, exerciseIndex) => ({
        weekKey,
        dayIndex,
        exerciseIndex,
        completed: true,
      }))
    );

  it("calls a fully timed week full despite a dozen exercise rows", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]],
      durations: { 0: 3600, 2: 2700, 4: 3300 },
      rawLogs: exerciseRows("Week 2", [0, 2, 4]),
    });

    expect(result.metrics.measuredSessionCount).toBe(3);
    expect(result.metrics.unmeasuredSessionCount).toBe(0);
    expect(result.metrics.durationCoverage).toBe("full");
    expect(result.metrics.measuredDurationSec).toBe(9600);
    expect(result.recommendation.reason).not.toMatch(/mindestens/);
  });

  it("tells the model the coverage, not just the minutes", async () => {
    const { providerCalls } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      durations: { 0: 3600 },
      rawLogs: exerciseRows("Week 2", [0, 2]),
    });

    expect(providerCalls[0]).toMatchObject({
      measuredDurationMinutes: 60,
      measuredSessionCount: 1,
      durationCoverage: "partial",
    });
  });

  it("sends no duration at all when nothing was measured", async () => {
    const { providerCalls } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      rawLogs: exerciseRows("Week 2", [0, 2]),
    });

    const input = providerCalls[0] as Record<string, unknown>;
    expect(input.measuredDurationMinutes).toBeUndefined();
    expect(input.durationCoverage).toBeUndefined();
  });

  it("discards a malformed legacy duration instead of counting it", async () => {
    const { result } = await run({
      completed: [["Week 2", 0]],
      rawLogs: [
        { weekKey: "Week 2", dayIndex: 2, completed: true, durationSec: "2700" },
        { weekKey: "Week 2", dayIndex: 4, completed: true, durationSec: -60 },
        { weekKey: "Week 2", dayIndex: 4, completed: true, durationSec: 20 * 60 * 60 },
      ],
    });

    // Three completed days, none of them with a duration this app will state.
    expect(result.metrics.completedDays).toBe(3);
    expect(result.metrics.measuredDurationSec).toBeNull();
    expect(result.metrics.durationCoverage).toBe("none");
    expect(result.recommendation.reason).not.toMatch(/Trainingszeit/);
  });
});

describe("E. the provider is not the review", () => {
  it("still reports the metrics when the provider throws", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: new Error("upstream is down"),
    });

    expect(result.ok).toBe(true);
    expect(result.metrics.completionPercent).toBe(67);
    expect(result.recommendation.source).toBe("deterministic");
    expect(result.aiStatus).toBe("unavailable");
  });

  it("refunds the reservation when nothing was delivered", async () => {
    const { deps, result } = await run({
      completed: [["Week 2", 0]],
      response: new Error("upstream is down"),
    });

    expect(await deps.quota.getUsage(UID, "weekly_summary")).toBe(0);
    expect(result.quota.remaining).toBe(DEFAULT_QUOTA_LIMITS.weekly_summary);
  });

  it("shows its own words rather than a model's malformed ones", async () => {
    const { result, logs } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: { headline: "Hi" },
    });

    expect(result.recommendation.source).toBe("deterministic");
    expect(result.recommendation.headline).not.toBe("Hi");
    expect(logs[0]).toMatchObject({ errorCategory: "invalid_output", rejection: "schema" });
  });

  it("refuses a model that disagrees with the rules about the category", async () => {
    const { result, logs } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("consistency"),
    });

    // The rules said "maintain"; a model does not get to overrule them.
    expect(result.recommendation.category).toBe("maintain");
    expect(result.recommendation.source).toBe("deterministic");
    expect(logs[0].rejection).toBe("category-mismatch");
  });

  it("refuses wording that prescribes plan content", async () => {
    const { result, logs } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: {
        ...aiAnswer("maintain"),
        message: "Nächste Woche machst du 5 Sätze mit 90 kg, dein Plan wurde entsprechend angepasst.",
      },
    });

    expect(result.recommendation.source).toBe("deterministic");
    expect(logs[0].rejection).toBe("unsafe-text");
  });

  it("marks a model's accepted wording as the model's", async () => {
    const { result } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });

    expect(result.recommendation.source).toBe("ai");
    expect(result.recommendation.headline).toBe("Deine Woche");
    expect(result.aiStatus).toBe("ai");
  });
});

describe("E2. unsupported claims never reach the screen", () => {
  /*
    The prompt forbids these. This is the layer that assumes it did not work —
    because a prompt is an instruction and a guard is a guarantee, and the
    difference matters most in exactly the state that most invites the claim:
    a completed week, twice running, with a model asked to sound encouraging.

    In every case the user still gets a review. The wording falls back to the
    app's own, the reservation is refunded because nothing was delivered, and
    the log records which rule tripped rather than the sentence that tripped it.
  */

  const fullWeek: Array<[string, number]> = [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]];

  const unsafe = (message: string) => ({
    category: "maintain",
    headline: "Starke Woche",
    message,
    reason: "3 von 3 Trainingstagen abgeschlossen (100 %).",
  });

  const cases: ReadonlyArray<{ label: string; message: string }> = [
    {
      label: "a readiness claim",
      message: "Du hast alle Einheiten geschafft — du bist bereit für mehr Umfang.",
    },
    {
      label: "a progression instruction",
      message: "Starke Woche. Steigere im nächsten Block dein Trainingsvolumen.",
    },
    {
      label: "a recovery claim",
      message: "Starke Woche. Achte jetzt auf ausreichend Regeneration, dein Körper braucht das.",
    },
    {
      label: "a fatigue reading",
      message: "Starke Woche, auch wenn du nach so viel Training sicher erschöpft bist.",
    },
    {
      label: "a claim that the plan changed",
      message: "Weil du alles geschafft hast, wurde dein Plan automatisch angepasst.",
    },
  ];

  cases.forEach(({ label, message }) => {
    it(`rejects ${label} and shows the app's own wording instead`, async () => {
      const { result, logs } = await run({ completed: fullWeek, response: unsafe(message) });

      expect(result.recommendation.source).toBe("deterministic");
      expect(result.aiStatus).toBe("unavailable");
      expect(result.recommendation.message).not.toBe(message);
      expect(logs[0]).toMatchObject({ status: "error", errorCategory: "invalid_output", rejection: "unsafe-text" });
    });

    it(`does not charge the user for ${label}`, async () => {
      const { deps, result } = await run({ completed: fullWeek, response: unsafe(message) });

      // Reserved before the call, released after the refusal: the user is not
      // billed a unit of their monthly budget for a sentence they never saw.
      expect(await deps.quota.getUsage(UID, "weekly_summary")).toBe(0);
      expect(result.quota.remaining).toBe(DEFAULT_QUOTA_LIMITS.weekly_summary);
    });
  });

  it("keeps the numbers intact when the wording is refused", async () => {
    const { result } = await run({
      completed: fullWeek,
      response: unsafe("Du bist bereit für mehr."),
    });

    // The metrics were computed before the call and are unaffected by it.
    expect(result.metrics).toMatchObject({ completedDays: 3, scheduledDays: 3, completionPercent: 100 });
  });

  it("logs which rule tripped, never the sentence that tripped it", async () => {
    const message = "Du bist bereit für mehr Umfang.";
    const { logs } = await run({ completed: fullWeek, response: unsafe(message) });

    expect(JSON.stringify(logs)).not.toContain(message);
    expect(JSON.stringify(logs)).not.toContain("bereit");
  });
});

describe("F. a review never touches a workout plan", () => {
  const cases: Array<[string, HarnessOptions]> = [
    ["with a model answer", { completed: [["Week 2", 0]], response: aiAnswer("consistency") }],
    ["with a provider outage", { completed: [["Week 2", 0]], response: new Error("down") }],
    ["with refused wording", { completed: [["Week 2", 0]], response: { nonsense: true } }],
    ["with the quota exhausted", { usedQuota: DEFAULT_QUOTA_LIMITS.weekly_summary }],
    ["with no plan at all", { content: null }],
    ["with a full week", {
      completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]],
      response: aiAnswer("maintain"),
    }],
    /*
      The states this PR added. Two full weeks running is the one a plan-
      adjusting product would act on, and a seven-day plan is the one a
      well-meaning one would "fix" — so both are pinned here, alongside the
      partial states and the two sides of a week boundary.
    */
    ["with a partly completed week", {
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    }],
    ["with two full weeks running", {
      completed: [
        ["Week 1", 0], ["Week 1", 2], ["Week 1", 4],
        ["Week 2", 0], ["Week 2", 2], ["Week 2", 4],
      ],
      response: aiAnswer("maintain"),
    }],
    ["with a seven-day plan fully completed", {
      content: planContent(everyDayWeek),
      completed: [0, 1, 2, 3, 4, 5, 6].map((day) => ["Week 2", day] as [string, number]),
      response: aiAnswer("dense-schedule"),
    }],
    ["on the last day of Week 1", {
      completed: [["Week 1", 0], ["Week 1", 2], ["Week 1", 4]],
      at: new Date("2026-08-09T18:00:00Z"),
    }],
    ["on the first day of Week 2", {
      completed: [["Week 1", 0], ["Week 1", 2], ["Week 1", 4]],
      at: new Date("2026-08-10T07:00:00Z"),
    }],
    ["after the four weeks are over", {
      completed: [["Week 4", 0]],
      at: new Date("2026-09-01T09:00:00Z"),
    }],
    ["with a model trying to prescribe progression", {
      completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]],
      response: {
        category: "maintain",
        headline: "Starke Woche",
        message: "Du bist bereit für mehr — steigere dein Volumen im nächsten Block.",
        reason: "3 von 3 Trainingstagen abgeschlossen.",
      },
    }],
  ];

  it.each(cases)("writes nothing under workout_plans %s", async (_label, options) => {
    const before = harness(options);
    await before.seed();
    const snapshot = new Map(before.db.docs);

    await handleGenerateWeeklyReview({ auth: { uid: UID } }, before.deps);

    const plansBefore = [...snapshot.keys()].filter((path) => path.includes("workout_plans"));
    const plansAfter = before.db.under(`users/${UID}/workout_plans`);

    // No plan document changed, and none appeared or disappeared.
    plansAfter.forEach(([path, data]) => expect(data).toEqual(snapshot.get(path)));
    expect(plansAfter.map(([path]) => path).sort()).toEqual(plansBefore.sort());
  });

  it("writes nothing under the user's documents at all", async () => {
    const before = harness({ completed: [["Week 2", 0]], response: aiAnswer("consistency") });
    const snapshot = new Map(before.db.docs);

    await handleGenerateWeeklyReview({ auth: { uid: UID } }, before.deps);

    const userDocs = [...before.db.docs.entries()].filter(([path]) => path.startsWith("users/"));
    userDocs.forEach(([path, data]) => expect(data).toEqual(snapshot.get(path)));
    expect(userDocs.length).toBe(snapshot.size);
  });

  it("returns no plan content, so a client has nothing to write back", async () => {
    const { result } = await run({ completed: [["Week 2", 0]], response: aiAnswer("consistency") });
    const serialised = JSON.stringify(result);

    expect(serialised).not.toMatch(/exercises|sets|reps|Kniebeuge|Week 1"\s*:/);
    expect(Object.keys(result.recommendation).sort()).toEqual([
      "category",
      "headline",
      "message",
      "reason",
      "source",
    ]);
  });
});

describe("quota is separate, and never blocks the review", () => {
  it("spends the weekly budget, not the plan budget", async () => {
    const { deps } = await run({ completed: [["Week 2", 0]], response: aiAnswer("consistency") });

    expect(await deps.quota.getUsage(UID, "weekly_summary")).toBe(1);
    expect(await deps.quota.getUsage(UID, "plan_generation")).toBe(0);
  });

  it("still answers when the weekly budget is gone", async () => {
    const { result, providerCalls, logs } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      usedQuota: DEFAULT_QUOTA_LIMITS.weekly_summary,
      response: aiAnswer("maintain"),
    });

    expect(providerCalls).toEqual([]);
    expect(result.aiStatus).toBe("quota_exceeded");
    expect(result.metrics.completionPercent).toBe(67);
    expect(result.recommendation.source).toBe("deterministic");
    expect(logs[0].errorCategory).toBe("quota_exceeded");
  });
});

describe("edge cases that must not crash", () => {
  it("answers for a user with no plan", async () => {
    const { result, providerCalls } = await run({ content: null });

    expect(result.metrics.hasPlan).toBe(false);
    expect(result.recommendation.category).toBe("consistency");
    expect(result.aiStatus).toBe("not_applicable");
    // Nothing to explain, so nothing is paid for.
    expect(providerCalls).toEqual([]);
  });

  it("answers for a plan whose four weeks are over", async () => {
    const h = harness({ response: aiAnswer("consistency") });
    const deps = { ...h.deps, now: () => new Date("2026-09-20T10:00:00Z") };

    const result = await handleGenerateWeeklyReview({ auth: { uid: UID } }, deps);

    expect(result.planFinished).toBe(true);
    expect(result.metrics.hasPlan).toBe(false);
    expect(result.aiStatus).toBe("not_applicable");
  });

  it("answers for a plan with no profile document", async () => {
    const { result } = await run({
      profile: null,
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });

    expect(result.metrics.completionPercent).toBe(67);
    expect(result.aiStatus).toBe("ai");
  });

  it("treats a malformed week as rest days rather than failing", async () => {
    const { result } = await run({
      content: { "Week 2": "not a week" },
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.scheduledDays).toBe(0);
    expect(result.metrics.completionPercent).toBeNull();
    expect(result.aiStatus).toBe("not_applicable");
  });

  it("reads the lowercase week key form too", () => {
    const days = readPlanWeek({ week2: threeDayWeek() }, "Week 2");

    expect(days.filter((day) => day.exerciseCount > 0)).toHaveLength(3);
  });

  it("reads a week stored as an object rather than an array", () => {
    const days = readPlanWeek({ "Week 2": { ...threeDayWeek() } }, "Week 2");

    expect(days.filter((day) => day.exerciseCount > 0)).toHaveLength(3);
  });

  it("ignores a legacy log that carries no plan position", async () => {
    const { result } = await run({
      completed: [["Week 2", 0]],
      legacyLogs: 2,
      response: aiAnswer("consistency"),
    });

    // A log whose only anchor is a possibly mis-derived date is not counted as
    // a completion — a lower bound is better than a confident wrong number.
    expect(result.metrics.completedDays).toBe(1);
  });
});

describe("what is logged, and what is not", () => {
  it("records the action, the outcome and the category — never the wording", async () => {
    const { logs } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      uid: UID,
      action: "weekly_summary",
      status: "success",
      providerCalled: true,
      category: "maintain",
      inputTokens: 120,
      outputTokens: 40,
    });
    expect(JSON.stringify(logs[0])).not.toMatch(/Deine Woche|abgeschlossen|@example/);
  });

  it("does not bill the plan-generation action", async () => {
    const { logs } = await run({ completed: [["Week 2", 0]], response: aiAnswer("consistency") });

    expect(logs.every((entry) => entry.action === "weekly_summary")).toBe(true);
  });
});

describe("what the model is told", () => {
  it("receives the computed numbers and the chosen category", async () => {
    const { providerCalls } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      durations: { 0: 2700, 2: 2700 },
      response: aiAnswer("maintain"),
    });

    expect(providerCalls[0]).toEqual({
      weekNumber: 2,
      scheduledDays: 3,
      completedDays: 2,
      missedDays: 1,
      completionPercent: 67,
      durationCoverage: "full",
      measuredDurationMinutes: 90,
      measuredSessionCount: 2,
      previousWeekCompletionPercent: 0,
      goal: "gainMuscle",
      experienceLevel: "intermediate",
      category: "maintain",
      focus: "on-track",
    });
  });

  it("is told nothing about effort, fatigue, recovery or why a session was missed", async () => {
    const { providerCalls } = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      response: aiAnswer("maintain"),
    });
    const keys = Object.keys(providerCalls[0] as object).join(" ");

    // None of it is persisted, so none of it can be sent — and a model that
    // cannot see a fatigue field cannot reason from one.
    expect(keys).not.toMatch(/rpe|effort|fatigue|recovery|sleep|readiness|soreness|reason/i);
  });

  it("receives nothing that identifies the person", async () => {
    const { providerCalls } = await run({
      completed: [["Week 2", 0]],
      response: aiAnswer("consistency"),
    });
    const sent = JSON.stringify(providerCalls[0]);

    expect(sent).not.toMatch(/@|Someone|user-1|82/);
    expect(Object.keys(providerCalls[0] as object)).toEqual(
      expect.not.arrayContaining(["uid", "email", "name", "weight", "height"])
    );
  });
});

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
  /**
   * Exercise-position rows, as `[weekKey, dayIndex, exerciseIndex]`.
   *
   * These carry `completed: true` and the same `weekKey` + `dayIndex` a day
   * session does — which is exactly why they used to be counted as finished
   * training days.
   */
  completedExercises?: Array<[string, number, number]>;
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

  (options.completedExercises ?? []).forEach(([weekKey, dayIndex, exerciseIndex], index) => {
    store.docs.set(`users/${UID}/workout_logs/exercise-${index}`, {
      planId: PLAN_ID,
      weekKey,
      dayIndex,
      exerciseIndex,
      completed: true,
    });
  });

  for (let index = 0; index < (options.legacyLogs ?? 0); index += 1) {
    store.docs.set(`users/${UID}/workout_logs/legacy-${index}`, {
      planId: PLAN_ID,
      workoutDay: "2026-08-12",
      completed: true,
    });
  }

  const quota = createFirestoreQuotaStore({ firestore: db, now: () => DURING_WEEK_2 });
  const logs: WeeklyReviewLogEntry[] = [];
  const providerCalls: unknown[] = [];

  const deps: WeeklyReviewDeps = {
    firestore: db,
    quota,
    now: () => DURING_WEEK_2,
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

describe("only a day session completes a training day", () => {
  /*
    `users/{uid}/workout_logs` holds day sessions and exercise positions in one
    collection, and both carry weekKey, dayIndex and completed. The review used
    to read those three fields alone, so ticking one exercise reported the
    whole training day as done — and the dashboard, which reads the day record,
    disagreed with it on the same data.
  */

  it("does not complete a day from one ticked exercise", async () => {
    const { result } = await run({
      completedExercises: [["Week 2", 0, 0]],
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.completedDays).toBe(0);
    expect(result.metrics.completionPercent).toBe(0);
  });

  it("does not complete a day from every exercise of that day", async () => {
    const { result } = await run({
      completedExercises: [0, 1, 2, 3, 4].map(
        (exerciseIndex) => ["Week 2", 0, exerciseIndex] as [string, number, number]
      ),
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.completedDays).toBe(0);
    expect(result.metrics.missedDays).toBe(3);
  });

  it("counts a completed day once, however many exercise rows sit on it", async () => {
    const { result } = await run({
      completed: [["Week 2", 0]],
      completedExercises: [0, 1, 2, 3].map(
        (exerciseIndex) => ["Week 2", 0, exerciseIndex] as [string, number, number]
      ),
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.completedDays).toBe(1);
    expect(result.metrics.completionPercent).toBe(33);
  });

  it("counts exercise rows as neither measured nor unmeasured sessions", async () => {
    const { result } = await run({
      completed: [["Week 2", 0]],
      completedExercises: [0, 1, 2, 3].map(
        (exerciseIndex) => ["Week 2", 0, exerciseIndex] as [string, number, number]
      ),
      response: aiAnswer("consistency"),
    });

    // One training day was done, so there is one session — not five.
    expect(result.metrics.measuredSessionCount + result.metrics.unmeasuredSessionCount).toBe(1);
  });

  it("reads a three-day week as 1/3, 2/3 and 3/3 from true sessions only", async () => {
    const noise: Array<[string, number, number]> = [0, 1, 2].map((exerciseIndex) => [
      "Week 2",
      4,
      exerciseIndex,
    ]);

    const one = await run({
      completed: [["Week 2", 0]],
      completedExercises: noise,
      response: aiAnswer("consistency"),
    });
    const two = await run({
      completed: [["Week 2", 0], ["Week 2", 2]],
      completedExercises: noise,
      response: aiAnswer("maintain"),
    });
    const three = await run({
      completed: [["Week 2", 0], ["Week 2", 2], ["Week 2", 4]],
      completedExercises: noise,
      response: aiAnswer("maintain"),
    });

    expect(one.result.metrics.completedDays).toBe(1);
    expect(two.result.metrics.completedDays).toBe(2);
    expect(three.result.metrics.completedDays).toBe(3);
    expect(three.result.metrics.completionPercent).toBe(100);
  });

  it("still refuses a legacy row that carries neither position nor exercise", async () => {
    const { result } = await run({
      legacyLogs: 3,
      response: aiAnswer("consistency"),
    });

    expect(result.metrics.completedDays).toBe(0);
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

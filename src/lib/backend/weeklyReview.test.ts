import { describe, it, expect } from "vitest";
import {
  WeeklyReviewError,
  readWeeklyReviewResponse,
  toWeeklyReviewError,
} from "./weeklyReview";
import { computeWeeklyReviewMetrics } from "@shared/weeklyRecommendation";

/*
  The client trusts its own backend, but not blindly: this is the last gate
  before a sentence reaches a user, and the cost of a second check is nothing.
*/

const metrics = () =>
  computeWeeklyReviewMetrics({
    weekKey: "Week 2",
    weekNumber: 2,
    hasPlan: true,
    planDays: [
      { dayIndex: 0, exerciseCount: 3 },
      { dayIndex: 1, exerciseCount: 0 },
      { dayIndex: 2, exerciseCount: 3 },
      { dayIndex: 3, exerciseCount: 0 },
      { dayIndex: 4, exerciseCount: 3 },
      { dayIndex: 5, exerciseCount: 0 },
      { dayIndex: 6, exerciseCount: 0 },
    ],
    completions: [{ weekKey: "Week 2", dayIndex: 0, completed: true }],
    weekLogs: [],
  });

const response = (recommendation: Record<string, unknown>) => ({
  ok: true,
  metrics: metrics(),
  recommendation,
  aiStatus: "ai",
  quota: { remaining: 7, limit: 8, period: "2026-09" },
  planFinished: false,
});

const good = {
  category: "consistency",
  headline: "Regelmäßigkeit zuerst",
  message: "Eine von drei Einheiten ist abgeschlossen. Hol die offenen Einheiten in Ruhe nach.",
  reason: "Eine abgeschlossene Einheit von drei geplanten.",
  source: "ai",
};

describe("reading the response", () => {
  it("accepts a well-formed review", () => {
    expect(readWeeklyReviewResponse(response(good)).recommendation.headline).toBe(
      "Regelmäßigkeit zuerst"
    );
  });

  it.each([
    ["nothing", undefined],
    ["a string", "alles gut"],
    ["a response that is not ok", { ...response(good), ok: false }],
    ["a review with no metrics", { ...response(good), metrics: undefined }],
    ["an unknown category", response({ ...good, category: "vibes" })],
    ["a missing message", response({ ...good, message: undefined })],
    ["an unknown source", response({ ...good, source: "guessed" })],
  ])("refuses %s", (_label, payload) => {
    expect(() => readWeeklyReviewResponse(payload)).toThrow(WeeklyReviewError);
  });

  it.each([
    ["a medical claim", "Das deutet auf Übertraining hin, geh bitte zum Arzt."],
    ["a nutrition tip", "Nimm mehr Protein zu dir und achte auf deine Kalorien."],
    ["a plan-change claim", "Dein Plan wurde automatisch für dich angepasst."],
    ["prescribed plan content", "Mach kommende Woche 5 Sätze mit 60 kg."],
  ])("refuses %s even from our own backend", (_label, message) => {
    // Defence in depth: one missed case on the server must not be the only
    // thing between a model and a user.
    expect(() => readWeeklyReviewResponse(response({ ...good, message }))).toThrow(
      WeeklyReviewError
    );
  });
});

describe("mapping a failure", () => {
  it("names an unauthenticated caller", () => {
    expect(toWeeklyReviewError({ code: "functions/unauthenticated" }).code).toBe("UNAUTHENTICATED");
  });

  it("turns anything else into UNAVAILABLE rather than showing it", () => {
    // A callable error carries a function name, a region and a request id.
    expect(toWeeklyReviewError(new Error("europe-west3/generateWeeklyReview failed")).code).toBe(
      "UNAVAILABLE"
    );
    expect(toWeeklyReviewError(undefined).code).toBe("UNAVAILABLE");
  });
});

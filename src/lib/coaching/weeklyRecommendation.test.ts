import { describe, it, expect } from "vitest";
import {
  LOW_COMPLETION_PERCENT,
  computeWeeklyReviewMetrics,
  describeRecommendation,
  findUnsafeRecommendationText,
  formatDurationDe,
  recommendCategory,
  usableDurationSec,
  validateModelRecommendation,
  weeklyRecommendationResponseSchema,
  type ReviewCompletion,
  type ReviewPlanDay,
  type WeeklyReviewMetricsInput,
} from "@shared/weeklyRecommendation";
import { computeDurationCoverage } from "./facts";

/*
  The weekly review is the one surface that turns a user's logged week into
  advice, so what these tests protect is that the advice never says more than
  the records support — and that it never claims a plan was changed, because
  nothing in this feature changes one.
*/

const threeDayWeek: readonly ReviewPlanDay[] = [
  { dayIndex: 0, exerciseCount: 4 },
  { dayIndex: 1, exerciseCount: 0 },
  { dayIndex: 2, exerciseCount: 5 },
  { dayIndex: 3, exerciseCount: 0 },
  { dayIndex: 4, exerciseCount: 4 },
  { dayIndex: 5, exerciseCount: 0 },
  { dayIndex: 6, exerciseCount: 0 },
];

const everyDayWeek: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
  dayIndex,
  exerciseCount: 3,
}));

const done = (weekKey: string, days: number[]): ReviewCompletion[] =>
  days.map((dayIndex) => ({ weekKey, dayIndex, completed: true }));

const metrics = (over: Partial<WeeklyReviewMetricsInput> = {}) =>
  computeWeeklyReviewMetrics({
    weekKey: "Week 2",
    weekNumber: 2,
    hasPlan: true,
    planDays: threeDayWeek,
    completions: [],
    weekLogs: [],
    ...over,
  });

describe("metrics are arithmetic over logged records", () => {
  it("counts 0 of 3 as a real zero, not as missing data", () => {
    const result = metrics();

    expect(result.scheduledDays).toBe(3);
    expect(result.completedDays).toBe(0);
    expect(result.missedDays).toBe(3);
    expect(result.completionPercent).toBe(0);
  });

  it("counts 2 of 3 at 67 %", () => {
    const result = metrics({ completions: done("Week 2", [0, 2]) });

    expect(result.completedDays).toBe(2);
    expect(result.missedDays).toBe(1);
    expect(result.completionPercent).toBe(67);
  });

  it("counts 3 of 3 at 100 %", () => {
    const result = metrics({ completions: done("Week 2", [0, 2, 4]) });

    expect(result.completedDays).toBe(3);
    expect(result.missedDays).toBe(0);
    expect(result.completionPercent).toBe(100);
  });

  it("excludes rest days from both sides of the fraction", () => {
    // Seven calendar days, three of them training days.
    expect(metrics().scheduledDays).toBe(3);
  });

  it("reports no percentage at all when nothing is scheduled", () => {
    // 0 of 0 is not 0 % — it is a week the plan says nothing about.
    expect(metrics({ planDays: [] }).completionPercent).toBeNull();
  });

  it("ignores a completion belonging to another week", () => {
    expect(metrics({ completions: done("Week 3", [0, 2, 4]) }).completedDays).toBe(0);
  });

  it("ignores a completion flagged false", () => {
    const result = metrics({
      completions: [{ weekKey: "Week 2", dayIndex: 0, completed: false }],
    });

    expect(result.completedDays).toBe(0);
  });

  it("derives the previous week from the same completion records", () => {
    const result = metrics({
      completions: [...done("Week 2", [0]), ...done("Week 1", [0, 2, 4])],
      previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
    });

    expect(result.previousWeek).toEqual({ weekKey: "Week 1", completionPercent: 100 });
  });
});

describe("duration is measured or absent, never invented", () => {
  it("reports null rather than zero when nothing was measured", () => {
    const result = metrics({
      completions: done("Week 2", [0, 2, 4]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, durationSec: null },
        { weekKey: "Week 2", dayIndex: 2 },
      ],
    });

    expect(result.measuredDurationSec).toBeNull();
    expect(result.durationCoverage).toBe("none");
    expect(result.measuredSessionCount).toBe(0);
    expect(result.unmeasuredSessionCount).toBe(2);
  });

  it("marks a partly measured week as partial", () => {
    const result = metrics({
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
        { weekKey: "Week 2", dayIndex: 2, durationSec: null },
      ],
    });

    expect(result.durationCoverage).toBe("partial");
    expect(result.measuredDurationSec).toBe(2700);
  });

  it("discards an implausible duration instead of counting it", () => {
    expect(usableDurationSec(-1)).toBeNull();
    expect(usableDurationSec(0)).toBeNull();
    expect(usableDurationSec(13 * 60 * 60)).toBeNull();
    expect(usableDurationSec(Number.NaN)).toBeNull();
    expect(usableDurationSec("2700")).toBeNull();
    expect(usableDurationSec(2700)).toBe(2700);
  });

  it("agrees with the client fact layer on the same logs", () => {
    /*
      Two implementations of "what counts as a measured session" would put two
      different totals on one screen — the review's metric tile and the
      recommendation's reason. This pins them together.
    */
    const logs = [
      { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
      { weekKey: "Week 2", dayIndex: 2, durationSec: null },
      { weekKey: "Week 2", dayIndex: 4, durationSec: 12 * 60 * 60 + 1 },
    ];
    const coverage = computeDurationCoverage(logs);
    const result = metrics({ weekLogs: logs });

    expect(result.measuredDurationSec).toBe(coverage.measuredDurationSec);
    expect(result.measuredSessionCount).toBe(coverage.measuredSessionCount);
    expect(result.unmeasuredSessionCount).toBe(coverage.unmeasuredSessionCount);
    expect(result.durationCoverage).toBe(coverage.state);
  });
});

describe("the category is decided by rules, conservatively", () => {
  it("asks for consistency when nothing is planned", () => {
    expect(recommendCategory(metrics({ hasPlan: false, planDays: [] }))).toBe("consistency");
  });

  it("asks for consistency at 0 of 3", () => {
    expect(recommendCategory(metrics())).toBe("consistency");
  });

  it("asks for consistency below half a week", () => {
    const result = metrics({ completions: done("Week 2", [0]) });

    expect(result.completionPercent).toBeLessThan(LOW_COMPLETION_PERCENT);
    expect(recommendCategory(result)).toBe("consistency");
  });

  it("keeps the plan at 2 of 3", () => {
    expect(recommendCategory(metrics({ completions: done("Week 2", [0, 2]) }))).toBe("maintain");
  });

  it("keeps the plan at a first full week rather than escalating it", () => {
    expect(recommendCategory(metrics({ completions: done("Week 2", [0, 2, 4]) }))).toBe("maintain");
  });

  it("suggests more only after two full weeks", () => {
    const result = metrics({
      completions: [...done("Week 2", [0, 2, 4]), ...done("Week 1", [0, 2, 4])],
      previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
    });

    expect(recommendCategory(result)).toBe("increase");
  });

  it("does not suggest more when the previous week was incomplete", () => {
    const result = metrics({
      completions: [...done("Week 2", [0, 2, 4]), ...done("Week 1", [0])],
      previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
    });

    expect(recommendCategory(result)).toBe("maintain");
  });

  it("suggests less only after two low weeks on a demanding schedule", () => {
    const fiveDayWeek = threeDayWeek.map((day, index) => ({ ...day, exerciseCount: index < 5 ? 4 : 0 }));
    const result = computeWeeklyReviewMetrics({
      weekKey: "Week 2",
      weekNumber: 2,
      hasPlan: true,
      planDays: fiveDayWeek,
      completions: [...done("Week 2", [0]), ...done("Week 1", [0])],
      weekLogs: [],
      previousWeek: { weekKey: "Week 1", planDays: fiveDayWeek },
    });

    expect(recommendCategory(result)).toBe("reduce");
  });

  it("suggests a rest day only when the plan itself scheduled none", () => {
    const result = metrics({
      planDays: everyDayWeek,
      completions: done("Week 2", [0, 1, 2, 3, 4, 5, 6]),
    });

    expect(recommendCategory(result)).toBe("recovery");
  });
});

describe("the deterministic wording", () => {
  const all = [
    metrics(),
    metrics({ hasPlan: false, planDays: [] }),
    metrics({ completions: done("Week 2", [0]) }),
    metrics({ completions: done("Week 2", [0, 2]) }),
    metrics({ completions: done("Week 2", [0, 2, 4]) }),
    metrics({ planDays: everyDayWeek, completions: done("Week 2", [0, 1, 2, 3, 4, 5, 6]) }),
    metrics({
      completions: [...done("Week 2", [0, 2, 4]), ...done("Week 1", [0, 2, 4])],
      previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
    }),
  ];

  it.each(all.map((m) => [m.completedDays + "/" + m.scheduledDays, m] as const))(
    "%s passes its own safety guard",
    (_label, m) => {
      expect(findUnsafeRecommendationText(describeRecommendation(m))).toEqual([]);
    }
  );

  it.each(all.map((m) => [m.completedDays + "/" + m.scheduledDays, m] as const))(
    "%s never implies the plan was changed",
    (_label, m) => {
      const text = Object.values(describeRecommendation(m)).join(" ");

      expect(text).not.toMatch(/automatisch|angepasst|aktualisiert|neu erstellt|umgestellt/i);
    }
  );

  it("quotes the real numbers in the reason", () => {
    const text = describeRecommendation(metrics({ completions: done("Week 2", [0, 2]) })).reason;

    expect(text).toContain("2 von 3 Trainingstagen abgeschlossen (67 %)");
  });

  it("mentions no duration when none was measured", () => {
    const text = describeRecommendation(metrics({ completions: done("Week 2", [0, 2]) })).reason;

    expect(text).not.toMatch(/Trainingszeit|Min\.|Std\./);
  });

  it("labels a partly measured total as a floor", () => {
    const text = describeRecommendation(
      metrics({
        completions: done("Week 2", [0, 2]),
        weekLogs: [
          { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
          { weekKey: "Week 2", dayIndex: 2, durationSec: null },
        ],
      })
    ).reason;

    expect(text).toContain("mindestens 45 Min.");
  });

  it("states a fully measured total plainly", () => {
    const text = describeRecommendation(
      metrics({
        completions: done("Week 2", [0, 2]),
        weekLogs: [
          { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
          { weekKey: "Week 2", dayIndex: 2, durationSec: 2700 },
        ],
      })
    ).reason;

    expect(text).toContain("Erfasste Trainingszeit: 1 Std. 30 Min.");
  });

  it("formats durations without inventing precision", () => {
    expect(formatDurationDe(2700)).toBe("45 Min.");
    expect(formatDurationDe(3600)).toBe("1 Std.");
    expect(formatDurationDe(8100)).toBe("2 Std. 15 Min.");
  });

  it("is always marked as deterministic, never as a model's words", () => {
    all.forEach((m) => expect(describeRecommendation(m).source).toBe("deterministic"));
  });
});

describe("a model may rephrase the conclusion, never choose it", () => {
  const valid = {
    category: "maintain" as const,
    headline: "Solide Woche",
    message: "Zwei von drei Einheiten sind abgeschlossen. Bleib beim aktuellen Umfang der Woche.",
    reason: "Zwei der drei geplanten Trainingstage sind erledigt.",
  };

  it("accepts a well-formed rephrasing of the same category", () => {
    const result = validateModelRecommendation(valid, "maintain");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recommendation.source).toBe("ai");
  });

  it("refuses a category the rules did not choose", () => {
    const result = validateModelRecommendation({ ...valid, category: "increase" }, "maintain");

    expect(result).toEqual({ ok: false, rejection: "category-mismatch" });
  });

  it("refuses anything that is not the agreed shape", () => {
    expect(validateModelRecommendation("Gute Woche!", "maintain").ok).toBe(false);
    expect(validateModelRecommendation(undefined, "maintain").ok).toBe(false);
    expect(validateModelRecommendation({ ...valid, headline: "" }, "maintain").ok).toBe(false);
  });

  it("refuses extra keys, so plan content cannot ride along", () => {
    const parsed = weeklyRecommendationResponseSchema.safeParse({
      ...valid,
      exercises: [{ name: "Bankdrücken", sets: 4 }],
    });

    expect(parsed.success).toBe(false);
  });

  it("bounds the wording so a model cannot return an essay", () => {
    expect(
      weeklyRecommendationResponseSchema.safeParse({ ...valid, message: "x".repeat(400) }).success
    ).toBe(false);
  });

  it.each([
    ["medical", "Du zeigst Anzeichen von Übertraining und solltest zum Arzt."],
    ["nutrition", "Erhöhe deine Kalorien und nimm mehr Protein zu dir diese Woche."],
    ["plan-mutation", "Dein Plan wurde automatisch für dich angepasst und aktualisiert."],
    ["plan-content", "Mach nächste Woche 4 Sätze mit 80 kg statt der bisherigen Vorgabe."],
  ])("refuses %s wording", (rule, message) => {
    const result = validateModelRecommendation({ ...valid, message }, "maintain");

    expect(result).toEqual({ ok: false, rejection: "unsafe-text" });
    expect(findUnsafeRecommendationText({ ...valid, message })).toContain(rule);
  });
});

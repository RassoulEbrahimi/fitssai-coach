import { describe, it, expect } from "vitest";
import {
  LOW_COMPLETION_PERCENT,
  computeWeeklyReviewMetrics,
  describeRecommendation,
  findUnsafeRecommendationText,
  formatDurationDe,
  recommendCategory,
  recommendFocus,
  RECOMMENDATION_CATEGORIES,
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

  it("keeps the plan at a full week", () => {
    expect(recommendCategory(metrics({ completions: done("Week 2", [0, 2, 4]) }))).toBe("maintain");
  });

  it("names a seven-day plan as dense", () => {
    const result = metrics({
      planDays: everyDayWeek,
      completions: done("Week 2", [0, 1, 2, 3, 4, 5, 6]),
    });

    expect(recommendCategory(result)).toBe("dense-schedule");
  });
});

describe("adherence is never read as a workload verdict", () => {
  /*
    The one rule this whole module exists to keep. The app persists how many
    planned sessions were ticked off and nothing else — no perceived effort, no
    fatigue, no recovery, no sleep, no injury status, and no reason a session
    was missed. A completion tally therefore cannot support a claim that
    somebody should train more or less, and these tests pin that it never
    produces one.
  */

  const twoFullWeeks = metrics({
    completions: [...done("Week 2", [0, 2, 4]), ...done("Week 1", [0, 2, 4])],
    previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
  });

  const fiveDayWeek: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    exerciseCount: dayIndex < 5 ? 4 : 0,
  }));

  const twoLowWeeks = computeWeeklyReviewMetrics({
    weekKey: "Week 2",
    weekNumber: 2,
    hasPlan: true,
    planDays: fiveDayWeek,
    completions: [...done("Week 2", [0]), ...done("Week 1", [0])],
    weekLogs: [],
    previousWeek: { weekKey: "Week 1", planDays: fiveDayWeek },
  });

  it("offers no category that means 'train more' or 'train less'", () => {
    // A dead enum value in a safety contract is an invitation, not a feature.
    expect([...RECOMMENDATION_CATEGORIES]).toEqual(["maintain", "consistency", "dense-schedule"]);
  });

  it("keeps two full weeks on maintain", () => {
    expect(twoFullWeeks.completionPercent).toBe(100);
    expect(twoFullWeeks.previousWeek?.completionPercent).toBe(100);
    expect(recommendCategory(twoFullWeeks)).toBe("maintain");
    // The previous week changes which sentence leads, never the conclusion.
    expect(recommendFocus(twoFullWeeks)).toBe("week-complete-repeat");
  });

  it("says nothing about readiness after two full weeks", () => {
    const text = Object.values(describeRecommendation(twoFullWeeks)).join(" ");

    expect(text).not.toMatch(/bereit für|kannst du jetzt|zeit für mehr|nächste stufe/i);
    expect(text).not.toMatch(/steigere |erhöhe (dein|die)|trainiere (mehr|öfter|häufiger)/i);
  });

  it("frames progression after two full weeks as the reader's own decision", () => {
    const { message } = describeRecommendation(twoFullWeeks);

    expect(message).toMatch(/entscheidest du selbst/);
    // And admits, in the same sentence, what the app cannot know.
    expect(message).toMatch(/kann nicht beurteilen, wie sich dein Training anfühlt/);
  });

  it("keeps two low weeks on consistency", () => {
    expect(twoLowWeeks.completionPercent).toBeLessThan(LOW_COMPLETION_PERCENT);
    expect(twoLowWeeks.previousWeek?.completionPercent).toBeLessThan(LOW_COMPLETION_PERCENT);
    expect(recommendCategory(twoLowWeeks)).toBe("consistency");
    expect(recommendFocus(twoLowWeeks)).toBe("schedule-fit");
  });

  it("asks about the schedule after two low weeks instead of prescribing less", () => {
    const { headline, message } = describeRecommendation(twoLowWeeks);

    expect(headline).toMatch(/\?$/);
    expect(message).toMatch(/Woran das lag, weiß die App nicht/);
    expect(message).not.toMatch(/reduzier|weniger|zu viel|pensum|überforder/i);
  });

  it("flags a seven-day plan as a property of the plan, not of the person", () => {
    const dense = metrics({
      planDays: everyDayWeek,
      completions: done("Week 2", [0, 1, 2, 3, 4, 5, 6]),
    });
    const { message } = describeRecommendation(dense);

    expect(message).toMatch(/dichter Wochenplan/);
    expect(message).toMatch(/entscheidest du/);
    expect(message).not.toMatch(/erholung|erholt|regeneration|deload|überlast|müde/i);
  });

  it.each([
    ["fatigue", "Du wirkst nach dieser Woche ziemlich müde und ausgelaugt."],
    ["recovery-claim", "Deine Regeneration reicht aus, du bist gut erholt."],
    ["progress-readiness", "Du bist bereit für mehr Umfang im Training."],
    ["workload-prescription", "Reduzier dein Pensum in der kommenden Woche deutlich."],
  ])("refuses a model that claims %s", (rule, message) => {
    const candidate = {
      category: "maintain" as const,
      headline: "Deine Woche",
      message,
      reason: "Drei von drei geplanten Trainingstagen sind abgeschlossen.",
    };

    expect(findUnsafeRecommendationText(candidate)).toContain(rule);
    expect(validateModelRecommendation(candidate, "maintain")).toEqual({
      ok: false,
      rejection: "unsafe-text",
    });
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
    metrics({
      completions: [...done("Week 2", [0]), ...done("Week 1", [0])],
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
    const result = validateModelRecommendation({ ...valid, category: "consistency" }, "maintain");

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

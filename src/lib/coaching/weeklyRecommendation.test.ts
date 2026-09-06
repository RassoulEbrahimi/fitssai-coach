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
import { computeDurationCoverage, computeWeeklyAdherence, selectSessionLogs } from "./facts";

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
    // Three completed sessions, none of them timed — counted against the
    // sessions the week completed, not against the two log rows that exist.
    expect(result.unmeasuredSessionCount).toBe(3);
  });

  it("marks a partly measured week as partial", () => {
    const result = metrics({
      completions: done("Week 2", [0, 2]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
        { weekKey: "Week 2", dayIndex: 2, durationSec: null },
      ],
    });

    expect(result.durationCoverage).toBe("partial");
    expect(result.measuredDurationSec).toBe(2700);
    // The two counts always add up to the completed sessions, which is what
    // lets the wording say "1 von 2" rather than "1 of however many rows".
    expect(result.measuredSessionCount).toBe(1);
    expect(result.unmeasuredSessionCount).toBe(1);
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
    const completions = done("Week 2", [0, 2, 4]);
    const adherence = computeWeeklyAdherence("Week 2", threeDayWeek, completions);
    const coverage = computeDurationCoverage(selectSessionLogs(adherence, logs));
    const result = metrics({ completions, weekLogs: logs });

    expect(result.measuredDurationSec).toBe(coverage.measuredDurationSec);
    expect(result.measuredSessionCount).toBe(coverage.measuredSessionCount);
    expect(result.unmeasuredSessionCount).toBe(coverage.unmeasuredSessionCount);
    expect(result.durationCoverage).toBe(coverage.state);
  });
});

describe("duration coverage counts sessions, not log rows", () => {
  /*
    `workout_logs` holds two families of document for the same training day:
    the day document, which is where the measured length is stored, and one
    document per exercise, written whenever a set is ticked. A week of three
    fully timed sessions therefore has roughly fifteen rows and three
    measurements — and counting rows made it report itself as barely measured.
  */

  /** Three timed day documents plus the exercise rows that accompany them. */
  const realisticWeek = [
    { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
    { weekKey: "Week 2", dayIndex: 2, completed: true, durationSec: 2700 },
    { weekKey: "Week 2", dayIndex: 4, completed: true, durationSec: 3300 },
    ...[0, 2, 4].flatMap((dayIndex) =>
      Array.from({ length: 4 }, () => ({ weekKey: "Week 2", dayIndex, completed: true }))
    ),
  ];

  it("calls a fully timed week full, however many rows it took", () => {
    const result = metrics({
      completions: done("Week 2", [0, 2, 4]),
      weekLogs: realisticWeek,
    });

    expect(result.measuredSessionCount).toBe(3);
    expect(result.unmeasuredSessionCount).toBe(0);
    expect(result.durationCoverage).toBe("full");
    expect(result.measuredDurationSec).toBe(3600 + 2700 + 3300);
  });

  it("states a fully timed total plainly, with no floor language", () => {
    const { reason } = describeRecommendation(
      metrics({ completions: done("Week 2", [0, 2, 4]), weekLogs: realisticWeek })
    );

    expect(reason).toContain("Gemessene Trainingszeit: 2 Std. 40 Min.");
    expect(reason).not.toMatch(/mindestens/);
  });

  it("counts a session once, even when several of its rows carry a time", () => {
    const result = metrics({
      completions: done("Week 2", [0]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
        { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
      ],
    });

    // One session was trained, so one hour was trained — not two.
    expect(result.measuredSessionCount).toBe(1);
    expect(result.measuredDurationSec).toBe(3600);
  });

  it("says which part of a partly timed week was measured", () => {
    const { reason } = describeRecommendation(
      metrics({
        completions: done("Week 2", [0, 2, 4]),
        weekLogs: [
          { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
          { weekKey: "Week 2", dayIndex: 2, completed: true },
          { weekKey: "Week 2", dayIndex: 4, completed: true },
        ],
      })
    );

    // A floor, named as one, with both counts so the gap is visible.
    expect(reason).toContain("mindestens 1 Std.");
    expect(reason).toContain("1 von 3 abgeschlossenen Einheiten wurden gemessen");
  });

  it("mentions no time at all when nothing was measured", () => {
    const { reason } = describeRecommendation(
      metrics({
        completions: done("Week 2", [0, 2]),
        weekLogs: [
          { weekKey: "Week 2", dayIndex: 0, completed: true },
          { weekKey: "Week 2", dayIndex: 2, completed: true },
        ],
      })
    );

    // Not "0 Min.", not an estimate, not an average of the sessions that had
    // one. Nothing was measured, so nothing is said.
    expect(reason).not.toMatch(/Trainingszeit/);
    expect(reason).not.toMatch(/0 Min/);
  });

  it("keeps the two counts adding up to the completed sessions", () => {
    const result = metrics({
      completions: done("Week 2", [0, 2, 4]),
      weekLogs: realisticWeek.slice(0, 2),
    });

    expect(result.measuredSessionCount + result.unmeasuredSessionCount).toBe(result.completedDays);
  });

  it("does not borrow time from a session the week never completed", () => {
    /*
      Ending a session is not completing the workout, and the two are written
      by different call sites. A stopwatch reading on a day that was never
      ticked off is not this week's training time.
    */
    const result = metrics({
      completions: done("Week 2", [0]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
        { weekKey: "Week 2", dayIndex: 2, durationSec: 9000 },
      ],
    });

    expect(result.measuredDurationSec).toBe(3600);
    expect(result.measuredSessionCount).toBe(1);
  });
});

describe("legacy and malformed log values", () => {
  /*
    Documents written by four call sites over two years. None of these shapes
    may throw, and none may become a number the app then states as a fact.
  */

  const malformed: ReadonlyArray<{ label: string; durationSec: unknown }> = [
    { label: "a string", durationSec: "2700" },
    { label: "a negative span", durationSec: -600 },
    { label: "exactly zero", durationSec: 0 },
    { label: "a session left running overnight", durationSec: 20 * 60 * 60 },
    { label: "NaN", durationSec: Number.NaN },
    { label: "Infinity", durationSec: Number.POSITIVE_INFINITY },
    { label: "an object", durationSec: { seconds: 2700 } },
    { label: "null", durationSec: null },
    { label: "undefined", durationSec: undefined },
  ];

  malformed.forEach(({ label, durationSec }) => {
    it(`treats ${label} as not measured rather than as a duration`, () => {
      const result = metrics({
        completions: done("Week 2", [0]),
        weekLogs: [
          { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec } as never,
        ],
      });

      expect(result.measuredDurationSec).toBeNull();
      expect(result.durationCoverage).toBe("none");
      expect(result.unmeasuredSessionCount).toBe(1);
      // And the wording says nothing about time, rather than saying "0 Min.".
      expect(describeRecommendation(result).reason).not.toMatch(/Trainingszeit/);
    });
  });

  it("ignores a legacy row that cannot be placed on a training day", () => {
    const result = metrics({
      completions: done("Week 2", [0]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: 3600 },
        // A pre-PR47 day log: a date, no plan position.
        { weekKey: "Week 2", dayIndex: null, completed: true, durationSec: 5400 },
      ],
    });

    expect(result.measuredDurationSec).toBe(3600);
  });

  it("still produces a complete, safe recommendation from junk logs", () => {
    const result = metrics({
      completions: done("Week 2", [0, 2]),
      weekLogs: [
        { weekKey: "Week 2", dayIndex: 0, completed: true, durationSec: "x" },
        { weekKey: "Week 2", dayIndex: null, completed: null },
      ] as never,
    });
    const recommendation = describeRecommendation(result);

    expect(recommendation.headline.length).toBeGreaterThan(0);
    expect(recommendation.source).toBe("deterministic");
    expect(findUnsafeRecommendationText(recommendation)).toEqual([]);
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

describe("every real completion ratio, exactly", () => {
  /*
    The states a user actually reaches, enumerated. Two things are checked for
    each: that the numbers are the arithmetic and nothing else, and that the
    wording that comes with them stays on the right side of the one line this
    feature must not cross.

    50 % is the hinge. At or above it the week is on track and the category is
    `maintain`; below it, regularity is the useful next step and the category
    is `consistency`. Neither is a verdict on the plan's size.
  */

  const fourDayWeek: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    exerciseCount: dayIndex < 4 ? 4 : 0,
  }));

  const ratio = (
    planDays: readonly ReviewPlanDay[],
    completedDayIndexes: number[]
  ) => metrics({ planDays, completions: done("Week 2", completedDayIndexes) });

  const cases: ReadonlyArray<{
    label: string;
    planDays: readonly ReviewPlanDay[];
    completed: number[];
    percent: number;
    completedDays: number;
    scheduledDays: number;
    missedDays: number;
    focus: string;
    category: string;
  }> = [
    { label: "1 of 3", planDays: threeDayWeek, completed: [0], percent: 33, completedDays: 1, scheduledDays: 3, missedDays: 2, focus: "catch-up", category: "consistency" },
    { label: "2 of 3", planDays: threeDayWeek, completed: [0, 2], percent: 67, completedDays: 2, scheduledDays: 3, missedDays: 1, focus: "on-track", category: "maintain" },
    { label: "3 of 3", planDays: threeDayWeek, completed: [0, 2, 4], percent: 100, completedDays: 3, scheduledDays: 3, missedDays: 0, focus: "week-complete", category: "maintain" },
    { label: "1 of 4", planDays: fourDayWeek, completed: [0], percent: 25, completedDays: 1, scheduledDays: 4, missedDays: 3, focus: "catch-up", category: "consistency" },
    { label: "2 of 4", planDays: fourDayWeek, completed: [0, 1], percent: 50, completedDays: 2, scheduledDays: 4, missedDays: 2, focus: "on-track", category: "maintain" },
    { label: "3 of 4", planDays: fourDayWeek, completed: [0, 1, 2], percent: 75, completedDays: 3, scheduledDays: 4, missedDays: 1, focus: "on-track", category: "maintain" },
    { label: "4 of 4", planDays: fourDayWeek, completed: [0, 1, 2, 3], percent: 100, completedDays: 4, scheduledDays: 4, missedDays: 0, focus: "week-complete", category: "maintain" },
  ];

  cases.forEach((testCase) => {
    describe(testCase.label, () => {
      const result = ratio(testCase.planDays, testCase.completed);

      it("counts exactly what was logged", () => {
        expect(result.completedDays).toBe(testCase.completedDays);
        expect(result.scheduledDays).toBe(testCase.scheduledDays);
        expect(result.missedDays).toBe(testCase.missedDays);
        expect(result.completionPercent).toBe(testCase.percent);
      });

      it("lands in the focus and category the ratio implies", () => {
        expect(recommendFocus(result)).toBe(testCase.focus);
        expect(recommendCategory(result)).toBe(testCase.category);
      });

      it("quotes those same numbers back in the reason", () => {
        expect(describeRecommendation(result).reason).toContain(
          `${testCase.completedDays} von ${testCase.scheduledDays} Trainingstagen abgeschlossen (${testCase.percent} %)`
        );
      });

      it("makes no claim about workload, recovery or readiness", () => {
        const { headline, message, reason } = describeRecommendation(result);

        expect(findUnsafeRecommendationText({ headline, message, reason })).toEqual([]);
      });

      it("assigns no blame for what is still open", () => {
        const { message } = describeRecommendation(result);

        /*
          A missed session is a fact about a week, not a failing. Nothing here
          may scold, and nothing may present the remaining sessions as a debt
          — the app does not know what else was in the person's week.
        */
        expect(message).not.toMatch(/leider|schade|solltest du|du musst|verpasst|versäum|schaffst du das/i);
        expect(message).not.toMatch(/nachholen musst|unbedingt|auf jeden Fall/i);
      });
    });
  });

  it("names the open sessions without demanding them, below half a week", () => {
    const { message } = describeRecommendation(ratio(threeDayWeek, [0]));

    // The remaining sessions are stated as a count, and handed back as a choice.
    expect(message).toContain("1 von 3 geplanten Einheiten");
    expect(message).toMatch(/2 sind noch offen/);
    expect(message).toMatch(/entscheidest du/);
  });

  it("names the open sessions without demanding them, above half a week", () => {
    const { message } = describeRecommendation(ratio(fourDayWeek, [0, 1, 2]));

    expect(message).toContain("3 von 4 geplanten Einheiten");
    expect(message).toMatch(/1 ist noch offen/);
    // "Keep going" is about the plan's size, not an instruction to finish it.
    expect(message).toMatch(/daran musst du nichts ändern/);
  });

  it("acknowledges a full week as done, and as a reason to change nothing", () => {
    const { message } = describeRecommendation(ratio(fourDayWeek, [0, 1, 2, 3]));

    expect(message).toContain("alle 4 geplanten Einheiten dieser Woche abgeschlossen");
    expect(message).toMatch(/nichts zu ändern/);
    // Never the reading a completion tally cannot support.
    expect(message).not.toMatch(/bereit|steiger|erhöh|mehr trainieren|nächste stufe/i);
  });

  it("keeps a repeated full week on maintain and hands progression to the reader", () => {
    const result = metrics({
      planDays: fourDayWeek,
      completions: [...done("Week 2", [0, 1, 2, 3]), ...done("Week 1", [0, 1, 2, 3])],
      previousWeek: { weekKey: "Week 1", planDays: fourDayWeek },
    });

    expect(result.completionPercent).toBe(100);
    expect(result.previousWeek?.completionPercent).toBe(100);
    expect(recommendCategory(result)).toBe("maintain");
    expect(recommendFocus(result)).toBe("week-complete-repeat");

    const { message } = describeRecommendation(result);
    expect(message).toMatch(/kannst du selbst entscheiden/);
    expect(message).toMatch(/weiterhin gut anfühlt/);
    expect(message).toMatch(/kann nicht beurteilen, wie sich dein Training anfühlt/);
  });

  it("does not escalate a third full week either", () => {
    /*
      There is no ladder. However many full weeks accumulate, the conclusion is
      the same one: the plan was followed. `week-complete-repeat` is a wording,
      not a rung.
    */
    const result = metrics({
      completions: [...done("Week 2", [0, 2, 4]), ...done("Week 1", [0, 2, 4])],
      previousWeek: { weekKey: "Week 1", planDays: threeDayWeek },
    });

    expect(recommendCategory(result)).toBe("maintain");
    expect(findUnsafeRecommendationText(describeRecommendation(result))).toEqual([]);
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

    expect(message).toMatch(/kannst du selbst entscheiden/);
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

    expect(text).toContain("Gemessene Trainingszeit: 1 Std. 30 Min.");
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

describe("the wording a model may never return", () => {
  /*
    The prompt forbids these; this is the layer that assumes the prompt failed.
    Every string below is something a model reaches for unprompted when it sees
    a tidy completion tally — most of all "three of three, twice running", the
    state that most looks like evidence of readiness and least is.

    Each case names the rule it must trip, so a future edit that loosens a
    pattern fails here rather than in front of a user.
  */

  const violations: ReadonlyArray<{ text: string; rule: string }> = [
    // Progression and readiness, the claim adherence cannot support.
    { text: "Du bist bereit für mehr Umfang.", rule: "progress-readiness" },
    { text: "Du bist bereit, den nächsten Schritt zu gehen.", rule: "progress-readiness" },
    { text: "Dein Körper hat sich an die Belastung gewöhnt.", rule: "progress-readiness" },
    { text: "Deinem Körper kannst du jetzt mehr zumuten.", rule: "progress-readiness" },
    { text: "Zeit für die nächste Stufe.", rule: "progress-readiness" },
    { text: "Da ist noch mehr drin bei dir.", rule: "progress-readiness" },

    // Recovery and fatigue, neither of which is recorded anywhere.
    { text: "Du brauchst Erholung.", rule: "recovery-claim" },
    { text: "Deine Regeneration kommt zu kurz.", rule: "recovery-claim" },
    { text: "Leg eine Pause ein.", rule: "recovery-claim" },
    { text: "Gönn dir eine Woche ohne Training.", rule: "recovery-claim" },
    { text: "Du wirkst erschöpft nach dieser Woche.", rule: "fatigue" },
    { text: "Du bist überlastet.", rule: "fatigue" },

    // Workload prescriptions, in both directions.
    { text: "Reduziere dein Volumen.", rule: "workload-prescription" },
    { text: "Erhöhe dein Gewicht im nächsten Block.", rule: "workload-prescription" },
    { text: "Du solltest mehr trainieren.", rule: "workload-prescription" },
    { text: "Versuche, häufiger zu trainieren.", rule: "workload-prescription" },
    { text: "Eine Steigerung des Pensums wäre sinnvoll.", rule: "workload-prescription" },
    { text: "Nimm schwerere Gewichte.", rule: "workload-prescription" },

    // The remaining product rules.
    { text: "Achte auf ausreichend Protein.", rule: "nutrition" },
    { text: "Dein Plan wurde automatisch angepasst.", rule: "plan-mutation" },
    { text: "Mach 3x10 Kniebeugen.", rule: "plan-content" },
    { text: "Bei Schmerzen solltest du zum Arzt.", rule: "medical" },
  ];

  violations.forEach(({ text, rule }) => {
    it(`refuses "${text}"`, () => {
      expect(findUnsafeRecommendationText({ message: text })).toContain(rule);
    });
  });

  it("refuses the claim wherever in the response it appears", () => {
    // Three fields reach the screen, so all three are screened.
    expect(findUnsafeRecommendationText({ headline: "Bereit für mehr" })).not.toEqual([]);
    expect(findUnsafeRecommendationText({ reason: "Du brauchst Erholung." })).not.toEqual([]);
  });

  it("lets ordinary German through", () => {
    /*
      A guard that refuses everything is a guard that is always bypassed. These
      are sentences the feature genuinely needs — including "bereits", which
      must survive the word-boundary on "bereit", and "Ruhetag", which is a
      statement about the plan rather than about the person.
    */
    const allowed = [
      "Du hast bereits zwei von drei Einheiten abgeschlossen.",
      "Ob ein fester Ruhetag für dich passt, entscheidest du.",
      "Dein Plan bleibt unverändert.",
      "Zwei von drei Trainingstagen sind abgeschlossen.",
    ];

    allowed.forEach((message) => {
      expect(findUnsafeRecommendationText({ message })).toEqual([]);
    });
  });

  it("turns a violation into a rejection rather than a rendered sentence", () => {
    const progression = validateModelRecommendation(
      {
        category: "maintain",
        headline: "Starke Woche",
        message: "Du hast alle Einheiten geschafft und bist bereit für mehr Umfang.",
        reason: "3 von 3 Trainingstagen abgeschlossen.",
      },
      "maintain"
    );
    const recovery = validateModelRecommendation(
      {
        category: "maintain",
        headline: "Starke Woche",
        message: "Du hast alle Einheiten geschafft. Achte jetzt auf deine Regeneration.",
        reason: "3 von 3 Trainingstagen abgeschlossen.",
      },
      "maintain"
    );

    expect(progression).toEqual({ ok: false, rejection: "unsafe-text" });
    expect(recovery).toEqual({ ok: false, rejection: "unsafe-text" });
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

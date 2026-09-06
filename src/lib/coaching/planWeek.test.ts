import { describe, it, expect } from "vitest";
import { berlinDayNumber, mondayIndex, resolvePlanWeek } from "@shared/planWeek";
import { resolvePlanDay } from "@/lib/planLifecycle";
import type { WorkoutPlan } from "@/lib/types";

/*
  Week boundaries, reproduced without waiting for a calendar.

  Every case here is a real transition a user walks through — Sunday night into
  Monday morning, the last day of Week 4 into the day after — expressed as two
  instants handed to a pure function. That is the whole reason `resolvePlanWeek`
  takes both dates as arguments: a review that mixes two weeks' logs is
  invisible in production until somebody's Monday reads like their Sunday.

  The second half of the file is the reason this module exists at all. The
  client resolves a plan day through date-fns-tz in `planLifecycle.ts`; the
  weekly-review backend resolves it through `Intl` in `shared/planWeek.ts`.
  Two implementations of one calendar is a drift waiting to happen, so the pair
  is pinned here rather than left to review.
*/

/** A Wednesday. Week 1 therefore starts on Monday 3 August. */
const PLAN_CREATED = "2026-08-05T09:00:00Z";
const PLAN_CREATED_DATE = new Date(PLAN_CREATED);

/** Berlin wall-clock noon, so no case is decided by a UTC-offset accident. */
const berlin = (day: string) => new Date(`${day}T12:00:00+02:00`);

const plan = { id: "plan-1", created_at: PLAN_CREATED, content: {} } as unknown as WorkoutPlan;

describe("the Berlin calendar day", () => {
  it("reads a late-evening UTC instant as the next Berlin day", () => {
    // 23:30 UTC on the 9th is 01:30 on the 10th in Berlin.
    expect(berlinDayNumber(new Date("2026-08-09T23:30:00Z"))).toBe(
      berlinDayNumber(new Date("2026-08-10T09:00:00Z"))
    );
  });

  it("counts calendar days across a daylight-saving change", () => {
    // 25 October 2026 is the autumn change: a 25-hour day, still one day.
    const before = berlinDayNumber(new Date("2026-10-24T12:00:00Z"));
    const after = berlinDayNumber(new Date("2026-10-26T12:00:00Z"));

    expect(after - before).toBe(2);
  });

  it("knows which epoch day is a Monday", () => {
    expect(mondayIndex(berlinDayNumber(berlin("2026-08-03")))).toBe(0);
    expect(mondayIndex(berlinDayNumber(berlin("2026-08-09")))).toBe(6);
  });
});

describe("week transitions", () => {
  it("puts Sunday and the Monday after it in different weeks", () => {
    const sunday = resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-09"));
    const monday = resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-10"));

    expect(sunday.weekKey).toBe("Week 1");
    expect(monday.weekKey).toBe("Week 2");
    // And the new week knows which week its history is, so a review can read
    // last week's completions without reading last week's as its own.
    expect(monday.previousWeekKey).toBe("Week 1");
  });

  it("anchors Week 1 on the Monday of the plan's creation week", () => {
    // The plan was created on Wednesday the 5th; the Monday before is the 3rd.
    expect(resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-03")).weekKey).toBe("Week 1");
    expect(resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-05")).weekKey).toBe("Week 1");
  });

  it("gives Week 1 no previous week to compare against", () => {
    expect(resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-05")).previousWeekKey).toBeNull();
  });

  it("walks the four weeks in order", () => {
    const weeks = ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"].map(
      (day) => resolvePlanWeek(PLAN_CREATED_DATE, berlin(day)).weekKey
    );

    expect(weeks).toEqual(["Week 1", "Week 2", "Week 3", "Week 4"]);
  });

  it("ends the programme after the last day of Week 4", () => {
    const lastDay = resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-30"));
    const dayAfter = resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-31"));

    expect(lastDay).toMatchObject({ weekKey: "Week 4", planFinished: false });
    /*
      Not Week 5, and not Week 1 again: a wrapped week would silently review a
      month-old set of logs as though they were this week's.
    */
    expect(dayAfter).toMatchObject({ weekKey: null, weekNumber: null, planFinished: true });
  });

  it("resolves nothing for a date before the plan starts", () => {
    expect(resolvePlanWeek(PLAN_CREATED_DATE, berlin("2026-08-02"))).toMatchObject({
      weekKey: null,
      planFinished: false,
    });
  });
});

describe("the client and the backend resolve the same week", () => {
  /** Every boundary day of the programme, plus the days either side of it. */
  const days = [
    "2026-08-02", "2026-08-03", "2026-08-05", "2026-08-09", "2026-08-10",
    "2026-08-16", "2026-08-17", "2026-08-23", "2026-08-24", "2026-08-30",
    "2026-08-31", "2026-10-24", "2026-10-25", "2026-10-26",
  ];

  it.each(days)("agrees on %s", (day) => {
    const shared = resolvePlanWeek(PLAN_CREATED_DATE, berlin(day));
    const client = resolvePlanDay(plan, berlin(day));

    // `resolvePlanDay` reports a date outside the programme as a status rather
    // than as a week, so the comparison is against the week it exposes.
    expect(client.weekKey).toBe(shared.weekKey);
    expect(client.weekNumber).toBe(shared.weekNumber);
    expect(client.planFinished).toBe(shared.planFinished);
  });
});

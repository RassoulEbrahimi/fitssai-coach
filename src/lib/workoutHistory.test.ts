import { describe, expect, it, vi } from "vitest";
import type { StoredDocument } from "@/lib/previousPerformance";
import {
  buildSessionDetail,
  collectHistorySessions,
  formatHistoryRowMeta,
  formatSessionDuration,
  groupHistoryByMonth,
  hasCompletedSession,
  historyDayLabel,
  loadSessionRecord,
  readHistoricalSets,
  readHistoryPage,
  readHistorySessionPage,
  summarizeHistorySession,
  type HistorySession,
  type HistorySource,
  type SessionDetailSource,
} from "@/lib/workoutHistory";

const planA = "plan-a";
const planB = "plan-b";

const daySession = (id: string, data: Record<string, unknown> = {}): StoredDocument => ({
  id,
  data: { planId: planA, workoutDay: "2026-09-24", weekKey: "Week 3", dayIndex: 3, completed: true, ...data },
});
const exerciseLog = (id: string, data: Record<string, unknown> = {}): StoredDocument => ({
  id,
  data: { planId: planA, workoutDay: "2026-09-24", weekKey: "Week 3", dayIndex: 3, exerciseIndex: 0, completed: true, ...data },
});
const setDoc = (id: string, data: Record<string, unknown>): StoredDocument => ({ id, data });

const ex = (name: string, sets = 3) => ({ name, sets, reps: "10" });
const week = (label: string, names: string[]) =>
  Array.from({ length: 7 }, (_, index) => (index === 3 ? { day: label, exercises: names.map((name) => ex(name)) } : { day: "Ruhetag", exercises: [] }));
const planAContent = {
  "Week 1": week("Oberkörper A", ["Bankdrücken", "Rudern"]),
  "Week 2": week("Oberkörper B", ["Schulterdrücken", "Latziehen", "Dips"]),
};
const planBContent = { "Week 1": week("Beine", ["Kniebeugen"]), "Week 3": week("Unterkörper", ["Kreuzheben"]) };

/** An in-memory `workout_logs` behaving like the ordered range read. */
const memorySource = (docs: StoredDocument[], plans: Record<string, unknown> = {}) => {
  const source = {
    logsBefore: vi.fn(async (before: string, limit: number) => docs
      .filter((doc) => typeof doc.data.workoutDay === "string" && (doc.data.workoutDay as string) < before)
      .sort((a, b) => (b.data.workoutDay as string).localeCompare(a.data.workoutDay as string))
      .slice(0, limit)),
    logsOn: vi.fn(async (workoutDay: string) => docs.filter((doc) => doc.data.workoutDay === workoutDay)),
    planContent: vi.fn(async (planId: string) => plans[planId] ?? null),
  } satisfies HistorySource;
  return source;
};

const sessionOf = (overrides: Partial<HistorySession> = {}): HistorySession => ({
  planId: planA, workoutDay: "2026-09-24", logId: "d1", weekKey: "Week 3", dayIndex: 3, durationSec: null, ...overrides,
});

describe("history sessions", () => {
  it("are completed day-session records only", () => {
    const sessions = collectHistorySessions([
      daySession("done"),
      // A ticked exercise, even one carrying the date, is not a session.
      exerciseLog("exercise", { workoutDay: "2026-09-23" }),
      daySession("open", { workoutDay: "2026-09-22", completed: false }),
      daySession("truthy", { workoutDay: "2026-09-21", completed: "yes" }),
      // Legacy completion without a readable date: not placed in the chronology.
      daySession("undated", { workoutDay: undefined }),
      daySession("junk-date", { workoutDay: "letzte Woche" }),
      daySession("no-plan", { workoutDay: "2026-09-20", planId: undefined }),
    ]);
    expect(sessions.map((session) => session.logId)).toEqual(["done"]);
  });

  it("are identified by planId + workoutDay: other plans on the same position stay distinct", () => {
    const sessions = collectHistorySessions([
      daySession("a-mon", { workoutDay: "2026-09-07", weekKey: "Week 1", dayIndex: 0 }),
      daySession("b-mon", { planId: planB, workoutDay: "2026-10-05", weekKey: "Week 1", dayIndex: 0 }),
      // Two plans completed on one date are two sessions.
      daySession("b-same-day", { planId: planB, workoutDay: "2026-09-07", weekKey: "Week 1", dayIndex: 0 }),
      // Duplicate rows of one session collapse, read in id order.
      daySession("a-mon-2", { workoutDay: "2026-09-07", weekKey: "Week 1", dayIndex: 0, durationSec: 900 }),
    ]);
    expect(sessions.map((session) => [session.planId, session.workoutDay, session.logId])).toEqual([
      [planB, "2026-10-05", "b-mon"],
      [planA, "2026-09-07", "a-mon"],
      [planB, "2026-09-07", "b-same-day"],
    ]);
    expect(sessions[1].durationSec).toBe(900);
  });

  it("keep a completion without plan position, and only a plausible measured duration", () => {
    const [legacy, bogus] = collectHistorySessions([
      daySession("legacy", { weekKey: undefined, dayIndex: undefined }),
      daySession("bogus", { workoutDay: "2026-09-01", durationSec: 60 * 60 * 13 }),
    ]);
    expect(legacy).toMatchObject({ weekKey: null, dayIndex: null, durationSec: null });
    expect(bogus.durationSec).toBeNull();
  });
});

describe("history paging", () => {
  /** `count` sessions on consecutive days, each with `exercises` exercise logs beside it. */
  const history = (count: number, exercises = 6) => Array.from({ length: count }, (_, index) => {
    const workoutDay = `2026-${String(9 - Math.floor(index / 28)).padStart(2, "0")}-${String(28 - (index % 28)).padStart(2, "0")}`;
    return [
      daySession(`day-${index}`, { workoutDay }),
      ...Array.from({ length: exercises }, (_, exerciseIndex) => exerciseLog(`ex-${index}-${exerciseIndex}`, { workoutDay, exerciseIndex })),
    ];
  }).flat();

  it("counts sessions, not mixed documents, and continues where it stopped", async () => {
    const source = memorySource(history(40));
    const first = await readHistorySessionPage(source);
    expect(first.sessions).toHaveLength(30);
    expect(first.nextBefore).toBe(first.sessions[29].workoutDay);
    // 30 sessions of 7 documents each needed more than one bounded read.
    expect(source.logsBefore.mock.calls.length).toBeGreaterThan(1);
    expect(source.logsBefore.mock.calls.every(([, limit]) => limit === 100)).toBe(true);

    const second = await readHistorySessionPage(source, { before: first.nextBefore! });
    expect(second.sessions).toHaveLength(10);
    expect(second.nextBefore).toBeNull();
    const all = [...first.sessions, ...second.sessions].map((session) => session.logId);
    expect(new Set(all).size).toBe(40);
    expect(all).toEqual(Array.from({ length: 40 }, (_, index) => `day-${index}`));
  });

  it("never splits a day across reads", async () => {
    const docs = [
      daySession("mon-a", { workoutDay: "2026-09-21" }),
      daySession("mon-b", { workoutDay: "2026-09-21", planId: planB }),
      ...Array.from({ length: 5 }, (_, index) => exerciseLog(`mon-ex-${index}`, { workoutDay: "2026-09-21", exerciseIndex: index })),
      daySession("sun", { workoutDay: "2026-09-20" }),
      daySession("sat", { workoutDay: "2026-09-19" }),
    ];
    // A chunk of 4 is a single day: that day is read whole.
    const source = memorySource(docs);
    const page = await readHistorySessionPage(source, { chunk: 4, target: 10 });
    expect(source.logsOn).toHaveBeenCalledWith("2026-09-21");
    expect(page.sessions.map((session) => session.logId)).toEqual(["mon-a", "mon-b", "sun", "sat"]);
    expect(page.nextBefore).toBeNull();
  });

  it("stops after a bounded number of reads and says where to continue", async () => {
    const docs = Array.from({ length: 50 }, (_, index) => exerciseLog(`ex-${index}`, { workoutDay: `2026-09-${String(28 - (index % 28)).padStart(2, "0")}` }));
    const source = memorySource(docs);
    const page = await readHistorySessionPage(source, { chunk: 10, maxChunks: 3 });
    expect(source.logsBefore).toHaveBeenCalledTimes(3);
    expect(page.sessions).toEqual([]);
    expect(page.nextBefore).not.toBeNull();
  });

  it("names each session from its own plan, reading every plan once", async () => {
    const source = memorySource([
      daySession("a", { workoutDay: "2026-09-24" }),
      daySession("b", { planId: planB, workoutDay: "2026-09-23", weekKey: "Week 1", dayIndex: 3 }),
      daySession("a-old", { workoutDay: "2026-09-10", weekKey: "Week 1", dayIndex: 3 }),
    ], { [planA]: planAContent, [planB]: planBContent });
    const { entries } = await readHistoryPage(source);
    // Week 3 of plan A has no content of its own and mirrors Week 2.
    expect(entries.map((entry) => entry.title)).toEqual(["Oberkörper B", "Beine", "Oberkörper A"]);
    // The plan's current exercise count is not the session's: rows carry none.
    expect(entries.every((entry) => !("exerciseCount" in entry))).toBe(true);
    expect(source.planContent.mock.calls.map(([planId]) => planId).sort()).toEqual([planA, planB]);
  });
});

describe("history names", () => {
  it("never borrow another plan and degrade to Training when the own plan is gone", () => {
    expect(summarizeHistorySession(sessionOf(), null).title).toBe("Training");
    // The same position in another plan says nothing about this session.
    expect(summarizeHistorySession(sessionOf({ planId: planB }), planAContent).title).toBe("Oberkörper B");
    expect(summarizeHistorySession(sessionOf({ weekKey: null, dayIndex: null }), planAContent).title).toBe("Training");
  });

  it("take the title from an explicit day label only, never from the day's current exercises", () => {
    // A weekday label names nothing; muscles derived from today's exercise list would change when one is appended.
    const generic = { "Week 1": week("Donnerstag", ["Bankdrücken", "Rudern"]) };
    expect(summarizeHistorySession(sessionOf({ weekKey: "Week 1" }), generic).title).toBe("Training");
    const appended = { "Week 1": week("Donnerstag", ["Bankdrücken", "Rudern", "Kniebeugen"]) };
    expect(summarizeHistorySession(sessionOf({ weekKey: "Week 1" }), appended).title).toBe("Training");
  });

  it("row meta is the stored duration, and nothing from the plan", () => {
    expect(formatHistoryRowMeta({ ...sessionOf({ durationSec: 3120 }), title: "X" })).toBe("52 Min");
    expect(formatHistoryRowMeta({ ...sessionOf(), title: "Training" })).toBeNull();
    expect(formatHistoryRowMeta({ ...sessionOf({ weekKey: null, dayIndex: null }), title: "Training" }))
      .toBe("Nur Abschluss gespeichert");
  });

  it("formats measured durations only", () => {
    expect(formatSessionDuration(3120)).toBe("52 Min");
    expect(formatSessionDuration(3840)).toBe("1 Std 04 Min");
    expect(formatSessionDuration(3600)).toBe("1 Std");
    expect(formatSessionDuration(20)).toBe("1 Min");
    for (const value of [null, undefined, 0, -5, Number.NaN, 60 * 60 * 13, "3120"]) {
      expect(formatSessionDuration(value)).toBeNull();
    }
  });

  it("groups by calendar month and labels recent days", () => {
    const months = groupHistoryByMonth([
      { workoutDay: "2026-09-24" }, { workoutDay: "2026-09-02" }, { workoutDay: "2026-08-29" },
    ]);
    expect(months.map((month) => [month.label, month.entries.length])).toEqual([["September 2026", 2], ["August 2026", 1]]);
    expect(historyDayLabel("2026-09-24", "2026-09-24")).toBe("Heute");
    expect(historyDayLabel("2026-09-23", "2026-09-24")).toBe("Gestern");
    expect(historyDayLabel("2026-09-17", "2026-09-24")).toBe("Do");
  });
});

describe("exact session for a plan day", () => {
  const log = (data: Record<string, unknown>) => ({ plan_id: planA, workout_day: "2026-09-24", completed: true, ...data });

  it("is only this plan's completed day-session on that date", () => {
    expect(hasCompletedSession([log({})], planA, "2026-09-24")).toBe(true);
    expect(hasCompletedSession([log({ plan_id: planB })], planA, "2026-09-24")).toBe(false);
    expect(hasCompletedSession([log({ workout_day: "2026-09-23" })], planA, "2026-09-24")).toBe(false);
    expect(hasCompletedSession([log({ completed: false })], planA, "2026-09-24")).toBe(false);
    expect(hasCompletedSession([log({ exercise_index: 0, week_key: "Week 3", day_index: 3 })], planA, "2026-09-24")).toBe(false);
    expect(hasCompletedSession([log({})], undefined, "2026-09-24")).toBe(false);
  });
});

describe("historical sets", () => {
  it("show reps and weight only when user-recorded", () => {
    const sets = readHistoricalSets([{ id: "p1", docs: [
      setDoc("s1", { setNumber: 1, performanceSource: "user-recorded", repsCompleted: 10, weightUsed: 52.5, completed: true }),
      setDoc("s2", { setNumber: 2, performanceSource: "completion-only", completed: true }),
      // Before the marker the checkbox copied the prescription: not a measurement.
      setDoc("s3", { setNumber: 3, repsCompleted: 12, weightUsed: 60 }),
      setDoc("s4", { setNumber: 4, performanceSource: "user-recorded", repsCompleted: 8, completed: true }),
      setDoc("s5", { setNumber: 5, performanceSource: "user-recorded", weightUsed: 10, completed: true }),
      // Recorded but never ticked: stays open.
      setDoc("s6", { setNumber: 6, performanceSource: "user-recorded", repsCompleted: 9, weightUsed: 50, completed: false }),
      setDoc("s7", { setNumber: 7, performanceSource: "user-recorded", repsCompleted: 8.5, completed: true }),
    ] }]);
    expect(sets).toEqual([
      { setNumber: 1, completed: true, reps: 10, weightKg: 52.5 },
      { setNumber: 2, completed: true, reps: null, weightKg: null },
      { setNumber: 3, completed: true, reps: null, weightKg: null },
      { setNumber: 4, completed: true, reps: 8, weightKg: null },
      { setNumber: 5, completed: true, reps: null, weightKg: 10 },
      { setNumber: 6, completed: false, reps: 9, weightKg: 50 },
      { setNumber: 7, completed: true, reps: null, weightKg: null },
    ]);
  });

  it("take the first document per set number, parents by id, as the running workout does", () => {
    const sets = readHistoricalSets([
      { id: "p2", docs: [setDoc("a", { setNumber: 1, performanceSource: "user-recorded", repsCompleted: 99, completed: true })] },
      { id: "p1", docs: [
        setDoc("b", { setNumber: 1, performanceSource: "user-recorded", repsCompleted: 5, completed: true }),
        setDoc("a", { setNumber: 1, performanceSource: "user-recorded", repsCompleted: 6, completed: true }),
        setDoc("c", { setNumber: 0, completed: true }),
        setDoc("d", { setNumber: "2", completed: true }),
      ] },
    ]);
    expect(sets).toEqual([{ setNumber: 1, completed: true, reps: 6, weightKg: null }]);
  });
});

describe("session detail", () => {
  const detailSource = (docs: StoredDocument[], plans: Record<string, unknown>, sets: Record<string, StoredDocument[]> = {}) => ({
    daySessionLogs: vi.fn(async (planId: string, workoutDay: string) =>
      docs.filter((doc) => doc.data.planId === planId && doc.data.workoutDay === workoutDay)),
    planContent: vi.fn(async (planId: string) => plans[planId] ?? null),
    positionLogs: vi.fn(async (planId: string, weekKey: string, dayIndex: number) =>
      docs.filter((doc) => doc.data.planId === planId && doc.data.weekKey === weekKey && doc.data.dayIndex === dayIndex)),
    setDocuments: vi.fn(async (logId: string) => sets[logId] ?? []),
  }) satisfies SessionDetailSource;
  const recorded = (setNumber: number, reps: number | null, weightUsed: number | null, completed = true) => setDoc(`s${setNumber}`, {
    setNumber, completed, performanceSource: "user-recorded",
    ...(reps !== null ? { repsCompleted: reps } : {}), ...(weightUsed !== null ? { weightUsed } : {}),
  });
  const ticked = (setNumber: number) => setDoc(`s${setNumber}`, { setNumber, completed: true, performanceSource: "completion-only" });

  it("is exactly one session or nothing - never another one in its place", async () => {
    const source = detailSource([
      daySession("other-plan", { planId: planB }),
      daySession("not-done", { workoutDay: "2026-09-23", completed: false }),
      exerciseLog("ex", { workoutDay: "2026-09-22" }),
    ], { [planA]: planAContent });
    expect(await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-24" })).toBeNull();
    expect(await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-23" })).toBeNull();
    expect(await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-22" })).toBeNull();
  });

  /** A parent as the set writer creates it: a place for sets, not a tick. */
  const setParent = (id: string, exerciseIndex: number, data: Record<string, unknown> = {}) =>
    exerciseLog(id, { exerciseIndex, completed: false, ...data });
  const load = async (source: ReturnType<typeof detailSource>, today = "2026-09-30") =>
    buildSessionDetail((await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-24" }))!, today);
  const rowsOf = (model: Awaited<ReturnType<typeof load>>) =>
    model.exercises.map((exercise) => [exercise.number, exercise.name, exercise.note, exercise.summary]);

  it("lists the positions with stored activity, named from the own plan", async () => {
    const source = detailSource([
      daySession("d", { durationSec: 3120 }),
      setParent("e0", 0),
      setParent("e1", 1),
      // Same position, another day: not this session's.
      setParent("e1-other", 1, { workoutDay: "2026-09-17" }),
      // A parent without activity and without sets proves nothing.
      setParent("e2", 2),
      // A position past the plan day: kept as "Übung 4", never renamed.
      setParent("e3", 3),
    ], { [planA]: planAContent, [planB]: planBContent }, {
      e0: [recorded(1, 10, 52.5), recorded(2, 9, null), recorded(3, 8, 50, false)],
      e1: [ticked(1), ticked(2), ticked(3)],
      "e1-other": [recorded(1, 99, 99)],
      e3: [ticked(1)],
    });
    const record = await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-24" });
    expect(source.planContent).toHaveBeenCalledWith(planA);
    expect(source.planContent).not.toHaveBeenCalledWith(planB);
    // The cached record keeps names of evidenced positions only, not the plan.
    expect(JSON.stringify(record)).not.toMatch(/Oberkörper A|Dips/);
    const model = buildSessionDetail(record!, "2026-09-24");
    expect(model.title).toBe("Oberkörper B");
    expect(model.eyebrow).toBe("Donnerstag · 24. Sep. 2026 · Heute");
    // Stored facts only: duration and ticked sets. No "x/y" from the plan.
    expect(model.meta).toBe("52 Min · 6 Sätze abgehakt");
    expect(model.context).toBe("4-Wochen-Plan · Woche 3");
    expect(model.notice).toBeNull();
    expect(rowsOf(model)).toEqual([
      [1, "Schulterdrücken", null, null],
      [2, "Latziehen", null, "3 Sätze abgehakt · keine Werte erfasst"],
      [4, "Übung 4", "Name nicht mehr zuordenbar", "1 Satz abgehakt · keine Werte erfasst"],
    ]);
    // Dips (position 3) is in the plan but has no activity: not presented as performed.
    expect(model.exercises.map((exercise) => exercise.name)).not.toContain("Dips");
    expect(model.exercises[0].sets).toEqual([
      { setNumber: 1, completed: true, reps: 10, weightKg: 52.5 },
      { setNumber: 2, completed: true, reps: 9, weightKg: null },
      { setNumber: 3, completed: false, reps: 8, weightKg: 50 },
    ]);
    expect(model.exercises[0].hasWeight).toBe(true);
    expect(model.exercises.some((exercise) => "count" in exercise)).toBe(false);
  });

  it("does not show an exercise appended to the plan day after the session", async () => {
    const stored = [daySession("d", { weekKey: "Week 1" }), setParent("e0", 0, { weekKey: "Week 1" }),
      setParent("e1", 1, { weekKey: "Week 1" }), setParent("e2", 2, { weekKey: "Week 1" })];
    const sets = { e0: [ticked(1)], e1: [ticked(1)], e2: [ticked(1)] };
    const before = { "Week 1": week("Push A", ["A", "B", "C"]) };
    const after = { "Week 1": week("Push A", ["A", "B", "C", "D"]) };
    const then = await load(detailSource(stored, { [planA]: before }, sets));
    const now = await load(detailSource(stored, { [planA]: after }, sets));
    expect(now.exercises.map((exercise) => exercise.name)).toEqual(["A", "B", "C"]);
    expect(now).toEqual(then);
  });

  it("does not turn a changed set prescription into a historical denominator", async () => {
    const stored = [daySession("d", { weekKey: "Week 1" }), setParent("e0", 0, { weekKey: "Week 1" })];
    const sets = { e0: [ticked(1), ticked(2), ticked(3)] };
    const withSets = (count: number) => ({
      "Week 1": week("Push A", []).map((day, index) => (index === 3 ? { day: "Push A", exercises: [ex("A", count)] } : day)),
    });
    const then = await load(detailSource(stored, { [planA]: withSets(3) }, sets));
    const now = await load(detailSource(stored, { [planA]: withSets(5) }, sets));
    expect(now.meta).toBe("3 Sätze abgehakt");
    expect(rowsOf(now)).toEqual([[1, "A", null, "3 Sätze abgehakt · keine Werte erfasst"]]);
    expect(JSON.stringify(now)).not.toMatch(/\d\/\d/);
    expect(now).toEqual(then);
  });

  it("keeps a ticked exercise without sets, as a numbered position when the plan is gone", async () => {
    const source = detailSource([
      daySession("d"),
      setParent("e1", 1, { completed: true }),
      setParent("e2", 2),
      setParent("e3", 3, { durationMinutes: 12 }),
    ], {}, { e2: [recorded(1, 10, 20)] });
    const model = await load(source);
    expect(model.title).toBe("Training");
    expect(model.meta).toBe("1 Satz abgehakt");
    expect(model.context).toBeNull();
    expect(model.notice).toMatch(/^Der Plan zu diesem Training ist nicht mehr verfügbar/);
    expect(rowsOf(model)).toEqual([
      [2, "Übung 2", null, "Als erledigt markiert · keine Sätze erfasst"],
      [3, "Übung 3", null, null],
      [4, "Übung 4", null, "Aktivität gespeichert · keine Sätze erfasst"],
    ]);
  });

  it("presents nothing as performed when no position has activity", async () => {
    const source = detailSource([daySession("d"), setParent("e0", 0)], { [planA]: planAContent });
    const model = await load(source);
    expect(model.exercises).toEqual([]);
    expect(model.meta).toBeNull();
    expect(model.notice).toBe("Übungen und Sätze sind zu diesem Training nicht gespeichert.");
  });

  it("says in one sentence what a legacy completion stored", async () => {
    const source = detailSource([daySession("d", { weekKey: undefined, dayIndex: undefined })], { [planA]: planAContent });
    const record = await loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-24" });
    expect(record?.positions).toBeNull();
    expect(source.positionLogs).not.toHaveBeenCalled();
    const model = buildSessionDetail(record!, "2026-09-30");
    expect(model).toMatchObject({ title: "Training", meta: null, exercises: [] });
    expect(model.notice).toMatch(/nur Datum und Abschluss gespeichert/);
  });

  it("rejects when a read fails, rather than reporting nothing", async () => {
    const source = detailSource([daySession("d")], { [planA]: planAContent });
    source.setDocuments.mockRejectedValue(new Error("unavailable"));
    source.positionLogs.mockResolvedValue([exerciseLog("e0")]);
    await expect(loadSessionRecord(source, { planId: planA, workoutDay: "2026-09-24" })).rejects.toThrow("unavailable");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isLegacyDayCompletionPayload } from "./offlineQueue";
import { hasCanonicalMetadata, summariseHistoryCoverage } from "./workoutLog";

const SRC = join(process.cwd(), "src");
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (relative: string) => stripComments(readFileSync(join(SRC, relative), "utf-8"));

describe("legacy day-completion detection", () => {
  it("recognises the pre-PR48 shape", () => {
    expect(isLegacyDayCompletionPayload({ workoutDateStr: "2026-03-10", completed: true })).toBe(true);
  });

  it("does not mistake an exercise completion for one", () => {
    expect(
      isLegacyDayCompletionPayload({
        planId: "p",
        weekKey: "Week 1",
        dayIndex: 0,
        exerciseIndex: 2,
        completed: true,
      })
    ).toBe(false);
  });

  it("does not mistake the canonical day payload for one", () => {
    expect(
      isLegacyDayCompletionPayload({
        planId: "p",
        weekKey: "Week 1",
        dayIndex: 0,
        workoutDay: "2026-03-10",
        completed: true,
      })
    ).toBe(false);
  });

  it("rejects junk without throwing", () => {
    for (const value of [null, undefined, "x", 3, [], {}]) {
      expect(isLegacyDayCompletionPayload(value)).toBe(false);
    }
  });
});

describe("history coverage (reports, never mutates)", () => {
  const canonical = {
    id: "a",
    planId: "p",
    weekKey: "Week 1",
    dayIndex: 2,
    workoutDay: "2026-03-10",
  };

  it("recognises a fully-specified row", () => {
    expect(hasCanonicalMetadata(canonical)).toBe(true);
  });

  it.each([
    ["no workoutDay", { ...canonical, workoutDay: undefined }],
    ["no weekKey", { ...canonical, weekKey: null }],
    ["no dayIndex", { ...canonical, dayIndex: null }],
    ["no planId", { ...canonical, planId: "" }],
    ["a malformed date", { ...canonical, workoutDay: "10.03.2026" }],
  ])("treats a row with %s as partial", (_name, log) => {
    expect(hasCanonicalMetadata(log)).toBe(false);
  });

  it("splits a mixed history without changing it", () => {
    const logs = [canonical, { id: "b" }, { id: "c", planId: "p" }];
    const before = JSON.stringify(logs);

    expect(summariseHistoryCoverage(logs)).toEqual({ total: 3, canonical: 1, partial: 2 });
    expect(JSON.stringify(logs)).toBe(before);
  });
});

describe("write-path contracts", () => {
  it("day completion never reads exerciseIndex", () => {
    const handlers = read("lib/offlineHandlers.ts");
    const dayHandler = handlers.slice(handlers.indexOf("TOGGLE_DAY:"));

    expect(dayHandler).not.toMatch(/exerciseIndex/);
  });

  it("the day producer maps to an explicit queue payload", () => {
    // The root cause was queuing raw mutation variables.
    const producer = read("hooks/queries/useWorkoutLogs.ts");

    expect(producer).toMatch(/offlineActionType:\s*"TOGGLE_DAY"/);
    expect(producer).toMatch(/toOfflinePayload/);
  });

  it("introduces no migration or backfill over workout_logs", () => {
    /*
      Semantic, not word-matching: a migration would be a declared routine that
      also touches the collection. Prose mentioning the word is not a migration,
      and neither is a test asserting the word is absent from the UI.
    */
    const walk = (path: string): string[] =>
      readdirSync(path).flatMap((entry) => {
        const full = join(path, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
      });

    const offenders = walk(SRC)
      .filter((file) => !file.endsWith("offlineQueueContract.test.ts"))
      .filter((file) => {
        const code = stripComments(readFileSync(file, "utf-8"));
        const declaresMigration =
          /\b(?:function|const|let|class)\s+\w*(?:migrate|backfill)\w*/i.test(code);
        return declaresMigration && /workout_logs/.test(code);
      });

    expect(offenders).toEqual([]);
  });

  it("adds no AI or provider call", () => {
    const preferences = read("lib/coachingPreferences.ts");

    expect(preferences).not.toMatch(/fetch\(|httpsCallable|openai|anthropic|gemini/i);
  });
});

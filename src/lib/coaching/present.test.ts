import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  durationCaption,
  durationText,
  formatDuration,
  historyNote,
  suggestionText,
} from "./present";
import { computeDurationCoverage } from "./facts";
import type { CoachingSuggestion, SuggestionCode } from "./suggestions";

const ALL_CODES: SuggestionCode[] = [
  "adherence-high",
  "adherence-low",
  "adherence-partial",
  "progression-weight",
  "progression-reps",
  "progression-sets",
  "volume-reduced",
  "frequency-mismatch",
  "session-length-mismatch",
  "plan-finished",
  "no-data",
];

const sample = (code: SuggestionCode): CoachingSuggestion => ({
  code,
  priority: 1,
  params: {
    completed: 2,
    scheduled: 3,
    percent: 67,
    exercise: "Bankdrücken",
    previous: 60,
    current: 62.5,
    preferred: 4,
    measured: 90,
    coverage: "full",
  },
});

describe("suggestion copy", () => {
  it.each(ALL_CODES)("%s produces non-empty German text", (code) => {
    const text = suggestionText(sample(code));

    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/undefined|NaN|\[object/);
  });

  it("never attributes a statement to AI", () => {
    // The numbers are arithmetic. Claiming a model produced them would be the
    // same untruth PR46 removed.
    const everything = ALL_CODES.map((code) => suggestionText(sample(code))).join(" ");

    expect(everything).not.toMatch(/\bKI\b/);
    expect(everything).not.toMatch(/\bAI\b/i);
    expect(everything).not.toMatch(/generiert|intelligent/i);
  });

  it("makes no medical, injury or shame claim", () => {
    const everything = ALL_CODES.map((code) => suggestionText(sample(code))).join(" ");

    expect(everything).not.toMatch(/übertrain|overtrain|verletz|injur|schmerz|rehab|müdigkeit|fatigue/i);
    expect(everything).not.toMatch(/faul|versagt|schlecht gemacht|enttäusch/i);
  });

  it("states the real numbers it was given", () => {
    expect(suggestionText(sample("adherence-high"))).toContain("2 von 3");
    expect(suggestionText(sample("progression-weight"))).toContain("62,5");
    expect(suggestionText(sample("frequency-mismatch"))).toContain("4");
  });

  it("marks a partly measured length comparison as partial", () => {
    const partial = suggestionText({
      code: "session-length-mismatch",
      priority: 1,
      params: { preferred: 45, measured: 90, coverage: "partial" },
    });

    expect(partial).toMatch(/Nicht jede Einheit wurde erfasst/);
  });
});

describe("duration copy", () => {
  it("says nothing was measured rather than showing zero", () => {
    const none = computeDurationCoverage([{ durationSec: null }]);

    expect(durationText(none)).toBe("Dauer nicht erfasst");
    expect(durationText(none)).not.toMatch(/0\s*Min/);
  });

  it("labels a partial total as a lower bound", () => {
    const partial = computeDurationCoverage([{ durationSec: 2700 }, { durationSec: null }]);

    expect(durationText(partial)).toBe("mind. 45 Min.");
    // Both counts, so the reader can see how much of the week the floor covers.
    expect(durationCaption(partial)).toBe("1 von 2 Einheiten erfasst");
  });

  it("shows a full measured total without qualification", () => {
    const full = computeDurationCoverage([{ durationSec: 2700 }, { durationSec: 2700 }]);

    expect(durationText(full)).toBe("1 Std. 30 Min.");
    expect(durationCaption(full)).toBeNull();
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(600)).toBe("10 Min.");
    expect(formatDuration(3600)).toBe("1 Std.");
    expect(formatDuration(4500)).toBe("1 Std. 15 Min.");
  });
});

describe("history note", () => {
  it("explains partial history in plain German", () => {
    const note = historyNote({ state: "partial", usableCount: 2, unusableCount: 1 });

    expect(note).toBe("Für ältere Trainingseinträge sind nicht alle Details verfügbar.");
  });

  it("exposes no internal terminology", () => {
    const note = historyNote({ state: "partial", usableCount: 1, unusableCount: 1 }) ?? "";

    expect(note).not.toMatch(/firestore|schema|migration|dokument|legacy|metadata/i);
  });

  it("stays silent when history is complete or unusable", () => {
    expect(historyNote({ state: "complete", usableCount: 3, unusableCount: 0 })).toBeNull();
    expect(historyNote({ state: "insufficient", usableCount: 0, unusableCount: 2 })).toBeNull();
  });
});

describe("the coaching layer is self-contained", () => {
  const dir = join(process.cwd(), "src/lib/coaching");
  const sources = readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .filter((entry) => /\.tsx?$/.test(entry) && !entry.includes(".test."));

  it("has sources to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)("%s imports no Firebase, React or network", (file) => {
    const code = readFileSync(join(dir, file), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(/from\s+["']firebase/);
    expect(code).not.toMatch(/from\s+["']react/);
    expect(code).not.toMatch(/@\/lib\/firebase/);
    expect(code).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/);
  });

  it.each(sources)("%s calls no AI provider", (file) => {
    const code = readFileSync(join(dir, file), "utf-8");

    expect(code).not.toMatch(/openai|anthropic|gemini|mistral|httpsCallable|generateContent/i);
  });

  it.each(sources)("%s reads no clock", (file) => {
    // Every date-sensitive function takes its reference period explicitly, so
    // the same inputs always produce the same facts.
    const code = readFileSync(join(dir, file), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\s*\)/);
  });

  it.each(sources)("%s performs no Firestore write", (file) => {
    const code = readFileSync(join(dir, file), "utf-8");

    expect(code).not.toMatch(/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\b/);
  });
});

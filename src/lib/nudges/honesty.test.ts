import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  NUDGE_DELIVERY_NOTE,
  PLANNED_SESSION_TEXT,
  UNFINISHED_SESSION_TEXT,
  weeklyConsistencyText,
} from "./copy";

/**
 * Source-level guards for what this feature promises and what it costs.
 *
 * Three claims are being protected, and none of them can be shown by
 * rendering a component:
 *
 *   1. No notification text is generated. If a Gemini call ever appears in
 *      this layer, notifications start consuming the weekly-review AI quota
 *      for sentences that never vary.
 *   2. Nothing in this layer writes. A reminder that could modify a plan, a
 *      log or a completion is not a reminder.
 *   3. Nothing claims background delivery. There is no push backend in this
 *      app, so a nudge that promises to arrive while the app is closed is a
 *      promise the architecture cannot keep.
 */

const NUDGE_SOURCES = [
  "src/lib/nudges",
  "src/hooks/useTrainingNudge.ts",
  "src/components/dashboard/TrainingNudgeCard.tsx",
  "src/components/profile/NotificationSettingsCard.tsx",
];

const filesUnder = (relative: string): string[] => {
  const full = join(process.cwd(), relative);
  if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) {
    return readdirSync(full)
      .filter((entry) => /\.tsx?$/.test(entry) && !entry.endsWith(".test.ts"))
      .map((entry) => join(relative, entry));
  }
  return [relative];
};

const sources = NUDGE_SOURCES.flatMap(filesUnder);

/** Comments name the forbidden APIs to record why they are absent. */
const code = (relative: string): string =>
  readFileSync(join(process.cwd(), relative), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the nudge layer consumes no AI", () => {
  const forbidden = [
    "gemini",
    "generateContent",
    "generativelanguage",
    "httpsCallable",
    "useAISessions",
    "aiQuota",
  ];

  it.each(sources)("%s calls no model", (file) => {
    const text = code(file).toLowerCase();
    forbidden.forEach((symbol) => expect(text).not.toContain(symbol.toLowerCase()));
  });
});

describe("the nudge layer writes nothing", () => {
  const writes = ["setDoc", "updateDoc", "addDoc", "deleteDoc", "writeBatch", "useMutation"];

  it.each(sources)("%s performs no document write", (file) => {
    const text = code(file);
    writes.forEach((symbol) => expect(text).not.toContain(symbol));
  });

  it.each(sources)("%s does not reach Firestore at all", (file) => {
    expect(code(file)).not.toMatch(/from ["']firebase\//);
    expect(code(file)).not.toMatch(/@\/lib\/firebase/);
  });
});

describe("the nudge layer claims no background delivery", () => {
  const pushApis = ["pushManager", "getMessaging", "getToken", "firebase/messaging", "VAPID"];

  it.each(sources)("%s subscribes to no push channel", (file) => {
    const text = code(file);
    pushApis.forEach((symbol) => expect(text).not.toContain(symbol));
  });

  it("states plainly that hints appear while the app is open", () => {
    expect(NUDGE_DELIVERY_NOTE).toContain("geöffnet");
  });

  it("promises nothing about a closed app or a fixed time", () => {
    const copy = [
      NUDGE_DELIVERY_NOTE,
      PLANNED_SESSION_TEXT.title,
      PLANNED_SESSION_TEXT.body,
      UNFINISHED_SESSION_TEXT.title,
      UNFINISHED_SESSION_TEXT.body,
      weeklyConsistencyText(2, 3).title,
      weeklyConsistencyText(2, 3).body,
    ].join(" ");

    expect(copy).not.toMatch(/erinnern wir dich|wir erinnern|um \d{1,2}:\d{2}|Uhr\b/i);
  });
});

describe("tone", () => {
  const copy = [
    PLANNED_SESSION_TEXT,
    UNFINISHED_SESSION_TEXT,
    weeklyConsistencyText(1, 3),
  ].flatMap((text) => [text.title, text.body]);

  it.each(copy)("%s makes no demand of the user", (line) => {
    expect(line).not.toMatch(/du musst|du solltest|nicht vergessen|schaffst du/i);
  });

  it.each(copy)("%s applies no streak or guilt pressure", (line) => {
    expect(line).not.toMatch(/streak|serie|verpasst|leider|schade|dranbleiben|durchhalten/i);
  });

  it.each(copy)("%s assumes nothing about motivation or recovery", (line) => {
    expect(line).not.toMatch(/motivation|müde|erschöpft|erholung|regeneration|energie/i);
  });
});

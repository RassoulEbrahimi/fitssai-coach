import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_LOG_FIELDS,
  aiLogCollectionPath,
  findForbiddenLogFields,
  type AiLogEntry,
} from "./aiLog";

/*
  There is no writer yet — deliberately, since with no AI request to record a
  writer could only produce fictional documents in a real user's history. What
  is pinned here is the contract the first writer will have to satisfy.
*/

const entry: AiLogEntry = {
  action: "plan_generation",
  status: "success",
  provider: "example",
  model: "example-v1",
  latencyMs: 1200,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("ai log contract", () => {
  it("writes under the user's own document, where the app already reads", () => {
    expect(aiLogCollectionPath("user-1")).toBe("users/user-1/ai_logs");
  });

  it("records what happened, not what was said", () => {
    expect(findForbiddenLogFields({ ...entry })).toEqual([]);
  });

  it.each([...FORBIDDEN_LOG_FIELDS])("refuses an entry carrying %s", (field) => {
    expect(findForbiddenLogFields({ ...entry, [field]: "x" })).toContain(field);
  });

  it("keeps prompts and responses out of the field list entirely", () => {
    expect([...FORBIDDEN_LOG_FIELDS]).toEqual(
      expect.arrayContaining(["prompt", "response", "completion", "messages", "apiKey"])
    );
  });

  it("has no writer implementation in this PR", async () => {
    const module = (await import("./aiLog")) as Record<string, unknown>;
    const callables = Object.entries(module).filter(([, value]) => typeof value === "function");

    // Only the two pure helpers. Nothing here can reach Firestore.
    expect(callables.map(([name]) => name).sort()).toEqual([
      "aiLogCollectionPath",
      "findForbiddenLogFields",
    ]);
  });
});

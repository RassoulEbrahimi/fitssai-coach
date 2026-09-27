import { describe, it, expect, afterEach } from "vitest";
import {
  TRANSPORT_RETRY_BACKOFF_MS,
  createGoogleGenAiClient,
  extractGenAiText,
  extractGenAiUsage,
  genAiErrorStatus,
  isTransientGenAiError,
  parseGenAiJson,
  runWithTransportRetry,
} from "./googleGenai";

/*
  NUT-12B: the provider-neutral Google GenAI transport. No prompt, schema,
  model or setting lives here; constructing a client makes no request, and no
  test here reaches the network.
*/

type SdkFields = { vertexai: boolean; apiKey?: string; project?: string; location?: string };

describe("building a client for one explicit connection", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("the Gemini Developer API: an API key, no Vertex project or location", () => {
    const client = createGoogleGenAiClient({ kind: "developerApi", apiKey: "test-key" }) as unknown as SdkFields;
    expect(client.vertexai).toBe(false);
    expect(client.apiKey).toBe("test-key");
  });

  it("Vertex AI: the explicit project and location, and no API key — even with one in the environment", () => {
    process.env.GOOGLE_API_KEY = "environment-key-must-not-be-used";
    process.env.GOOGLE_CLOUD_PROJECT = "environment-project";
    process.env.GOOGLE_CLOUD_LOCATION = "environment-location";
    const client = createGoogleGenAiClient({ kind: "vertex", project: "fixture-project", location: "fixture-location" }) as unknown as SdkFields;
    expect(client.vertexai).toBe(true);
    expect(client.project).toBe("fixture-project");
    expect(client.location).toBe("fixture-location");
    expect(client.apiKey).toBeUndefined();
  });
});

describe("reading a response", () => {
  it("takes the SDK's text, or the first candidate's parts", () => {
    expect(extractGenAiText({ text: "{}" })).toBe("{}");
    expect(extractGenAiText({ candidates: [{ content: { parts: [{ text: '{"a"' }, { text: ":1}" }] } }] })).toBe('{"a":1}');
    expect(extractGenAiText({ candidates: [] })).toBeUndefined();
  });

  it("parses JSON or answers undefined", () => {
    expect(parseGenAiJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseGenAiJson("Guten Tag")).toBeUndefined();
  });

  it("reads only numeric usage; absent stays absent", () => {
    expect(extractGenAiUsage({ usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
    expect(extractGenAiUsage({})).toEqual({});
  });
});

describe("classifying failures", () => {
  it.each([
    [{ status: 429 }, true],
    [{ status: 500 }, true],
    [{ status: 503 }, true],
    [{ code: 502 }, true],
    [{ status: 400 }, false],
    [{ status: 401 }, false],
    [{ status: 403 }, false],
    [{ status: 404 }, false],
    [new Error("no status"), false],
  ])("%j transient: %s", (error, transient) => {
    expect(isTransientGenAiError(error)).toBe(transient);
  });

  it("reads a status, never a message", () => {
    expect(genAiErrorStatus({ status: 429, message: "project 123" })).toBe(429);
    expect(genAiErrorStatus({ message: "503" })).toBeUndefined();
  });
});

describe("the bounded retry loop", () => {
  const failingThen = (errors: unknown[], value = "ok") => {
    let calls = 0;
    return {
      calls: () => calls,
      operation: async () => {
        calls += 1;
        if (calls <= errors.length) throw errors[calls - 1];
        return value;
      },
    };
  };

  it("retries transient failures up to the bound, pausing 250 ms × attempt", async () => {
    const sleeps: number[] = [];
    const run = failingThen([{ status: 503 }, { status: 429 }]);
    const outcome = await runWithTransportRetry(run.operation, { maxAttempts: 3, sleep: async (ms) => void sleeps.push(ms) });
    expect(outcome).toEqual({ ok: true, value: "ok" });
    expect(run.calls()).toBe(3);
    expect(sleeps).toEqual([TRANSPORT_RETRY_BACKOFF_MS, 2 * TRANSPORT_RETRY_BACKOFF_MS]);
  });

  it("stops at the bound and hands back the last failure raw, for the adapter to classify", async () => {
    const last = { status: 503, message: "raw" };
    const run = failingThen([{ status: 503 }, last, { status: 503 }]);
    const outcome = await runWithTransportRetry(run.operation, { maxAttempts: 2, sleep: async () => undefined });
    expect(outcome).toEqual({ ok: false, error: last });
    expect(run.calls()).toBe(2);
  });

  it("does not retry what would fail again", async () => {
    for (const status of [400, 401, 403]) {
      const run = failingThen([{ status }]);
      const outcome = await runWithTransportRetry(run.operation, { maxAttempts: 3, sleep: async () => undefined });
      expect(outcome.ok).toBe(false);
      expect(run.calls()).toBe(1);
    }
  });

  it("uses the adapter's retry rule when one is given", async () => {
    const run = failingThen([{ status: 503 }]);
    await runWithTransportRetry(run.operation, { maxAttempts: 3, sleep: async () => undefined, isRetryable: () => false });
    expect(run.calls()).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { handleCoachBackendStatus } from "./status";
import { requireAuth } from "../auth";
import { BACKEND_CAPABILITIES, FUNCTIONS_REGION } from "../config";

/*
  The callable exists to prove one thing: a signed-in client reaches verified
  server-side code. These tests pin the boundary itself — who is refused, whose
  identity is believed, and what the response is allowed to claim.
*/

const signedIn = (uid: string) => ({ auth: { uid } });

describe("authentication boundary", () => {
  it("refuses a call with no auth context", () => {
    expect(() => handleCoachBackendStatus({})).toThrow(HttpsError);
    expect(() => handleCoachBackendStatus({})).toThrow(/Authentication required/);
  });

  it.each([{ auth: null }, { auth: { uid: null } }, { auth: { uid: "" } }, { auth: { uid: "   " } }])(
    "refuses %j",
    (request) => {
      expect(() => handleCoachBackendStatus(request)).toThrow(HttpsError);
    }
  );

  it("uses the unauthenticated error code, not a generic failure", () => {
    try {
      requireAuth({});
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpsError);
      expect((error as HttpsError).code).toBe("unauthenticated");
    }
  });

  it("accepts an authenticated call", () => {
    const result = handleCoachBackendStatus(signedIn("user-123"));

    expect(result.ok).toBe(true);
    expect(result.uid).toBe("user-123");
  });

  it("believes the token, not the payload", () => {
    /*
      The whole point of the guard. A caller signed in as `real-user` sends a
      payload claiming to be `victim` and to be an admin; the server resolves
      identity from the verified auth context and never reads the data.
    */
    const request = {
      auth: { uid: "real-user" },
      data: { uid: "victim", userId: "victim", admin: true, role: "admin" },
    };

    const result = handleCoachBackendStatus(request);

    expect(result.uid).toBe("real-user");
    expect(JSON.stringify(result)).not.toContain("victim");
    expect(JSON.stringify(result)).not.toMatch(/admin/i);
  });
});

describe("what the response says", () => {
  const result = handleCoachBackendStatus(signedIn("user-123"));

  it("reports the deployed region so a mismatch is visible", () => {
    expect(result.region).toBe(FUNCTIONS_REGION);
    expect(result.region.startsWith("europe-")).toBe(true);
  });

  it("reports both shipped capabilities as available", () => {
    // planGeneration became true in PR55 and weeklySummaryAI in PR58, each
    // when a real callable and a real model shipped behind it — a capability
    // flag is a claim, not an aspiration.
    expect(result.capabilities.planGeneration).toBe(true);
    expect(result.capabilities.weeklySummaryAI).toBe(true);
    expect(result.capabilities).toEqual(BACKEND_CAPABILITIES);
  });

  it("returns no personal data beyond the caller's own uid", () => {
    const keys = Object.keys(result).sort();

    expect(keys).toEqual(["backend", "capabilities", "ok", "region", "uid"]);
    expect(JSON.stringify(result)).not.toMatch(/email|@|displayName|name"/i);
  });

  it("cannot be mutated into misreporting a capability", () => {
    const first = handleCoachBackendStatus(signedIn("a"));
    first.capabilities.weeklySummaryAI = false;

    // The frozen source is copied per call, so one caller cannot poison the next.
    expect(handleCoachBackendStatus(signedIn("b")).capabilities.weeklySummaryAI).toBe(true);
  });
});

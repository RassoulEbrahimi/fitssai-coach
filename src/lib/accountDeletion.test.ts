import { describe, it, expect } from "vitest";
import {
  DELETION_RESPONSE_COMMITMENT,
  SUPPORT_EMAIL,
  isDeletionSupportConfigured,
} from "./accountDeletion";

describe("account-deletion support configuration", () => {
  it("ships with neither value supplied", () => {
    // No real support address or response commitment has been provided, so
    // nothing may be shown that implies one exists.
    expect(SUPPORT_EMAIL).toBeNull();
    expect(DELETION_RESPONSE_COMMITMENT).toBeNull();
    expect(isDeletionSupportConfigured()).toBe(false);
  });

  it("requires both values, not just one", () => {
    expect(isDeletionSupportConfigured("support@example.com", null)).toBe(false);
    expect(isDeletionSupportConfigured(null, "innerhalb von 14 Tagen")).toBe(false);
    expect(isDeletionSupportConfigured("support@example.com", "innerhalb von 14 Tagen")).toBe(true);
  });

  it("treats blank strings as missing", () => {
    expect(isDeletionSupportConfigured("   ", "innerhalb von 14 Tagen")).toBe(false);
    expect(isDeletionSupportConfigured("support@example.com", "  ")).toBe(false);
  });

  it("ships no placeholder token in place of the real values", () => {
    const serialized = JSON.stringify({ SUPPORT_EMAIL, DELETION_RESPONSE_COMMITMENT });
    expect(serialized).not.toMatch(/\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/);
    expect(serialized.toLowerCase()).not.toContain("example.com");
    expect(serialized.toLowerCase()).not.toContain("tbd");
  });
});

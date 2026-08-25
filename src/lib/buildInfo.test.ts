import { describe, it, expect } from "vitest";
import { shortenSha, formatBuildLabel, formatVersionLabel, normalizeVersion } from "./buildInfo";

describe("shortenSha", () => {
  it("takes the first seven characters of a full SHA", () => {
    expect(shortenSha("348328cebef66e185c34172ff97c52482f6ce8f7")).toBe("348328c");
  });

  it("accepts an already-short SHA", () => {
    expect(shortenSha("348328c")).toBe("348328c");
  });

  it("lowercases the result", () => {
    expect(shortenSha("348328CEBEF66E185C34172FF97C52482F6CE8F7")).toBe("348328c");
  });

  it("trims surrounding whitespace from command output", () => {
    expect(shortenSha("  348328cebef66e185c34172ff97c52482f6ce8f7\n")).toBe("348328c");
  });

  it("falls back to 'dev' when Git metadata is unavailable", () => {
    expect(shortenSha(null)).toBe("dev");
    expect(shortenSha(undefined)).toBe("dev");
    expect(shortenSha("")).toBe("dev");
    expect(shortenSha("   ")).toBe("dev");
    expect(shortenSha("unknown")).toBe("dev");
  });

  it("falls back to 'dev' for values that are not SHAs", () => {
    expect(shortenSha("not-a-sha")).toBe("dev");
    expect(shortenSha("v1.2.3")).toBe("dev");
    // Too short to be a commit SHA.
    expect(shortenSha("abc")).toBe("dev");
  });
});

describe("formatBuildLabel", () => {
  it("renders the short SHA", () => {
    expect(formatBuildLabel("348328cebef66e185c34172ff97c52482f6ce8f7")).toBe("Build 348328c");
  });

  it("renders the dev fallback", () => {
    expect(formatBuildLabel(null)).toBe("Build dev");
    expect(formatBuildLabel("unknown")).toBe("Build dev");
  });
});

describe("normalizeVersion", () => {
  it("passes a real version through", () => {
    expect(normalizeVersion("1.4.2")).toBe("1.4.2");
  });

  it("falls back rather than inventing a version", () => {
    expect(normalizeVersion(null)).toBe("0.0.0");
    expect(normalizeVersion(undefined)).toBe("0.0.0");
    expect(normalizeVersion("  ")).toBe("0.0.0");
  });
});

describe("formatVersionLabel", () => {
  it("renders the package version and short SHA", () => {
    expect(formatVersionLabel("1.0.0", "4a9741f3f859136b02c7fc606eff0095a5159757")).toBe(
      "Version 1.0.0 · 4a9741f"
    );
  });

  it("uses the dev fallback for the commit, keeping the real version", () => {
    expect(formatVersionLabel("1.0.0", null)).toBe("Version 1.0.0 · dev");
    expect(formatVersionLabel("1.0.0", "unknown")).toBe("Version 1.0.0 · dev");
  });

  it("falls back on both halves independently", () => {
    expect(formatVersionLabel(null, null)).toBe("Version 0.0.0 · dev");
  });

  it("separates the two parts with a middle dot", () => {
    expect(formatVersionLabel("2.1.0", "abcdef1234")).toContain(" · ");
  });
});

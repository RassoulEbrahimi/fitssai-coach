import { describe, it, expect, beforeEach } from "vitest";
import {
  SIGN_OUT_CLEARED_KEYS,
  SIGN_OUT_PRESERVED_KEYS,
  clearSignOutSensitiveStorage,
} from "./storage";
import { THEME_STORAGE_KEY } from "./theme";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("clearSignOutSensitiveStorage", () => {
  it("removes account-scoped keys", () => {
    for (const key of SIGN_OUT_CLEARED_KEYS) localStorage.setItem(key, "x");

    clearSignOutSensitiveStorage();

    for (const key of SIGN_OUT_CLEARED_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("preserves the theme preference across sign-out", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    clearSignOutSensitiveStorage();

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("preserves every declared device preference", () => {
    for (const key of SIGN_OUT_PRESERVED_KEYS) localStorage.setItem(key, "kept");

    clearSignOutSensitiveStorage();

    for (const key of SIGN_OUT_PRESERVED_KEYS) {
      expect(localStorage.getItem(key)).toBe("kept");
    }
  });

  it("leaves storage owned by anything else on the origin alone", () => {
    // Regression: logout called localStorage.clear(), wiping the whole origin.
    localStorage.setItem("some-other-app.token", "not-ours");
    localStorage.setItem("unrelated", "not-ours");

    clearSignOutSensitiveStorage();

    expect(localStorage.getItem("some-other-app.token")).toBe("not-ours");
    expect(localStorage.getItem("unrelated")).toBe("not-ours");
  });

  it("drops namespaced session caches but not foreign session keys", () => {
    sessionStorage.setItem("fitssai.ai-nudge.abc", "{}");
    sessionStorage.setItem("someone-else", "keep");

    clearSignOutSensitiveStorage();

    expect(sessionStorage.getItem("fitssai.ai-nudge.abc")).toBeNull();
    expect(sessionStorage.getItem("someone-else")).toBe("keep");
  });

  it("never clears a preserved key by accident", () => {
    for (const key of SIGN_OUT_PRESERVED_KEYS) {
      expect(SIGN_OUT_CLEARED_KEYS).not.toContain(key);
    }
  });
});

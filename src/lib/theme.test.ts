import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readStoredTheme,
  applyThemeClass,
  isTheme,
  THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
} from "./theme";

describe("theme storage", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("returns 'system' when nothing is stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("reads the canonical namespaced key", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("migrates a valid legacy 'theme' value to 'fitssai.theme'", () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, "dark");

    expect(readStoredTheme()).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull();
  });

  it("prefers the canonical key over the legacy key", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, "dark");

    expect(readStoredTheme()).toBe("light");
    // The legacy key is only removed as part of an actual migration.
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("ignores an invalid legacy value instead of guessing", () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, "chartreuse");

    expect(readStoredTheme()).toBe("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe("chartreuse");
  });

  it("does not touch unrelated storage during migration", () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, "dark");
    localStorage.setItem("fitssai:compactCards", "true");
    localStorage.setItem("fitssai.training.session.started", "true");

    readStoredTheme();

    expect(localStorage.getItem("fitssai:compactCards")).toBe("true");
    expect(localStorage.getItem("fitssai.training.session.started")).toBe("true");
  });

  it("validates theme values", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
    expect(isTheme("Dark")).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});

describe("applyThemeClass", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.style.colorScheme = "";
  });

  it("applies exactly one theme class", () => {
    applyThemeClass("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("never leaves light and dark on the root together", () => {
    document.documentElement.classList.add("light", "dark");

    applyThemeClass("light");

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("preserves unrelated classes on the root element", () => {
    document.documentElement.classList.add("some-app-class");

    applyThemeClass("dark");

    expect(document.documentElement.classList.contains("some-app-class")).toBe(true);
  });

  it("sets color-scheme so native controls match", () => {
    applyThemeClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

describe("storage failures", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");

  afterEach(() => {
    if (original) Object.defineProperty(window, "localStorage", original);
  });

  it("falls back to 'system' when storage throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => {
          throw new Error("blocked");
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });

    expect(readStoredTheme()).toBe("system");
  });
});

/**
 * Theme primitives — storage, migration and DOM class application.
 *
 * Kept separate from the React provider so this module stays free of
 * components: the same logic is used by ThemeProvider and mirrored by the
 * pre-hydration script in index.html.
 */

export type Theme = "light" | "dark" | "system";

/** Canonical, namespaced storage key. All FitssAI keys are namespaced. */
export const THEME_STORAGE_KEY = "fitssai.theme";

/**
 * Pre-namespacing key. Read once for migration, then removed.
 * Exported so the pre-hydration script and tests agree on the name.
 */
export const LEGACY_THEME_STORAGE_KEY = "theme";

const VALID_THEMES: readonly Theme[] = ["light", "dark", "system"];

export const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (VALID_THEMES as readonly string[]).includes(value);

/**
 * Resolve the persisted theme, migrating the legacy generic key once.
 *
 * Precedence:
 *   1. `fitssai.theme` wins whenever it holds a valid value.
 *   2. Otherwise a valid legacy `theme` value is copied to `fitssai.theme`.
 *   3. Otherwise "system".
 *
 * The legacy key is removed only after a successful migration, and only that
 * one key — unrelated localStorage data is never touched. An invalid legacy
 * value is left in place rather than guessed at.
 */
export const readStoredTheme = (): Theme => {
  if (typeof window === "undefined") return "system";

  try {
    const current = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(current)) return current;

    const legacy = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (isTheme(legacy)) {
      window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return legacy;
    }
  } catch {
    // Private mode / blocked storage: fall through to the default.
  }

  return "system";
};

export const getSystemTheme = (): "light" | "dark" => {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

/**
 * Apply exactly one theme class to the root element.
 * Both classes are removed first, so `light` and `dark` can never coexist.
 */
export const applyThemeClass = (resolved: "light" | "dark") => {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
};

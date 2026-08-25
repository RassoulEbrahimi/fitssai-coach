import { useState, useEffect, useCallback, createContext, useContext } from "react";
import {
  type Theme,
  THEME_STORAGE_KEY,
  readStoredTheme,
  getSystemTheme,
  applyThemeClass,
} from "@/lib/theme";

interface ThemeContextType {
  theme: Theme;
  actualTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * Single source of truth for the app theme.
 *
 * Storage, migration and DOM class rules live in `@/lib/theme`; the same
 * rules are mirrored by the pre-hydration script in index.html so the first
 * paint already matches the persisted setting.
 */
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  // Initialised from storage so the first render agrees with the class the
  // pre-hydration script already put on <html> — no flash, no second paint.
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [actualTheme, setActualTheme] = useState<"light" | "dark">(() => {
    const stored = readStoredTheme();
    return stored === "system" ? getSystemTheme() : stored;
  });

  const resolveAndApply = useCallback((value: Theme) => {
    const resolved = value === "system" ? getSystemTheme() : value;
    setActualTheme(resolved);
    applyThemeClass(resolved);
  }, []);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // Persisting is best-effort; the in-memory theme still applies.
      }
      resolveAndApply(newTheme);
    },
    [resolveAndApply]
  );

  // Keep the DOM in sync with the current setting.
  useEffect(() => {
    resolveAndApply(theme);
  }, [theme, resolveAndApply]);

  // Follow the OS only while the setting is "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => resolveAndApply("system");
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, resolveAndApply]);

  return (
    <ThemeContext.Provider value={{ theme, actualTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

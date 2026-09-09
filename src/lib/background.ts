export type BackgroundMode = "static" | "animated";

export const BACKGROUND_MODE_STORAGE_KEY = "fitssai.preferences.backgroundMode";

export const parseBackgroundMode = (value: unknown): BackgroundMode =>
  value === "animated" ? "animated" : "static";

export const readStoredBackgroundMode = (): BackgroundMode => {
  try {
    return parseBackgroundMode(window.localStorage.getItem(BACKGROUND_MODE_STORAGE_KEY));
  } catch {
    return "static";
  }
};

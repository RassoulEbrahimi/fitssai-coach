/**
 * Sign-out storage handling.
 *
 * `localStorage.clear()` wipes every key on the origin — the theme, UI
 * preferences, and anything else served from the same host. Signing out only
 * needs to drop what is tied to the account that is signing out, so the keys
 * are named explicitly here and everything else is left alone.
 */

import { AUTH_RECOVERY_MARKER } from "@/lib/authPersistenceRecovery";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import {
  SESSION_STORAGE_KEY,
  LEGACY_SESSION_STARTED_KEY,
  LEGACY_SESSION_START_TIME_KEY,
} from "@/lib/trainingSession";

/** Prefix for every FitssAI-owned key, used to scope the sessionStorage sweep. */
export const FITSSAI_KEY_PREFIX = "fitssai.";

/**
 * Legacy ownerless keys. Clear on every resolved auth transition as well as
 * explicit sign-out. New UID-suffixed caches/sessions stay isolated for their
 * original owner, and the offline queue retains its immutable entry owners.
 */
export const SIGN_OUT_CLEARED_KEYS: readonly string[] = [
  SESSION_STORAGE_KEY,
  LEGACY_SESSION_STARTED_KEY,
  LEGACY_SESSION_START_TIME_KEY,
  "fitssai.training.cache",
  "fitssai.nudges.v1",
  "REACT_QUERY_OFFLINE_CACHE",
];

/**
 * Device preferences, deliberately kept across sign-out — they describe the
 * browser, not the account, and losing them on every logout is a bug, not a
 * security measure.
 */
export const SIGN_OUT_PRESERVED_KEYS: readonly string[] = [
  THEME_STORAGE_KEY,
  "fitssai.preferences.enableAdvancedGlass",
  "fitssai:compactCards",
  "fitssai:lastSmartFocus",
];

const safely = (operation: () => void): void => {
  try {
    operation();
  } catch {
    /* Blocked or full storage: sign-out must still complete. */
  }
};

/**
 * Remove account-scoped storage without touching preferences or any key this
 * app does not own.
 */
export const clearSignOutSensitiveStorage = (): void => {
  safely(() => {
    for (const key of SIGN_OUT_CLEARED_KEYS) {
      localStorage.removeItem(key);
    }
  });

  /*
    Remove any legacy per-tab derived caches. There are currently no active
    sessionStorage writers, but older clients used this namespaced storage.

    The auth recovery marker shares the prefix and must survive: this runs on
    every resolved auth transition, including the failure one, so sweeping the
    marker away would let each failed initialization believe it was the first
    and reload the page forever.
  */
  safely(() => {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(FITSSAI_KEY_PREFIX) && key !== AUTH_RECOVERY_MARKER) doomed.push(key);
    }
    for (const key of doomed) sessionStorage.removeItem(key);
  });
};

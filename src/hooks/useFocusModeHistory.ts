import { useEffect, useRef } from "react";

/** Marks the one history entry Focus Mode owns. The rest of the entry's state is kept. */
export const focusModeHistoryKey = "fitssaiFocusMode";

export const isFocusModeEntry = (state: unknown): boolean =>
  !!state && typeof state === "object" && (state as Record<string, unknown>)[focusModeHistoryKey] === true;

const withFocusModeEntry = (state: unknown, owned: boolean): Record<string, unknown> => {
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  if (owned) base[focusModeHistoryKey] = true;
  else delete base[focusModeHistoryKey];
  return base;
};

/**
 * Focus Mode owns exactly one browser-history level.
 *
 * Opening it pushes one entry at the current URL carrying the entry's existing
 * state (the Trainingsplan stack included) plus a Focus Mode mark, so browser
 * and Android Back close Focus Mode first and leave the screen underneath
 * exactly where it was. An entry that already carries the mark is reused, so
 * a repeated Start or Resume never stacks a second one. Closing it any other
 * way (the exit control, Escape, a finished workout) consumes that entry, so
 * the next Back is the underlying screen's own.
 *
 * Presentation only: nothing here reaches the running workout.
 */
export function useFocusModeHistory(isFocusMode: boolean, setFocusMode: (value: boolean) => void) {
  const openRef = useRef(isFocusMode);
  const wasOpenRef = useRef(false);
  /** Focus Mode was just closed by the history itself; there is no entry left to consume. */
  const closedByHistoryRef = useRef(false);
  /** Our own `history.back()` is on its way; its popstate is not a user's Back. */
  const consumingRef = useRef(false);

  useEffect(() => {
    openRef.current = isFocusMode;
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isFocusMode;

    if (isFocusMode) {
      // Reopened before our own Back landed: the popstate handler pushes afresh.
      if (consumingRef.current) return;
      if (!isFocusModeEntry(window.history.state)) {
        window.history.pushState(withFocusModeEntry(window.history.state, true), "", window.location.href);
      }
      return;
    }
    if (!wasOpen) return;
    if (closedByHistoryRef.current) {
      closedByHistoryRef.current = false;
      return;
    }
    if (isFocusModeEntry(window.history.state)) {
      consumingRef.current = true;
      window.history.back();
    }
  }, [isFocusMode]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (consumingRef.current) {
        consumingRef.current = false;
        if (openRef.current && !isFocusModeEntry(event.state)) {
          window.history.pushState(withFocusModeEntry(event.state, true), "", window.location.href);
        }
        return;
      }
      if (!openRef.current || isFocusModeEntry(event.state)) return;
      closedByHistoryRef.current = true;
      setFocusMode(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setFocusMode]);

  /*
    Safety net: the owner going away while Focus Mode is open must not leave
    the app stuck in it. The mark is dropped in place rather than navigated
    away, so an unexpected unmount never moves the history.
  */
  useEffect(() => () => {
    if (!openRef.current) return;
    openRef.current = false;
    if (!consumingRef.current && isFocusModeEntry(window.history.state)) {
      window.history.replaceState(withFocusModeEntry(window.history.state, false), "", window.location.href);
    }
    setFocusMode(false);
  }, [setFocusMode]);
}

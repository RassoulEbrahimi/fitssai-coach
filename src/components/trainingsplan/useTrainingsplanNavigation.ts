import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readTrainingsplanStack, withTrainingsplanStack, type PushedScreen } from "@/lib/trainingsplanNavigation";

export type TrainingsplanScreen = PushedScreen | { kind: "main" };

/** Marks a control as the one that opened a screen, so Back can return focus to it. */
export const OPENER_ATTRIBUTE = "data-tp-opener";

const openerKey = (element: Element | null): string | null =>
  element?.closest(`[${OPENER_ATTRIBUTE}]`)?.getAttribute(OPENER_ATTRIBUTE) ?? null;

type Pending = { type: "push" } | { type: "pop"; depth: number } | null;

/**
 * The Trainingsplan's own screen stack, kept in the browser history.
 *
 * Main is the root; Day Detail, Plan Overview and editing are pushed on top
 * and popped in reverse, so Back always returns to where a screen was opened
 * from. Every push adds one history entry at the *current URL* carrying the
 * whole stack, so browser and Android Back walk the same hierarchy. The app's
 * tab router only listens for hash changes, and these entries never change
 * the hash, so nothing outside this tab sees them.
 *
 * Presentation only: nothing here reaches the running workout.
 */
export function useTrainingsplanNavigation(planId: string | undefined) {
  const [stack, setStackState] = useState<PushedScreen[]>(() =>
    typeof window === "undefined" ? [] : readTrainingsplanStack(window.history.state, planId)
  );
  const stackRef = useRef(stack);
  const pendingRef = useRef<Pending>(null);
  /** Scroll position and opener of each depth, recorded when leaving it. */
  const scrollByDepth = useRef<number[]>([]);
  const openerByDepth = useRef<(string | null)[]>([]);
  /** The URL hash of the tab's own entries; any other entry belongs to another view. */
  const hashRef = useRef(typeof window === "undefined" ? "" : window.location.hash);
  /*
    The control that was just activated. A click does not focus a button on
    every platform (Safari and iOS never do), so the opener is taken from the
    activation itself, with focus as the fallback. Keyboard activation of a
    button dispatches a click too.
  */
  const lastActivatedRef = useRef<Element | null>(null);
  useEffect(() => {
    const record = (event: Event) => { lastActivatedRef.current = event.target as Element | null; };
    document.addEventListener("click", record, true);
    return () => document.removeEventListener("click", record, true);
  }, []);

  const apply = useCallback((next: PushedScreen[]) => {
    const current = stackRef.current;
    if (next.length === current.length && next.every((screen, index) => screen === current[index])) return;
    pendingRef.current = next.length < current.length ? { type: "pop", depth: next.length } : { type: "push" };
    stackRef.current = next;
    setStackState(next);
  }, []);

  const push = useCallback((screen: PushedScreen) => {
    const current = stackRef.current;
    scrollByDepth.current[current.length] = window.scrollY;
    openerByDepth.current[current.length] =
      openerKey(lastActivatedRef.current) ?? openerKey(document.activeElement);
    lastActivatedRef.current = null;
    const next = [...current, screen];
    hashRef.current = window.location.hash;
    window.history.pushState(withTrainingsplanStack(window.history.state, planId, next), "", window.location.href);
    apply(next);
  }, [apply, planId]);

  /** Back one level: through the history when it matches, so both stay in step. */
  const back = useCallback(() => {
    const current = stackRef.current;
    if (current.length === 0) return;
    const recorded = readTrainingsplanStack(window.history.state, planId);
    if (recorded.length === current.length) {
      window.history.back();
      return;
    }
    // The history does not hold this screen (it was lost or replaced): pop in place.
    const next = current.slice(0, -1);
    window.history.replaceState(withTrainingsplanStack(window.history.state, planId, next), "", window.location.href);
    apply(next);
  }, [apply, planId]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // An entry of another tab: the router takes over and this view unmounts.
      if (window.location.hash !== hashRef.current) return;
      apply(readTrainingsplanStack(event.state, planId));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [apply, planId]);

  // A different plan invalidates every stored screen.
  useEffect(() => {
    if (stackRef.current.length && readTrainingsplanStack(window.history.state, planId).length === 0) apply([]);
  }, [apply, planId]);

  /*
    A pushed screen starts at the top with focus on its heading. A popped one
    gets back its scroll position and focus on the control that opened the
    screen above it, or its heading when that control is gone.
  */
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const heading = () => document.querySelector<HTMLElement>("[data-screen] h1");
    const focus = (element: HTMLElement | null) => {
      if (!element) return;
      if (element.tagName === "H1") element.tabIndex = -1;
      element.focus({ preventScroll: true });
    };
    if (pending.type === "push") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      focus(heading());
      return;
    }
    const key = openerByDepth.current[pending.depth];
    const opener = key ? document.querySelector<HTMLElement>(`[${OPENER_ATTRIBUTE}="${key}"]`) : null;
    focus(opener ?? heading());
    const top = scrollByDepth.current[pending.depth] ?? 0;
    requestAnimationFrame(() => window.scrollTo({ top, left: 0, behavior: "auto" }));
  }, [stack]);

  const screen: TrainingsplanScreen = stack[stack.length - 1] ?? { kind: "main" };
  return { screen, depth: stack.length, push, back };
}

import { useEffect, useRef, type RefObject } from "react";

const TABBABLE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[tabindex]",
  "[contenteditable='true']",
].join(",");

/** Whether an element is attached, rendered and can take keyboard focus. */
export function isFocusableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.tabIndex < 0 || element.matches(":disabled")) return false;
  if (element.closest("[inert],[hidden]")) return false;
  if (typeof element.checkVisibility === "function") return element.checkVisibility();
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}

const getTabbables = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(TABBABLE_SELECTOR)).filter(isFocusableElement);

/*
  A dialog opened from inside Focus Mode (the workout summary) is portalled to
  body, so it sits outside the container. While one is open it owns focus and
  Escape — Radix traps and dismisses it — and Focus Mode stands down entirely
  rather than fighting it for either.
*/
const hasOtherOpenDialog = (container: HTMLElement) =>
  Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"]')).some(
    (dialog) => dialog !== container && !container.contains(dialog)
  );

/**
 * Keyboard-modal behaviour for the Focus Mode container: focus moves in when
 * it opens, Tab and Shift+Tab wrap inside it, focus that escapes to background
 * content is pulled back, and Escape calls `onEscape`.
 *
 * Escape is read on window in the bubble phase, after every document listener.
 * A nested Radix layer that handled the key has already called preventDefault,
 * so one press never closes both the summary and Focus Mode.
 */
export function useFocusModeContainment({
  active,
  container,
  initialFocusRef,
  onEscape,
}: {
  active: boolean;
  container: HTMLElement | null;
  initialFocusRef: RefObject<HTMLElement>;
  onEscape: () => void;
}) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active || !container) return;

    const focusInitial = () => {
      const target = isFocusableElement(initialFocusRef.current)
        ? initialFocusRef.current
        : getTabbables(container)[0];
      target?.focus({ preventScroll: true });
    };

    if (!container.contains(document.activeElement)) focusInitial();

    const onKeyDown = (event: KeyboardEvent) => {
      if (hasOtherOpenDialog(container)) return;

      if (event.key === "Escape") {
        if (event.defaultPrevented || event.isComposing) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }

      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const tabbables = getTabbables(container);
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const current = document.activeElement;

      if (!first) {
        event.preventDefault();
        return;
      }
      if (!current || !container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || container.contains(target)) return;
      if (hasOtherOpenDialog(container)) return;
      focusInitial();
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [active, container, initialFocusRef]);
}

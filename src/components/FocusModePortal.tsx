import { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders focus-mode content directly under document.body.
 *
 * The dashboard shell wraps its content in animated `motion.div`s, and a
 * transformed ancestor becomes the containing block for `position: fixed`.
 * Inside that subtree a "fullscreen" overlay resolves against the transformed
 * ancestor instead of the viewport, so it neither starts at 0,0 nor covers the
 * full screen. Portalling to body puts it back on the viewport.
 *
 * Mirrors the existing BottomNavPortal pattern.
 */
export default function FocusModePortal({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (!active || typeof window === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

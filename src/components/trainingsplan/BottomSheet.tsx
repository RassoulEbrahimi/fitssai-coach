import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title; also the dialog's accessible description. */
  description?: React.ReactNode;
  children: React.ReactNode;
  /** A fixed row under the scrolling body (the sheet's own actions). */
  footer?: React.ReactNode;
  /** The corner close button; left out when the footer already has one. */
  showClose?: boolean;
}

/**
 * The Edit Mode's focused picker: a bottom sheet on the shared Radix dialog
 * primitive, so it has role="dialog", a focus trap, Escape and focus return
 * to the control that opened it. It never touches the browser history, so
 * closing it always leaves the user in Edit Mode.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({ open, onOpenChange, title, description, children, footer, showClose = true }) => (
  <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="tp-sheet-overlay" />
      <DialogPrimitive.Content
        className="tp-sheet"
        // Without a description Radix is told there is none, instead of warning.
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <div className="tp-sheet-grip" aria-hidden="true" />
        <div className="tp-sheet-head">
          <div className="tp-sheet-titles">
            <DialogPrimitive.Title className="tp-sheet-title">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="tp-sheet-description">{description}</DialogPrimitive.Description>
            )}
          </div>
          {showClose && (
            <DialogPrimitive.Close className="tp-icon-button" aria-label="Schließen">
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          )}
        </div>
        <div className="tp-sheet-body">{children}</div>
        {footer && <div className="tp-sheet-footer">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);

export default BottomSheet;

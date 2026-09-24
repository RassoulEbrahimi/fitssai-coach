import React from "react";
import { Plus } from "lucide-react";
import { BottomSheet } from "./BottomSheet";

interface AutoFillSheetProps {
  open: boolean;
  onClose: () => void;
  /** Hands over to the manual add flow. Omitted when the day cannot be changed. */
  onAddManually?: () => void;
}

/**
 * Auto-ausfüllen, reached from Edit Mode.
 *
 * The app has no suggestion source yet: the KI tab it used to open was
 * already a "not available" notice (`AIPromptAssist`). This keeps exactly
 * that behaviour - it says so and writes nothing. When suggestions exist,
 * they belong here as a list the user accepts explicitly; nothing may be
 * applied to the workout without that step.
 */
export const AutoFillSheet: React.FC<AutoFillSheetProps> = ({ open, onClose, onAddManually }) => (
  <BottomSheet
    open={open}
    onOpenChange={(next) => { if (!next) onClose(); }}
    title="Auto-ausfüllen"
    description="Automatische Vorschläge sind noch nicht verfügbar."
    showClose={false}
    footer={
      <div className="tp-sheet-actions">
        <button type="button" className="tp-secondary" onClick={onClose}>Schließen</button>
        {onAddManually && (
          <button type="button" className="tp-secondary tp-fill" onClick={onAddManually}>
            <Plus aria-hidden="true" />
            Übung hinzufügen
          </button>
        )}
      </div>
    }
  >
    <p className="tp-sheet-text">
      Sobald es sie gibt, siehst du sie hier zuerst und entscheidest selbst, was übernommen wird.
      Bis dahin bleibt dein Training unverändert.
    </p>
  </BottomSheet>
);

export default AutoFillSheet;

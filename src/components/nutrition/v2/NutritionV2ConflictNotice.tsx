import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseEntryId, type NutritionDate, type RecordedEntry } from "@shared/nutrition";
import type { NutritionEntryConflict } from "@/lib/nutrition/v2/nutritionWriteIntents";
import { isNutritionEntryConflictError } from "@/lib/nutrition/v2/entryTransaction";
import {
  isNutritionV2RecordingUnavailableError,
  type NutritionV2Recording,
} from "@/hooks/queries/useNutritionV2Recording";
import { recordedEntryLabel } from "./recordingFormat";

/**
 * One rejected offline change (NUT-07): the entry changed on the server
 * before the change could be applied, so it was NOT saved.
 *
 * Neutral, and never "saved". Two explicit choices:
 *
 *   Erneut anwenden  a NEW action with the same requested change, made
 *                    against the entry as the server has it now (online only)
 *   Verwerfen        forget the change on this device; nothing is written
 *
 * Rendering it writes nothing.
 */

const entryName = (conflict: NutritionEntryConflict, current: RecordedEntry | null): string | null => {
  const { intent } = conflict;
  if (intent.op !== "remove" && intent.desired.recording === "custom") return intent.desired.name;
  return current?.recording === "custom" ? current.name : null;
};

export const NutritionV2ConflictNotice: React.FC<{
  conflict: NutritionEntryConflict;
  /** The entry as shown now (committed plus local changes), or `null` if there is none. */
  current: RecordedEntry | null;
  today: NutritionDate;
  recording: NutritionV2Recording;
}> = ({ conflict, current, today, recording }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const parsed = parseEntryId(conflict.entryId);
  const name = entryName(conflict, current);
  const base =
    parsed?.kind === "slot"
      ? t(`nutritionV2.recording.slot.${parsed.slotId}`)
      : name
        ? t("nutritionV2.recording.conflict.extraNamed", { name })
        : t("nutritionV2.recording.conflict.extra");
  const label =
    conflict.date === today
      ? base
      : t("nutritionV2.recording.conflict.onDate", {
          entry: base,
          date: new Intl.DateTimeFormat(language, { day: "numeric", month: "long", timeZone: "UTC" }).format(
            new Date(`${conflict.date}T00:00:00Z`)
          ),
        });

  const { intent } = conflict;
  const requested =
    intent.op === "remove"
      ? t("nutritionV2.recording.conflict.requestedRemove")
      : recordedEntryLabel({ ...intent.desired, status: "active", revision: 1, appliedIntentIds: [intent.intentId] } as RecordedEntry, t, language);
  const unavailable = recording.availability.status === "unavailable";

  const applyAgain = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await recording.applyAgain(conflict);
    } catch (error) {
      if (isNutritionEntryConflictError(error)) setFailure(t("nutritionV2.recording.conflict.changedAgain"));
      else if (isNutritionV2RecordingUnavailableError(error) && error.reason === "offline") {
        setFailure(t("nutritionV2.recording.conflict.offline"));
      } else setFailure(t("nutritionV2.recording.conflict.failed"));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setFailure(null);
    try {
      recording.dismiss(conflict);
    } catch {
      setFailure(t("nutritionV2.recording.conflict.failed"));
    }
  };

  return (
    <div
      role="group"
      aria-label={t("nutritionV2.recording.conflict.title")}
      data-testid="nutrition-v2-conflict"
      data-entry-id={conflict.entryId}
      className="space-y-2 rounded-lg border border-border px-3 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("nutritionV2.recording.conflict.title")}
      </p>
      <p className="text-sm text-muted-foreground">{t("nutritionV2.recording.conflict.body", { entry: label })}</p>
      <p className="text-sm text-foreground">{t("nutritionV2.recording.conflict.requested", { change: requested })}</p>
      <p className="text-sm text-foreground">
        {t("nutritionV2.recording.conflict.current", {
          state: current ? recordedEntryLabel(current, t, language) : t("nutritionV2.recording.state.none"),
        })}
      </p>
      {!recording.online && (
        <p className="text-sm text-muted-foreground">{t("nutritionV2.recording.conflict.offline")}</p>
      )}
      {failure && (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          disabled={busy || unavailable || !recording.online}
          onClick={() => void applyAgain()}
        >
          {busy ? t("nutritionV2.recording.conflict.applying") : t("nutritionV2.recording.conflict.applyAgain")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy || unavailable} onClick={dismiss}>
          {t("nutritionV2.recording.conflict.dismiss")}
        </Button>
      </div>
    </div>
  );
};

NutritionV2ConflictNotice.displayName = "NutritionV2ConflictNotice";

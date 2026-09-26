import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extraEntryId, parseEntryId, type NutritionSlotId, type RecordedEntry } from "@shared/nutrition";
import type { NutritionDayRecordings } from "@/lib/nutrition/v2/dayRecordings";
import type { NutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import { NutritionV2RecordingSheet, type NutritionV2RecordingTarget } from "./NutritionV2RecordingSheet";
import { formatNutritionKcal, recordedEntryLabel } from "./recordingFormat";

/**
 * Today's slots and extra meals, with one explicit way into recording each.
 *
 * Every slot shows its PLANNED meal and, separately, what was RECORDED for it
 * (an estimate, "ca."). A `removed` entry reads as not recorded. Nothing here
 * writes: a button only opens the recording sheet, and the sheet writes only
 * when the person confirms. While recording is unavailable (offline, or the
 * account is not yet known to be an eligible adult) the buttons are disabled
 * and the reason is shown.
 */

type OpenTarget = { kind: "slot"; slotId: NutritionSlotId } | { kind: "extra"; uuid: string; editing: boolean };

/** The open target, resolved against the latest entries so a refetch is seen at once. */
const resolveTarget = (open: OpenTarget | null, recordings: NutritionDayRecordings): NutritionV2RecordingTarget | null => {
  if (open === null) return null;
  if (open.kind === "slot") {
    const slot = recordings.slots.find((candidate) => candidate.meal.slotId === open.slotId);
    return slot ? { kind: "slot", slot } : null;
  }
  if (!open.editing) return { kind: "extra", date: recordings.date, uuid: open.uuid, entry: null };
  const entry = recordings.extras.find((candidate) => candidate.entryId === extraEntryId(open.uuid));
  // An extra that is no longer active (removed elsewhere) has nothing left to edit.
  return entry ? { kind: "extra", date: recordings.date, uuid: open.uuid, entry } : null;
};

const extraUuid = (entry: RecordedEntry): string | null => {
  const parsed = parseEntryId(entry.entryId);
  return parsed?.kind === "extra" ? parsed.uuid : null;
};

export const NutritionV2TodayRecording: React.FC<{
  recordings: NutritionDayRecordings;
  recording: NutritionV2Recording;
}> = ({ recordings, recording }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";
  const [open, setOpen] = useState<OpenTarget | null>(null);

  const unavailable = recording.availability.status === "unavailable" ? recording.availability.reason : null;
  const target = resolveTarget(open, recordings);

  return (
    <section aria-label={t("nutritionV2.recording.title")} className="space-y-3" data-testid="nutrition-v2-today-recording">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("nutritionV2.recording.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("nutritionV2.recording.estimateNote")}</p>
      </div>

      {unavailable && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`nutritionV2.recording.unavailable.${unavailable}`)}
        </p>
      )}

      <ul className="space-y-1">
        {recordings.slots.map((slot) => {
          const slotLabel = t(`nutritionV2.recording.slot.${slot.meal.slotId}`);
          return (
            <li
              key={slot.entryId}
              data-testid="nutrition-v2-slot"
              data-slot-id={slot.meal.slotId}
              data-recorded={slot.active ? slot.active.recording : "none"}
              className="flex items-center gap-3 rounded-lg px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{slotLabel}</p>
                <p className="font-medium text-foreground">{slot.meal.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t("nutritionV2.recording.planned", { kcal: formatNutritionKcal(slot.meal.values.kcal, language) })}
                </p>
                <p className="text-sm text-foreground" data-testid="nutrition-v2-slot-recorded">
                  {slot.active ? recordedEntryLabel(slot.active, t, language) : t("nutritionV2.recording.state.none")}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0"
                disabled={unavailable !== null}
                aria-label={t(slot.active ? "nutritionV2.recording.editSlot" : "nutritionV2.recording.recordSlot", {
                  slot: slotLabel,
                })}
                onClick={() => setOpen({ kind: "slot", slotId: slot.meal.slotId })}
              >
                {t(slot.active ? "nutritionV2.recording.edit" : "nutritionV2.recording.record")}
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">{t("nutritionV2.recording.extrasTitle")}</h4>
        {recordings.extras.length > 0 && (
          <ul className="space-y-1">
            {recordings.extras.map((entry) => {
              const uuid = extraUuid(entry);
              const name = entry.recording === "custom" ? entry.name : "";
              return (
                <li
                  key={entry.entryId}
                  data-testid="nutrition-v2-extra"
                  className="flex items-center gap-3 rounded-lg px-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{name}</p>
                    <p className="text-sm text-foreground">{recordedEntryLabel(entry, t, language)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-11 shrink-0"
                    disabled={unavailable !== null || uuid === null}
                    aria-label={t("nutritionV2.recording.editExtra", { name })}
                    onClick={() => uuid && setOpen({ kind: "extra", uuid, editing: true })}
                  >
                    {t("nutritionV2.recording.edit")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={unavailable !== null}
          // The extra's identity is chosen here, once, before anything is written.
          onClick={() => setOpen({ kind: "extra", uuid: crypto.randomUUID(), editing: false })}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("nutritionV2.recording.addExtra")}
        </Button>
      </div>

      <NutritionV2RecordingSheet target={target} recording={recording} onClose={() => setOpen(null)} />
    </section>
  );
};

NutritionV2TodayRecording.displayName = "NutritionV2TodayRecording";

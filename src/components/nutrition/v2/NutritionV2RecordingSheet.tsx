import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NutritionDate, RecordedEntry, RecordedEntrySnapshot } from "@shared/nutrition";
import type { NutritionSlotRecording } from "@/lib/nutrition/v2/dayRecordings";
import { isNutritionEntryConflictError } from "@/lib/nutrition/v2/entryTransaction";
import { QueueStorageError } from "@/lib/offlineQueue";
import {
  NUTRITION_PORTION_PRESETS,
  buildCustomSlotRecording,
  buildExtraRecording,
  buildPlannedMealRecording,
  buildSkipRecording,
  parseNutritionNumberInput,
  type NutritionEstimateInput,
  type NutritionRecordingCommand,
} from "@/lib/nutrition/v2/recording";
import {
  isNutritionV2RecordingUnavailableError,
  type NutritionV2Recording,
} from "@/hooks/queries/useNutritionV2Recording";
import { formatNutritionKcal, formatNutritionPortion, recordedEntryLabel } from "./recordingFormat";

/**
 * The Nutrition V2 recording sheet: one slot of today, or one extra meal.
 *
 * Opening it, switching modes and typing write nothing. Only "Speichern" or
 * "Entfernen" submits — one explicit action, one intent, written online or
 * queued on this device (NUT-07). The planned meal is shown as planned; what
 * gets recorded is shown as an estimate ("ca."). A queued change closes the
 * sheet like a saved one; the entry then says it is waiting to synchronise.
 */

export type NutritionV2RecordingTarget =
  | { kind: "slot"; slot: NutritionSlotRecording }
  /** `entry`: the active extra being edited, or `null` for a new one with `uuid`. */
  | { kind: "extra"; date: NutritionDate; uuid: string; entry: RecordedEntry | null };

type SlotMode = "plannedMeal" | "custom" | "skip";

const SLOT_MODES: readonly SlotMode[] = ["plannedMeal", "custom", "skip"];

interface CustomFields {
  name: string;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const MACRO_FIELDS = ["proteinG", "carbsG", "fatG"] as const;

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

const initialCustomFields = (entry: RecordedEntry | null): CustomFields =>
  entry?.recording === "custom"
    ? {
        name: entry.name,
        kcal: numberText(entry.nutritionEstimate.kcal),
        proteinG: numberText(entry.nutritionEstimate.proteinG),
        carbsG: numberText(entry.nutritionEstimate.carbsG),
        fatG: numberText(entry.nutritionEstimate.fatG),
      }
    : { name: "", kcal: "", proteinG: "", carbsG: "", fatG: "" };

type FieldErrors = Partial<Record<keyof CustomFields | "portion", string>>;

/** The stated estimate, or the field errors that stop it. Empty macros stay unknown (`null`). */
const readCustomFields = (
  fields: CustomFields,
  t: (key: string) => string
): { estimate: NutritionEstimateInput; name: string } | { errors: FieldErrors } => {
  const errors: FieldErrors = {};
  if (fields.name.trim() === "") errors.name = t("nutritionV2.recording.sheet.nameRequired");

  const kcal = parseNutritionNumberInput(fields.kcal);
  if (!kcal.valid) errors.kcal = t("nutritionV2.recording.sheet.numberInvalid");
  else if (kcal.value === null) errors.kcal = t("nutritionV2.recording.sheet.kcalRequired");

  const macros: Partial<Record<(typeof MACRO_FIELDS)[number], number | null>> = {};
  for (const field of MACRO_FIELDS) {
    const parsed = parseNutritionNumberInput(fields[field]);
    if (parsed.valid) macros[field] = parsed.value;
    else errors[field] = t("nutritionV2.recording.sheet.numberInvalid");
  }

  if (Object.keys(errors).length > 0 || !kcal.valid || kcal.value === null) return { errors };
  return {
    name: fields.name,
    estimate: { kcal: kcal.value, proteinG: macros.proteinG ?? null, carbsG: macros.carbsG ?? null, fatG: macros.fatG ?? null },
  };
};

const readPortion = (text: string): number | null => {
  const parsed = parseNutritionNumberInput(text);
  return parsed.valid && parsed.value !== null && parsed.value > 0 ? parsed.value : null;
};

const CustomFieldsForm = ({
  fields,
  errors,
  onChange,
  disabled,
}: {
  fields: CustomFields;
  errors: FieldErrors;
  onChange: (fields: CustomFields) => void;
  disabled: boolean;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const field = (key: keyof CustomFields, label: string, inputMode: "text" | "decimal") => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        name={key}
        inputMode={inputMode}
        autoComplete="off"
        value={fields[key]}
        disabled={disabled}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
        onChange={(event) => onChange({ ...fields, [key]: event.target.value })}
      />
      {errors[key] && (
        <p id={`${id}-${key}-error`} className="text-sm text-destructive">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {field("name", t("nutritionV2.recording.sheet.name"), "text")}
      {field("kcal", t("nutritionV2.recording.sheet.kcal"), "decimal")}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MACRO_FIELDS.map((key) => (
          <React.Fragment key={key}>{field(key, t(`nutritionV2.recording.sheet.${key}`), "decimal")}</React.Fragment>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("nutritionV2.recording.sheet.macrosNote")}</p>
    </div>
  );
};

const RecordingForm = ({
  target,
  recording,
  onClose,
}: {
  target: NutritionV2RecordingTarget;
  recording: NutritionV2Recording;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";
  const current = target.kind === "slot" ? target.slot.entry : target.entry;
  const active = target.kind === "slot" ? target.slot.active : target.entry;

  const [mode, setMode] = useState<SlotMode>(() =>
    active?.recording === "custom" || active?.recording === "skip" ? active.recording : "plannedMeal"
  );
  const [portionText, setPortionText] = useState(() =>
    active?.recording === "plannedMeal" ? String(active.portion) : "1"
  );
  const [fields, setFields] = useState<CustomFields>(() => initialCustomFields(active));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const unavailable = recording.availability.status === "unavailable";
  const busy = recording.isSubmitting;
  const disabled = unavailable || busy;
  const portion = readPortion(portionText);

  const run = async (command: NutritionRecordingCommand) => {
    setFailure(null);
    try {
      await recording.submit(command);
      onClose();
    } catch (error) {
      if (isNutritionEntryConflictError(error)) setFailure(t("nutritionV2.recording.sheet.error.conflict"));
      else if (isNutritionV2RecordingUnavailableError(error)) {
        setFailure(
          t(
            error.reason === "futureDate"
              ? "nutritionV2.recording.sheet.error.futureDate"
              : "nutritionV2.recording.sheet.error.unavailable"
          )
        );
      } else if (error instanceof QueueStorageError) setFailure(t("nutritionV2.recording.sheet.error.storage"));
      else setFailure(t("nutritionV2.recording.sheet.error.failed"));
    }
  };

  const desiredSnapshot = (): RecordedEntrySnapshot | null => {
    if (target.kind === "slot" && mode === "plannedMeal") {
      if (portion === null) {
        setErrors({ portion: t("nutritionV2.recording.sheet.portionInvalid") });
        return null;
      }
      return buildPlannedMealRecording(target.slot.meal, portion);
    }
    if (target.kind === "slot" && mode === "skip") {
      return buildSkipRecording({ date: target.slot.meal.date, slotId: target.slot.meal.slotId });
    }
    const read = readCustomFields(fields, t);
    if ("errors" in read) {
      setErrors(read.errors);
      return null;
    }
    return target.kind === "slot"
      ? buildCustomSlotRecording({ date: target.slot.meal.date, slotId: target.slot.meal.slotId, ...read })
      : buildExtraRecording({ uuid: target.uuid, date: target.date, ...read });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    setErrors({});
    const desired = desiredSnapshot();
    if (desired) void run({ kind: "save", current, desired });
  };

  const remove = () => {
    if (disabled || !active) return;
    void run({ kind: "remove", current: active });
  };

  const portionId = useId();

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      {active && (
        <p className="text-sm" data-testid="nutrition-v2-current-entry">
          <span className="text-muted-foreground">{t("nutritionV2.recording.sheet.currentLabel")}: </span>
          {recordedEntryLabel(active, t, language)}
        </p>
      )}
      {!active && current?.status === "removed" && (
        <p className="text-sm text-muted-foreground">{t("nutritionV2.recording.sheet.removedNote")}</p>
      )}

      {target.kind === "slot" && (
        <div role="group" aria-label={t("nutritionV2.recording.sheet.modeLabel")} className="grid grid-cols-3 gap-2">
          {SLOT_MODES.map((option) => (
            <Button
              key={option}
              type="button"
              variant={mode === option ? "default" : "outline"}
              aria-pressed={mode === option}
              className="h-auto min-h-11 whitespace-normal px-2"
              onClick={() => {
                setMode(option);
                setErrors({});
              }}
            >
              {t(`nutritionV2.recording.sheet.mode.${option}`)}
            </Button>
          ))}
        </div>
      )}

      {target.kind === "slot" && mode === "plannedMeal" && (
        <div className="space-y-3">
          <div role="group" aria-label={t("nutritionV2.recording.sheet.portionPresets")} className="flex flex-wrap gap-2">
            {NUTRITION_PORTION_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={portion === preset ? "default" : "outline"}
                aria-pressed={portion === preset}
                className="min-h-11 min-w-11"
                onClick={() => {
                  setPortionText(String(preset));
                  setErrors({});
                }}
              >
                {formatNutritionPortion(preset, language)}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor={portionId}>{t("nutritionV2.recording.sheet.portionLabel")}</Label>
            <Input
              id={portionId}
              name="portion"
              inputMode="decimal"
              autoComplete="off"
              value={portionText}
              disabled={disabled}
              aria-invalid={errors.portion ? true : undefined}
              aria-describedby={errors.portion ? `${portionId}-error` : undefined}
              onChange={(event) => setPortionText(event.target.value)}
            />
            {errors.portion && (
              <p id={`${portionId}-error`} className="text-sm text-destructive">
                {errors.portion}
              </p>
            )}
          </div>
          {portion !== null && (
            <p className="text-sm text-muted-foreground" data-testid="nutrition-v2-estimate-preview">
              {t("nutritionV2.recording.sheet.estimate", {
                kcal: formatNutritionKcal(target.slot.meal.values.kcal * portion, language),
              })}
            </p>
          )}
        </div>
      )}

      {target.kind === "slot" && mode === "skip" && (
        <p className="text-sm text-muted-foreground">{t("nutritionV2.recording.sheet.skipNote")}</p>
      )}

      {(target.kind === "extra" || mode === "custom") && (
        <CustomFieldsForm fields={fields} errors={errors} onChange={setFields} disabled={disabled} />
      )}

      {unavailable && recording.availability.status === "unavailable" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`nutritionV2.recording.unavailable.${recording.availability.reason}`)}
        </p>
      )}
      {failure && (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}

      <SheetFooter className="gap-2 sm:space-x-0">
        {active && (
          <Button type="button" variant="outline" className="min-h-11 sm:mr-auto" disabled={disabled} onClick={remove}>
            {t("nutritionV2.recording.sheet.remove")}
          </Button>
        )}
        <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
          {t("nutritionV2.recording.sheet.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" disabled={disabled}>
          {busy ? t("nutritionV2.recording.sheet.saving") : t("nutritionV2.recording.sheet.save")}
        </Button>
      </SheetFooter>
    </form>
  );
};

const targetKey = (target: NutritionV2RecordingTarget) =>
  target.kind === "slot" ? target.slot.entryId : `extra:${target.uuid}`;

export const NutritionV2RecordingSheet: React.FC<{
  target: NutritionV2RecordingTarget | null;
  recording: NutritionV2Recording;
  onClose: () => void;
}> = ({ target, recording, onClose }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";

  const title = !target
    ? ""
    : target.kind === "slot"
      ? t("nutritionV2.recording.sheet.slotTitle", { slot: t(`nutritionV2.recording.slot.${target.slot.meal.slotId}`) })
      : t(target.entry ? "nutritionV2.recording.sheet.extraEditTitle" : "nutritionV2.recording.sheet.extraTitle");

  return (
    <Sheet open={target !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="bottom" className={cn("max-h-[90dvh] overflow-y-auto")}>
        {target && (
          <>
            <SheetHeader className="mb-4 text-left">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>
                {target.kind === "slot"
                  ? t("nutritionV2.recording.sheet.plannedLabel", {
                      name: target.slot.meal.name,
                      kcal: formatNutritionKcal(target.slot.meal.values.kcal, language),
                    })
                  : t("nutritionV2.recording.estimateNote")}
              </SheetDescription>
            </SheetHeader>
            {/* Keyed by the entry, so every open starts from what is recorded now. */}
            <RecordingForm key={targetKey(target)} target={target} recording={recording} onClose={onClose} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

NutritionV2RecordingSheet.displayName = "NutritionV2RecordingSheet";

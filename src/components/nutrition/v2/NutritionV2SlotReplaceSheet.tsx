import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NutritionPlan } from "@shared/nutrition";
import type { NutritionSlotRecording } from "@/lib/nutrition/v2/dayRecordings";
import { isNutritionSlotCallError } from "@/lib/nutrition/v2/slotCallable";
import {
  nutritionSlotReplacementChoices,
  type NutritionSlotReplacementBlock,
} from "@/lib/nutrition/v2/slotReplacement";
import {
  isNutritionV2SlotOverrideUnavailableError,
  type NutritionV2SlotOverride,
} from "@/hooks/queries/useNutritionV2SlotOverride";
import { formatNutritionKcal } from "./recordingFormat";

/**
 * Replace one of today's planned meals with another meal of the same plan, or
 * undo the last replacement (NUT-10).
 *
 * Opening the sheet and choosing an option write nothing. Only "Ersetzen" or
 * "Rückgängig" sends one request, and the slot keeps showing its current meal
 * until the server has answered and the slot has been read again — the new
 * meal is never shown on the strength of a click. When the plan changed in the
 * meantime the person sees the current meal and decides again; nothing is
 * retried for them.
 *
 * Only the plan's own base meals of the same slot are offered. Replacement
 * suggestions are not offered: no suggestion source exists yet.
 */

const HANDLED_CODES = ["STALE_REVISION", "NOTHING_TO_UNDO", "SLOT_HAS_RECORD", "PLAN_CHANGED_FOR_DATE", "DATE_FROZEN"];

const ReplaceForm = ({
  plan,
  slot,
  block,
  slotOverride,
  onClose,
}: {
  plan: NutritionPlan;
  slot: NutritionSlotRecording;
  block: NutritionSlotReplacementBlock | null;
  slotOverride: NutritionV2SlotOverride;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";
  const groupId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState<"commit" | "undo" | null>(null);

  const { planMeals, canUndo } = nutritionSlotReplacementChoices(plan, slot);
  const unavailable = slotOverride.availability.status === "unavailable";
  const disabled = unavailable || block !== null || running !== null;
  // Read at the moment of confirmation: the revision of the head as shown now.
  const target = () => ({
    planId: slot.meal.planId,
    date: slot.meal.date,
    slotId: slot.meal.slotId,
    expectedRevision: slot.meal.slotRevision,
  });

  const run = async (action: "commit" | "undo") => {
    if (disabled) return;
    if (action === "commit" && !planMeals.some((meal) => meal.mealId === chosen)) return;
    setFailure(null);
    setRunning(action);
    try {
      if (action === "commit") await slotOverride.commitPlanMeal(target(), chosen as string);
      else await slotOverride.undo(target());
      onClose();
    } catch (error) {
      if (isNutritionSlotCallError(error) && HANDLED_CODES.includes(error.code)) {
        setFailure(t(`nutritionV2.replace.error.${error.code}`));
      } else if (isNutritionV2SlotOverrideUnavailableError(error)) {
        setFailure(
          t(
            error.reason === "offline"
              ? "nutritionV2.replace.error.offline"
              : error.reason === "pastDate"
                ? "nutritionV2.replace.error.DATE_FROZEN"
                : "nutritionV2.replace.error.unavailable"
          )
        );
      } else {
        setFailure(t("nutritionV2.replace.error.failed"));
      }
    } finally {
      setRunning(null);
    }
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void run("commit");
      }}
    >
      {block && (
        <p className="text-sm text-muted-foreground" role="status" data-testid="nutrition-v2-replace-blocked">
          {t(`nutritionV2.replace.blocked.${block}`)}
        </p>
      )}
      {unavailable && slotOverride.availability.status === "unavailable" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("nutritionV2.replace.error.unavailable")}
        </p>
      )}

      <fieldset className="space-y-2" aria-describedby={`${groupId}-hint`}>
        <legend className="text-sm font-medium text-foreground">{t("nutritionV2.replace.sheet.planMealsTitle")}</legend>
        <p id={`${groupId}-hint`} className="text-xs text-muted-foreground">
          {t("nutritionV2.replace.sheet.planMealsHint")}
        </p>
        {planMeals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nutritionV2.replace.sheet.noPlanMeals")}</p>
        ) : (
          <ul className="space-y-1">
            {planMeals.map((meal) => (
              <li key={meal.mealId}>
                <label
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-border",
                    chosen === meal.mealId && "bg-primary/10 ring-primary/40",
                    disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <input
                    type="radio"
                    name={`${groupId}-meal`}
                    value={meal.mealId}
                    checked={chosen === meal.mealId}
                    disabled={disabled}
                    onChange={() => {
                      setChosen(meal.mealId);
                      setFailure(null);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm text-foreground">
                    {t("nutritionV2.replace.sheet.option", {
                      name: meal.name,
                      kcal: formatNutritionKcal(meal.values.kcal, language),
                    })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {canUndo && <p className="text-xs text-muted-foreground">{t("nutritionV2.replace.sheet.undoHint")}</p>}

      {failure && (
        <p className="text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}

      <SheetFooter className="gap-2 sm:space-x-0">
        {canUndo && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 sm:mr-auto"
            disabled={disabled}
            onClick={() => void run("undo")}
          >
            {running === "undo" ? t("nutritionV2.replace.sheet.undoing") : t("nutritionV2.replace.sheet.undo")}
          </Button>
        )}
        <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
          {t("nutritionV2.replace.sheet.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" disabled={disabled || chosen === null}>
          {running === "commit" ? t("nutritionV2.replace.sheet.confirming") : t("nutritionV2.replace.sheet.confirm")}
        </Button>
      </SheetFooter>
    </form>
  );
};

export const NutritionV2SlotReplaceSheet: React.FC<{
  /** The slot to replace, as currently read; null when the sheet is closed. */
  slot: NutritionSlotRecording | null;
  /** The plan that owns the slot's date. */
  plan: NutritionPlan;
  block: NutritionSlotReplacementBlock | null;
  slotOverride: NutritionV2SlotOverride;
  onClose: () => void;
}> = ({ slot, plan, block, slotOverride, onClose }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";

  return (
    <Sheet open={slot !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        {slot && (
          <>
            <SheetHeader className="mb-4 text-left">
              <SheetTitle>
                {t("nutritionV2.replace.sheet.title", { slot: t(`nutritionV2.recording.slot.${slot.meal.slotId}`) })}
              </SheetTitle>
              <SheetDescription data-testid="nutrition-v2-replace-current">
                {t("nutritionV2.replace.sheet.current", {
                  name: slot.meal.name,
                  kcal: formatNutritionKcal(slot.meal.values.kcal, language),
                })}
              </SheetDescription>
            </SheetHeader>
            {/* Keyed by the slot, so every open starts with nothing chosen. */}
            <ReplaceForm
              key={slot.entryId}
              plan={plan}
              slot={slot}
              block={block}
              slotOverride={slotOverride}
              onClose={onClose}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

NutritionV2SlotReplaceSheet.displayName = "NutritionV2SlotReplaceSheet";

import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { NutritionTargetMode, NutritionTargetProfileField } from "@shared/nutrition";
import type { Profile } from "@/hooks/queries/useProfile";
import {
  isNutritionV2TargetUnavailableError,
  type NutritionV2TargetMutation,
} from "@/hooks/queries/useNutritionV2Target";
import { isNutritionTargetCallError } from "@/lib/nutrition/v2/targetCallable";
import {
  TARGET_SETUP_FIELDS,
  TARGET_SETUP_OPTIONS,
  initialTargetSetupDraft,
  planTargetSetupSave,
  type TargetSetupDraft,
  type TargetSetupField,
} from "@/lib/nutrition/v2/targetSetup";

/**
 * The TARGET part of Nutrition setup (NUT-08), as a sheet.
 *
 * Opening it, switching modes and typing call nothing. "Ziel festlegen" first
 * saves the changed profile answers through the normal profile save, and only
 * once that has succeeded asks the server for a target — which rereads the
 * saved profile itself. Online only.
 *
 * Every server answer is said truthfully: "not configured yet" is neutral,
 * never an outage; missing answers are named by field; a saved profile stays
 * saved even when no target could be set.
 */

type Outcome =
  | { kind: "notConfigured"; profileSaved: boolean }
  | { kind: "incomplete"; missingFields: NutritionTargetProfileField[]; invalidFields: NutritionTargetProfileField[]; profileSaved: boolean }
  | { kind: "ineligible" }
  | { kind: "infeasible"; profileSaved: boolean }
  | { kind: "offline" }
  | { kind: "unavailable" }
  | { kind: "profileFailed" }
  | { kind: "failed"; profileSaved: boolean };

/** Calculated first: the default when the profile names no mode. */
const SETUP_MODES: readonly NutritionTargetMode[] = ["calculated", "manual"];

const NUMBER_FIELDS = ["height", "weight", "manualTargetKcal"] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];
type ChoiceField = Exclude<TargetSetupField, NumberField>;

const isNumberField = (field: TargetSetupField): field is NumberField => (NUMBER_FIELDS as readonly string[]).includes(field);

const choiceLabelKey = (field: ChoiceField, value: string) =>
  field === "fitnessGoal"
    ? `onboarding.goals.${value}`
    : field === "biologicalSex"
      ? `nutritionV2.target.setup.sex.${value}`
      : `nutritionV2.target.setup.activity.${value}`;

interface SetupFormProps {
  profile: Profile | null | undefined;
  mutation: NutritionV2TargetMutation;
  saveProfile: (changes: Partial<Profile>) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}

const SetupForm: React.FC<SetupFormProps> = ({ profile, mutation, saveProfile, onDone, onCancel }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TargetSetupDraft>(() => initialTargetSetupDraft(profile));
  const [invalid, setInvalid] = useState<TargetSetupField[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const idBase = useId();

  const unavailable = mutation.availability.status !== "available";
  const disabled = busy || unavailable || !mutation.online;
  const fieldNames = (fields: readonly NutritionTargetProfileField[]) =>
    fields.map((field) => t(`nutritionV2.target.fieldName.${field}`)).join(", ");

  const update = <K extends keyof TargetSetupDraft>(key: K, value: TargetSetupDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setInvalid([]);
    setOutcome(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!mutation.online) return setOutcome({ kind: "offline" });
    if (unavailable) return setOutcome({ kind: "unavailable" });

    const plan = planTargetSetupSave(profile, draft);
    if ("invalidFields" in plan) {
      setInvalid(plan.invalidFields);
      return;
    }

    setBusy(true);
    setOutcome(null);
    let profileSaved = false;
    try {
      if (Object.keys(plan.changes).length > 0) {
        try {
          await saveProfile(plan.changes);
          profileSaved = true;
        } catch {
          setOutcome({ kind: "profileFailed" });
          return;
        }
      }
      // Only now: the server reads the profile that was just saved.
      await mutation.submit(draft.mode);
      onDone();
    } catch (error) {
      if (isNutritionV2TargetUnavailableError(error)) {
        setOutcome(error.reason === "offline" ? { kind: "offline" } : { kind: "unavailable" });
      } else if (isNutritionTargetCallError(error) && error.code === "TARGET_POLICY_NOT_CONFIGURED") {
        setOutcome({ kind: "notConfigured", profileSaved });
      } else if (isNutritionTargetCallError(error) && error.code === "PROFILE_INCOMPLETE") {
        setOutcome({ kind: "incomplete", missingFields: error.missingFields, invalidFields: error.invalidFields, profileSaved });
      } else if (isNutritionTargetCallError(error) && error.code === "NOT_ELIGIBLE") {
        setOutcome({ kind: "ineligible" });
      } else if (isNutritionTargetCallError(error) && error.code === "TARGET_INFEASIBLE") {
        setOutcome({ kind: "infeasible", profileSaved });
      } else {
        setOutcome({ kind: "failed", profileSaved });
      }
    } finally {
      setBusy(false);
    }
  };

  const numberInput = (field: NumberField) => {
    const id = `${idBase}-${field}`;
    const isInvalid = invalid.includes(field);
    return (
      <div key={field} className="space-y-1">
        <Label htmlFor={id}>{t(`nutritionV2.target.setup.field.${field}`)}</Label>
        <Input
          id={id}
          name={field}
          inputMode="decimal"
          autoComplete="off"
          value={draft[field]}
          disabled={busy}
          aria-invalid={isInvalid ? true : undefined}
          aria-describedby={isInvalid ? `${id}-error` : undefined}
          onChange={(event) => update(field, event.target.value)}
        />
        {isInvalid && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {t("nutritionV2.target.setup.invalid")}
          </p>
        )}
      </div>
    );
  };

  const choiceGroup = (field: ChoiceField) => {
    const options = TARGET_SETUP_OPTIONS[field] as readonly string[];
    const label = t(`nutritionV2.target.setup.field.${field}`);
    const isInvalid = invalid.includes(field);
    return (
      <div key={field} className="space-y-2">
        <p className="text-sm font-medium" id={`${idBase}-${field}`}>
          {label}
        </p>
        <div role="group" aria-labelledby={`${idBase}-${field}`} className="flex flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={draft[field] === option ? "default" : "outline"}
              aria-pressed={draft[field] === option}
              className="min-h-11 whitespace-normal"
              disabled={busy}
              onClick={() => update(field, option as TargetSetupDraft[typeof field])}
            >
              {t(choiceLabelKey(field, option))}
            </Button>
          ))}
        </div>
        {isInvalid && <p className="text-sm text-destructive">{t("nutritionV2.target.setup.invalid")}</p>}
      </div>
    );
  };

  const message = (() => {
    if (!outcome) return null;
    const saved = "profileSaved" in outcome && outcome.profileSaved ? ` ${t("nutritionV2.target.setup.profileSaved")}` : "";
    switch (outcome.kind) {
      case "notConfigured":
        return { tone: "neutral", text: t("nutritionV2.target.setup.result.notConfigured") + saved };
      case "incomplete": {
        const parts = [
          outcome.missingFields.length > 0
            ? t("nutritionV2.target.setup.result.missing", { fields: fieldNames(outcome.missingFields) })
            : null,
          outcome.invalidFields.length > 0
            ? t("nutritionV2.target.setup.result.invalid", { fields: fieldNames(outcome.invalidFields) })
            : null,
        ].filter(Boolean);
        return { tone: "neutral", text: parts.join(" ") + saved };
      }
      case "ineligible":
        return { tone: "neutral", text: t("nutritionV2.target.setup.result.ineligible") };
      case "infeasible":
        return { tone: "neutral", text: t("nutritionV2.target.setup.result.infeasible") + saved };
      case "offline":
        return { tone: "neutral", text: t("nutritionV2.target.setup.offline") };
      case "unavailable":
        return { tone: "neutral", text: t("nutritionV2.target.setup.unavailable") };
      case "profileFailed":
        return { tone: "error", text: t("nutritionV2.target.setup.profileSaveFailed") };
      case "failed":
        return { tone: "error", text: t("nutritionV2.target.setup.result.failed") + saved };
    }
  })();

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <div role="group" aria-label={t("nutritionV2.target.setup.modeLabel")} className="grid grid-cols-2 gap-2">
        {SETUP_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={draft.mode === mode ? "default" : "outline"}
            aria-pressed={draft.mode === mode}
            className="h-auto min-h-11 whitespace-normal px-2"
            disabled={busy}
            onClick={() => update("mode", mode)}
          >
            {t(`nutritionV2.target.setup.mode.${mode}`)}
          </Button>
        ))}
      </div>

      {TARGET_SETUP_FIELDS[draft.mode].map((field: TargetSetupField) =>
        isNumberField(field) ? numberInput(field) : choiceGroup(field)
      )}

      {!mutation.online && !outcome && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("nutritionV2.target.setup.offline")}
        </p>
      )}
      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          data-testid="nutrition-v2-target-setup-message"
          data-outcome={outcome?.kind}
          className={message.tone === "error" ? "text-sm text-destructive" : "rounded-lg bg-muted/40 p-3 text-sm text-foreground"}
        >
          {message.text}
        </p>
      )}

      <SheetFooter className="gap-2 sm:space-x-0">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          {t("nutritionV2.target.setup.cancel")}
        </Button>
        <Button type="submit" className="min-h-11" disabled={disabled}>
          {busy ? t("nutritionV2.target.setup.submitting") : t("nutritionV2.target.setup.submit")}
        </Button>
      </SheetFooter>
    </form>
  );
};

export interface NutritionV2TargetSetupSheetProps extends Omit<SetupFormProps, "onDone" | "onCancel"> {
  open: boolean;
  onClose: () => void;
}

export const NutritionV2TargetSetupSheet: React.FC<NutritionV2TargetSetupSheetProps> = ({ open, onClose, ...form }) => {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        {open && (
          <>
            <SheetHeader className="mb-4 text-left">
              <SheetTitle>{t("nutritionV2.target.setup.title")}</SheetTitle>
              <SheetDescription>{t("nutritionV2.target.setup.description")}</SheetDescription>
            </SheetHeader>
            <SetupForm {...form} onDone={onClose} onCancel={onClose} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

NutritionV2TargetSetupSheet.displayName = "NutritionV2TargetSetupSheet";

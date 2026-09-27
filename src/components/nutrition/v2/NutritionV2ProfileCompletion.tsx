import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useProfile, useUpdateProfile, type Profile } from "@/hooks/queries/useProfile";
import { nutritionProfileOf } from "@/lib/nutrition/v2/targetSetup";
import {
  NUTRITION_PROFILE_OPTIONS,
  getNutritionProfileCompleteness,
  initialNutritionProfileDraft,
  planNutritionProfileSave,
  type NutritionProfileDraft,
  type NutritionProfileField,
  type NutritionProfileFieldError,
  type NutritionProfileNumberField,
} from "@/lib/nutrition/v2/profileCompletion";

/**
 * Nutrition PROFILE completion (NUT-12D.1): the Nutrition-relevant answers of
 * the existing profile, completed or changed from the Nutrition tab.
 *
 * Profile answers only — never a target and never a plan. It reads and saves
 * the profile through `useProfile`/`useUpdateProfile` and nothing else: no V2
 * read, no callable, no V2 document. It therefore works while Nutrition is
 * still unavailable because the age is missing, and saving an adult age lets
 * the Nutrition reads start through the profile cache the save updates.
 */

type ChoiceField = Exclude<NutritionProfileField, NutritionProfileNumberField>;

const choiceLabelKey = (field: ChoiceField, value: string | number) => {
  switch (field) {
    case "fitnessGoal":
      return `onboarding.goals.${value}`;
    case "dietaryPreference":
      return `onboarding.diet.${value}`;
    case "biologicalSex":
      return `nutritionV2.target.setup.sex.${value}`;
    case "activityLevel":
      return `nutritionV2.target.setup.activity.${value}`;
    case "mealsPerDay":
      return "nutritionV2.profile.mealsOption";
  }
};

/** Numbers say what onboarding says; a choice can only be missing. */
const errorKey = (field: NutritionProfileField, error: NutritionProfileFieldError) =>
  field === "age" || field === "height" || field === "weight"
    ? `onboarding.validation.${field}.${error}`
    : "nutritionV2.profile.choiceRequired";

interface FormProps {
  profile: Profile | null | undefined;
  saveProfile: (changes: Partial<Profile>) => Promise<unknown>;
  onDone: () => void;
  onCancel: () => void;
}

const ProfileForm: React.FC<FormProps> = ({ profile, saveProfile, onDone, onCancel }) => {
  const { t } = useTranslation();
  const idBase = useId();
  const [draft, setDraft] = useState<NutritionProfileDraft>(() => initialNutritionProfileDraft(profile));
  const [errors, setErrors] = useState<Partial<Record<NutritionProfileField, NutritionProfileFieldError>>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the profile answered when the form opened: a field without an answer is marked open.
  const [stored] = useState(() => nutritionProfileOf(profile));

  const setField = <K extends keyof NutritionProfileDraft>(key: K, value: NutritionProfileDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setFailed(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const plan = planNutritionProfileSave(profile, draft);
    if ("errors" in plan) {
      setErrors(plan.errors);
      return;
    }
    // Nothing changed: nothing to write.
    if (Object.keys(plan.changes).length === 0) return onDone();

    setBusy(true);
    setFailed(false);
    try {
      await saveProfile(plan.changes);
      toast.success(t("nutritionV2.profile.saved"));
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hint = (field: NutritionProfileField) => {
    const status = stored[field].status;
    if (status === "answered") return null;
    return (
      <span className="shrink-0 text-xs font-medium text-primary" data-testid={`nutrition-v2-profile-${field}-open`}>
        {t(status === "invalid" ? "nutritionV2.profile.reselect" : "nutritionV2.profile.open")}
      </span>
    );
  };

  const errorLine = (field: NutritionProfileField) => {
    const error = errors[field];
    if (!error) return null;
    return (
      <p id={`${idBase}-${field}-error`} className="text-sm text-destructive">
        {t(errorKey(field, error))}
      </p>
    );
  };

  const numberInput = (field: NutritionProfileNumberField) => {
    const id = `${idBase}-${field}`;
    return (
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <Label htmlFor={id}>{t(`nutritionV2.profile.field.${field}`)}</Label>
          {hint(field)}
        </div>
        <Input
          id={id}
          name={field}
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          className="h-11 text-base"
          value={draft[field]}
          disabled={busy}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={errors[field] ? `${id}-error` : undefined}
          onChange={(event) => setField(field, event.target.value)}
        />
        {errorLine(field)}
      </div>
    );
  };

  const choiceGroup = (field: ChoiceField, layout: string, note?: string) => {
    const labelId = `${idBase}-${field}`;
    const options = NUTRITION_PROFILE_OPTIONS[field] as readonly (string | number)[];
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p className="text-sm font-medium leading-none" id={labelId}>
            {t(`nutritionV2.profile.field.${field}`)}
          </p>
          {hint(field)}
        </div>
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={errors[field] ? `${labelId}-error` : undefined}
          className={cn("grid gap-2", layout)}
        >
          {options.map((option) => {
            const selected = draft[field] === option;
            return (
              <Button
                key={option}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                className="h-auto min-h-11 whitespace-normal px-2 py-2 text-sm leading-snug"
                disabled={busy}
                onClick={() => setField(field, option as NutritionProfileDraft[typeof field])}
              >
                {field === "mealsPerDay" ? t(choiceLabelKey(field, option), { count: option as number }) : t(choiceLabelKey(field, option))}
              </Button>
            );
          })}
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {errorLine(field)}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6" data-testid="nutrition-v2-profile-form">
      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("nutritionV2.profile.section.body")}
        </legend>
        {numberInput("age")}
        <div className="grid grid-cols-2 gap-3">
          {numberInput("height")}
          {numberInput("weight")}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("nutritionV2.profile.section.goal")}
        </legend>
        {choiceGroup("fitnessGoal", "grid-cols-2")}
        {choiceGroup("dietaryPreference", "grid-cols-2", t("nutritionV2.profile.dietNote"))}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("nutritionV2.profile.section.nutrition")}
        </legend>
        {choiceGroup("biologicalSex", "grid-cols-3", t("nutritionV2.profile.sexNote"))}
        {choiceGroup("activityLevel", "grid-cols-1 min-[400px]:grid-cols-2")}
        {choiceGroup("mealsPerDay", "grid-cols-5")}
      </fieldset>

      {failed && (
        <p role="alert" className="text-sm text-destructive" data-testid="nutrition-v2-profile-save-error">
          {t("nutritionV2.profile.saveFailed")}
        </p>
      )}

      {/*
        Pinned to the sheet's bottom edge while the form scrolls (the sheet's own
        padding would otherwise inset it), above the home indicator, and side by
        side so it stays low on a phone.
      */}
      <SheetFooter className="sticky -bottom-6 -mx-6 -mb-6 flex-row gap-2 border-t border-border bg-background px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:space-x-0">
        <Button type="button" variant="outline" className="min-h-11 flex-1 sm:flex-none" onClick={onCancel} disabled={busy}>
          {t("nutritionV2.profile.cancel")}
        </Button>
        <Button type="submit" className="min-h-11 flex-1 sm:flex-none" disabled={busy}>
          {busy ? t("nutritionV2.profile.saving") : t("nutritionV2.profile.save")}
        </Button>
      </SheetFooter>
    </form>
  );
};

export interface NutritionV2ProfileSheetProps extends Omit<FormProps, "onDone" | "onCancel"> {
  open: boolean;
  onClose: () => void;
}

/** The profile answers as a bottom sheet. Opening it reads and writes nothing. */
export const NutritionV2ProfileSheet: React.FC<NutritionV2ProfileSheetProps> = ({ open, onClose, ...form }) => {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto overscroll-contain" data-testid="nutrition-v2-profile-sheet">
        {open && (
          <>
            <SheetHeader className="mb-5 pr-8 text-left">
              <SheetTitle>{t("nutritionV2.profile.sheetTitle")}</SheetTitle>
              <SheetDescription>{t("nutritionV2.profile.sheetDescription")}</SheetDescription>
            </SheetHeader>
            <ProfileForm {...form} onDone={onClose} onCancel={onClose} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

NutritionV2ProfileSheet.displayName = "NutritionV2ProfileSheet";

export interface NutritionV2ProfileSectionProps {
  /** The account's Nutrition eligibility; the section is offered in every case. */
  reason: "eligible" | "minor" | "missingAge";
  /**
   * The account has no target and no plan yet: a complete profile then says
   * so, as the one empty-state message. Otherwise a complete profile shows
   * nothing (eligible) or only a way to change it (minor).
   */
  showReady: boolean;
}

/**
 * The Nutrition profile card: a completion prompt while answers are missing,
 * the empty state's "ready" message once they are all given.
 */
export const NutritionV2ProfileSection: React.FC<NutritionV2ProfileSectionProps> = ({ reason, showReady }) => {
  const { t } = useTranslation();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const titleId = useId();

  if (profile.data === undefined) return null;
  const completeness = getNutritionProfileCompleteness(nutritionProfileOf(profile.data));

  const sheet = (
    <NutritionV2ProfileSheet
      open={open}
      onClose={() => setOpen(false)}
      profile={profile.data}
      saveProfile={updateProfile.mutateAsync}
    />
  );

  if (completeness.status === "incomplete") {
    const openFields = [...completeness.missing, ...completeness.invalid];
    return (
      <section
        aria-labelledby={titleId}
        data-testid="nutrition-v2-profile-completion"
        data-profile-status="incomplete"
        className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
      >
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 id={titleId} className="font-semibold leading-snug text-foreground">
              {t("nutritionV2.profile.incomplete.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(reason === "missingAge" ? "nutritionV2.profile.incomplete.descriptionMissingAge" : "nutritionV2.profile.incomplete.description")}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="nutrition-v2-profile-open-fields">
              {t("nutritionV2.profile.incomplete.openFields", {
                fields: openFields.map((field) => t(`nutritionV2.profile.fieldName.${field}`)).join(", "),
              })}
            </p>
          </div>
        </div>
        <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => setOpen(true)}>
          {t("nutritionV2.profile.incomplete.action")}
        </Button>
        {sheet}
      </section>
    );
  }

  if (reason === "eligible" && showReady) {
    return (
      <section
        aria-labelledby={titleId}
        data-testid="nutrition-v2-profile-completion"
        data-profile-status="complete"
        className="space-y-3 rounded-xl bg-muted/40 p-4"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 id={titleId} className="font-semibold leading-snug text-foreground">
              {t("nutritionV2.profile.complete.title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("nutritionV2.profile.complete.description")}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
          {t("nutritionV2.profile.edit")}
        </Button>
        {sheet}
      </section>
    );
  }

  if (reason === "minor") {
    return (
      <div className="flex justify-center" data-testid="nutrition-v2-profile-completion" data-profile-status="complete">
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setOpen(true)}>
          {t("nutritionV2.profile.edit")}
        </Button>
        {sheet}
      </div>
    );
  }

  return null;
};

NutritionV2ProfileSection.displayName = "NutritionV2ProfileSection";

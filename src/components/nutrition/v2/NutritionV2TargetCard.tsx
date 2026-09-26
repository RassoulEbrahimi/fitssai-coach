import React from "react";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NutritionDate, TargetVersion } from "@shared/nutrition";
import type { NutritionV2Read } from "@/lib/nutrition/v2/readStatus";
import type { NutritionV2TargetFreshness } from "@/hooks/queries/useNutritionV2Target";

/**
 * The person's current Nutrition V2 TARGET. Presentational.
 *
 * Target values are what the person aims for. They are labelled "Ziel" and
 * nothing else — never planned, recorded or eaten — and rounded only here;
 * the stored values stay unrounded.
 *
 * Freshness is shown, never acted on: a stale target says so neutrally and
 * offers the setup; a target whose inputs cannot be compared says to check
 * the profile rather than claiming it is current. Nothing here writes.
 */

interface NutritionV2TargetCardProps {
  target: NutritionV2Read<TargetVersion | null>;
  freshness: NutritionV2TargetFreshness;
  /** Opens the target setup. Absent while setting a target is unavailable. */
  onSetUp?: () => void;
}

const formatNumber = (value: number, language: string) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(Math.round(value));

/** A calendar day, formatted in UTC so it never shifts. */
const formatDate = (date: NutritionDate, language: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
};

const VALUE_ROWS = [
  { key: "kcal", unit: "kcalValue" },
  { key: "proteinG", unit: "gramValue" },
  { key: "carbsG", unit: "gramValue" },
  { key: "fatG", unit: "gramValue" },
] as const;

const FreshnessNotice = ({ freshness, onSetUp }: { freshness: NutritionV2TargetFreshness; onSetUp?: () => void }) => {
  const { t } = useTranslation();
  if (freshness.status !== "stale" && freshness.status !== "cannotCompare") return null;
  const key = freshness.status === "stale" ? "stale" : "cannotCompare";

  return (
    <div
      role="status"
      data-testid="nutrition-v2-target-freshness"
      data-freshness={freshness.status}
      className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <p className="text-sm font-medium text-foreground">{t(`nutritionV2.target.${key}.title`)}</p>
      <p className="text-sm text-muted-foreground">{t(`nutritionV2.target.${key}.description`)}</p>
      {onSetUp && (
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={onSetUp}>
          {t(`nutritionV2.target.${key}.action`)}
        </Button>
      )}
    </div>
  );
};

export const NutritionV2TargetCard: React.FC<NutritionV2TargetCardProps> = ({ target, freshness, onSetUp }) => {
  const { t, i18n } = useTranslation();
  const language = i18n.language || "de";
  const title = t("nutritionV2.target.title");

  const body = (() => {
    switch (target.status) {
      case "disabled":
        return null;
      case "pending":
        return (
          <p className="text-sm text-muted-foreground" role="status" aria-busy="true">
            {t("nutritionV2.target.loading")}
          </p>
        );
      case "error":
        return (
          <p className="text-sm text-muted-foreground" role="status">
            {t("nutritionV2.target.error")}
          </p>
        );
      case "success":
        break;
    }
    const current = target.data;
    if (current === null) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("nutritionV2.target.none")}</p>
          {onSetUp && (
            <Button type="button" className="min-h-11" onClick={onSetUp}>
              {t("nutritionV2.target.set")}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <dl
          aria-label={t("nutritionV2.target.valuesLabel")}
          data-testid="nutrition-v2-target-values"
          className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4"
        >
          {VALUE_ROWS.map(({ key, unit }) => (
            <div key={key} className="min-w-0" data-testid={`nutrition-v2-target-${key}`}>
              <dt className="text-xs text-muted-foreground">{t(`nutritionV2.target.${key}`)}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">
                {t(`nutritionV2.target.${unit}`, { value: formatNumber(current.values[key], language) })}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {t(`nutritionV2.target.mode.${current.mode}`)} ·{" "}
          {t("nutritionV2.target.since", { date: formatDate(current.effectiveFrom, language) })}
        </p>
        <FreshnessNotice freshness={freshness} onSetUp={onSetUp} />
        {onSetUp && freshness.status !== "stale" && freshness.status !== "cannotCompare" && (
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onSetUp}>
            {t("nutritionV2.target.change")}
          </Button>
        )}
      </div>
    );
  })();

  if (body === null) return null;
  return (
    <section aria-label={title} data-testid="nutrition-v2-target" data-target-status={target.status} className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Target className="h-4 w-4" aria-hidden="true" />
        {title}
      </h3>
      {body}
    </section>
  );
};

NutritionV2TargetCard.displayName = "NutritionV2TargetCard";

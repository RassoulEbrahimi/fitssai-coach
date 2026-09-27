import { useTranslation } from "react-i18next";
import { useActiveNutritionV2Generation } from "@/hooks/queries/useNutritionV2";

/**
 * Read only. Shown only while the state names a generation request: without
 * one there is no status to report, so nothing is rendered. Refresh/focus
 * rereads the active request; no polling and no generation callable.
 */
export function NutritionV2GenerationStatus() {
  const { t } = useTranslation();
  const request = useActiveNutritionV2Generation();
  if (request.status === "disabled") return null;
  if (request.status === "success" && request.data === null) return null;
  const status = request.status === "success" ? request.data.status : request.status;
  return (
    <section aria-label={t("nutritionV2.product.generationTitle")} data-testid="nutrition-v2-generation-status" className="space-y-2 rounded-lg bg-muted/40 p-3">
      <h3 className="text-sm font-semibold">{t("nutritionV2.product.generationTitle")}</h3>
      <p role={status === "error" ? "alert" : "status"} aria-busy={status === "pending"} className="text-sm text-muted-foreground">
        {t(`nutritionV2.product.generation.${status}`)}
      </p>
    </section>
  );
}

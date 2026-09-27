import { useTranslation } from "react-i18next";
import { useActiveNutritionV2Generation } from "@/hooks/queries/useNutritionV2";

/** Read only. Refresh/focus rereads the active request; no generation callable. */
export function NutritionV2GenerationStatus() {
  const { t } = useTranslation();
  const request = useActiveNutritionV2Generation();
  if (request.status === "disabled") return null;
  const status = request.status === "success" ? request.data?.status ?? "none" : request.status;
  return (
    <section aria-label={t("nutritionV2.product.generationTitle")} className="space-y-2 rounded-lg bg-muted/40 p-3">
      <h3 className="text-sm font-semibold">{t("nutritionV2.product.generationTitle")}</h3>
      <p role={status === "error" ? "alert" : "status"} aria-busy={status === "pending"} className="text-sm text-muted-foreground">
        {t(`nutritionV2.product.generation.${status}`)}
      </p>
      <p className="text-sm text-muted-foreground">{t("nutritionV2.product.availability")}</p>
    </section>
  );
}

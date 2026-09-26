import React from "react";
import { useTranslation } from "react-i18next";
import type { NutritionDate } from "@shared/nutrition";
import type { NutritionEntryConflict } from "@/lib/nutrition/v2/nutritionWriteIntents";
import { useNutritionV2EntriesByDate } from "@/hooks/queries/useNutritionV2";
import { useNutritionV2EntryOverlay } from "@/hooks/queries/useNutritionV2EntryOverlay";
import type { NutritionV2Recording } from "@/hooks/queries/useNutritionV2Recording";
import { NutritionV2ConflictNotice } from "./NutritionV2ConflictNotice";

/**
 * This account's rejected offline Nutrition changes (NUT-07), wherever the
 * rest of the Nutrition V2 view is: with or without an active plan, on a plan
 * day or outside the plan, and for any date. Each notice reads its own date's
 * entries to show what is recorded now; nothing here writes, and it offers no
 * recording controls — only the explicit "apply again" and "discard".
 */

const ConflictItem = ({
  conflict,
  today,
  recording,
}: {
  conflict: NutritionEntryConflict;
  today: NutritionDate;
  recording: NutritionV2Recording;
}) => {
  // The conflict's own date, committed read plus this device's queued changes.
  const committed = useNutritionV2EntriesByDate(conflict.date);
  const { entries } = useNutritionV2EntryOverlay(committed, conflict.date, conflict.date);
  const current =
    entries.status === "success" ? (entries.data.find((entry) => entry.entryId === conflict.entryId) ?? null) : undefined;

  return <NutritionV2ConflictNotice conflict={conflict} current={current} today={today} recording={recording} />;
};

export const NutritionV2Conflicts: React.FC<{
  conflicts: readonly NutritionEntryConflict[];
  today: NutritionDate;
  recording: NutritionV2Recording;
}> = ({ conflicts, today, recording }) => {
  const { t } = useTranslation();
  if (conflicts.length === 0) return null;
  return (
    <section aria-label={t("nutritionV2.recording.conflict.sectionTitle")} className="space-y-3" data-testid="nutrition-v2-conflicts">
      {conflicts.map((conflict) => (
        <ConflictItem key={conflict.entryId} conflict={conflict} today={today} recording={recording} />
      ))}
    </section>
  );
};

NutritionV2Conflicts.displayName = "NutritionV2Conflicts";

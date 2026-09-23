import React from "react";
import { ChevronRight } from "lucide-react";
import { planDisplayName } from "@/lib/trainingsplanModel";

interface PlanPositionProps {
  weekNumber: number | null;
  totalWeeks: number;
  finished: boolean;
}

/** "Trainingsplan" and the current-plan chip, which opens the plan overview. */
export const TrainingsplanHeader: React.FC<PlanPositionProps & { onOpenPlan: () => void }> = ({
  weekNumber,
  totalWeeks,
  finished,
  onOpenPlan,
}) => (
  <header className="tp-header">
    <h1 className="tp-title">Trainingsplan</h1>
    <button
      type="button"
      className="tp-chip"
      aria-label={
        finished
          ? "Planübersicht öffnen, Plan abgeschlossen"
          : `Planübersicht öffnen, Woche ${weekNumber ?? 1} von ${totalWeeks}`
      }
      onClick={onOpenPlan}
    >
      {finished ? (
        "Abgeschlossen"
      ) : (
        <>
          <span className="tp-long">Woche {weekNumber ?? 1}/{totalWeeks}</span>
          <span className="tp-short">W{weekNumber ?? 1}/{totalWeeks}</span>
        </>
      )}
      <ChevronRight aria-hidden="true" />
    </button>
  </header>
);

/** The quiet current-plan row at the end of the tab. */
export const CurrentPlanRow: React.FC<PlanPositionProps & { trainingDaysPerWeek: number; onOpenPlan: () => void }> = ({
  weekNumber,
  totalWeeks,
  finished,
  trainingDaysPerWeek,
  onOpenPlan,
}) => (
  <button type="button" className="tp-plan-row" onClick={onOpenPlan}>
    <span>
      <b className="tp-ellipsis">{planDisplayName(totalWeeks)}</b>
      <span className="tp-meta tp-ellipsis">
        {finished ? "Abgeschlossen" : `Woche ${weekNumber ?? 1} von ${totalWeeks}`} · {trainingDaysPerWeek} Tage/Woche
      </span>
    </span>
    <span className="tp-link" aria-hidden="true">Plan<ChevronRight /></span>
  </button>
);

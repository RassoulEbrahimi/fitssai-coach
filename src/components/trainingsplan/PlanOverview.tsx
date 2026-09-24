import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatDayMonth,
  formatWeekdayShort,
  planDisplayName,
  type PlanDayRef,
  type PlanOverviewModel,
} from "@/lib/trainingsplanModel";

interface PlanOverviewProps {
  model: PlanOverviewModel;
  /** The plan's creation date as stored, `YYYY-MM-DD`, when known. */
  createdDay: string | null;
  onBack: () => void;
  onOpenDay: (day: PlanDayRef) => void;
}

/**
 * Planübersicht: the plan's structure and position, from the stored plan
 * only. The plan document carries no name, goal or level, so none is shown;
 * and there are no actions here that the app cannot actually perform.
 */
export const PlanOverview: React.FC<PlanOverviewProps> = ({ model, createdDay, onBack, onOpenDay }) => {
  const segmentState = (week: number) =>
    model.status === "finished" || week < model.weekNumber
      ? "past"
      : week === model.weekNumber && model.status === "active"
        ? "current"
        : "future";
  const position = model.status === "finished"
    ? "Abgeschlossen"
    : model.status === "before-start"
      ? "Noch nicht gestartet"
      : `Woche ${model.weekNumber} von ${model.totalWeeks}`;

  return (
    <div className="tp-root" data-screen="plan-overview">
      <div className="tp-topbar">
        <button type="button" className="tp-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Zurück
        </button>
      </div>

      <div className="tp-detail-head">
        <span className="tp-eyebrow">Aktueller Plan</span>
        <h1 className="tp-detail-title">{planDisplayName(model.totalWeeks)}</h1>
        <p className="tp-meta">
          {model.trainingDaysPerWeek} Tage/Woche · {model.totalWeeks} Wochen
        </p>
      </div>

      <section aria-labelledby="tp-run-heading" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="tp-section-head" style={{ margin: 0 }}>
          <h2 id="tp-run-heading" className="tp-eyebrow">Laufzeit</h2>
          <span className="tp-section-meta">{position}</span>
        </div>
        <div className="tp-run" role="img" aria-label={`Plan-Laufzeit: ${position}`}>
          {Array.from({ length: model.totalWeeks }, (_, index) => (
            <span key={index} data-state={segmentState(index + 1)} />
          ))}
        </div>
        <p className="tp-meta" style={{ fontSize: 12 }}>
          {formatDayMonth(model.startDay)} – {formatDayMonth(model.endDay, true)}
        </p>
      </section>

      <section aria-labelledby="tp-structure-heading">
        <div className="tp-section-head">
          <h2 id="tp-structure-heading" className="tp-eyebrow">Wochenstruktur</h2>
          <span className="tp-section-meta">Woche {model.weekNumber}</span>
        </div>
        <ul className="tp-list">
          {model.workoutDays.map((workout) => (
            <li key={workout.workoutDay}>
              <button
                type="button"
                className="tp-weekday tp-row-button"
                data-tp-opener={`day:${workout.workoutDay}`}
                onClick={() => onOpenDay(workout)}
              >
                <span>
                  <span className="tp-weekday-day">{formatWeekdayShort(workout.workoutDay)}</span>
                  <b className="tp-ellipsis">{workout.summary.title}</b>
                </span>
                <span className="tp-row-trail">
                  {workout.summary.exerciseCount} {workout.summary.exerciseCount === 1 ? "Übung" : "Übungen"}
                  <ChevronRight aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
          {model.restDays.length > 0 && (
            <li>
              <p className="tp-meta" style={{ fontSize: 12, minHeight: 36, display: "flex", alignItems: "center" }}>
                {model.restDays.map(formatWeekdayShort).join(" · ")}: {model.restDays.length === 1 ? "Ruhetag" : "Ruhetage"}
              </p>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="tp-details-heading">
        <div className="tp-section-head">
          <h2 id="tp-details-heading" className="tp-eyebrow">Details</h2>
        </div>
        <dl className="tp-kv">
          <dt>Dauer</dt>
          <dd>{model.totalWeeks} Wochen</dd>
          <dt>Trainingstage</dt>
          <dd>{model.trainingDaysPerWeek} pro Woche</dd>
          <dt>Start</dt>
          <dd>{formatDayMonth(model.startDay, true)}</dd>
          {createdDay && (
            <>
              <dt>Erstellt</dt>
              <dd>{formatDayMonth(createdDay, true)}</dd>
            </>
          )}
        </dl>
      </section>
    </div>
  );
};

export default PlanOverview;

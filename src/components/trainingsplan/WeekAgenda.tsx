import React from "react";
import { Check, ChevronRight } from "lucide-react";
import {
  formatShortDay,
  formatWeekdayShort,
  type AgendaRow,
  type PlanDayRef,
  type PlannedWorkout,
  type WeekAgenda as WeekAgendaModel,
} from "@/lib/trainingsplanModel";

const exerciseCount = (count: number) => (
  <>
    <span className="tp-long">{count} {count === 1 ? "Übung" : "Übungen"}</span>
    <span className="tp-short">{count} Üb.</span>
  </>
);

const WorkoutRowTrail: React.FC<{ row: Extract<AgendaRow, { kind: "workout" }> }> = ({ row }) => {
  switch (row.status) {
    case "completed":
      return <span className="tp-row-trail">{row.isToday ? "Heute · Erledigt" : "Erledigt"}</span>;
    case "today":
      return <span className="tp-row-trail" data-tone="green">Heute</span>;
    case "active":
      return <span className="tp-row-trail" data-tone="green">Läuft</span>;
    default:
      return (
        <span className="tp-row-trail">
          {exerciseCount(row.summary.exerciseCount)}
          <span className="tp-wide"> · {row.summary.setCount} Sätze</span>
          <ChevronRight aria-hidden="true" />
        </span>
      );
  }
};

const countLabel = (count: number) => `${count} ${count === 1 ? "Übung" : "Übungen"}`;

const statusLabel = (row: Extract<AgendaRow, { kind: "workout" }>): string => {
  switch (row.status) {
    case "completed": return row.isToday ? "heute, erledigt" : "erledigt";
    case "today": return "heute";
    case "active": return "läuft, fortsetzen";
    case "open": return `nicht erledigt, ${countLabel(row.summary.exerciseCount)}`;
    default: return countLabel(row.summary.exerciseCount);
  }
};

interface WeekAgendaProps {
  agenda: WeekAgendaModel;
  onOpenDay: (day: PlanDayRef) => void;
  onResume: () => void;
}

/**
 * "Diese Woche": one line per day, no accordion. Workout rows open the day
 * (the running day's row resumes it instead); rest rows are quiet, compact
 * and not interactive.
 */
export const WeekAgenda: React.FC<WeekAgendaProps> = ({ agenda, onOpenDay, onResume }) => (
  <section aria-labelledby="tp-week-heading">
    <div className="tp-section-head">
      <h2 id="tp-week-heading" className="tp-eyebrow">Diese Woche</h2>
      {agenda.weekNumber !== null && (
        <span className="tp-section-meta">
          <span className="tp-long">Woche {agenda.weekNumber} · {agenda.completedDays}/{agenda.trainingDays}</span>
          <span className="tp-short">W{agenda.weekNumber} · {agenda.completedDays}/{agenda.trainingDays}</span>
        </span>
      )}
    </div>
    <ul className="tp-agenda">
      {agenda.rows.map((row) => (
        <li key={row.key}>
          {row.kind === "workout" ? (
            <button
              type="button"
              className="tp-row tp-row-button"
              data-kind="workout"
              data-status={row.status}
              data-today={row.isToday}
              aria-label={`${formatShortDay(row.day.workoutDay)}, ${row.summary.title}, ${statusLabel(row)}`}
              onClick={() => (row.status === "active" ? onResume() : onOpenDay(row.day))}
            >
              <span className="tp-row-day">{formatShortDay(row.day.workoutDay)}</span>
              <span className="tp-row-marker" aria-hidden="true">
                {row.status === "completed"
                  ? <Check />
                  : row.status === "today" || row.status === "active"
                    ? <span className="tp-fill-dot" />
                    : <span className="tp-ring" />}
              </span>
              <span className="tp-row-name tp-ellipsis">{row.summary.title}</span>
              <WorkoutRowTrail row={row} />
            </button>
          ) : row.kind === "rest" ? (
            <div className="tp-row" data-kind="rest" data-today={row.isToday}>
              <span className="tp-row-day">
                {row.from === row.to
                  ? formatShortDay(row.from)
                  : `${formatWeekdayShort(row.from)}–${formatWeekdayShort(row.to)}`}
              </span>
              <span className="tp-row-marker" aria-hidden="true">–</span>
              <span className="tp-row-name tp-ellipsis">{row.from === row.to ? "Ruhetag" : "Ruhetage"}</span>
              {row.isToday ? <span className="tp-row-trail" data-tone="green">Heute</span> : <span />}
            </div>
          ) : (
            <div className="tp-row" data-kind="rest" data-today={row.isToday}>
              <span className="tp-row-day">{formatShortDay(row.workoutDay)}</span>
              <span className="tp-row-marker" aria-hidden="true">–</span>
              <span className="tp-row-name tp-ellipsis">Außerhalb des Plans</span>
              {row.isToday ? <span className="tp-row-trail" data-tone="green">Heute</span> : <span />}
            </div>
          )}
        </li>
      ))}
    </ul>
  </section>
);

/** "Nächste Woche": only the first planned workout, never the whole week. */
export const NextWeekTeaser: React.FC<{ workout: PlannedWorkout; onOpenDay: (day: PlanDayRef) => void }> = ({
  workout,
  onOpenDay,
}) => (
  <button type="button" className="tp-teaser" onClick={() => onOpenDay(workout)}>
    <span>
      <span className="tp-eyebrow">Nächste Woche</span>
      <b className="tp-ellipsis">{formatShortDay(workout.workoutDay)} · {workout.summary.title}</b>
    </span>
    <ChevronRight aria-hidden="true" />
  </button>
);

export default WeekAgenda;

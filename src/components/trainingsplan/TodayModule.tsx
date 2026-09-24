import React from "react";
import { Check, ChevronRight, Eye, Flame, Play } from "lucide-react";
import type { TodayExecutionView } from "@/components/TodayWorkoutCard";
import {
  findCurrentExercise,
  formatDayMonth,
  formatDaySummaryLine,
  formatShortDay,
  shiftDay,
  type PlanDayRef,
  type PlannedWorkout,
  type TodayState,
} from "@/lib/trainingsplanModel";
import { PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";

/** `mm:ss`, the same clock the running workout's header shows. */
const formatClock = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const PlayIcon = () => <Play fill="currentColor" aria-hidden="true" />;

interface TodayModuleProps {
  state: TodayState;
  exec: TodayExecutionView;
  today: string;
  /** Title of the running session's workout (Läuft only). */
  activeTitle: string;
  /** Measured duration of today's finished workout, when one was stored. */
  completedMinutes: number | null;
  planStartDay: string;
  /** The primary action, where focus returns when the running workout closes. */
  primaryRef?: React.Ref<HTMLButtonElement>;
  onStart: () => void;
  onResume: () => void;
  onOpenDay: (day: PlanDayRef) => void;
}

/**
 * The Heute module: one card, one slot, a state-aware primary action. The
 * eyebrow always reads "Heute · Wd DD" so the slot reads the same in every
 * state; only a session still running from another day names that day.
 */
export const TodayModule: React.FC<TodayModuleProps> = ({
  state,
  exec,
  today,
  activeTitle,
  completedMinutes,
  planStartDay,
  primaryRef,
  onStart,
  onResume,
  onOpenDay,
}) => {
  const todayEyebrow = `Heute · ${formatShortDay(today)}`;

  if (state.kind === "active") {
    const eyebrow = state.sessionDay && !state.isSessionToday
      ? `Training · ${formatShortDay(state.sessionDay)}`
      : todayEyebrow;
    const current = findCurrentExercise(exec.exercises, exec.getCompletedSetsCount);
    const meta = exec.isLoading
      ? "Fortschritt wird geladen …"
      : current
        ? `Übung ${current.index + 1} von ${exec.exercises.length} · ${current.name}`
        : "Alle Sätze erledigt";
    return (
      <section className="tp-today" data-due="true" data-state="active" aria-label="Heute">
        <div className="tp-today-top">
          <span className="tp-eyebrow">{eyebrow}</span>
          <span className="tp-state" data-tone="green">
            <Flame aria-hidden="true" />
            Läuft · <time className="tabular-nums">{formatClock(exec.durationSeconds)}</time>
          </span>
        </div>
        <h2 className="tp-today-title tp-ellipsis">{activeTitle}</h2>
        <p className="tp-meta tp-ellipsis">{meta}</p>
        <div
          className="tp-bar"
          role="progressbar"
          aria-label="Trainingsfortschritt"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={exec.progress.progressPercent}
          aria-valuetext={`${exec.progress.completedSets} von ${exec.progress.totalSets} Sätzen`}
        >
          <span style={{ width: `${exec.progress.progressPercent}%` }} />
        </div>
        <div className="tp-actions">
          <button type="button" ref={primaryRef} className="tp-cta" onClick={onResume}>
            <PlayIcon />
            Fortsetzen
          </button>
        </div>
      </section>
    );
  }

  if (state.kind === "planned") {
    const { workout } = state;
    const names = workout.summary.exerciseNames;
    return (
      <section className="tp-today" data-due="true" data-state="planned" aria-label="Heute">
        <div className="tp-today-top">
          <span className="tp-eyebrow">{todayEyebrow}</span>
          <span className="tp-state" data-tone="green"><span className="tp-dot" />Geplant</span>
        </div>
        <h2 className="tp-today-title tp-ellipsis">{workout.summary.title}</h2>
        <p className="tp-meta tp-ellipsis">{formatDaySummaryLine(workout.summary)}</p>
        {names.length > 0 && (
          <>
            <p className="tp-preview tp-narrow">
              <span className="tp-ellipsis">{names.slice(0, 3).join(" · ")}</span>
              {names.length > 3 && <span>+{names.length - 3}</span>}
            </p>
            <p className="tp-preview tp-wide">
              <span className="tp-ellipsis">{names.slice(0, 4).join(" · ")}</span>
              {names.length > 4 && <span>+{names.length - 4}</span>}
            </p>
          </>
        )}
        <div className="tp-actions">
          <button type="button" ref={primaryRef} className="tp-cta" onClick={onStart}>
            <PlayIcon />
            Training starten
          </button>
          <button
            type="button"
            className="tp-secondary tp-icon-narrow tp-roomy"
            aria-label="Ansehen"
            data-tp-opener="today-view"
            onClick={() => onOpenDay(workout)}
          >
            <Eye className="tp-short" aria-hidden="true" />
            <span className="tp-long">Ansehen</span>
          </button>
        </div>
      </section>
    );
  }

  if (state.kind === "completed") {
    const { workout, next } = state;
    return (
      <section className="tp-today" data-state="completed" aria-label="Heute">
        <div className="tp-today-top">
          <span className="tp-eyebrow">{todayEyebrow}</span>
          <span className="tp-state">
            <Check className="text-primary" aria-hidden="true" />
            Erledigt
          </span>
        </div>
        <h2 className="tp-today-title tp-ellipsis" data-size="s">
          {workout.summary.title}
          {completedMinutes !== null && ` · ${completedMinutes} Min`}
        </h2>
        {next && (
          <>
            <div className="tp-divider" />
            <NextRow next={next} onOpenDay={onOpenDay} />
          </>
        )}
      </section>
    );
  }

  if (state.kind === "plan-finished") {
    return (
      <section className="tp-today" data-state="plan-finished" aria-label="Heute" role="status">
        <div className="tp-today-top">
          <span className="tp-eyebrow">{todayEyebrow}</span>
          <span className="tp-state"><Check className="text-primary" aria-hidden="true" />Abgeschlossen</span>
        </div>
        <h2 className="tp-today-title" data-size="s">{PLAN_TOTAL_WEEKS}-Wochen-Plan abgeschlossen</h2>
        <div className="tp-notice">
          <p>Du hast alle {PLAN_TOTAL_WEEKS} Wochen dieses Plans hinter dir. Dein bisheriger Plan bleibt in der Planübersicht einsehbar.</p>
          <p>Neue Pläne können derzeit nicht erstellt werden, da die KI-Planerstellung vorübergehend nicht verfügbar ist.</p>
        </div>
      </section>
    );
  }

  // Rest day, or a plan that has not started yet.
  const next: PlannedWorkout | null = state.next;
  const nextEyebrow = next && next.workoutDay === shiftDay(today, 1) ? "Als Nächstes · Morgen" : "Als Nächstes";
  return (
    <section className="tp-today" data-state={state.kind} aria-label="Heute">
      <div className="tp-today-top">
        <span className="tp-eyebrow">{todayEyebrow}</span>
      </div>
      {state.kind === "rest" ? (
        <>
          <h2 className="tp-today-title" data-size="s">Ruhetag</h2>
          <p className="tp-meta">Heute ist Erholung geplant.</p>
        </>
      ) : (
        <>
          <h2 className="tp-today-title" data-size="s">Plan startet bald</h2>
          <p className="tp-meta">Dein Plan beginnt am {formatDayMonth(planStartDay)}.</p>
        </>
      )}
      {next && (
        <>
          <div className="tp-divider" />
          <span className="tp-eyebrow">{nextEyebrow}</span>
          <b className="tp-ellipsis" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
            {formatShortDay(next.workoutDay)} · {next.summary.title}
          </b>
          <p className="tp-meta">
            {formatDaySummaryLine(next.summary)}
          </p>
          <div className="tp-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="tp-secondary tp-fill"
              aria-label={`Ansehen: ${formatShortDay(next.workoutDay)} · ${next.summary.title}`}
              data-tp-opener="next-view"
              onClick={() => onOpenDay(next)}
            >
              Ansehen
            </button>
          </div>
        </>
      )}
    </section>
  );
};

const NextRow: React.FC<{ next: PlannedWorkout; onOpenDay: (day: PlanDayRef) => void }> = ({ next, onOpenDay }) => (
  <button type="button" className="tp-next-row" data-tp-opener="next-row" onClick={() => onOpenDay(next)}>
    <span>
      <span className="tp-eyebrow">Als Nächstes</span>
      <b className="tp-ellipsis">{formatShortDay(next.workoutDay)} · {next.summary.title}</b>
    </span>
    <ChevronRight aria-hidden="true" />
  </button>
);

export default TodayModule;

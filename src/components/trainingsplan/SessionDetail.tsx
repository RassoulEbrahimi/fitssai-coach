import React, { useMemo } from "react";
import { AlertCircle, Check, ChevronLeft, Info, RefreshCw } from "lucide-react";
import { useWorkoutSession } from "@/hooks/queries/useWorkoutHistory";
import { formatPerformanceValues, formatRecordedSet } from "@/lib/setPerformanceEntry";
import {
  buildSessionDetail,
  type HistoricalSet,
  type HistorySessionKey,
  type SessionDetailExercise,
} from "@/lib/workoutHistory";

interface SessionDetailProps {
  sessionKey: HistorySessionKey;
  today: string;
  onBack: () => void;
  /** Opened from Verlauf: the not-found state offers the way back there. */
  fromHistory: boolean;
}

/*
  One set line: number · reps · weight · state. Reps and weight each keep
  their own column, so a missing value reads as a gap ("–"), and the weight
  column stays empty for an exercise where no set has a weight. The values
  use the immediate summary's own formatter; the accessible name is its
  `formatRecordedSet` line.
*/
const SetLine: React.FC<{ set: HistoricalSet; hasWeight: boolean }> = ({ set, hasWeight }) => {
  const hasValues = set.reps !== null || set.weightKg !== null;
  const label = hasValues ? formatRecordedSet(set) : `Satz ${set.setNumber} · Abgehakt · ohne Werte`;
  return (
    <li className="tp-set" aria-label={label}>
      <span className="tp-set-num" aria-hidden="true">{set.setNumber}</span>
      {hasValues ? (
        <span className="tp-set-values" aria-hidden="true">
          <span className="tp-set-reps" data-empty={set.reps === null || undefined}>
            {set.reps !== null ? formatPerformanceValues({ reps: set.reps, weightKg: null }) : "–"}
          </span>
          <span data-empty={set.weightKg === null || undefined}>
            {set.weightKg !== null ? formatPerformanceValues({ reps: null, weightKg: set.weightKg }) : hasWeight ? "–" : ""}
          </span>
        </span>
      ) : (
        <span className="tp-set-values tp-set-note" aria-hidden="true">Abgehakt · ohne Werte</span>
      )}
      <span className="tp-set-state" aria-hidden="true">
        {set.completed ? <Check /> : <span>offen</span>}
      </span>
    </li>
  );
};

const ExerciseSection: React.FC<{ exercise: SessionDetailExercise }> = ({ exercise }) => (
  <li className="tp-session-exercise">
    <div className="tp-session-exercise-head">
      <span className="tp-exercise-num" aria-hidden="true">{exercise.number}</span>
      <span className="tp-session-exercise-name">
        <b>{exercise.name}</b>
        {exercise.note && <span className="tp-meta">{exercise.note}</span>}
      </span>
      {exercise.count && (
        <span className="tp-session-count" aria-label={`${exercise.count.replace("/", " von ")} Sätzen abgehakt`}>
          {exercise.count}
        </span>
      )}
    </div>
    {exercise.sets.length > 0 && (
      <ol className="tp-sets" aria-label={`Sätze ${exercise.name}`}>
        {exercise.sets.map((set) => <SetLine key={set.setNumber} set={set} hasWeight={exercise.hasWeight} />)}
      </ol>
    )}
    {exercise.summary && <p className="tp-meta tp-session-summary">{exercise.summary}</p>}
  </li>
);

const DetailSkeleton: React.FC = () => (
  <div className="tp-history-month" aria-hidden="true">
    <span className="tp-skel" style={{ width: "45%", height: 10 }} />
    {[0, 1, 2].map((index) => (
      <div key={index} className="tp-session-skeleton">
        <span className="tp-skel" style={{ width: 28, height: 28, borderRadius: 8 }} />
        <span className="tp-history-text">
          <span className="tp-skel" style={{ width: "58%", height: 12 }} />
          <span className="tp-skel" style={{ width: "34%", height: 9 }} />
        </span>
      </div>
    ))}
  </div>
);

/**
 * Session Detail: the stored record of one completed session. Read-only - no
 * inputs, checkboxes, timer, restart or editing. It reads persisted data
 * only, addressed by `planId + workoutDay`, and never another session in
 * its place.
 */
export const SessionDetail: React.FC<SessionDetailProps> = ({ sessionKey, today, onBack, fromHistory }) => {
  const { data, isError, isFetching, refetch } = useWorkoutSession(sessionKey);
  const model = useMemo(() => (data ? buildSessionDetail(data, today) : null), [data, today]);
  const status = model ? "ready" : data === null ? "missing" : isError ? "error" : "loading";

  return (
    <div className="tp-root tp-history" data-screen="session">
      <div className="tp-topbar">
        <button type="button" className="tp-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Zurück
        </button>
      </div>

      <div className="tp-detail-head" aria-busy={status === "loading" || undefined}>
        {model ? (
          <span className="tp-eyebrow">{model.eyebrow}</span>
        ) : status === "missing" ? (
          <span className="tp-history-icon"><AlertCircle aria-hidden="true" /></span>
        ) : null}
        <h1 className={model ? "tp-detail-title" : "tp-state-title"}>
          {model?.title ?? (status === "missing" ? "Training nicht gefunden" : status === "error" ? "Training" : "Training wird geladen")}
        </h1>
        {model?.meta ? <p className="tp-meta">{model.meta}</p> : null}
        {model?.context ? <p className="tp-meta tp-session-context">{model.context}</p> : null}
      </div>

      {status === "loading" && <DetailSkeleton />}

      {status === "error" && (
        <div className="tp-history-error" role="alert">
          <div>
            <AlertCircle aria-hidden="true" />
            <span>
              <b>Training konnte nicht geladen werden</b>
              <span className="tp-meta">Es ließ sich gerade nicht abrufen.</span>
            </span>
          </div>
          <button type="button" className="tp-secondary tp-fill" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw aria-hidden="true" />
            Erneut versuchen
          </button>
        </div>
      )}

      {status === "missing" && (
        <div className="tp-history-empty">
          <p className="tp-meta">Zu diesem Tag ist kein abgeschlossenes Training gespeichert.</p>
          {fromHistory && (
            <button type="button" className="tp-secondary tp-fill" onClick={onBack}>Zum Verlauf</button>
          )}
        </div>
      )}

      {model?.notice && (
        <p className="tp-scope">
          <Info aria-hidden="true" />
          <span>{model.notice}</span>
        </p>
      )}

      {model && model.exercises.length > 0 && (
        <>
          <ol className="tp-list tp-session-list" aria-label="Übungen">
            {model.exercises.map((exercise) => <ExerciseSection key={exercise.number} exercise={exercise} />)}
          </ol>
          <p className="tp-meta tp-session-footnote">Nur selbst eingetragene Werte. – bedeutet: nicht erfasst.</p>
        </>
      )}
    </div>
  );
};

export default SessionDetail;

import React from "react";
import { AlertCircle, ChevronLeft, ChevronRight, History, RefreshCw } from "lucide-react";
import { useWorkoutHistory } from "@/hooks/queries/useWorkoutHistory";
import { dayToDate, formatDayMonth, formatShortDay, formatWeekdayLong } from "@/lib/trainingsplanModel";
import {
  formatHistoryRowMeta,
  groupHistoryByMonth,
  historyDayLabel,
  historySessionKey,
  sessionOpenerKey,
  type HistoryEntry,
  type HistorySessionKey,
} from "@/lib/workoutHistory";

/**
 * The quiet `Verlauf` row. It belongs to the user, not to a plan, so it is
 * shown with or without an active plan. The meta names the newest session
 * only once it is known; "Noch keine Trainings" only when there provably is none.
 */
export const HistoryEntryRow: React.FC<{
  latest: HistoryEntry | null | undefined;
  today: string;
  onOpen: () => void;
}> = ({ latest, today, onOpen }) => {
  const meta = latest
    ? `Zuletzt: ${latest.workoutDay === today ? "Heute" : formatShortDay(latest.workoutDay)} · ${latest.title}`
    : latest === null
      ? "Noch keine Trainings"
      : null;
  return (
    <button type="button" className="tp-history-row" data-tp-opener="history-row" onClick={onOpen}>
      <span>
        <b className="tp-ellipsis">Verlauf</b>
        {meta && <span className="tp-meta tp-ellipsis">{meta}</span>}
      </span>
      <span className="tp-link" aria-hidden="true">Alle<ChevronRight /></span>
    </button>
  );
};

/** A failed read, never shown as "no history". */
export const HistoryReadError: React.FC<{ title: string; onRetry: () => void; retrying?: boolean }> = ({
  title,
  onRetry,
  retrying = false,
}) => (
  <div className="tp-history-error" role="alert">
    <div>
      <AlertCircle aria-hidden="true" />
      <span>
        <b>{title}</b>
        <span className="tp-meta">Deine Trainings sind gespeichert, sie ließen sich nur gerade nicht abrufen.</span>
      </span>
    </div>
    <button type="button" className="tp-secondary tp-fill" onClick={onRetry} disabled={retrying}>
      <RefreshCw aria-hidden="true" />
      Erneut versuchen
    </button>
  </div>
);

const HistorySkeleton: React.FC = () => (
  <div className="tp-history-month" aria-busy="true" aria-label="Verlauf wird geladen">
    <span className="tp-skel" style={{ width: 96, height: 10, marginLeft: 2 }} />
    <div className="tp-history-list" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="tp-history-session">
          <span className="tp-history-date">
            <span className="tp-skel" style={{ width: 22, height: 8 }} />
            <span className="tp-skel" style={{ width: 26, height: 14 }} />
          </span>
          <span className="tp-history-text">
            <span className="tp-skel" style={{ width: "62%", height: 12 }} />
            <span className="tp-skel" style={{ width: "38%", height: 9 }} />
          </span>
        </div>
      ))}
    </div>
  </div>
);

const SessionRow: React.FC<{ entry: HistoryEntry; today: string; onOpen: (key: HistorySessionKey) => void }> = ({
  entry,
  today,
  onOpen,
}) => {
  const meta = formatHistoryRowMeta(entry);
  const label = [
    `${formatWeekdayLong(entry.workoutDay)}, ${formatDayMonth(entry.workoutDay, true)}`,
    entry.title,
    meta,
  ].filter(Boolean).join(", ");
  return (
    <li>
      <button
        type="button"
        className="tp-history-session"
        aria-label={label}
        data-tp-opener={sessionOpenerKey(entry)}
        onClick={() => onOpen({ planId: entry.planId, workoutDay: entry.workoutDay })}
      >
        <span className="tp-history-date" aria-hidden="true">
          <span className="tp-history-dow">{historyDayLabel(entry.workoutDay, today)}</span>
          <span className="tp-history-day">{dayToDate(entry.workoutDay).getDate()}</span>
        </span>
        <span className="tp-history-text">
          <b className="tp-ellipsis">{entry.title}</b>
          {meta && <span className="tp-meta tp-ellipsis">{meta}</span>}
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
    </li>
  );
};

/**
 * Verlauf: completed sessions, newest first, one list surface per calendar
 * month. Read-only; a row opens that session's detail.
 */
export const WorkoutHistoryScreen: React.FC<{
  today: string;
  onBack: () => void;
  onOpenSession: (key: HistorySessionKey) => void;
}> = ({ today, onBack, onOpenSession }) => {
  const history = useWorkoutHistory();
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  const months = groupHistoryByMonth(entries);
  const hasData = !!history.data;

  return (
    <div className="tp-root tp-history" data-screen="history">
      <div className="tp-topbar">
        <button type="button" className="tp-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          Zurück
        </button>
      </div>
      <h1 className="tp-detail-title">Verlauf</h1>

      {!hasData && history.isError && (
        <HistoryReadError title="Verlauf konnte nicht geladen werden" onRetry={() => void history.refetch()} retrying={history.isFetching} />
      )}
      {!hasData && !history.isError && <HistorySkeleton />}

      {hasData && history.isRefetchError && (
        <HistoryReadError title="Verlauf konnte nicht aktualisiert werden" onRetry={() => void history.refetch()} retrying={history.isFetching} />
      )}

      {hasData && entries.length === 0 && !history.hasNextPage && (
        <div className="tp-history-empty">
          <span className="tp-history-icon"><History aria-hidden="true" /></span>
          <b>Noch keine Trainings</b>
          <p className="tp-meta">Sobald du ein Training speicherst und beendest, erscheint es hier.</p>
        </div>
      )}
      {hasData && entries.length === 0 && history.hasNextPage && (
        <p className="tp-meta">In den neuesten Einträgen ist kein abgeschlossenes Training gespeichert.</p>
      )}

      {months.map((month) => (
        <section key={month.key} className="tp-history-month" aria-label={month.label}>
          <h2 className="tp-eyebrow">{month.label}</h2>
          <ol className="tp-history-list">
            {month.entries.map((entry) => (
              <SessionRow key={historySessionKey(entry)} entry={entry} today={today} onOpen={onOpenSession} />
            ))}
          </ol>
        </section>
      ))}

      {hasData && history.isFetchNextPageError ? (
        <HistoryReadError
          title="Ältere Trainings konnten nicht geladen werden"
          onRetry={() => void history.fetchNextPage()}
          retrying={history.isFetchingNextPage}
        />
      ) : hasData && history.hasNextPage ? (
        <button
          type="button"
          className="tp-secondary tp-quiet tp-fill"
          onClick={() => void history.fetchNextPage()}
          disabled={history.isFetchingNextPage}
        >
          {history.isFetchingNextPage ? "Wird geladen …" : "Ältere Trainings laden"}
        </button>
      ) : null}
    </div>
  );
};

export default WorkoutHistoryScreen;

import { format } from "date-fns";
import { de } from "date-fns/locale";
import { readLogDayIndex, readLogWeekKey, readLogWorkoutDay } from "@shared/workoutCompletion";
import { PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";
import { readDisplayedDay } from "@/lib/planWeekMirroring";
import { hasPositionActivityMarker, isPositionTicked } from "@/lib/positionActivity";
import type { StoredDocument } from "@/lib/previousPerformance";
import { isRecordedReps, isRecordedWeightKg, readSetLogState, USER_RECORDED } from "@/lib/setPerformance";
import {
  dayToDate,
  formatDayMonth,
  formatWeekdayLong,
  formatWeekdayShort,
  planDisplayName,
  readDayExercises,
  readWorkoutLabel,
  shiftDay,
  WORKOUT_TITLE_FALLBACK,
} from "@/lib/trainingsplanModel";
import type { DayContent, WorkoutPlanContent } from "@/lib/types";
import { classifyLog, isCompletedDayLog, type AnyWorkoutLogShape } from "@/lib/workoutCompletion";
import { readDurationSec } from "@/lib/workoutLog";

/**
 * Workout History (TRAINING-HISTORY-01): the completed sessions a user has
 * stored, read back as they were stored.
 *
 * A history session is a **completed day-session record** - the one document
 * that can say a workout day was completed (`shared/workoutCompletion.ts`).
 * Exercise-position logs, ticked sets, a measured duration or any progress
 * never make one. Its identity is `planId + workoutDay`, the address the
 * day-session writer converges on. That is deliberately not
 * `readCompletedWorkoutDays`' `weekKey + dayIndex`: two plans both have a
 * "Week 1, Monday", and they are different workouts.
 *
 * Nothing is reconstructed. A session without a readable `workoutDay` cannot
 * be placed in a chronology and is not listed; a date is never taken from
 * the plan calendar, `completedAt`, today or list order. Names come only from
 * the session's own plan, through the same week mirroring the plan-edit guard
 * protects - never from the active plan. Reps and weight are shown only where
 * the set says they were `user-recorded`.
 *
 * The plan is a **name lookup only**. It can be edited after a session - an
 * exercise may be appended to a day that already has history - so its current
 * exercise list, set prescriptions and exercise count say nothing about what
 * was trained. What a session contains comes from its stored activity alone.
 *
 * Pure: every read arrives through a source.
 */

/** Valid sessions a History page aims for. */
export const HISTORY_PAGE_SESSIONS = 30;
/** Mixed `workout_logs` documents one read fetches. */
export const HISTORY_LOG_CHUNK = 100;
/** Reads one page may make before handing back what it has. */
export const HISTORY_MAX_CHUNKS = 8;
/** Above every `YYYY-MM-DD`: the first page reads "before" this. */
export const HISTORY_START = "9999-99-99";

export const EXERCISE_NAME_UNRESOLVED = "Name nicht mehr zuordenbar";

export interface HistorySessionKey {
  planId: string;
  workoutDay: string;
}

/** One completed session, as its day-session record stores it. */
export interface HistorySession extends HistorySessionKey {
  /** The record the session is read from: the first by id of its completed rows. */
  logId: string;
  /** The session's plan position, when the record carries one. */
  weekKey: string | null;
  dayIndex: number | null;
  /** Measured seconds, only when stored and plausible. Never estimated. */
  durationSec: number | null;
}

export const historySessionKey = ({ planId, workoutDay }: HistorySessionKey): string =>
  JSON.stringify([planId, workoutDay]);

/** The opener key of a session's row, so Back can return focus to it. */
export const sessionOpenerKey = ({ planId, workoutDay }: HistorySessionKey): string =>
  `session-${encodeURIComponent(planId)}-${workoutDay}`;

const readPlanId = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** The session one stored document is evidence of, or null. */
const readSessionRow = ({ id, data }: StoredDocument): HistorySession | null => {
  if (!isCompletedDayLog(data as AnyWorkoutLogShape)) return null;
  const workoutDay = readLogWorkoutDay(data.workoutDay);
  const planId = readPlanId(data.planId);
  if (workoutDay === null || planId === null) return null;
  const weekKey = readLogWeekKey(data.weekKey);
  const dayIndex = readLogDayIndex(data.dayIndex);
  const positioned = weekKey !== null && dayIndex !== null;
  return {
    planId,
    workoutDay,
    logId: id,
    weekKey: positioned ? weekKey : null,
    dayIndex: positioned ? dayIndex : null,
    durationSec: readDurationSec(data.durationSec),
  };
};

/**
 * The completed sessions among mixed `workout_logs` documents, newest first,
 * once per `planId + workoutDay`. Rows of one session are read in id order -
 * the order the day-session writer picks its document in.
 */
export const collectHistorySessions = (docs: readonly StoredDocument[]): HistorySession[] => {
  const byKey = new Map<string, HistorySession[]>();
  for (const doc of docs) {
    const row = readSessionRow(doc);
    if (!row) continue;
    const key = historySessionKey(row);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  const sessions = [...byKey.values()].map((rows) => {
    const [first, ...rest] = [...rows].sort((a, b) => a.logId.localeCompare(b.logId));
    const positioned = [first, ...rest].find((row) => row.weekKey !== null) ?? first;
    const measured = [first, ...rest].find((row) => row.durationSec !== null) ?? first;
    return { ...first, weekKey: positioned.weekKey, dayIndex: positioned.dayIndex, durationSec: measured.durationSec };
  });
  return sessions.sort((a, b) => b.workoutDay.localeCompare(a.workoutDay) || a.planId.localeCompare(b.planId));
};

// --- Paging ------------------------------------------------------------------

export interface HistoryLogSource {
  /** Logs whose `workoutDay` is strictly before `before`, newest day first, at most `limit`. */
  logsBefore: (before: string, limit: number) => Promise<StoredDocument[]>;
  /** Every log stored on one `workoutDay`. */
  logsOn: (workoutDay: string) => Promise<StoredDocument[]>;
}

export interface HistorySessionPage {
  sessions: HistorySession[];
  /** Where the next page starts reading; null once the source is exhausted. */
  nextBefore: string | null;
}

const rawDay = (doc: StoredDocument): string | null =>
  typeof doc.data.workoutDay === "string" ? doc.data.workoutDay : null;

/**
 * One page of history, bounded: mixed documents are read in chunks, newest day
 * first, until `target` sessions are found or the source runs out.
 *
 * A document is not a session, so the page counts sessions, not documents.
 * Days are only ever taken whole: a full chunk may end part-way through its
 * oldest day, so that day is read again with the next chunk. A chunk that is
 * one single day is completed with a read of that day alone.
 */
export const readHistorySessionPage = async (
  source: HistoryLogSource,
  {
    before = HISTORY_START,
    target = HISTORY_PAGE_SESSIONS,
    chunk = HISTORY_LOG_CHUNK,
    maxChunks = HISTORY_MAX_CHUNKS,
  }: { before?: string; target?: number; chunk?: number; maxChunks?: number } = {}
): Promise<HistorySessionPage> => {
  const sessions: HistorySession[] = [];
  let cursor = before;
  for (let read = 0; read < maxChunks; read += 1) {
    const docs = await source.logsBefore(cursor, chunk);
    const full = docs.length >= chunk;
    const days = new Map<string, StoredDocument[]>();
    for (const doc of docs) {
      const day = rawDay(doc);
      if (day === null || day >= cursor) continue;
      days.set(day, [...(days.get(day) ?? []), doc]);
    }
    let ordered = [...days.keys()].sort((a, b) => b.localeCompare(a));
    if (ordered.length === 0) return { sessions, nextBefore: null };
    if (full) {
      const oldest = ordered[ordered.length - 1];
      if (ordered.length === 1) days.set(oldest, await source.logsOn(oldest));
      else ordered = ordered.slice(0, -1);
    }
    for (let index = 0; index < ordered.length; index += 1) {
      const day = ordered[index];
      sessions.push(...collectHistorySessions(days.get(day) ?? []));
      cursor = day;
      const exhausted = !full && index === ordered.length - 1;
      if (exhausted) return { sessions, nextBefore: null };
      if (sessions.length >= target) return { sessions, nextBefore: cursor };
    }
  }
  return { sessions, nextBefore: cursor };
};

// --- Names -------------------------------------------------------------------

const isPlanContent = (content: unknown): content is WorkoutPlanContent =>
  !!content && typeof content === "object" && !Array.isArray(content);

/** The plan day a session trained, read from its own plan. Null when unreadable. */
export const resolveHistoricalDay = (
  planContent: unknown,
  session: Pick<HistorySession, "weekKey" | "dayIndex">
): DayContent | null => {
  if (!isPlanContent(planContent) || session.weekKey === null || session.dayIndex === null) return null;
  return readDisplayedDay(planContent, session.weekKey, session.dayIndex) ?? null;
};

/**
 * A session's title: its plan day's own explicit label ("Push A"), else
 * `Training`. Never derived from the day's current exercises, which may have
 * changed since - an exercise appended later must not rename an old session.
 */
export const historicalTitle = (day: DayContent | null | undefined): string =>
  readWorkoutLabel(day?.day) ?? WORKOUT_TITLE_FALLBACK;

/** A History row: the session plus its title from its own plan. */
export interface HistoryEntry extends HistorySession {
  title: string;
}

export const summarizeHistorySession = (session: HistorySession, planContent: unknown): HistoryEntry =>
  ({ ...session, title: historicalTitle(resolveHistoricalDay(planContent, session)) });

export interface HistorySource extends HistoryLogSource {
  /** A plan's stored content; null when the plan does not exist. Rejects when it cannot be read. */
  planContent: (planId: string) => Promise<unknown>;
}

export interface HistoryPage {
  entries: HistoryEntry[];
  nextBefore: string | null;
}

/** A page of sessions, each named from its own plan. Every plan is read once. */
export const readHistoryPage = async (
  source: HistorySource,
  options: Parameters<typeof readHistorySessionPage>[1] = {}
): Promise<HistoryPage> => {
  const { sessions, nextBefore } = await readHistorySessionPage(source, options);
  const planIds = [...new Set(sessions.map((session) => session.planId))];
  const plans = new Map(await Promise.all(
    planIds.map(async (planId) => [planId, await source.planContent(planId)] as const)
  ));
  return { entries: sessions.map((session) => summarizeHistorySession(session, plans.get(session.planId))), nextBefore };
};

// --- Presentation ------------------------------------------------------------

/** Whole measured minutes, the same rounding Today's "Erledigt" uses. Null when unmeasured. */
export const measuredMinutes = (durationSec: unknown): number | null => {
  const seconds = readDurationSec(durationSec);
  return seconds === null ? null : Math.max(1, Math.round(seconds / 60));
};

/** `52 Min`, `1 Std 04 Min`. Null when nothing was measured - never 0, never "~". */
export const formatSessionDuration = (durationSec: unknown): string | null => {
  const minutes = measuredMinutes(durationSec);
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} Min`;
  const rest = minutes % 60;
  const hours = `${Math.floor(minutes / 60)} Std`;
  return rest ? `${hours} ${String(rest).padStart(2, "0")} Min` : hours;
};

/**
 * `52 Min`: the measured duration, stored on the session itself. No exercise
 * count - the plan's current count is not the session's, and the session's own
 * would take a read per row.
 */
export const formatHistoryRowMeta = (entry: HistoryEntry): string | null =>
  formatSessionDuration(entry.durationSec) ?? (entry.weekKey === null ? "Nur Abschluss gespeichert" : null);

/** `Heute`, `Gestern`, else the short weekday. */
export const historyDayLabel = (workoutDay: string, today: string): string =>
  workoutDay === today ? "Heute" : workoutDay === shiftDay(today, -1) ? "Gestern" : formatWeekdayShort(workoutDay);

export interface HistoryMonth<T> {
  key: string;
  /** `September 2026` */
  label: string;
  entries: T[];
}

/** Consecutive entries of one calendar month, in the order given. */
export const groupHistoryByMonth = <T extends { workoutDay: string }>(entries: readonly T[]): HistoryMonth<T>[] => {
  const months: HistoryMonth<T>[] = [];
  for (const entry of entries) {
    const key = entry.workoutDay.slice(0, 7);
    const current = months[months.length - 1];
    if (current?.key === key) current.entries.push(entry);
    else months.push({ key, label: format(dayToDate(`${key}-01`), "LLLL yyyy", { locale: de }), entries: [entry] });
  }
  return months;
};

// --- Exact session for a plan day ------------------------------------------

interface PlanScopedLog extends AnyWorkoutLogShape {
  planId?: unknown;
  plan_id?: unknown;
}

/**
 * Whether exactly this plan's `workoutDay` has a completed day-session record.
 * Nothing else answers it: not the same date in another plan, not the latest
 * session, not an exercise log.
 */
export const hasCompletedSession = (
  logs: readonly (PlanScopedLog | null | undefined)[] | null | undefined,
  planId: string | null | undefined,
  workoutDay: string
): boolean =>
  !!planId &&
  (logs ?? []).some((log) =>
    !!log &&
    isCompletedDayLog(log) &&
    (log.planId ?? log.plan_id) === planId &&
    readLogWorkoutDay(log.workoutDay ?? log.workout_day) === workoutDay);

// --- Session detail -----------------------------------------------------------

/** One stored set, as recorded. Values only when `user-recorded`. */
export interface HistoricalSet {
  setNumber: number;
  completed: boolean;
  reps: number | null;
  weightKg: number | null;
}

const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

/**
 * The sets of one exercise position. Documents are chosen exactly as the
 * running workout shows them: parents by id, then set documents by id, the
 * first per set number. Completion follows `readSetCompletion`; reps and
 * weight only an explicit `user-recorded` marker. A document that records
 * neither is not a set anyone did.
 */
export const readHistoricalSets = (
  parents: readonly { id: string; docs: readonly StoredDocument[] }[]
): HistoricalSet[] => {
  const claimed = new Set<string>();
  const sets: HistoricalSet[] = [];
  for (const parent of [...parents].sort(byId)) {
    for (const { data } of [...parent.docs].sort(byId)) {
      const key = String(data.setNumber);
      if (claimed.has(key)) continue;
      claimed.add(key);
      if (typeof data.setNumber !== "number" || !/^[1-9]\d*$/.test(key)) continue;
      const { completed, actual } = readSetLogState(data);
      const trusted = actual.source === USER_RECORDED;
      const reps = trusted && isRecordedReps(actual.reps) ? actual.reps : null;
      const weightKg = trusted && isRecordedWeightKg(actual.weightKg) ? actual.weightKg : null;
      if (!completed && reps === null && weightKg === null) continue;
      sets.push({ setNumber: data.setNumber, completed, reps, weightKg });
    }
  }
  return sets.sort((a, b) => a.setNumber - b.setNumber);
};

export interface SessionDetailSource {
  /** Day logs stored at `planId + workoutDay`. */
  daySessionLogs: (planId: string, workoutDay: string) => Promise<StoredDocument[]>;
  planContent: (planId: string) => Promise<unknown>;
  /** Logs stored at one plan position. */
  positionLogs: (planId: string, weekKey: string, dayIndex: number) => Promise<StoredDocument[]>;
  setDocuments: (logId: string) => Promise<StoredDocument[]>;
}

/** One exercise position with stored activity in a session. */
export interface HistoricalPosition {
  exerciseIndex: number;
  /** The exercise itself was ticked off on its parent log. */
  ticked: boolean;
  /** Stored sets: ticked, or carrying trusted recorded values. */
  sets: HistoricalSet[];
}

/**
 * Everything stored for one session. Plain data, so it can be cached. Of the
 * plan it keeps only what names the evidenced positions - never its exercise
 * list or prescriptions.
 */
export interface SessionRecord {
  session: HistorySession;
  /** Whether the session's own plan still exists. */
  planExists: boolean;
  /** Whether the session's plan day could be read in that plan. */
  dayResolved: boolean;
  /** The title from the plan day's explicit label. */
  title: string;
  /** Names of the evidenced positions, by exercise index, from the session's own plan. */
  names: Record<number, string>;
  /** Positions with stored activity, in order; null when the session has no plan position to read them at. */
  positions: HistoricalPosition[] | null;
}

/**
 * The stored record of exactly one session, or null when no completed
 * day-session exists at `planId + workoutDay`. Never another session instead.
 * Any failed read rejects: unreadable is not the same as absent.
 */
export const loadSessionRecord = async (
  source: SessionDetailSource,
  { planId, workoutDay }: HistorySessionKey
): Promise<SessionRecord | null> => {
  const docs = await source.daySessionLogs(planId, workoutDay);
  const session = collectHistorySessions(docs)
    .find((candidate) => candidate.planId === planId && candidate.workoutDay === workoutDay);
  if (!session) return null;

  const planContent = (await source.planContent(planId)) ?? null;
  const day = resolveHistoricalDay(planContent, session);
  const plan = { planExists: planContent !== null, dayResolved: day !== null, title: historicalTitle(day) };
  if (session.weekKey === null || session.dayIndex === null) return { session, ...plan, names: {}, positions: null };

  const logs = await source.positionLogs(planId, session.weekKey, session.dayIndex);
  const parentsByExercise = new Map<number, StoredDocument[]>();
  for (const log of logs) {
    if (classifyLog(log.data as AnyWorkoutLogShape) !== "exercise") continue;
    // A log that names another day is not this session's, whatever its position.
    const day = readLogWorkoutDay(log.data.workoutDay);
    if (day !== null && day !== workoutDay) continue;
    const exerciseIndex = log.data.exerciseIndex as number;
    parentsByExercise.set(exerciseIndex, [...(parentsByExercise.get(exerciseIndex) ?? []), log]);
  }
  const read = await Promise.all([...parentsByExercise].map(async ([exerciseIndex, parents]) => {
    const withSets = await Promise.all(parents.map(async (parent) => ({ id: parent.id, docs: await source.setDocuments(parent.id) })));
    return {
      exerciseIndex,
      ticked: parents.some((parent) => isPositionTicked(parent.data)),
      marked: parents.some((parent) => hasPositionActivityMarker(parent.data)),
      sets: readHistoricalSets(withSets),
    };
  }));
  // Evidence only: a position counts when its own logs record activity. The
  // plan never adds a position, however many exercises its day lists today.
  const positions = read
    .filter((position) => position.marked || position.sets.length > 0)
    .map(({ exerciseIndex, ticked, sets }): HistoricalPosition => ({ exerciseIndex, ticked, sets }))
    .sort((a, b) => a.exerciseIndex - b.exerciseIndex);
  const planned = readDayExercises(day);
  const names: Record<number, string> = {};
  for (const { exerciseIndex } of positions) {
    const name = (planned[exerciseIndex] as { name?: unknown } | null | undefined)?.name;
    if (typeof name === "string" && name.trim() !== "") names[exerciseIndex] = name.trim();
  }
  return { session, ...plan, names, positions };
};

export interface SessionDetailExercise {
  /** Position in the day, 1-based. */
  number: number;
  name: string;
  /** Said once under the name when the position no longer has a name. */
  note: string | null;
  /** Individual set lines: only when at least one set has recorded values. */
  sets: HistoricalSet[];
  /** Whether any listed set has a weight; otherwise the weight column stays empty. */
  hasWeight: boolean;
  /** One line instead of set lines, when no set has values. */
  summary: string | null;
}

export interface SessionDetailModel {
  eyebrow: string;
  title: string;
  meta: string | null;
  context: string | null;
  notice: string | null;
  exercises: SessionDetailExercise[];
}

const setWord = (count: number) => (count === 1 ? "Satz" : "Sätze");

const buildExercise = (
  position: HistoricalPosition,
  name: string | null,
  dayResolved: boolean
): SessionDetailExercise => {
  const { exerciseIndex, ticked, sets } = position;
  const completed = sets.filter((set) => set.completed).length;
  const withValues = sets.some((set) => set.reps !== null || set.weightKg !== null);
  return {
    number: exerciseIndex + 1,
    name: name ?? `Übung ${exerciseIndex + 1}`,
    note: name === null && dayResolved ? EXERCISE_NAME_UNRESOLVED : null,
    sets: withValues ? [...sets] : [],
    hasWeight: sets.some((set) => set.weightKg !== null),
    summary: withValues
      ? null
      : completed > 0
        ? `${completed} ${setWord(completed)} abgehakt · keine Werte erfasst`
        : ticked
          ? "Als erledigt markiert · keine Sätze erfasst"
          : "Aktivität gespeichert · keine Sätze erfasst",
  };
};

/**
 * Session Detail, as data. Only what the record establishes is stated: the
 * exercises are the positions with stored activity, counts come from stored
 * sets, and the plan contributes names only. Every unknown is left out, and
 * explained in one sentence where the screen would otherwise look broken.
 */
export const buildSessionDetail = (record: SessionRecord, today: string): SessionDetailModel => {
  const { session, planExists, dayResolved, title, names, positions } = record;
  const exercises = (positions ?? []).map((position) =>
    buildExercise(position, names[position.exerciseIndex] ?? null, dayResolved));

  const ticked = (positions ?? []).reduce((total, position) => total + position.sets.filter((set) => set.completed).length, 0);
  const meta = [
    formatSessionDuration(session.durationSec),
    ticked > 0 ? `${ticked} ${setWord(ticked)} abgehakt` : null,
  ].filter((part): part is string => part !== null);

  const weekNumber = session.weekKey?.match(/\d+/)?.[0];
  const nothingStored = "Übungen und Sätze sind zu diesem Training nicht gespeichert.";
  let notice: string | null = null;
  if (session.weekKey === null) {
    notice = "Zu diesem Training sind nur Datum und Abschluss gespeichert. Übungen und Sätze lassen sich ihm nicht zuordnen.";
  } else if (!dayResolved) {
    notice = [
      !planExists
        ? "Der Plan zu diesem Training ist nicht mehr verfügbar, deshalb lassen sich keine Übungsnamen anzeigen."
        : "Der Plantag zu diesem Training ist nicht mehr lesbar, deshalb lassen sich keine Übungsnamen anzeigen.",
      exercises.length === 0 ? nothingStored : null,
    ].filter(Boolean).join(" ");
  } else if (exercises.length === 0) {
    notice = nothingStored;
  }

  return {
    eyebrow: [
      formatWeekdayLong(session.workoutDay),
      formatDayMonth(session.workoutDay, true),
      session.workoutDay === today ? "Heute" : null,
    ].filter(Boolean).join(" · "),
    title,
    meta: meta.length > 0 ? meta.join(" · ") : null,
    context: planExists && weekNumber ? `${planDisplayName(PLAN_TOTAL_WEEKS)} · Woche ${weekNumber}` : null,
    notice,
    exercises,
  };
};

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { formatExerciseMuscleSubtitle } from "@/lib/exerciseMuscleSummary";
import { PLAN_TOTAL_WEEKS } from "@/lib/planLifecycle";
import { parseSetCount } from "@/lib/workoutExecution";
import { getWorkoutDateString } from "@/lib/workoutDateUtils";
import { normalizeWeekKey } from "@/lib/workoutPlanUtils";
import type { DayContent } from "@/lib/types";

/**
 * The Trainingsplan V2 browsing screens, as data.
 *
 * Everything the main tab, the day detail and the plan overview show is
 * decided here, from the loaded plan, the day session records and the running
 * session. Nothing in this module talks to React, Firestore or storage, and
 * nothing here can start, bind or end a session: the screens only read.
 *
 * Plan positions and calendar days are converted through the same authority
 * completion and set writes use (`getWorkoutDateString`), so the agenda can
 * never mark a different day than the one a workout was recorded against.
 * A plan's weeks are calendar weeks starting on Monday, so the current
 * calendar week and the current plan week are the same seven days.
 */

export type ReadWeek = (weekKey: string) => DayContent[];

/** A dated plan day. `workoutDay` is `YYYY-MM-DD`, the key completion uses. */
export interface PlanDayRef {
  weekKey: string;
  dayIndex: number;
  workoutDay: string;
}

export interface PlanExerciseLike {
  name: string;
  sets: number | string;
  reps: number | string;
  rest?: string;
}

/** What a workout day contains, summarised for display. */
export interface WorkoutDaySummary {
  title: string;
  /** Where the title came from: the plan's own label, the muscle focus, or neither. */
  titleSource: "label" | "muscles" | "fallback";
  exerciseCount: number;
  setCount: number;
  /** Muscle groups from the exercise catalogue, main focus first. Empty when unknown. */
  muscles: string[];
  exerciseNames: string[];
}

const WEEKDAY_LABELS = new Set([
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mo", "di", "mi", "do", "fr", "sa", "so",
]);

export const WORKOUT_TITLE_FALLBACK = "Training";

/**
 * A day label that names the workout ("Push A", "Oberkörper"). Generated plans
 * label their days with the weekday, which names nothing, so a weekday or an
 * empty label is not a title.
 */
export const readWorkoutLabel = (label: unknown): string | null => {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  const bare = trimmed.toLowerCase().replace(/[.:,]/g, "").replace(/^tag\s+\d+\s*[-–:]?\s*/, "");
  if (!bare || WEEKDAY_LABELS.has(bare)) return null;
  // "Montag – Push" and similar keep the part after the weekday.
  const parts = trimmed.split(/\s*[-–:·]\s*/).filter(Boolean);
  if (parts.length > 1 && WEEKDAY_LABELS.has(parts[0].toLowerCase().replace(/\./g, ""))) {
    return parts.slice(1).join(" · ");
  }
  return trimmed;
};

/**
 * Muscle groups a day trains, ranked. Only exercises the catalogue knows count;
 * a name it does not know adds nothing rather than a guess. The first group of
 * each exercise weighs double, so the main focus comes first.
 */
export const rankDayMuscles = (exercises: readonly { name: string }[]): string[] => {
  const scores = new Map<string, { score: number; order: number }>();
  let order = 0;
  exercises.forEach((exercise) => {
    const subtitle = formatExerciseMuscleSubtitle(exercise.name);
    if (!subtitle) return;
    subtitle.split(",").map((word) => word.trim()).filter(Boolean).forEach((word, index) => {
      const current = scores.get(word) ?? { score: 0, order: order++ };
      current.score += index === 0 ? 2 : 1;
      scores.set(word, current);
    });
  });
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order)
    .map(([word]) => word);
};

export const readDayExercises = (day: DayContent | null | undefined): PlanExerciseLike[] =>
  Array.isArray(day?.exercises) ? (day!.exercises as PlanExerciseLike[]) : [];

export const summarizeWorkoutDay = (day: DayContent | null | undefined): WorkoutDaySummary => {
  const exercises = readDayExercises(day);
  const muscles = rankDayMuscles(exercises);
  const label = readWorkoutLabel(day?.day);
  const title = label ?? (muscles.length ? muscles.slice(0, 2).join(" · ") : WORKOUT_TITLE_FALLBACK);
  return {
    title,
    titleSource: label ? "label" : muscles.length ? "muscles" : "fallback",
    exerciseCount: exercises.length,
    setCount: exercises.reduce((total, exercise) => total + parseSetCount(exercise.sets), 0),
    muscles,
    exerciseNames: exercises.map((exercise) => exercise.name),
  };
};

/**
 * The muscle line under a day title: only when it adds something the title
 * does not already say.
 */
export const dayMuscleLine = (summary: WorkoutDaySummary, max = 4): string | null => {
  if (!summary.muscles.length) return null;
  if (summary.titleSource === "muscles" && summary.muscles.length <= 2) return null;
  return summary.muscles.slice(0, max).join(" · ");
};

/** `"3×8 · 90s"`: sets × reps, and the rest only when the plan states one. */
export const formatPrescription = (exercise: PlanExerciseLike): string => {
  const sets = parseSetCount(exercise.sets);
  const reps = String(exercise.reps ?? "").trim();
  const base = reps ? `${sets}×${reps}` : `${sets} Sätze`;
  const rest = typeof exercise.rest === "string" ? exercise.rest.trim() : "";
  return rest ? `${base} · ${rest.replace(/\s+/g, "")}` : base;
};

/**
 * `"7 Übungen · 19 Sätze"`. No duration: the plan stores none, and a
 * per-exercise minute estimate would be a fabricated number (see the
 * "no fabricated workout duration" guard in aiSurfaces.test.ts).
 */
export const formatExerciseCount = (count: number): string => `${count} ${count === 1 ? "Übung" : "Übungen"}`;

export const formatDaySummaryLine = (summary: WorkoutDaySummary): string =>
  `${formatExerciseCount(summary.exerciseCount)} · ${summary.setCount} ${summary.setCount === 1 ? "Satz" : "Sätze"}`;

// --- Dates -------------------------------------------------------------------

/** Local noon of a `YYYY-MM-DD` day: formatting it never slips to a neighbour. */
export const dayToDate = (workoutDay: string): Date => parseISO(`${workoutDay}T12:00:00`);

export const shiftDay = (workoutDay: string, days: number): string =>
  format(addDays(dayToDate(workoutDay), days), "yyyy-MM-dd");

/** `"Mi 23"` */
export const formatShortDay = (workoutDay: string): string =>
  format(dayToDate(workoutDay), "EEEEEE d", { locale: de });

/** `"Mi"` */
export const formatWeekdayShort = (workoutDay: string): string =>
  format(dayToDate(workoutDay), "EEEEEE", { locale: de });

/** `"Mittwoch"` */
export const formatWeekdayLong = (workoutDay: string): string =>
  format(dayToDate(workoutDay), "EEEE", { locale: de });

/** `"23. Sep."` / `"23. Sep. 2026"` */
export const formatDayMonth = (workoutDay: string, withYear = false): string =>
  format(dayToDate(workoutDay), withYear ? "d. MMM yyyy" : "d. MMM", { locale: de });

/** Monday of the calendar week containing `workoutDay`. */
export const calendarMonday = (workoutDay: string): string => {
  const weekday = (dayToDate(workoutDay).getDay() + 6) % 7;
  return shiftDay(workoutDay, -weekday);
};

// --- Plan positions ----------------------------------------------------------

export interface PlanCalendar {
  /** `YYYY-MM-DD` of the plan's first Monday. */
  startDay: string;
  totalWeeks: number;
}

export const getPlanCalendar = (createdAt: string | null | undefined): PlanCalendar | null => {
  if (!createdAt) return null;
  return { startDay: getWorkoutDateString(createdAt, "Week 1", 0), totalWeeks: PLAN_TOTAL_WEEKS };
};

export type PlanPosition =
  | { status: "active"; weekKey: string; weekNumber: number; dayIndex: number }
  | { status: "before-start" }
  | { status: "finished" };

export const resolvePlanPosition = (calendar: PlanCalendar, workoutDay: string): PlanPosition => {
  const offset = differenceInCalendarDays(dayToDate(workoutDay), dayToDate(calendar.startDay));
  if (offset < 0) return { status: "before-start" };
  const weekNumber = Math.floor(offset / 7) + 1;
  if (weekNumber > calendar.totalWeeks) return { status: "finished" };
  return { status: "active", weekKey: `Week ${weekNumber}`, weekNumber, dayIndex: offset % 7 };
};

export const planDayDate = (calendar: PlanCalendar, weekKey: string, dayIndex: number): string => {
  const weekNumber = Number(normalizeWeekKey(weekKey).match(/\d+/)?.[0] ?? 1);
  return shiftDay(calendar.startDay, (weekNumber - 1) * 7 + dayIndex);
};

/**
 * The plan has no stored name, goal or level, so it is named by what it is:
 * the app's fixed four-week programme. Nothing invents metadata for it.
 */
export const planDisplayName = (totalWeeks: number): string => `${totalWeeks}-Wochen-Plan`;

export const planEndDay = (calendar: PlanCalendar): string =>
  shiftDay(calendar.startDay, calendar.totalWeeks * 7 - 1);

// --- Session -----------------------------------------------------------------

/** The running session as the browsing screens need it. Null when nothing runs. */
export interface RunningSession {
  weekKey: string | null;
  dayIndex: number | null;
  /** `YYYY-MM-DD` the session records against, when it is known. */
  workoutDay: string | null;
}

export const isSessionDay = (session: RunningSession | null, day: PlanDayRef): boolean =>
  !!session &&
  session.weekKey !== null &&
  session.dayIndex !== null &&
  normalizeWeekKey(session.weekKey) === normalizeWeekKey(day.weekKey) &&
  session.dayIndex === day.dayIndex;

// --- Screen inputs -----------------------------------------------------------

export interface TrainingsplanInputs {
  calendar: PlanCalendar;
  readWeek: ReadWeek;
  /** Today in Berlin, `YYYY-MM-DD`. */
  today: string;
  isDayCompleted: (weekKey: string, dayIndex: number) => boolean;
  /** The running session, or null. Takes precedence over anything browsed. */
  session: RunningSession | null;
}

export interface PlannedWorkout extends PlanDayRef {
  summary: WorkoutDaySummary;
}

const readPlanDay = (inputs: TrainingsplanInputs, weekKey: string, dayIndex: number): DayContent | null =>
  inputs.readWeek(weekKey)[dayIndex] ?? null;

/** The dated plan day on `workoutDay`, or null outside the programme. */
export const resolveDatedDay = (
  inputs: TrainingsplanInputs,
  workoutDay: string
): (PlanDayRef & { day: DayContent | null }) | null => {
  const position = resolvePlanPosition(inputs.calendar, workoutDay);
  if (position.status !== "active") return null;
  return {
    weekKey: position.weekKey,
    dayIndex: position.dayIndex,
    workoutDay,
    day: readPlanDay(inputs, position.weekKey, position.dayIndex),
  };
};

const hasExercises = (day: DayContent | null | undefined): boolean => readDayExercises(day).length > 0;

/** The first workout day strictly after `after`, inside the programme and up to `until`. */
export const findNextWorkout = (
  inputs: TrainingsplanInputs,
  after: string,
  until: string = planEndDay(inputs.calendar)
): PlannedWorkout | null => {
  for (let offset = 1; offset <= 7 * inputs.calendar.totalWeeks; offset += 1) {
    const workoutDay = shiftDay(after, offset);
    if (workoutDay > until) return null;
    const dated = resolveDatedDay(inputs, workoutDay);
    if (!dated) {
      if (resolvePlanPosition(inputs.calendar, workoutDay).status === "finished") return null;
      continue;
    }
    if (hasExercises(dated.day)) {
      return { weekKey: dated.weekKey, dayIndex: dated.dayIndex, workoutDay, summary: summarizeWorkoutDay(dated.day) };
    }
  }
  return null;
};

// --- Today module ------------------------------------------------------------

export type TodayState =
  /** A session is running. Always wins over the calendar. */
  | { kind: "active"; sessionDay: string | null; isSessionToday: boolean }
  | { kind: "planned"; workout: PlannedWorkout }
  | { kind: "completed"; workout: PlannedWorkout; next: PlannedWorkout | null }
  | { kind: "rest"; next: PlannedWorkout | null }
  | { kind: "before-start"; next: PlannedWorkout | null }
  | { kind: "plan-finished" };

/**
 * Which Today state to show. Priority: Läuft > Geplant > Erledigt > Ruhetag.
 * `isStarted` is the session context's own flag; a running session is shown
 * as running whatever day it belongs to and whatever is being browsed.
 */
export const resolveTodayState = (inputs: TrainingsplanInputs, isStarted: boolean): TodayState => {
  if (isStarted) {
    const sessionDay = inputs.session?.workoutDay ?? null;
    return { kind: "active", sessionDay, isSessionToday: sessionDay === inputs.today };
  }

  const position = resolvePlanPosition(inputs.calendar, inputs.today);
  if (position.status === "finished") return { kind: "plan-finished" };
  if (position.status === "before-start") {
    return { kind: "before-start", next: findNextWorkout(inputs, shiftDay(inputs.calendar.startDay, -1)) };
  }

  const day = readPlanDay(inputs, position.weekKey, position.dayIndex);
  if (!hasExercises(day)) return { kind: "rest", next: findNextWorkout(inputs, inputs.today) };

  const workout: PlannedWorkout = {
    weekKey: position.weekKey,
    dayIndex: position.dayIndex,
    workoutDay: inputs.today,
    summary: summarizeWorkoutDay(day),
  };
  if (inputs.isDayCompleted(position.weekKey, position.dayIndex)) {
    return { kind: "completed", workout, next: findNextWorkout(inputs, inputs.today) };
  }
  return { kind: "planned", workout };
};

// --- Weekly agenda -----------------------------------------------------------

export type AgendaRow =
  | {
      kind: "workout";
      key: string;
      day: PlanDayRef;
      summary: WorkoutDaySummary;
      /** completed · today · active (the running session's day) · upcoming · open (past, not done) */
      status: "completed" | "today" | "active" | "upcoming" | "open";
      isToday: boolean;
    }
  | {
      kind: "rest";
      key: string;
      /** First and last day of a merged run; the same day when single. */
      from: string;
      to: string;
      isToday: boolean;
    }
  | { kind: "outside"; key: string; workoutDay: string; isToday: boolean };

export interface WeekAgenda {
  weekNumber: number | null;
  rows: AgendaRow[];
  completedDays: number;
  trainingDays: number;
}

/**
 * The seven days of today's calendar week, one row each. Rest days after today
 * that follow each other merge into one row; past rest days stay single so the
 * finished part of the week reads accurately.
 */
export const buildWeekAgenda = (inputs: TrainingsplanInputs): WeekAgenda => {
  const monday = calendarMonday(inputs.today);
  const rows: AgendaRow[] = [];
  let completedDays = 0;
  let trainingDays = 0;
  let weekNumber: number | null = null;

  for (let index = 0; index < 7; index += 1) {
    const workoutDay = shiftDay(monday, index);
    const isToday = workoutDay === inputs.today;
    const dated = resolveDatedDay(inputs, workoutDay);
    if (!dated) {
      rows.push({ kind: "outside", key: workoutDay, workoutDay, isToday });
      continue;
    }
    weekNumber = Number(dated.weekKey.match(/\d+/)?.[0] ?? 0) || null;

    if (!hasExercises(dated.day)) {
      const previous = rows[rows.length - 1];
      if (workoutDay > inputs.today && previous?.kind === "rest" && previous.from > inputs.today) {
        previous.to = workoutDay;
      } else {
        rows.push({ kind: "rest", key: workoutDay, from: workoutDay, to: workoutDay, isToday });
      }
      continue;
    }

    trainingDays += 1;
    const day: PlanDayRef = { weekKey: dated.weekKey, dayIndex: dated.dayIndex, workoutDay };
    const completed = inputs.isDayCompleted(dated.weekKey, dated.dayIndex);
    if (completed) completedDays += 1;
    const status = isSessionDay(inputs.session, day)
      ? "active"
      : completed
        ? "completed"
        : isToday
          ? "today"
          : workoutDay > inputs.today
            ? "upcoming"
            : "open";
    rows.push({ kind: "workout", key: workoutDay, day, summary: summarizeWorkoutDay(dated.day), status, isToday });
  }

  return { weekNumber, rows, completedDays, trainingDays };
};

/** The first workout of next calendar week, for the teaser. */
export const findNextWeekWorkout = (inputs: TrainingsplanInputs): PlannedWorkout | null => {
  const nextMonday = shiftDay(calendarMonday(inputs.today), 7);
  return findNextWorkout(inputs, shiftDay(nextMonday, -1), shiftDay(nextMonday, 6));
};

// --- Day detail --------------------------------------------------------------

export type DayDetailAction =
  | { kind: "start" }
  | { kind: "resume" }
  /** Another day's session is running: nothing may start a second one. */
  | { kind: "blocked" }
  | { kind: "completed" }
  | { kind: "future" }
  | { kind: "past" }
  | { kind: "none" };

/**
 * The one action Day Detail offers. Starting is only ever today's planned
 * workout, and only while nothing runs; a running session is resumed from its
 * own day and blocks every other. Completed, past and future days start
 * nothing: no restart, no schedule change.
 */
export const resolveDayDetailAction = (
  inputs: TrainingsplanInputs,
  day: PlanDayRef,
  isStarted: boolean
): DayDetailAction => {
  const dated = resolveDatedDay(inputs, day.workoutDay);
  if (!dated || !hasExercises(dated.day)) return { kind: "none" };
  if (isStarted) return isSessionDay(inputs.session, day) ? { kind: "resume" } : { kind: "blocked" };
  if (inputs.isDayCompleted(day.weekKey, day.dayIndex)) return { kind: "completed" };
  if (day.workoutDay === inputs.today) return { kind: "start" };
  return day.workoutDay > inputs.today ? { kind: "future" } : { kind: "past" };
};

// --- Plan overview -----------------------------------------------------------

export interface PlanOverviewModel {
  totalWeeks: number;
  /** The week the overview describes: the current one, else the nearest. */
  weekNumber: number;
  status: "before-start" | "active" | "finished";
  startDay: string;
  endDay: string;
  trainingDaysPerWeek: number;
  workoutDays: PlannedWorkout[];
  restDays: string[];
}

export const buildPlanOverview = (inputs: TrainingsplanInputs): PlanOverviewModel => {
  const position = resolvePlanPosition(inputs.calendar, inputs.today);
  const weekNumber = position.status === "active"
    ? position.weekNumber
    : position.status === "finished" ? inputs.calendar.totalWeeks : 1;
  const weekKey = `Week ${weekNumber}`;
  const workoutDays: PlannedWorkout[] = [];
  const restDays: string[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const day = readPlanDay(inputs, weekKey, dayIndex);
    const workoutDay = planDayDate(inputs.calendar, weekKey, dayIndex);
    if (hasExercises(day)) {
      workoutDays.push({ weekKey, dayIndex, workoutDay, summary: summarizeWorkoutDay(day) });
    } else {
      restDays.push(workoutDay);
    }
  }
  return {
    totalWeeks: inputs.calendar.totalWeeks,
    weekNumber,
    status: position.status,
    startDay: inputs.calendar.startDay,
    endDay: planEndDay(inputs.calendar),
    trainingDaysPerWeek: workoutDays.length,
    workoutDays,
    restDays,
  };
};

/**
 * The exercise a running session is on: the first one with planned sets left.
 * Null once every set is ticked.
 */
export const findCurrentExercise = (
  exercises: readonly PlanExerciseLike[],
  getCompletedSetsCount: (exerciseIndex: number) => number
): { index: number; name: string } | null => {
  for (let index = 0; index < exercises.length; index += 1) {
    if (getCompletedSetsCount(index) < parseSetCount(exercises[index].sets)) {
      return { index, name: exercises[index].name };
    }
  }
  return null;
};

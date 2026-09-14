import { OFFLINE_ENTRY_REPLAYED_EVENT, QUEUE_CHANGED_EVENT, peekQueueStorage } from "@/lib/offlineQueue";
import { isValidPerformanceChange, type SetLogChange } from "@/lib/setPerformance";

/**
 * Set writes the server has not confirmed to this tab yet, and how they show.
 *
 * With recorded performance a set can change several times in a few seconds:
 * reps, then weight, then a tick. The previous optimistic model - snapshot the
 * whole day before a write, restore it on failure, refetch the whole day on
 * success - lets an older write undo a newer one: a late failure restores a
 * snapshot taken before the newer edit, and a refetch that started before the
 * newer commit lands after it.
 *
 * So the query cache holds only what the server returned, and every change is
 * an intent recorded here. What a set shows is the server read, then:
 *
 *   1. intents that already committed, until a read that *started* after they
 *      committed replaces them - an older in-flight read cannot hide them;
 *   2. the owner's queued offline entries, in queue order;
 *   3. intents still in flight, in the order they were requested.
 *
 * A failed intent is simply dropped, which rolls back that one change and
 * nothing else. Writes for one exercise position are serialized upstream (see
 * `useSupabaseAction`'s `serializeKey`), and once any entry for a position is
 * queued the later ones queue behind it, so this order is also the order the
 * server applies them in.
 *
 * Module state, shared by every hook instance: a set row that remounts, or a
 * card that re-renders in Focus Mode, sees the same pending changes. Intents
 * are always scoped to the account that made them.
 */

export interface ExerciseWritePosition {
  planId: string;
  weekKey: string;
  dayIndex: number;
  exerciseIndex: number;
}

export interface SetWritePosition extends ExerciseWritePosition {
  setNumber: number;
}

export interface SetWriteDay {
  planId: string;
  weekKey: string;
  dayIndex: number;
}

export interface PositionedSetChange {
  position: SetWritePosition;
  change: SetLogChange;
}

export type SetWriteOutcome = "written" | "queued" | "failed";

interface SetWriteIntent extends PositionedSetChange {
  ownerUid: string;
  seq: number;
  committedSeq?: number;
  outcome: Promise<SetWriteOutcome>;
}

const SET_QUEUE_TYPES = new Set(["TOGGLE_SET", "UPDATE_SET_PERFORMANCE"]);
/** Committed intents are tiny; the bound only stops a very long session growing without end. */
const MAX_COMMITTED = 500;

let clock = 0;
let inFlight: SetWriteIntent[] = [];
let committed: SetWriteIntent[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** One clock for reads and writes, so "started after it committed" is a comparison. */
export const nextSetWriteSeq = (): number => ++clock;

const notify = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

const commit = (intent: SetWriteIntent) => {
  intent.committedSeq = nextSetWriteSeq();
  committed = [...committed, intent].slice(-MAX_COMMITTED);
};

const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** A set's plan position from untrusted data, or null when any part is unusable. */
export const readSetWritePosition = (value: unknown): SetWritePosition | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.planId !== "string" || candidate.planId === "" ||
    typeof candidate.weekKey !== "string" || candidate.weekKey === "" ||
    !isIndex(candidate.dayIndex) || !isIndex(candidate.exerciseIndex) ||
    !isIndex(candidate.setNumber) || candidate.setNumber < 1
  ) return null;
  return {
    planId: candidate.planId,
    weekKey: candidate.weekKey,
    dayIndex: candidate.dayIndex,
    exerciseIndex: candidate.exerciseIndex,
    setNumber: candidate.setNumber,
  };
};

/** The set change a queue entry carries, or null for other types and malformed entries. */
export const readQueuedSetChange = (entry: unknown): PositionedSetChange | null => {
  if (!entry || typeof entry !== "object") return null;
  const { type, payload } = entry as { type?: unknown; payload?: unknown };
  const position = readSetWritePosition(payload);
  if (!position) return null;
  const fields = payload as Record<string, unknown>;
  if (type === "TOGGLE_SET") {
    // Completion only: reps/weight an older build copied into the payload are
    // not part of the change.
    return typeof fields.completed === "boolean"
      ? { position, change: { kind: "completion", completed: fields.completed } }
      : null;
  }
  if (type === "UPDATE_SET_PERFORMANCE") {
    if (!isValidPerformanceChange(fields)) return null;
    return {
      position,
      change: {
        kind: "performance",
        ...(fields.reps !== undefined ? { reps: fields.reps as number | null } : {}),
        ...(fields.weightKg !== undefined ? { weightKg: fields.weightKg as number | null } : {}),
      },
    };
  }
  return null;
};

/**
 * The owner's queued set changes, parsed from storage without the repairs
 * `loadQueue` performs - this runs during render and must not write.
 */
const queuedSetChanges = (ownerUid: string): PositionedSetChange[] => {
  const raw = peekQueueStorage();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const candidate = entry as { ownerUid?: unknown; status?: unknown; type?: unknown } | null;
    if (!candidate || candidate.ownerUid !== ownerUid || candidate.status === "quarantined") return [];
    if (!SET_QUEUE_TYPES.has(String(candidate.type))) return [];
    const change = readQueuedSetChange(candidate);
    return change ? [change] : [];
  });
};

const sameExercise = (a: ExerciseWritePosition, b: ExerciseWritePosition) =>
  a.planId === b.planId && a.weekKey === b.weekKey && a.dayIndex === b.dayIndex && a.exerciseIndex === b.exerciseIndex;

const inDay = (position: SetWritePosition, day: SetWriteDay) =>
  position.planId === day.planId && position.weekKey === day.weekKey && position.dayIndex === day.dayIndex;

/** Whether the owner still has queued set changes for this exercise position. */
export const hasQueuedSetWrite = (ownerUid: string, exercise: ExerciseWritePosition): boolean =>
  queuedSetChanges(ownerUid).some(({ position }) => sameExercise(position, exercise));

/**
 * Runs one set write as a tracked intent. The intent exists from the moment
 * this is called, so the change shows before the first await.
 */
export const trackSetWrite = <T>(
  ownerUid: string,
  position: SetWritePosition,
  change: SetLogChange,
  write: () => Promise<T>
): Promise<T> => {
  let settle!: (outcome: SetWriteOutcome) => void;
  const intent: SetWriteIntent = {
    ownerUid,
    position,
    change,
    seq: nextSetWriteSeq(),
    outcome: new Promise<SetWriteOutcome>((resolve) => { settle = resolve; }),
  };
  inFlight = [...inFlight, intent];
  notify();

  let running: Promise<T>;
  try {
    running = write();
  } catch (error) {
    running = Promise.reject(error);
  }
  return running.then(
    (result) => {
      inFlight = inFlight.filter((item) => item !== intent);
      const queued = !!result && typeof result === "object" && (result as { queued?: unknown }).queued === true;
      // A queued change is now carried by its durable queue entry.
      if (queued) settle("queued");
      else { commit(intent); settle("written"); }
      notify();
      return result;
    },
    (error: unknown) => {
      inFlight = inFlight.filter((item) => item !== intent);
      settle("failed");
      notify();
      throw error;
    }
  );
};

/** The changes to lay over a server read of one day, in application order. */
export const setChangesOverRead = (
  ownerUid: string,
  day: SetWriteDay,
  readSeq: number
): PositionedSetChange[] => {
  const own = (intent: SetWriteIntent) => intent.ownerUid === ownerUid && inDay(intent.position, day);
  return [
    ...committed.filter((intent) => own(intent) && (intent.committedSeq ?? 0) > readSeq),
    ...queuedSetChanges(ownerUid).filter(({ position }) => inDay(position, day)),
    ...inFlight.filter(own),
  ];
};

/**
 * Waits for the owner's set writes that are still in flight. Queued writes
 * count as settled: they are durable. Returns how many failed.
 */
export const whenSetWritesSettled = async (ownerUid: string): Promise<{ failed: number }> => {
  const outcomes = await Promise.all(
    inFlight.filter((intent) => intent.ownerUid === ownerUid).map((intent) => intent.outcome)
  );
  return { failed: outcomes.filter((outcome) => outcome === "failed").length };
};

export const subscribeSetWrites = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener(QUEUE_CHANGED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener(QUEUE_CHANGED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

/** Changes whenever an intent or the stored queue does. */
export const getSetWritesSnapshot = (): string => `${version} ${peekQueueStorage() ?? ""}`;

/*
  A replayed entry left the queue because the server accepted it. Until a read
  that started afterwards arrives, it shows as a committed intent - otherwise
  it would vanish from the overlay one refetch before the server data shows it.
*/
if (typeof window !== "undefined") {
  window.addEventListener(OFFLINE_ENTRY_REPLAYED_EVENT, (event) => {
    const entry = (event as CustomEvent<unknown>).detail as { ownerUid?: unknown } | undefined;
    const change = readQueuedSetChange(entry);
    if (!change || typeof entry?.ownerUid !== "string") return;
    commit({ ...change, ownerUid: entry.ownerUid, seq: nextSetWriteSeq(), outcome: Promise.resolve("written") });
    notify();
  });
}

/** Test isolation only: forgets every intent. */
export const resetSetWriteIntentsForTests = (): void => {
  inFlight = [];
  committed = [];
  notify();
};

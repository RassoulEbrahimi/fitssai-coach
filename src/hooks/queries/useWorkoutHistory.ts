import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  collection, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import type { StoredDocument } from "@/lib/previousPerformance";
import {
  HISTORY_START,
  loadSessionRecord,
  readHistoryPage,
  type HistoryEntry,
  type HistorySessionKey,
  type HistorySource,
  type SessionDetailSource,
} from "@/lib/workoutHistory";

/*
  Every read goes to the server, as the previous-performance lookup does:
  Firestore runs without persistence here, so a cache-eligible read made
  while the SDK considers itself offline answers "nothing" - and History
  would then claim there are no trainings. A server read rejects instead,
  which the screens show as a retryable error.

  The list is one ordered range on `workoutDay` with a limit, the shape the
  previous-performance lookup already uses; a session and its sets are read
  by the same equality queries the day-session writer and set tracking use.
  None of them needs a composite index.
*/
const toDocuments = (snap: { docs: { id: string; data: () => unknown }[] }): StoredDocument[] =>
  snap.docs.map((document) => ({ id: document.id, data: document.data() as Record<string, unknown> }));

const planContentReader = (uid: string) => async (planId: string): Promise<unknown> => {
  const snap = await getDocFromServer(doc(db, "users", uid, "workout_plans", planId));
  return snap.exists() ? (snap.data() as { content?: unknown }).content ?? null : null;
};

export const firestoreHistorySource = (uid: string): HistorySource => {
  const logs = collection(db, "users", uid, "workout_logs");
  return {
    logsBefore: async (before, count) => toDocuments(await getDocsFromServer(query(
      logs,
      where("workoutDay", "<", before),
      orderBy("workoutDay", "desc"),
      limit(count),
    ))),
    logsOn: async (workoutDay) => toDocuments(await getDocsFromServer(query(logs, where("workoutDay", "==", workoutDay)))),
    planContent: planContentReader(uid),
  };
};

export const firestoreSessionSource = (uid: string): SessionDetailSource => {
  const logs = collection(db, "users", uid, "workout_logs");
  return {
    daySessionLogs: async (planId, workoutDay) => toDocuments(await getDocsFromServer(query(
      logs, where("planId", "==", planId), where("workoutDay", "==", workoutDay),
    ))),
    planContent: planContentReader(uid),
    positionLogs: async (planId, weekKey, dayIndex) => toDocuments(await getDocsFromServer(query(
      logs, where("planId", "==", planId), where("weekKey", "==", weekKey), where("dayIndex", "==", dayIndex),
    ))),
    setDocuments: async (logId) => toDocuments(await getDocsFromServer(
      collection(db, "users", uid, "workout_logs", logId, "workout_set_logs")
    )),
  };
};

// Completed sessions change only when a workout is finished; the tab
// invalidates these queries when that happens (see WorkoutView).
const HISTORY_STALE_TIME = 5 * 60 * 1000;

/** Verlauf: pages of completed sessions, newest first. `Ältere Trainings laden` fetches the next. */
export function useWorkoutHistory(enabled = true) {
  const { user } = useAuth();
  const uid = user?.uid;
  return useInfiniteQuery({
    queryKey: queryKeys.history.list(uid),
    queryFn: ({ pageParam }) => readHistoryPage(firestoreHistorySource(uid as string), { before: pageParam }),
    initialPageParam: HISTORY_START,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    enabled: enabled && !!uid,
    staleTime: HISTORY_STALE_TIME,
    retry: false,
  });
}

/**
 * The newest completed session, for the quiet `Verlauf` entry row: null only
 * when the account provably has none, undefined while that is not known
 * (loading, failed, or not found within this small read).
 */
export function useLatestWorkoutSession(enabled = true): HistoryEntry | null | undefined {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data } = useQuery({
    queryKey: queryKeys.history.latest(uid),
    queryFn: async () => {
      const page = await readHistoryPage(firestoreHistorySource(uid as string), { target: 1, chunk: 30, maxChunks: 2 });
      return { entry: page.entries[0] ?? null, exhausted: page.nextBefore === null };
    },
    enabled: enabled && !!uid,
    staleTime: HISTORY_STALE_TIME,
    retry: false,
  });
  if (!data) return undefined;
  return data.entry ?? (data.exhausted ? null : undefined);
}

/** Exactly one stored session, or null when no completed session exists at that address. */
export function useWorkoutSession(key: HistorySessionKey | null) {
  const { user } = useAuth();
  const uid = user?.uid;
  return useQuery({
    queryKey: queryKeys.history.session(uid, key?.planId, key?.workoutDay),
    queryFn: () => loadSessionRecord(firestoreSessionSource(uid as string), key as HistorySessionKey),
    enabled: !!uid && !!key,
    staleTime: HISTORY_STALE_TIME,
    retry: false,
  });
}

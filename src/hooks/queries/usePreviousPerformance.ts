import { useQuery } from "@tanstack/react-query";
import {
  collection, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import {
  findPreviousPerformance,
  type PreviousPerformanceByIdentity,
  type PreviousPerformanceSource,
  type StoredDocument,
} from "@/lib/previousPerformance";
import { isWorkoutDayString } from "@/lib/workoutLog";

/*
  Every read goes to the server. Firestore runs without persistence here, so
  a cache-eligible read made while the SDK considers itself offline answers
  "nothing" - and a lookup cached as "no previous workout" would replace a
  reference the persisted query cache could still have shown. A server read
  rejects instead, and a rejected lookup keeps whatever was cached.

  One ordered range on `workoutDay` with a limit needs no composite index.
*/
const toDocuments = (snap: { docs: { id: string; data: () => unknown }[] }): StoredDocument[] =>
  snap.docs.map((document) => ({ id: document.id, data: document.data() as Record<string, unknown> }));

export const firestorePreviousPerformanceSource = (uid: string): PreviousPerformanceSource => ({
  recentLogs: async (beforeDay, count) => toDocuments(await getDocsFromServer(query(
    collection(db, "users", uid, "workout_logs"),
    where("workoutDay", "<", beforeDay),
    orderBy("workoutDay", "desc"),
    limit(count),
  ))),
  planContent: async (planId) => {
    const snap = await getDocFromServer(doc(db, "users", uid, "workout_plans", planId));
    return snap.exists() ? (snap.data() as { content?: unknown }).content ?? null : null;
  },
  setDocuments: async (logId) => toDocuments(await getDocsFromServer(
    collection(db, "users", uid, "workout_logs", logId, "workout_set_logs")
  )),
});

export interface PreviousPerformanceParams {
  /** Only a bound session looks anything up; browsing the calendar never does. */
  enabled: boolean;
  planId: string | undefined;
  weekKey: string;
  dayIndex: number;
  /** The running workout's day. Only strictly earlier workouts are considered. */
  workoutDay: string | undefined;
  /** Identity of each exercise on the running day, by position. */
  identityKeys: readonly (string | null)[];
}

const NONE: PreviousPerformanceByIdentity = {};

/**
 * Previous recorded performance for every exercise of the running workout, in
 * one account-scoped, cached lookup for the whole day - never one per set row.
 *
 * An optional hint: while it loads, when it fails or when there is nothing to
 * show, the result is empty and the workout carries on exactly as before. No
 * retries and no toast for it.
 */
export function usePreviousPerformance({
  enabled, planId, weekKey, dayIndex, workoutDay, identityKeys,
}: PreviousPerformanceParams): PreviousPerformanceByIdentity {
  const { user } = useAuth();
  const uid = user?.uid;
  const canLookUp = enabled && !!uid && !!planId && isWorkoutDayString(workoutDay) &&
    identityKeys.some((key) => key !== null);

  const { data } = useQuery({
    queryKey: queryKeys.previousPerformance.byExecution(uid, planId, weekKey, dayIndex, workoutDay, identityKeys),
    queryFn: () => findPreviousPerformance(
      firestorePreviousPerformanceSource(uid as string),
      { planId: planId as string, weekKey, dayIndex, workoutDay: workoutDay as string },
      identityKeys,
    ),
    enabled: canLookUp,
    // Earlier workouts rarely change while this one runs.
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  return canLookUp && data ? data : NONE;
}

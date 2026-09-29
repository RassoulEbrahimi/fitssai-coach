import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { fetchCoachBackendStatus, type CoachBackendStatus } from "@/lib/backend";

/**
 * What the DEPLOYED backend can do for the signed-in account (NUT-14), read
 * live from `coachBackendStatus`.
 *
 * A new action is offered only when the backend that is actually running says
 * it supports it — never because this bundle contains the action. A frontend
 * released before its backend, or a backend rolled back after it, therefore
 * shows no action the backend would refuse.
 *
 * - One read per signed-in account and in-memory session: it never goes stale
 *   by itself, and it does not refetch on mount, focus or reconnect. There is
 *   no polling and no timer. An explicit Nutrition refresh invalidates it.
 * - Keyed by the account's uid, and a status answered for another uid is an
 *   error. Each account also has its own query client, so account B never
 *   sees account A's status.
 * - Never persisted (`queryPersistence.ts`): a stored `true` could outlive a
 *   backend rollback.
 * - Fails closed: signed out, disabled, pending, an error, a malformed answer
 *   or anything but a literal `true` is "unavailable". A failed read only
 *   hides the new actions; it is not retried until the next refresh, and it
 *   never turns into an error of the view that asked.
 */

export interface CoachBackendCapabilityRead {
  /** The deployed backend offers Nutrition target setup to this account. */
  nutritionTargets: boolean;
  /** The deployed backend offers Nutrition plan generation to this account. */
  nutritionGeneration: boolean;
}

const UNAVAILABLE: CoachBackendCapabilityRead = Object.freeze({ nutritionTargets: false, nutritionGeneration: false });

/** A thrown answer: the status was not this account's, or not a status at all. */
export class CoachBackendStatusMismatchError extends Error {
  constructor() {
    super("coachBackendStatus did not answer for the signed-in account");
    this.name = "CoachBackendStatusMismatchError";
  }
}

const readStatusFor = async (uid: string): Promise<CoachBackendStatus> => {
  const status = await fetchCoachBackendStatus();
  if (status?.ok !== true || status.uid !== uid || typeof status.capabilities !== "object" || status.capabilities === null) {
    throw new CoachBackendStatusMismatchError();
  }
  return status;
};

export const useCoachBackendCapabilities = ({ enabled = true }: { enabled?: boolean } = {}): CoachBackendCapabilityRead => {
  const { user } = useAuth();
  const uid = user?.uid;
  const active = enabled && typeof uid === "string" && uid.length > 0;

  const query = useQuery({
    queryKey: queryKeys.backend.status(uid),
    queryFn: () => readStatusFor(uid as string),
    enabled: active,
    // The session's answer: only an explicit refresh asks again, and leaving
    // the Nutrition tab does not drop it.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    retryOnMount: false,
  });

  if (!active || query.status !== "success" || query.data.uid !== uid) return UNAVAILABLE;
  const { capabilities } = query.data;
  return {
    nutritionTargets: capabilities.nutritionTargets === true,
    nutritionGeneration: capabilities.nutritionGeneration === true,
  };
};

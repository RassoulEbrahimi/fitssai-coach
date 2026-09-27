import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { NutritionRequestPlanResult } from "@shared/nutrition";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { callNutritionRequestPlan } from "@/lib/nutrition/v2/generationCallable";

/**
 * Requesting a generated Nutrition V2 plan for the signed-in account (NUT-11).
 * No UI uses it yet, and the deployed backend has no generator: every call is
 * answered `GENERATION_PROVIDER_NOT_CONFIGURED`.
 *
 * - happens only through `submit`, called from one explicit action; mounting
 *   or rendering calls nothing;
 * - only for a signed-in, eligible adult (NUT-03), and only online — there is
 *   no offline generation queue, and nothing enters the Nutrition entry queue;
 *   offline, `submit` refuses before anything is sent;
 * - one action is one request id, created once in `submit`, so the server
 *   treats a retry of that action as the same request;
 * - sends `{ requestId }` only; nothing about the generation is chosen here;
 * - writes nothing to the cache: the server's request document is the
 *   convergence source. An answer refetches the account's state and its
 *   generation reads; a succeeded one also refetches its plans and slot
 *   heads, because a plan was activated. Entries, targets, legacy Nutrition
 *   and Training are never touched;
 * - there is no cancel. Leaving, closing or losing the response does not
 *   change what happens to the request on the server.
 */

export type NutritionV2RequestPlanUnavailableReason = "signedOut" | "pending" | "error" | "ineligible";

export type NutritionV2RequestPlanAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2RequestPlanUnavailableReason };

/** An action refused before anything was sent. */
export class NutritionV2RequestPlanUnavailableError extends Error {
  readonly reason: NutritionV2RequestPlanUnavailableReason | "offline";

  constructor(reason: NutritionV2RequestPlanUnavailableReason | "offline") {
    super(`Requesting a Nutrition V2 plan is unavailable (${reason})`);
    this.name = "NutritionV2RequestPlanUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2RequestPlanUnavailableError = (error: unknown): error is NutritionV2RequestPlanUnavailableError =>
  error instanceof NutritionV2RequestPlanUnavailableError;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

export interface NutritionV2RequestPlanMutation {
  availability: NutritionV2RequestPlanAvailability;
  /** Generation needs the server; offline it is unavailable. */
  online: boolean;
  /** One explicit action. Rejects with the refusal or a `NutritionRequestPlanCallError`. */
  submit: () => Promise<NutritionRequestPlanResult>;
  isSubmitting: boolean;
}

interface RequestPlanVariables {
  uid: string;
  requestId: string;
}

export const useNutritionV2RequestPlan = (): NutritionV2RequestPlanMutation => {
  const access = useNutritionV2Access();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation<NutritionRequestPlanResult, Error, RequestPlanVariables>({
    mutationFn: ({ requestId }) => callNutritionRequestPlan({ requestId }),
    // Offline is refused in `submit`; TanStack must not park the action for later.
    networkMode: "always",
    retry: false,
    onSuccess: (result, { uid }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.state(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.generation.all(uid) }),
        // A plan was activated: the plan reads and the new plan's (empty) slot heads.
        ...(result.status === "succeeded"
          ? [
              queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.plans.all(uid) }),
              queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.slots.all(uid) }),
            ]
          : []),
      ]),
  });

  const availability: NutritionV2RequestPlanAvailability =
    access.status === "eligible" ? { status: "available" } : { status: "unavailable", reason: access.status };
  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const submit = useCallback(async (): Promise<NutritionRequestPlanResult> => {
    if (unavailableReason !== null || uid === null) {
      throw new NutritionV2RequestPlanUnavailableError(unavailableReason ?? "pending");
    }
    if (!navigator.onLine) throw new NutritionV2RequestPlanUnavailableError("offline");
    // Created once, here, for this one action.
    return mutateAsync({ uid, requestId: crypto.randomUUID() });
  }, [mutateAsync, uid, unavailableReason]);

  return { availability, online, submit, isSubmitting: isPending };
};

import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import type { NutritionRepeatPlanResult } from "@shared/nutrition";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { callNutritionRepeatPlan } from "@/lib/nutrition/v2/planCallable";

/**
 * Repeating the active Nutrition V2 plan for the signed-in account (NUT-09).
 * No UI uses it yet; the plan UI slice that owns the action will.
 *
 * - happens only through `submit`, called from one explicit action; mounting
 *   or rendering calls nothing;
 * - only for a signed-in, eligible adult (NUT-03), and only online — there is
 *   no offline plan queue, and no plan operation enters the Nutrition entry
 *   queue; offline, `submit` refuses before anything is sent;
 * - one action is one request id, created once in `submit` and carried by the
 *   mutation's variables, so the submission reuses it and the server applies
 *   it once;
 * - sends `{ requestId }` only. The server resolves the plan to repeat, the
 *   target and the dates, and writes the plans and the state;
 * - on success refetches exactly the account's state, plans and slot heads, so
 *   no cached slot head of the previous plan is taken for the new plan's.
 *   Entries, targets, legacy Nutrition and Training are not touched.
 */

export type NutritionV2RepeatPlanUnavailableReason = "signedOut" | "pending" | "error" | "ineligible";

export type NutritionV2RepeatPlanAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2RepeatPlanUnavailableReason };

/** An action refused before anything was sent. */
export class NutritionV2RepeatPlanUnavailableError extends Error {
  readonly reason: NutritionV2RepeatPlanUnavailableReason | "offline";

  constructor(reason: NutritionV2RepeatPlanUnavailableReason | "offline") {
    super(`Repeating a Nutrition V2 plan is unavailable (${reason})`);
    this.name = "NutritionV2RepeatPlanUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2RepeatPlanUnavailableError = (error: unknown): error is NutritionV2RepeatPlanUnavailableError =>
  error instanceof NutritionV2RepeatPlanUnavailableError;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

export interface NutritionV2RepeatPlanMutation {
  availability: NutritionV2RepeatPlanAvailability;
  /** Repeating a plan needs the server; offline it is unavailable. */
  online: boolean;
  /** One explicit action. Rejects with the refusal or a `NutritionPlanCallError`. */
  submit: () => Promise<NutritionRepeatPlanResult>;
  isSubmitting: boolean;
}

interface RepeatPlanVariables {
  uid: string;
  requestId: string;
}

export const useNutritionV2RepeatPlan = (): NutritionV2RepeatPlanMutation => {
  const access = useNutritionV2Access();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation<NutritionRepeatPlanResult, Error, RepeatPlanVariables>({
    mutationFn: ({ requestId }) => callNutritionRepeatPlan({ requestId }),
    // Offline is refused in `submit`; TanStack must not park the action for later.
    networkMode: "always",
    retry: false,
    onSuccess: (_result, { uid }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.state(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.plans.all(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.slots.all(uid) }),
      ]),
  });

  const availability: NutritionV2RepeatPlanAvailability =
    access.status === "eligible" ? { status: "available" } : { status: "unavailable", reason: access.status };
  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const submit = useCallback(async (): Promise<NutritionRepeatPlanResult> => {
    if (unavailableReason !== null || uid === null) {
      throw new NutritionV2RepeatPlanUnavailableError(unavailableReason ?? "pending");
    }
    if (!navigator.onLine) throw new NutritionV2RepeatPlanUnavailableError("offline");
    // Created once, here, for this one action.
    return mutateAsync({ uid, requestId: crypto.randomUUID() });
  }, [mutateAsync, uid, unavailableReason]);

  return { availability, online, submit, isSubmitting: isPending };
};

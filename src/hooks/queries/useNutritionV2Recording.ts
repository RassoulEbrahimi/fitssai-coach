import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { nutritionDateAt, type NutritionEntryIntent } from "@shared/nutrition";
import { useNutritionV2Access } from "@/hooks/queries/useNutritionV2";
import { writeNutritionV2Entry } from "@/lib/nutrition/v2/entryWriter";
import { isNutritionEntryConflictError, type NutritionEntryWriteResult } from "@/lib/nutrition/v2/entryTransaction";
import {
  buildNutritionEntryIntent,
  isRecordableNutritionDate,
  nutritionRecordingCommandDate,
  type NutritionRecordingCommand,
} from "@/lib/nutrition/v2/recording";

/**
 * Online Nutrition V2 recording for the signed-in account (NUT-06).
 *
 * - Writes happen only through `submit`, called from an explicit confirmation.
 *   Mounting, rendering or opening a form writes nothing.
 * - Only a signed-in, eligible adult (NUT-03) may write. Signed out, a profile
 *   still loading or failing, and a missing, unusable or under-18 age all
 *   refuse before any write starts. Identity is the authenticated uid only.
 * - Online only: while offline nothing is written, queued or shown as saved.
 *   The offline queue and replay are not used here.
 * - Never a future Berlin date. There is no lower bound (see
 *   `isRecordableNutritionDate`).
 * - Each `submit` is one user action with one new intent id; the transaction
 *   reuses that id on every internal retry.
 * - After a write — or a conflict, which means the cache was stale — the
 *   account's entry queries (`queryKeys.nutrition.entries.all(uid)`: by-date
 *   and range reads alike) are refetched. Nothing else is invalidated.
 */

export type NutritionV2RecordingUnavailableReason = "signedOut" | "pending" | "error" | "ineligible" | "offline";

export type NutritionV2RecordingAvailability =
  | { status: "available" }
  | { status: "unavailable"; reason: NutritionV2RecordingUnavailableReason };

/** A submit that was refused before any write started. */
export class NutritionV2RecordingUnavailableError extends Error {
  readonly reason: NutritionV2RecordingUnavailableReason | "futureDate";

  constructor(reason: NutritionV2RecordingUnavailableReason | "futureDate") {
    super(`Nutrition V2 recording is unavailable (${reason})`);
    this.name = "NutritionV2RecordingUnavailableError";
    this.reason = reason;
  }
}

export const isNutritionV2RecordingUnavailableError = (error: unknown): error is NutritionV2RecordingUnavailableError =>
  error instanceof NutritionV2RecordingUnavailableError;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

const readOnline = () => navigator.onLine;

/** The browser's online state, kept current by its online/offline events. */
const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, readOnline, () => true);

interface WriteVariables {
  uid: string;
  intent: NutritionEntryIntent;
}

export interface NutritionV2Recording {
  availability: NutritionV2RecordingAvailability;
  /** One explicit, confirmed action. Rejects with the refusal, a conflict or the Firestore error. */
  submit: (command: NutritionRecordingCommand) => Promise<NutritionEntryWriteResult>;
  isSubmitting: boolean;
}

export const useNutritionV2Recording = (): NutritionV2Recording => {
  const access = useNutritionV2Access();
  const online = useOnline();
  const queryClient = useQueryClient();

  const refetchEntries = useCallback(
    (uid: string) => queryClient.invalidateQueries({ queryKey: queryKeys.nutrition.entries.all(uid) }),
    [queryClient]
  );

  const { mutateAsync, isPending } = useMutation<NutritionEntryWriteResult, Error, WriteVariables>({
    mutationFn: ({ uid, intent }) => writeNutritionV2Entry(uid, intent),
    // A conflict is never retried; any other failure is the person's to retry.
    retry: false,
    onSuccess: (_result, { uid }) => refetchEntries(uid),
    onError: (error, { uid }) => (isNutritionEntryConflictError(error) ? refetchEntries(uid) : undefined),
  });

  const availability: NutritionV2RecordingAvailability =
    access.status !== "eligible"
      ? { status: "unavailable", reason: access.status }
      : online
        ? { status: "available" }
        : { status: "unavailable", reason: "offline" };

  const uid = access.status === "eligible" ? access.uid : null;
  const unavailableReason = availability.status === "unavailable" ? availability.reason : null;

  const submit = useCallback(
    async (command: NutritionRecordingCommand): Promise<NutritionEntryWriteResult> => {
      if (unavailableReason !== null || uid === null) {
        throw new NutritionV2RecordingUnavailableError(unavailableReason ?? "pending");
      }
      // Checked again at the moment of confirmation, not only at render.
      if (!navigator.onLine) throw new NutritionV2RecordingUnavailableError("offline");
      if (!isRecordableNutritionDate(nutritionRecordingCommandDate(command), nutritionDateAt(new Date()))) {
        throw new NutritionV2RecordingUnavailableError("futureDate");
      }
      const intent = buildNutritionEntryIntent(command, crypto.randomUUID());
      return mutateAsync({ uid, intent });
    },
    [mutateAsync, uid, unavailableReason]
  );

  return { availability, submit, isSubmitting: isPending };
};

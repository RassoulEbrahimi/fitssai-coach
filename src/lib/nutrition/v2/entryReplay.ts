import { NutritionEntryIntentError } from "@shared/nutrition";
import { assertAccountOwner } from "@/lib/accountIdentity";
import { ReplayRejectedError } from "@/lib/offlineQueue";
import { queryKeys } from "@/lib/queryKeys";
import { writeNutritionV2Entry } from "./entryWriter";
import { isNutritionEntryConflictError } from "./entryTransaction";
import { isNutritionV2IntegrityError } from "./integrity";
import { parseNutritionEntryWritePayload } from "./nutritionWriteIntents";

/**
 * Replays one queued Nutrition V2 entry write (NUT-07, `NUTRITION_ENTRY_WRITE`).
 *
 * The queued intent is written with the same writer the online path uses —
 * `writeNutritionV2Entry`, one transaction through the shared planner — so it
 * means exactly what it meant when the person made it. There is no replay
 * planner, no rebase and no last-write-wins:
 *
 *   applied / alreadyApplied / noop   success; the entry leaves the queue
 *   conflict                          terminal: quarantined, never retried
 *   anything else                     thrown as is: the queue's usual retry
 *
 * `alreadyApplied` is how an intent that did land — an online write whose
 * answer was lost, or a replay whose queue cleanup was interrupted — converges
 * without a second revision.
 *
 * On success, and on a conflict, only the owner's entry queries are named for
 * refetch. Never legacy Nutrition, Training, targets, plans or slot heads.
 */
export const replayNutritionEntryWrite = async (
  payload: unknown,
  ownerUid: string,
  checkpoint?: () => void
): Promise<(readonly unknown[])[]> => {
  const uid = assertAccountOwner(ownerUid);
  const entries = queryKeys.nutrition.entries.all(uid);

  const valid = parseNutritionEntryWritePayload(payload);
  if (valid === null) {
    // Local corruption: nothing trustworthy to write, and retrying cannot help.
    throw new ReplayRejectedError({
      code: "invalidPayload",
      message: "Eine gespeicherte Offline-Änderung ist beschädigt und wurde nicht übernommen.",
    });
  }

  checkpoint?.();
  try {
    await writeNutritionV2Entry(uid, valid.intent);
  } catch (error) {
    if (isNutritionEntryConflictError(error)) {
      throw new ReplayRejectedError({
        code: error.reason,
        message: "Der Eintrag wurde geändert, bevor die Offline-Änderung übernommen werden konnte.",
        invalidate: [entries],
        details: {
          entryId: error.entryId,
          expectedRevision: error.expectedRevision,
          currentRevision: error.currentRevision,
        },
      });
    }
    // Deterministic too: the same intent against the same document gives the same answer.
    if (error instanceof NutritionEntryIntentError) {
      throw new ReplayRejectedError({
        code: "invalidIntent",
        message: "Eine gespeicherte Offline-Änderung passt nicht zu ihrem Eintrag und wurde nicht übernommen.",
        invalidate: [entries],
      });
    }
    if (isNutritionV2IntegrityError(error)) {
      throw new ReplayRejectedError({
        code: "invalidEntryDocument",
        message: "Der gespeicherte Eintrag ist ungültig; die Offline-Änderung wurde nicht übernommen.",
        invalidate: [entries],
      });
    }
    throw error;
  }
  checkpoint?.();
  return [entries];
};

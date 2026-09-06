import { useCallback, useEffect, useMemo, useState } from "react";
import {
  evaluateTrainingNudges,
  isNudgeDelivered,
  isNudgeDismissed,
  markNudgeDelivered,
  markNudgeDismissed,
  nudgeDay,
  persistNudgeRecord,
  readNotificationChannelState,
  readNudgeRecord,
  requestNotificationPermission,
  showBrowserNudge,
  type NotificationChannelState,
  type NudgeEvaluation,
  type TrainingNudge,
} from "@/lib/nudges";
import type { AnyWorkoutLogShape } from "@/lib/workoutCompletion";
import type { WorkoutPlan } from "@/lib/types";

/**
 * The nudge layer's one stateful piece.
 *
 * Everything it decides is decided by `evaluateTrainingNudges`, which is pure;
 * this only holds the per-device record of what was already shown, and reacts
 * to the two events that can change the answer without any data changing: the
 * tab coming back to the foreground, and the user granting permission.
 *
 * It is deliberately event-driven rather than scheduled. The product has no
 * user-defined reminder time, and inventing one — "we will remind you at
 * 18:00" — would be a promise nothing in this architecture keeps, since
 * nothing can run while the app is closed. So a nudge is evaluated when the
 * app is open and looked at, and the UI says exactly that.
 */

export interface UseTrainingNudgeInput {
  plan: WorkoutPlan | null | undefined;
  logs: readonly (AnyWorkoutLogShape | null | undefined)[] | null | undefined;
  /** The date to evaluate, normally the app's "today". */
  date: Date;
  /** Escape hatch for surfaces that must not deliver (tests, previews). */
  enabled?: boolean;
}

export interface TrainingNudgeState {
  /** The eligible nudges the user has not dismissed today. */
  nudges: TrainingNudge[];
  /** The full evaluation, including why nothing is eligible. */
  evaluation: NudgeEvaluation;
  channelState: NotificationChannelState;
  /** Asks the browser for permission. Only ever called from a user action. */
  requestPermission: () => Promise<NotificationChannelState>;
  dismiss: (key: string) => void;
}

export const useTrainingNudge = ({
  plan,
  logs,
  date,
  enabled = true,
}: UseTrainingNudgeInput): TrainingNudgeState => {
  const evaluation = useMemo(
    () => evaluateTrainingNudges({ plan, date, logs }),
    [plan, date, logs]
  );

  const [record, setRecord] = useState(readNudgeRecord);
  const [channelState, setChannelState] = useState<NotificationChannelState>(
    readNotificationChannelState
  );

  const day = useMemo(() => nudgeDay(evaluation, date), [evaluation, date]);

  /*
    Permission can be revoked in browser settings without the page hearing
    about it, so the state is re-read whenever the tab is looked at again
    rather than trusted from mount. Same listener covers "the user granted it
    in another tab".
  */
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible") {
        setChannelState(readNotificationChannelState());
      }
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /*
    One browser notification per training day, at most.

    The record is written *before* the notification is raised, so a re-render,
    a StrictMode double-invoke or a reload cannot produce a second one: the
    next pass sees the delivery already recorded. A completed day never gets
    here at all — it is not eligible — and a dismissed nudge is treated as
    already answered.
  */
  useEffect(() => {
    if (!enabled) return;
    if (channelState !== "granted") return;

    const target = evaluation.nudges.find((nudge) => nudge.browserDeliverable);
    if (!target) return;
    if (isNudgeDelivered(record, target.key) || isNudgeDismissed(record, target.key)) return;

    setRecord((current) => persistNudgeRecord(markNudgeDelivered(current, target.key, day)));
    void showBrowserNudge(target);
  }, [enabled, channelState, evaluation, record, day]);

  const dismiss = useCallback(
    (key: string) => {
      setRecord((current) => persistNudgeRecord(markNudgeDismissed(current, key, day)));
    },
    [day]
  );

  const requestPermission = useCallback(async () => {
    const next = await requestNotificationPermission();
    setChannelState(next);
    return next;
  }, []);

  /*
    Dismissing the day nudge dismisses the day. The weekly count is context for
    that nudge rather than a nudge of its own, so leaving it behind would mean
    the user closes a card and a card stays.
  */
  const nudges = useMemo(() => {
    const dayNudge = evaluation.nudges.find((nudge) => nudge.browserDeliverable);
    if (dayNudge && isNudgeDismissed(record, dayNudge.key)) return [];
    return evaluation.nudges.filter((nudge) => !isNudgeDismissed(record, nudge.key));
  }, [evaluation, record]);

  return { nudges, evaluation, channelState, requestPermission, dismiss };
};

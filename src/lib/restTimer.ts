import { accountStorageKey } from './accountIdentity';
import type { TrainingSessionPayload } from './trainingSession';

export const REST_STORAGE_KEY = 'fitssai.training.rest';
export type RestTimerStatus = 'idle' | 'running' | 'paused' | 'finished';
export interface RestTimerState {
  status: RestTimerStatus;
  exerciseIndex: number | null;
  setNumber: number | null;
  totalRestSeconds: number;
  deadlineMs: number | null;
  pausedRemainingSeconds: number | null;
}
export const IDLE_REST: RestTimerState = {
  status: 'idle', exerciseIndex: null, setNumber: null,
  totalRestSeconds: 0, deadlineMs: null, pausedRemainingSeconds: null,
};

export const restSessionIdentity = (uid: string | undefined, session: TrainingSessionPayload | null) =>
  uid && session ? JSON.stringify([
    uid, session.planId, session.weekKey, session.dayIndex,
    session.workoutDay ?? null, session.startedAt,
  ]) : null;

export const remainingRestSeconds = (state: RestTimerState, now = Date.now()) =>
  state.status === 'running' && state.deadlineMs !== null
    ? Math.max(0, Math.ceil((state.deadlineMs - now) / 1000))
    : state.status === 'paused' ? state.pausedRemainingSeconds ?? 0 : 0;

export function clearStoredRest(uid: string) {
  try { localStorage.removeItem(accountStorageKey(REST_STORAGE_KEY, uid)); } catch { /* Best effort. */ }
}

export function persistRest(uid: string, identity: string, state: RestTimerState) {
  if (state.status !== 'running' && state.status !== 'paused') {
    clearStoredRest(uid);
    return;
  }
  try {
    localStorage.setItem(accountStorageKey(REST_STORAGE_KEY, uid), JSON.stringify({ version: 1, identity, state }));
  } catch { /* Storage restrictions must not interrupt a workout. */ }
}

export function restoreRest(uid: string, identity: string): RestTimerState {
  try {
    const saved = JSON.parse(localStorage.getItem(accountStorageKey(REST_STORAGE_KEY, uid)) ?? 'null');
    const s = saved?.state;
    if (saved?.version === 1 && saved.identity === identity && s &&
      Number.isInteger(s.exerciseIndex) && s.exerciseIndex >= 0 &&
      Number.isInteger(s.setNumber) && s.setNumber > 0 &&
      Number.isFinite(s.totalRestSeconds) && s.totalRestSeconds > 0 &&
      ((s.status === 'running' && Number.isFinite(s.deadlineMs) && s.pausedRemainingSeconds === null) ||
       (s.status === 'paused' && s.deadlineMs === null && Number.isInteger(s.pausedRemainingSeconds) && s.pausedRemainingSeconds > 0)) &&
      remainingRestSeconds(s) > 0) {
      return {
        status: s.status, exerciseIndex: s.exerciseIndex, setNumber: s.setNumber,
        totalRestSeconds: s.totalRestSeconds, deadlineMs: s.deadlineMs,
        pausedRemainingSeconds: s.pausedRemainingSeconds,
      };
    }
  } catch { /* Invalid JSON or unavailable storage is not recoverable. */ }
  clearStoredRest(uid);
  return IDLE_REST;
}

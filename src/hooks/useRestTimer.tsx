import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import {
  IDLE_REST, clearStoredRest, persistRest, restoreRest, remainingRestSeconds, restSessionIdentity,
  type RestTimerState,
} from '@/lib/restTimer';
import type { TrainingSessionPayload } from '@/lib/trainingSession';

/** One clock above the Focus Mode portal; storage writes happen only on transitions. */
export function useRestTimer(uid?: string, session: TrainingSessionPayload | null = null) {
  const identity = restSessionIdentity(uid, session);
  const [state, setState] = useState<RestTimerState>(IDLE_REST);
  const stateRef = useRef(state);
  const scopeRef = useRef<string | null>(identity);
  const generation = useRef(0);
  const [now, setNow] = useState(Date.now);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const commit = useCallback((next: RestTimerState) => {
    stateRef.current = next;
    setState(next);
    setNow(Date.now());
    if (uid && identity && scopeRef.current === identity) persistRest(uid, identity, next);
  }, [uid, identity]);

  useLayoutEffect(() => {
    scopeRef.current = identity;
    generation.current++;
    const next = uid && identity ? restoreRest(uid, identity) : IDLE_REST;
    if (uid && !identity) clearStoredRest(uid);
    stateRef.current = next;
    setState(next);
    setNow(Date.now());
    setIsSheetOpen(false); // Recovery is inline; visibility is never persisted.
    return () => {
      // In-flight writes can settle after navigation remounts the card. Their
      // callbacks must not erase recovery belonging to the replacement card.
      scopeRef.current = null;
    };
  }, [uid, identity]);

  const finish = useCallback((completed: boolean) => {
    generation.current++;
    commit({ ...IDLE_REST, status: completed ? 'finished' : 'idle' });
    setIsSheetOpen(false);
  }, [commit]);

  useEffect(() => {
    if (state.status !== 'running') return;
    const refresh = () => {
      if (stateRef.current.status !== 'running') return;
      if (remainingRestSeconds(stateRef.current) === 0) finish(true);
      else setNow(Date.now());
    };
    const interval = setInterval(refresh, 250);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [state.status, finish]);

  const isTimerOwnedBy = useCallback((exerciseIndex: number, setNumber: number) => {
    const current = stateRef.current;
    return (current.status === 'running' || current.status === 'paused') &&
      current.exerciseIndex === exerciseIndex && current.setNumber === setNumber;
  }, []);
  const cancelTimerForSet = useCallback((exerciseIndex: number, setNumber: number) => {
    if (isTimerOwnedBy(exerciseIndex, setNumber)) finish(false);
  }, [isTimerOwnedBy, finish]);

  const startTimer = useCallback((exerciseIndex: number, durationSeconds: number, setNumber: number) => {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, Math.ceil(durationSeconds)) : 60;
    const instance = ++generation.current;
    const scope = identity;
    commit(duration > 0 ? {
      status: 'running', exerciseIndex, setNumber, totalRestSeconds: duration,
      deadlineMs: Date.now() + duration * 1000, pausedRemainingSeconds: null,
    } : { ...IDLE_REST, status: 'finished' });
    setIsSheetOpen(duration > 0);
    // Also protects a later completion of the SAME set, or a new session.
    return () => {
      if (scopeRef.current === scope && generation.current === instance) cancelTimerForSet(exerciseIndex, setNumber);
    };
  }, [identity, commit, cancelTimerForSet]);

  const pauseTimer = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'running') return;
    const remaining = remainingRestSeconds(current);
    if (remaining === 0) return finish(true);
    commit({ ...current, status: 'paused', deadlineMs: null, pausedRemainingSeconds: remaining });
  }, [commit, finish]);
  const resumeTimer = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'paused') return;
    commit({ ...current, status: 'running', deadlineMs: Date.now() + remainingRestSeconds(current) * 1000, pausedRemainingSeconds: null });
  }, [commit]);
  const adjustTimer = useCallback((seconds: number) => {
    const current = stateRef.current;
    if (!Number.isFinite(seconds) || (current.status !== 'running' && current.status !== 'paused')) return;
    const remaining = remainingRestSeconds(current);
    if (remaining === 0 || remaining + seconds <= 0) return finish(true);
    commit(current.status === 'running'
      ? { ...current, deadlineMs: current.deadlineMs! + seconds * 1000 }
      : { ...current, pausedRemainingSeconds: remaining + seconds });
  }, [commit, finish]);
  const setSheetOpen = useCallback((open: boolean) => {
    const current = stateRef.current;
    setIsSheetOpen(open && (current.status === 'running' || current.status === 'paused'));
  }, []);
  const skipTimer = useCallback(() => finish(false), [finish]);

  // Do not display the previous account/session for even one render.
  const visibleState = scopeRef.current === identity ? state : IDLE_REST;
  const timerState = {
    ...visibleState,
    remainingSeconds: remainingRestSeconds(visibleState, now),
    isComplete: visibleState.status === 'finished',
  };
  return {
    timerState, isSheetOpen, setSheetOpen, startTimer, skipTimer,
    pauseTimer, resumeTimer, adjustTimer, isTimerOwnedBy, cancelTimerForSet,
    isTimerActiveFor: (exerciseIndex: number) => timerState.exerciseIndex === exerciseIndex && timerState.remainingSeconds > 0,
  };
}

export type RestTimerController = ReturnType<typeof useRestTimer>;

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

/**
 * P1-07, second half — the training nudge belongs to the real day.
 *
 * Home and the workout tab share one `selectedDate`: the calendar strip on the
 * workout tab writes it, and Home reads it. Home used to hand that same value
 * to the nudge layer as "today", so paging back to last Sunday raised "Heute
 * ist eine Trainingseinheit geplant." for last Sunday, and paging forward
 * announced a session on a day that has not happened yet. Worse, the delivery
 * and dismissal records are keyed on the plan position of whatever day was
 * evaluated, so merely browsing could spend the real day's one notification or
 * silence a card the user never saw.
 *
 * Every case below renders the real `HomeView` with the real nudge hook, the
 * real eligibility rules and the real per-device record. Only the clock, the
 * account and the data sources are doubles.
 */

const identity = vi.hoisted(() => ({ currentUser: { uid: 'u1' } as { uid: string } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: identity.currentUser }) }));
vi.mock('@/lib/telemetryClient', () => ({ logEvent: vi.fn(), logError: vi.fn(), logRetry: vi.fn() }));
vi.mock('@/hooks/useWeeklyActivity', () => ({
  useWeeklyActivity: () => ({
    dailyData: [0, 0, 0, 0, 0, 0, 0],
    dayLabels: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
    activeDays: 0,
    measuredMinutes: 0,
    measuredWorkouts: 0,
    unmeasuredWorkouts: 0,
    totalWorkouts: 0,
    targetMinutes: 350,
    isLoading: false,
  }),
}));
vi.mock('@/components/charts/WeeklyActivity', () => ({ WeeklyActivity: () => null }));

import HomeView from '@/views/HomeView';
import { ThemeProvider } from '@/hooks/useTheme';
import { NUDGE_RECORD_STORAGE_KEY, type NudgeRecord } from '@/lib/nudges/delivery';
import { accountStorageKey } from '@/lib/accountIdentity';
import type { WorkoutPlan, WorkoutLog } from '@/lib/types';

/*
  The plan starts on Monday 2026-03-02, so Sunday 2026-03-08 is Week 1 day 6
  and Monday 2026-03-09 is Week 2 day 0. Two adjacent days in two different
  plan weeks: the strongest possible separation between "the day on screen"
  and "the day it is".
*/
const PLAN_CREATED_AT = '2026-03-02T08:00:00.000Z';
const TODAY = new Date('2026-03-09T11:00:00.000Z');
const YESTERDAY = new Date('2026-03-08T11:00:00.000Z');
const TOMORROW = new Date('2026-03-10T11:00:00.000Z');

/** `planId|weekKey|dayIndex` — the key the nudge record is written under. */
const todayKey = 'plan-1|Week 2|0';
const yesterdayKey = 'plan-1|Week 1|6';
const tomorrowKey = 'plan-1|Week 2|1';

const exercises = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `Übung ${index + 1}`, sets: 3, reps: 10 }));

/**
 * Every day of every week is a training day.
 *
 * That is what makes the browsed-date cases meaningful: if yesterday were a
 * rest day the nudge would be suppressed for the boring reason, and the test
 * would prove nothing about which day the hook thinks it is.
 */
const plan = (): WorkoutPlan => {
  const week = () =>
    Array.from({ length: 7 }, (_, index) => ({
      day: `Tag ${index + 1}`,
      exercises: exercises(3),
    }));
  return {
    id: 'plan-1',
    created_at: PLAN_CREATED_AT,
    user_id: 'u1',
    content: {
      'Week 1': week(),
      'Week 2': week(),
      'Week 3': week(),
      'Week 4': week(),
    },
  } as unknown as WorkoutPlan;
};

/** A finished day session — the only evidence that completes a training day. */
const completedDay = (weekKey: string, dayIndex: number, workoutDay: string): WorkoutLog =>
  ({ week_key: weekKey, day_index: dayIndex, workout_day: workoutDay, completed: true }) as unknown as WorkoutLog;

/** Monday 2026-03-09 is done; Sunday before and Tuesday after are not. */
const REAL_DAY_DONE = [completedDay('Week 2', 0, '2026-03-09')];

/** The real HomeView, with only the providers it reaches for around it. */
const view = (selectedDate: Date, logs: WorkoutLog[]) => (
  <MemoryRouter>
    <ThemeProvider>
      <HomeView
        generatingPlans={false}
        workoutPlan={plan()}
        onGeneratePlans={() => undefined}
        profile={{ id: 'u1', full_name: 'Test' } as never}
        selectedDate={selectedDate}
        workoutLogs={logs}
        getTodayWorkout={() => null}
      />
    </ThemeProvider>
  </MemoryRouter>
);

const home = (selectedDate: Date, logs: WorkoutLog[] = []) =>
  render(view(selectedDate, logs));

/** The day nudge's headline, whichever of its two wordings is on screen. */
const dayNudge = () =>
  screen.queryByText(
    /Heute ist eine Trainingseinheit geplant\.|Deine heutige Einheit ist noch offen\./
  );

const nudgeRecord = (): NudgeRecord => {
  const raw = window.localStorage.getItem(accountStorageKey(NUDGE_RECORD_STORAGE_KEY, 'u1'));
  return raw ? (JSON.parse(raw) as NudgeRecord) : { delivered: {}, dismissed: {} };
};

let shown: string[] = [];

/** jsdom ships no Notifications API; this is the path a desktop browser takes. */
const stubNotification = (permission: NotificationPermission) => {
  const Notification = function (this: unknown, title: string) {
    shown.push(title);
  } as unknown as typeof window.Notification;
  (Notification as unknown as { permission: NotificationPermission }).permission = permission;
  (Notification as unknown as { requestPermission: unknown }).requestPermission = vi.fn(
    async () => permission
  );
  Object.defineProperty(window, 'Notification', {
    value: Notification,
    configurable: true,
    writable: true,
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TODAY);
  window.localStorage.clear();
  identity.currentUser = { uid: 'u1' };
  shown = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  Reflect.deleteProperty(window, 'Notification');
});

describe('a browsed day is never treated as today', () => {
  it('raises nothing for yesterday when the real day is already done', () => {
    /*
      The reproduction. The real Monday is finished, so there is nothing
      outstanding to say. Before PR68 the hook was handed `selectedDate`, found
      Sunday's session open, and announced it with "Heute ist eine
      Trainingseinheit geplant." — about a day that was over.
    */
    home(YESTERDAY, REAL_DAY_DONE);

    expect(dayNudge()).toBeNull();
  });

  it('raises nothing for tomorrow when the real day is already done', () => {
    home(TOMORROW, REAL_DAY_DONE);

    expect(dayNudge()).toBeNull();
  });

  it('nudges normally when the browsed day is the real day', () => {
    home(TODAY);

    expect(dayNudge()).toBeInTheDocument();
  });

  it('still nudges about the real day while another one is on screen', () => {
    /*
      The other half, and it matters as much: binding to the real day must not
      make the card vanish whenever somebody looks at the calendar. Sunday is
      on screen; the reminder is Monday's, because Monday's session is open.
    */
    home(YESTERDAY);

    expect(dayNudge()).toBeInTheDocument();
  });
});

describe('browsing does not spend the real day', () => {
  it('delivers the day\'s one notification against the real day, not the browsed one', async () => {
    stubNotification('granted');

    home(YESTERDAY);

    await waitFor(() => expect(shown).toHaveLength(1));
    /*
      The anti-spam record is keyed on the plan position. Recording Sunday here
      would leave Monday's own notification still unspent — two interruptions
      for one open session — and recording it for a day the user only looked at
      is a lie about what was shown.
    */
    expect(Object.keys(nudgeRecord().delivered)).toEqual([todayKey]);
  });

  it('scopes a dismissal to the real training day, and keeps it there', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const rendered = home(YESTERDAY);

    await user.click(screen.getByRole('button', { name: 'Hinweis ausblenden' }));
    expect(dayNudge()).toBeNull();

    expect(Object.keys(nudgeRecord().dismissed)).toEqual([todayKey]);
    expect(nudgeRecord().dismissed[yesterdayKey]).toBeUndefined();

    // Paging the calendar cannot resurrect it: the day it was dismissed for is
    // still the day it is.
    rendered.rerender(view(TOMORROW, []));
    expect(dayNudge()).toBeNull();
    expect(Object.keys(nudgeRecord().dismissed)).toEqual([todayKey]);
  });

  it('does not read a browsed day\'s dismissal as the real day\'s', () => {
    /*
      Sunday of Week 1 was dismissed yesterday. That says nothing about Monday
      of Week 2, and the only way the card could be missing here is if the hook
      were still evaluating the day on screen.
    */
    window.localStorage.setItem(
      accountStorageKey(NUDGE_RECORD_STORAGE_KEY, 'u1'),
      JSON.stringify({ dismissed: { [yesterdayKey]: '2026-03-08' }, delivered: {} })
    );

    home(YESTERDAY);

    expect(dayNudge()).toBeInTheDocument();
  });

  it('creates no second nudge when the browsed date changes', async () => {
    stubNotification('granted');
    const rendered = home(TODAY);

    await waitFor(() => expect(shown).toHaveLength(1));

    rendered.rerender(view(YESTERDAY, []));
    rendered.rerender(view(TOMORROW, []));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(shown).toHaveLength(1);
    expect(Object.keys(nudgeRecord().delivered)).toEqual([todayKey]);
    expect(nudgeRecord().delivered[yesterdayKey]).toBeUndefined();
    expect(nudgeRecord().delivered[tomorrowKey]).toBeUndefined();
  });
});

describe('the real day rolls over on its own', () => {
  it('moves to the next session at Berlin midnight without a reload', async () => {
    // 23:30 Berlin on Sunday. Sunday's session is done, so nothing is open.
    vi.setSystemTime(new Date('2026-03-08T22:30:00.000Z'));

    home(TOMORROW, [completedDay('Week 1', 6, '2026-03-08')]);
    expect(dayNudge()).toBeNull();

    /*
      Berlin midnight. `useBerlinToday` fires its own timer, the hook re-reads
      the day, and Monday's open session becomes the nudge — while the browsed
      date has not moved at all.
    */
    await act(async () => {
      vi.setSystemTime(new Date('2026-03-08T23:30:00.000Z'));
      await vi.advanceTimersByTimeAsync(90 * 60 * 1000);
    });

    expect(dayNudge()).toBeInTheDocument();
  });
});

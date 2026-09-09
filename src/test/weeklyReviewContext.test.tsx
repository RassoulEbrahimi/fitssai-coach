import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1-07, first half — a weekly review belongs to the week it was asked about.
 *
 * The recommendation section is the one place in the app where a model writes
 * a sentence about a specific week of a specific person's training. Three ways
 * that sentence could end up describing a week it was not generated from:
 *
 *   1. the request said nothing about which week, so the backend answered
 *      about its own current one;
 *   2. the answer arrived after the user had paged to another week, and
 *      replaced that week's wording;
 *   3. the week's numbers changed underneath a sentence already on screen.
 *
 * Case 1 is fixed on both sides and its server half lives in
 * `functions/src/coaching/weeklyReview.test.ts`; the client half — asking for
 * a week and refusing an answer about another — is here. Cases 2 and 3 are
 * client-only and are the bulk of this file.
 *
 * Everything below drives the shipped `CoachingRecommendation` and the shipped
 * `fetchWeeklyReview`. Only the callable itself is a double.
 */

const callable = vi.hoisted(() => vi.fn());
const httpsCallable = vi.hoisted(() => vi.fn(() => callable));

vi.mock('firebase/app', () => ({ getApp: () => ({}) }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable,
}));

import { CoachingRecommendation } from '@/components/dashboard/CoachingRecommendation';
import { fetchWeeklyReview, WeeklyReviewError } from '@/lib/backend/weeklyReview';
import {
  computeWeeklyReviewMetrics,
  type ReviewCompletion,
  type ReviewPlanDay,
  type WeeklyReviewMetrics,
} from '@shared/weeklyRecommendation';

const THREE_DAY_WEEK: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
  dayIndex,
  exerciseCount: dayIndex % 2 === 0 && dayIndex < 5 ? 4 : 0,
}));

const done = (weekKey: string, days: number[]): ReviewCompletion[] =>
  days.map((dayIndex) => ({ weekKey, dayIndex, completed: true }));

const metricsFor = (weekKey: string, weekNumber: number, days: number[]): WeeklyReviewMetrics =>
  computeWeeklyReviewMetrics({
    weekKey,
    weekNumber,
    hasPlan: true,
    planDays: THREE_DAY_WEEK,
    completions: done(weekKey, days),
    weekLogs: [],
  });

const WEEK_1 = metricsFor('Week 1', 1, [0, 2]);
const WEEK_2 = metricsFor('Week 2', 2, [0]);
/** Week 1 again, after a third session was logged from another device. */
const WEEK_1_AFTER = metricsFor('Week 1', 1, [0, 2, 4]);

const AI_WORDING = {
  category: 'maintain' as const,
  headline: 'Zwei von drei',
  message: 'Du hast zwei der drei geplanten Einheiten dieser Woche abgeschlossen.',
  reason: 'Zwei abgeschlossene Trainingstage von drei geplanten.',
  source: 'ai' as const,
};

/** A second model answer, distinguishable from the first on screen. */
const OTHER_AI_WORDING = {
  category: 'consistency' as const,
  headline: 'Eine von drei',
  message: 'Du hast eine der drei geplanten Einheiten dieser Woche abgeschlossen.',
  reason: 'Eine abgeschlossene Trainingseinheit von drei geplanten.',
  source: 'ai' as const,
};

const responseFor = (
  weekKey: string,
  weekNumber: number,
  over: Record<string, unknown> = {}
) => ({
  ok: true as const,
  context: { planId: 'plan-1', weekKey, weekNumber },
  metrics: metricsFor(weekKey, weekNumber, [0, 2]),
  recommendation: AI_WORDING,
  aiStatus: 'ai' as const,
  quota: { remaining: 7, limit: 8, period: '2026-09' },
  planFinished: false,
  ...over,
});

const context = (weekKey: string, over: Record<string, unknown> = {}) => ({
  accountId: 'u1',
  planId: 'plan-1',
  weekKey,
  ...over,
});

const explain = () => screen.getByRole('button', { name: /Vom KI-Coach erklären lassen/ });
const aiWording = () => screen.queryByText(AI_WORDING.headline);
const otherAiWording = () => screen.queryByText(OTHER_AI_WORDING.headline);
const aiBadge = () => screen.queryByText(/Formulierung vom KI-Coach/);

beforeEach(() => {
  callable.mockReset();
  httpsCallable.mockClear();
});

afterEach(cleanup);

/* ------------------------------------------------------------------ *
 * The request names its week, and the answer has to agree
 * ------------------------------------------------------------------ */

describe('asking about one named week', () => {
  it('sends the week the user is looking at', async () => {
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    await fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' });

    expect(callable).toHaveBeenCalledWith({ weekKey: 'Week 1' });
  });

  it('refuses an answer about a different week', async () => {
    /*
      The reproduction of the original defect, at the boundary where it can now
      be caught: the caller asked about Week 1 and the backend answered about
      Week 3. Before PR68 nothing in the response said so, and the wording went
      straight onto the Week 1 card.
    */
    callable.mockResolvedValue({ data: responseFor('Week 3', 3) });

    await expect(fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' })).rejects.toMatchObject({
      code: 'CONTEXT_MISMATCH',
    });
  });

  it('refuses an answer about a different plan', async () => {
    callable.mockResolvedValue({
      data: responseFor('Week 1', 1, { context: { planId: 'plan-2', weekKey: 'Week 1', weekNumber: 1 } }),
    });

    await expect(fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' })).rejects.toMatchObject({
      code: 'CONTEXT_MISMATCH',
    });
  });

  it('falls back to the metrics\' own week when the backend sends no context', async () => {
    /*
      The window between this client shipping and `generateWeeklyReview` being
      deployed. The old backend sends no context block, but it does send the
      metrics it computed — which name the week it actually used. That is
      enough to catch the swap, and no wording is trusted to imply anything.
    */
    const { context: _dropped, ...withoutContext } = responseFor('Week 3', 3);

    await expect(
      (callable.mockResolvedValue({ data: withoutContext }),
      fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' }))
    ).rejects.toMatchObject({ code: 'CONTEXT_MISMATCH' });
  });

  it('accepts the matching week from a backend that sends no context', async () => {
    const { context: _dropped, ...withoutContext } = responseFor('Week 1', 1);
    callable.mockResolvedValue({ data: withoutContext });

    const review = await fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' });

    expect(review.recommendation.headline).toBe(AI_WORDING.headline);
  });

  it('refuses a malformed context block outright', async () => {
    callable.mockResolvedValue({
      data: responseFor('Week 1', 1, { context: { planId: 7, weekKey: 'Week 1', weekNumber: 1 } }),
    });

    await expect(fetchWeeklyReview({ weekKey: 'Week 1', planId: 'plan-1' })).rejects.toBeInstanceOf(
      WeeklyReviewError
    );
  });
});

/* ------------------------------------------------------------------ *
 * A late answer is never the current week's advice
 * ------------------------------------------------------------------ */

describe('an answer that arrives after the user has moved on', () => {
  it('does not render Week 1\'s wording under Week 2', async () => {
    const user = userEvent.setup();
    let resolveWeek1: (value: unknown) => void = () => undefined;
    callable.mockReturnValue(new Promise((resolve) => { resolveWeek1 = resolve; }));

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());

    // The user pages to Week 2 while the call for Week 1 is still open.
    rendered.rerender(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    expect(screen.getByText(/1 von 3 Trainingstagen abgeschlossen \(33 %\)/)).toBeInTheDocument();

    // Week 1's answer lands last.
    await act(async () => {
      resolveWeek1({ data: responseFor('Week 1', 1) });
    });

    expect(aiWording()).toBeNull();
    expect(aiBadge()).toBeNull();
    // Week 2 still shows its own numbers, in its own words.
    expect(screen.getByText(/1 von 3 Trainingstagen abgeschlossen \(33 %\)/)).toBeInTheDocument();
  });

  it('does not take away the answer Week 2 already has', async () => {
    const user = userEvent.setup();
    let resolveWeek1: (value: unknown) => void = () => undefined;
    callable
      .mockReturnValueOnce(new Promise((resolve) => { resolveWeek1 = resolve; }))
      .mockResolvedValueOnce({
        data: responseFor('Week 2', 2, { recommendation: OTHER_AI_WORDING }),
      });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());

    // The user pages to Week 2 with Week 1's call still open, and asks again.
    rendered.rerender(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    await user.click(explain());
    expect(await screen.findByText(OTHER_AI_WORDING.headline)).toBeInTheDocument();

    // Week 1's answer lands last. It belongs to Week 1 and goes to Week 1.
    await act(async () => {
      resolveWeek1({ data: responseFor('Week 1', 1) });
    });

    // Week 2's answer is still there: not replaced, not cleared, and not
    // quietly swapped for the deterministic wording the user did not pay for.
    expect(otherAiWording()).toBeInTheDocument();
    expect(aiBadge()).toBeInTheDocument();
    expect(aiWording()).toBeNull();
    expect(screen.queryByText(/1 von 3 Trainingstagen abgeschlossen \(33 %\)/)).toBeNull();
  });

  it('leaves the button usable for the week now on screen', async () => {
    const user = userEvent.setup();
    callable.mockReturnValue(new Promise(() => undefined));

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());

    /*
      The in-flight guard is keyed on the context, not on a single boolean: a
      call still open for Week 1 must not swallow the click that asks about
      Week 2, or the user is left with a dead button.
    */
    rendered.rerender(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    await user.click(explain());

    expect(callable).toHaveBeenCalledTimes(2);
    expect(callable).toHaveBeenLastCalledWith({ weekKey: 'Week 2' });
  });

  it('still shows Week 1\'s answer when the user pages back to Week 1', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    expect(await screen.findByText(AI_WORDING.headline)).toBeInTheDocument();

    rendered.rerender(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    expect(aiWording()).toBeNull();

    // It was generated for Week 1 and Week 1 has not changed, so it is still
    // true of Week 1 — nothing was thrown away, only hidden where it did not
    // belong.
    rendered.rerender(<CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />);
    expect(aiWording()).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Wording does not outlive the numbers it describes
 * ------------------------------------------------------------------ */

describe('when the week\'s facts change underneath', () => {
  it('retires wording generated from the old numbers', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    expect(await screen.findByText(AI_WORDING.headline)).toBeInTheDocument();

    // A third session lands — from the phone, or from the offline queue.
    rendered.rerender(<CoachingRecommendation metrics={WEEK_1_AFTER} context={context('Week 1')} />);

    // "Zwei von drei" is no longer true of this week, so it is gone, and the
    // section says what the new numbers say.
    expect(aiWording()).toBeNull();
    expect(aiBadge()).toBeNull();
    expect(screen.getByText(/3 von 3 Trainingstagen abgeschlossen \(100 %\)/)).toBeInTheDocument();
  });

  it('offers a fresh explanation for the new numbers', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    await screen.findByText(AI_WORDING.headline);

    rendered.rerender(<CoachingRecommendation metrics={WEEK_1_AFTER} context={context('Week 1')} />);

    expect(explain()).toBeEnabled();
  });

  it('keeps valid wording while the numbers stay the same', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    await screen.findByText(AI_WORDING.headline);

    // A re-render with an equal-but-not-identical metrics object is not a
    // change of facts, and must not throw away something the user paid for.
    rendered.rerender(
      <CoachingRecommendation metrics={metricsFor('Week 1', 1, [0, 2])} context={context('Week 1')} />
    );

    expect(aiWording()).toBeInTheDocument();
    expect(callable).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * The profile the model was told about
 * ------------------------------------------------------------------ */

/**
 * The backend hands the model the caller's goal and experience level along
 * with the numbers, so the same week at the same numbers is phrased for the
 * person it is phrased for. Change either and the sentence on screen answers a
 * question that is no longer being asked — the numbers alone cannot show it,
 * which is why both belong in the render context.
 *
 * Nothing here is sent to the backend: it reads its own copy under the
 * caller's uid. This is only how the screen knows its wording went stale.
 */
describe('when the profile the model was told about changes', () => {
  const withProfile = (over: Record<string, unknown>) =>
    context('Week 1', { goal: 'gainMuscle', experienceLevel: 'beginner', ...over });

  const explained = async (initial: ReturnType<typeof withProfile>) => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });
    const rendered = render(<CoachingRecommendation metrics={WEEK_1} context={initial} />);
    await user.click(explain());
    expect(await screen.findByText(AI_WORDING.headline)).toBeInTheDocument();
    return rendered;
  };

  it('retires wording generated under the old goal', async () => {
    const rendered = await explained(withProfile({}));

    rendered.rerender(
      <CoachingRecommendation metrics={WEEK_1} context={withProfile({ goal: 'loseFat' })} />
    );

    expect(aiWording()).toBeNull();
    expect(aiBadge()).toBeNull();
    expect(screen.getByText(/2 von 3 Trainingstagen abgeschlossen \(67 %\)/)).toBeInTheDocument();
  });

  it('retires wording generated under the old experience level', async () => {
    const rendered = await explained(withProfile({}));

    rendered.rerender(
      <CoachingRecommendation
        metrics={WEEK_1}
        context={withProfile({ experienceLevel: 'advanced' })}
      />
    );

    expect(aiWording()).toBeNull();
    expect(aiBadge()).toBeNull();
  });

  it('keeps valid wording when the same profile arrives again', async () => {
    const rendered = await explained(withProfile({}));

    // A new object carrying the same two values is not a change of profile,
    // and neither is a stored spelling that only differs in padding.
    rendered.rerender(<CoachingRecommendation metrics={WEEK_1} context={withProfile({})} />);
    expect(aiWording()).toBeInTheDocument();

    rendered.rerender(
      <CoachingRecommendation
        metrics={WEEK_1}
        context={withProfile({ goal: ' gainMuscle ', experienceLevel: ' beginner ' })}
      />
    );

    expect(aiWording()).toBeInTheDocument();
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('is not confused by a profile that has not loaded yet', async () => {
    const rendered = await explained(withProfile({}));

    // Absent is a context of its own — it is not "any profile".
    rendered.rerender(
      <CoachingRecommendation
        metrics={WEEK_1}
        context={withProfile({ goal: null, experienceLevel: null })}
      />
    );
    expect(aiWording()).toBeNull();

    rendered.rerender(<CoachingRecommendation metrics={WEEK_1} context={withProfile({})} />);
    expect(aiWording()).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Plans and accounts are contexts too
 * ------------------------------------------------------------------ */

describe('a plan or an account is a different review', () => {
  it('does not carry wording across a plan change', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    await screen.findByText(AI_WORDING.headline);

    rendered.rerender(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1', { planId: 'plan-2' })} />
    );

    expect(aiWording()).toBeNull();
  });

  it('does not carry wording across an account switch', async () => {
    /*
      PR64's rule, at this surface: nothing generated for one account may be on
      screen for another, even for the same week number of a similar plan.
    */
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 1', 1) });

    const rendered = render(
      <CoachingRecommendation metrics={WEEK_1} context={context('Week 1')} />
    );
    await user.click(explain());
    await screen.findByText(AI_WORDING.headline);

    rendered.rerender(
      <CoachingRecommendation
        metrics={WEEK_1}
        context={context('Week 1', { accountId: 'u2' })}
      />
    );

    expect(aiWording()).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The ordinary case still works
 * ------------------------------------------------------------------ */

describe('the current week, unchanged', () => {
  it('asks for it, renders it, and labels it as the model\'s', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 2', 2) });

    render(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    await user.click(explain());

    expect(await screen.findByText(AI_WORDING.headline)).toBeInTheDocument();
    expect(aiBadge()).toBeInTheDocument();
    expect(callable).toHaveBeenCalledWith({ weekKey: 'Week 2' });
  });

  it('keeps its own words when the answer is about the wrong week', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 3', 3) });

    render(<CoachingRecommendation metrics={WEEK_2} context={context('Week 2')} />);
    await user.click(explain());

    await waitFor(() =>
      expect(screen.getByText(/gerade nicht verfügbar/)).toBeInTheDocument()
    );
    expect(aiWording()).toBeNull();
    // The numbers never depended on the model, so they are untouched.
    expect(screen.getByText(/1 von 3 Trainingstagen abgeschlossen \(33 %\)/)).toBeInTheDocument();
  });

  it('falls back to the metrics\' week when no context prop is supplied', async () => {
    const user = userEvent.setup();
    callable.mockResolvedValue({ data: responseFor('Week 2', 2) });

    render(<CoachingRecommendation metrics={WEEK_2} />);
    await user.click(explain());

    expect(callable).toHaveBeenCalledWith({ weekKey: 'Week 2' });
    expect(await screen.findByText(AI_WORDING.headline)).toBeInTheDocument();
  });
});

import type { ComponentProps } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/lib/i18n';
import { DayAccordion } from './DayAccordion';

// Framer Motion measures animated content with scrollTo, absent in jsdom.
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Keep this suite focused on the accordion's state and action wiring.
vi.mock('@/views/ExerciseList', () => ({
  default: ({ exercises }: { exercises: { name: string }[] }) => (
    <ul>{exercises.map((exercise, index) => <li key={index}>{exercise.name}</li>)}</ul>
  ),
}));

const makeProps = (overrides: Partial<ComponentProps<typeof DayAccordion>> = {}) => ({
  wk: 'Week 1',
  currentWeekNum: 1,
  weekProgress: { completed: 0, total: 7 },
  weekData: {},
  expandedDay: -1,
  getDateFor: (_week: string, day: number) => new Date(2026, 8, 7 + day),
  isDayCompleted: () => false,
  isDayInFuture: () => false,
  isTodayInWeekDay: () => false,
  onDayExpand: vi.fn(),
  onOpenAddExercise: vi.fn(),
  onAutoFill: vi.fn(),
  onUpdateExercise: vi.fn().mockResolvedValue(undefined),
  onDeleteExercise: vi.fn(),
  isUpdating: false,
  ...overrides,
});

describe('DayAccordion rest days', () => {
  // jsdom does not perform CSS layout. Check content/semantics here; verify
  // wrapping, clipping and target dimensions in a real browser at 320px+.
  it('renders the German note from the real locale and keeps add exercise usable', async () => {
    const user = userEvent.setup();
    const props = makeProps({ expandedDay: 0 });
    render(<DayAccordion {...props} />);

    expect(i18n.exists('workout.rest.note', { lng: 'de' })).toBe(true);
    await waitFor(() => expect(screen.getByText('Erholungstag — kein Training geplant.')).toBeVisible());
    expect(screen.queryByText('workout.rest.note')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Montag - Ruhetag' })).toHaveAttribute('aria-expanded', 'true');
    const add = screen.getByRole('button', { name: 'Übung hinzufügen' });
    expect(add).toBeVisible();
    await user.click(add);
    expect(props.onOpenAddExercise).toHaveBeenCalledTimes(1);
    expect(props.onOpenAddExercise).toHaveBeenCalledWith('Week 1', 0);
    expect(props.onDayExpand).not.toHaveBeenCalled();
  });

  it('keeps the rest-day meaning, status dot and chevron in the collapsed trigger', () => {
    render(<DayAccordion {...makeProps()} />);

    const trigger = screen.getByRole('button', { name: 'Montag - Ruhetag' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(within(trigger).getByText('Ruhetag — kein Training geplant')).toBeVisible();
    expect(within(trigger).getByLabelText('Ruhetag')).toBeVisible();
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    expect(screen.queryByText('Erholungstag — kein Training geplant.')).not.toBeInTheDocument();
  });

  it('represents today and rest day together and opens with the keyboard', async () => {
    const user = userEvent.setup();
    const props = makeProps({ isTodayInWeekDay: (_week, day) => day === 3 });
    function Harness() {
      const [expandedDay, setExpandedDay] = useState(-1);
      return <DayAccordion {...props} expandedDay={expandedDay} onDayExpand={(day) => {
        props.onDayExpand(day);
        setExpandedDay(day);
      }} />;
    }
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Donnerstag - Heute - Ruhetag' });
    expect(within(trigger).getByText('Heute')).toBeVisible();
    expect(within(trigger).getByText('Ruhetag — kein Training geplant')).toBeVisible();
    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onDayExpand).toHaveBeenCalledTimes(1);
    expect(props.onDayExpand).toHaveBeenCalledWith(3);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('Erholungstag — kein Training geplant.')).toBeVisible());
  });

  it('preserves the exercise editor pause label after nesting the rest resources', () => {
    expect(i18n.t('workout.rest.label', { lng: 'de' })).toBe('Pause');
  });
});

describe('DayAccordion training days', () => {
  it('preserves count, today, completion, expansion and training actions', async () => {
    const user = userEvent.setup();
    const props = makeProps({
      weekData: { 0: { exercises: [{ name: 'Kniebeugen' }, { name: 'Plank' }] } },
      isTodayInWeekDay: (_week, day) => day === 0,
      isDayCompleted: (_week, day) => day === 0,
    });
    const { rerender } = render(<DayAccordion {...props} />);

    const trigger = screen.getByRole('button', { name: 'Montag - Heute - 2 Übungen - abgeschlossen' });
    expect(within(trigger).getByText('Heute')).toBeVisible();
    expect(within(trigger).getByText('2 Übungen')).toBeVisible();
    expect(within(trigger).getByLabelText('Tag abgeschlossen')).toBeVisible();
    expect(trigger.querySelector('svg')).toBeInTheDocument();
    expect(within(trigger).queryByText(/Ruhetag/)).not.toBeInTheDocument();
    expect(screen.queryByText('Kniebeugen')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(props.onDayExpand).toHaveBeenCalledTimes(1);
    expect(props.onDayExpand).toHaveBeenCalledWith(0);

    rerender(<DayAccordion {...props} expandedDay={0} />);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('Kniebeugen')).toBeVisible());
    expect(screen.getByText('Plank')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Übung hinzufügen' }));
    expect(props.onOpenAddExercise).toHaveBeenCalledTimes(1);
    expect(props.onOpenAddExercise).toHaveBeenCalledWith('Week 1', 0);
    await user.click(screen.getByRole('button', { name: 'Automatisch ausfüllen' }));
    expect(props.onAutoFill).toHaveBeenCalledTimes(1);
    expect(props.onAutoFill).toHaveBeenCalledWith('Week 1', 0);
  });
});

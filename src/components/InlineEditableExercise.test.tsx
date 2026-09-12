import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise } from '@/lib/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The name popover only mounts the selector when opened; keep Firestore out of the test.
vi.mock('@/components/ExerciseSelector', () => ({
  ExerciseSelector: () => null,
  PREDEFINED_EXERCISES: [],
}));

import InlineEditableExercise from './InlineEditableExercise';

const exercise = (overrides: Partial<Exercise> & { name: string }): Exercise => ({
  sets: 3,
  reps: '10',
  ...overrides,
});

const renderExercise = (ex: Exercise) => {
  const onUpdate = vi.fn(async () => {});
  const utils = render(
    <InlineEditableExercise
      exercise={ex}
      exerciseIndex={0}
      onUpdate={onUpdate}
      onInfo={vi.fn()}
    />,
  );
  return { ...utils, onUpdate };
};

/** The parameter controls, addressed the way a user perceives them. */
const controls = (name: string) => ({
  sets: screen.queryByRole('combobox', { name: `Sätze für ${name}` }),
  reps: screen.queryByRole('combobox', { name: `Wiederholungen für ${name}` }),
  weight: screen.queryByPlaceholderText('kg'),
  rest: screen.queryByPlaceholderText('90s'),
  distance: screen.queryByPlaceholderText('5km'),
  duration: screen.queryByPlaceholderText('30min'),
});

const visibleControls = (name: string) =>
  Object.entries(controls(name))
    .filter(([, el]) => el !== null)
    .map(([field]) => field);

describe('exercises the catalogue knows by name', () => {
  it('shows the full prescription for a known strength exercise', () => {
    renderExercise(exercise({ name: 'Bankdrücken', sets: 4, reps: '8', weight: '60', rest: '120s' }));

    expect(visibleControls('Bankdrücken')).toEqual(['sets', 'reps', 'weight', 'rest']);
    expect(controls('Bankdrücken').weight).toHaveValue('60');
    expect(controls('Bankdrücken').rest).toHaveValue('120s');
  });

  it('shows distance and duration — and no strength controls — for known cardio', () => {
    renderExercise(exercise({ name: 'Laufen', description: '5km / 30min' }));

    expect(visibleControls('Laufen')).toEqual(['distance', 'duration']);
    expect(controls('Laufen').distance).toHaveValue('5');
    expect(controls('Laufen').duration).toHaveValue('30');
  });

  it('keeps known cardio cardio even when the object carries strength data', () => {
    renderExercise(
      exercise({ name: 'Radfahren', sets: 4, reps: '12', weight: '20', rest: '90s', description: '20km' }),
    );

    expect(visibleControls('Radfahren')).toEqual(['distance', 'duration']);
    expect(controls('Radfahren').distance).toHaveValue('20');
  });

  it('does not broaden a known exercise that defines fewer fields', () => {
    renderExercise(exercise({ name: 'Liegestütze', weight: '20', rest: '60s' }));

    expect(visibleControls('Liegestütze')).toEqual(['sets', 'reps']);
  });
});

describe('exercises whose name is not an exact catalogue match', () => {
  it('keeps every supplied prescription value visible and editable', () => {
    // Regression for UI02-03: this rendered name-only before the fallback existed.
    const name = 'Bankdrücken enger Griff';
    renderExercise(exercise({ name, sets: 4, reps: '8', weight: '60', rest: '120s' }));

    expect(visibleControls(name)).toEqual(['sets', 'reps', 'weight', 'rest']);
    expect(controls(name).sets).toHaveTextContent('4');
    expect(controls(name).reps).toHaveTextContent('8');
    expect(controls(name).weight).toHaveValue('60');
    expect(controls(name).rest).toHaveValue('120s');
    expect(controls(name).weight).toBeEnabled();
    expect(controls(name).rest).toBeEnabled();
  });

  it('lets the user edit a weight the catalogue never knew about', async () => {
    const user = userEvent.setup();
    const name = 'Einarmiges Kabelrudern am Seilzug';
    const { onUpdate } = renderExercise(exercise({ name, weight: '25', rest: '75s' }));

    const weight = screen.getByPlaceholderText('kg');
    await user.clear(weight);
    await user.type(weight, '30');
    await user.tab();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name, weight: '30', rest: '75s' }));
  });

  it('invents no optional fields the exercise does not carry', () => {
    const name = 'Seitheben am Kabelzug';
    renderExercise(exercise({ name, sets: 3, reps: '15' }));

    expect(visibleControls(name)).toEqual(['sets', 'reps']);
  });

  it('offers distance and duration only for a machine-written description', () => {
    const name = 'Laufen im Gelände';
    renderExercise({ name, sets: 0, reps: '', description: '5km / 30min' });

    expect(visibleControls(name)).toEqual(['distance', 'duration']);
  });

  it('leaves a prose description without controls that could overwrite it', () => {
    const name = 'Lockerer Dauerlauf';
    renderExercise({ name, sets: 0, reps: '', description: 'Locker 5 km im Grundlagenbereich laufen' });

    expect(visibleControls(name)).toEqual([]);
    expect(screen.getByText(name)).toBeInTheDocument();
  });
});

describe('rendering the fallback is read-only', () => {
  it('never writes back or mutates the exercise it was given', () => {
    const ex = exercise({ name: 'Bankdrücken enger Griff', weight: '60', rest: '120s' });
    const snapshot = structuredClone(ex);
    const { onUpdate, rerender } = renderExercise(ex);

    rerender(
      <InlineEditableExercise exercise={ex} exerciseIndex={0} onUpdate={onUpdate} onInfo={vi.fn()} />,
    );

    expect(onUpdate).not.toHaveBeenCalled();
    expect(ex).toEqual(snapshot);
  });
});

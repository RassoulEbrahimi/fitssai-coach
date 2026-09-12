import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

/*
  UI02-07 ownership regression. The nutrition tab's skeleton used to be gated
  on useWorkoutPlan().isLoading while useNutritionPlan() was destructured for
  its data alone, so nutrition loading tracked the wrong query and a failed
  nutrition fetch was indistinguishable from "no plan yet".

  The real Dashboard and the real NutritionView are mounted here; only the
  data sources and the sibling views are fixtures.
*/

const nutritionQuery = vi.hoisted(() => ({
  data: null as unknown,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
const workoutQuery = vi.hoisted(() => ({
  data: null as unknown,
  isLoading: false,
  generatePlan: vi.fn(),
  isGenerating: false,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test', id: 'test' } }) }));
vi.mock('@/hooks/queries/useProfile', () => ({ useProfile: () => ({ data: { id: 'test' }, isLoading: false, refetch: vi.fn() }) }));
vi.mock('@/hooks/queries/useWorkoutPlan', () => ({ useWorkoutPlan: () => workoutQuery }));
vi.mock('@/hooks/queries/useWorkoutLogs', () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false, toggleDay: vi.fn() }) }));
vi.mock('@/hooks/queries/useNutritionPlan', () => ({ useNutritionPlan: () => nutritionQuery }));
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({}) }));
vi.mock('@/contexts/TrainingSessionContext', () => ({
  useTrainingSession: () => ({ validateSessionAgainstPlan: vi.fn(), rejectionNotice: null, clearRejectionNotice: vi.fn() }),
}));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/views/HomeView', () => ({ default: () => <h1>Home fixture</h1> }));
vi.mock('@/views/WorkoutView', () => ({ default: () => <h1>Workout fixture</h1> }));
vi.mock('@/views/ProfileView', () => ({ default: () => <h1>Profile fixture</h1> }));

import Dashboard from '@/components/Dashboard';
import { PreferencesProvider } from '@/contexts/PreferencesContext';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import { ThemeProvider } from '@/hooks/useTheme';

const plan = {
  id: 'fixture-nutrition',
  user_id: 'test',
  content: { breakfast: [{ meal: 'Porridge', description: 'Haferflocken mit Beeren', calories: 420 }] },
};

// The nutrition view is lazy, so every assertion below waits with findBy*.
const mountNutrition = () => render(
  <ThemeProvider><PreferencesProvider><FocusModeProvider><Dashboard /></FocusModeProvider></PreferencesProvider></ThemeProvider>
);

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '#/nutrition');
  Object.assign(nutritionQuery, { data: null, isLoading: false, isError: false, refetch: vi.fn() });
  Object.assign(workoutQuery, { data: null, isLoading: false, generatePlan: vi.fn(), isGenerating: false });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '#/');
});

describe('nutrition tab query states', () => {
  it('shows the nutrition skeleton while the nutrition query loads with no data', async () => {
    nutritionQuery.isLoading = true;
    mountNutrition();

    expect(await screen.findByRole('status', { name: /Ernährungsplan wird geladen/ })).toBeInTheDocument();
    expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
  });

  it('shows an explicit error state when the nutrition query fails with no data', async () => {
    nutritionQuery.isError = true;
    mountNutrition();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Ernährungsplan konnte nicht geladen werden/);
    expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
  });

  it('retries the nutrition query only and never generates a workout plan', async () => {
    nutritionQuery.isError = true;
    mountNutrition();

    fireEvent.click(await screen.findByRole('button', { name: /Erneut versuchen/ }));

    expect(nutritionQuery.refetch).toHaveBeenCalledTimes(1);
    expect(workoutQuery.generatePlan).not.toHaveBeenCalled();
  });

  it('keeps the truthful empty state for a successful query with no plan', async () => {
    mountNutrition();

    expect(await screen.findByText(/Noch kein Ernährungsplan/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /erstellen/i })).not.toBeInTheDocument();
  });

  it('renders the plan for a successful query with data', async () => {
    nutritionQuery.data = plan;
    mountNutrition();

    expect(await screen.findByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
    expect(screen.getByText('420 kcal')).toBeInTheDocument();
  });

  it('does not let the workout query control nutrition loading', async () => {
    workoutQuery.isLoading = true;
    mountNutrition();

    // Workout plan is still loading, nutrition resolved empty: the nutrition
    // tab must report its own state, not the workout query's.
    expect(await screen.findByText(/Noch kein Ernährungsplan/)).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Ernährungsplan wird geladen/ })).not.toBeInTheDocument();
  });

  it('lets the nutrition query control nutrition loading while the workout plan is settled', async () => {
    workoutQuery.isLoading = false;
    workoutQuery.data = { id: 'fixture-plan', user_id: 'test', content: {} };
    nutritionQuery.isLoading = true;
    mountNutrition();

    expect(await screen.findByRole('status', { name: /Ernährungsplan wird geladen/ })).toBeInTheDocument();
  });

  it('keeps a cached plan visible while a refetch fails in the background', async () => {
    nutritionQuery.data = plan;
    nutritionQuery.isError = true;
    mountNutrition();

    expect(await screen.findByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

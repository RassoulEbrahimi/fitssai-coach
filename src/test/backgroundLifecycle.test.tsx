import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';

// Keep the real dashboard, navigation, focus and preference boundaries. Only
// account/data sources and view contents are fixtures for this lifecycle test.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test' } }) }));
vi.mock('@/hooks/queries/useProfile', () => ({ useProfile: () => ({ data: { id: 'test' }, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutPlan', () => ({ useWorkoutPlan: () => ({ data: null, isLoading: false }) }));
vi.mock('@/hooks/queries/useWorkoutLogs', () => ({ useWorkoutLogs: () => ({ data: [], isToggling: false }) }));
vi.mock('@/hooks/queries/useNutritionPlan', () => ({ useNutritionPlan: () => ({ data: null }) }));
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({}) }));
vi.mock('@/contexts/TrainingSessionContext', () => ({ useTrainingSession: () => ({}) }));
vi.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
vi.mock('@/views/HomeView', () => ({ default: () => <h1>Home fixture</h1> }));
vi.mock('@/views/WorkoutView', () => ({ default: () => <h1>Workout fixture</h1> }));
vi.mock('@/views/NutritionView', () => ({ default: () => <h1>Nutrition fixture</h1> }));
vi.mock('@/views/ProfileView', () => ({ default: () => <h1>Profile fixture</h1> }));

import Dashboard from '@/components/Dashboard';
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext';
import { FocusModeProvider, useFocusMode } from '@/contexts/FocusModeContext';
import { ThemeProvider } from '@/hooks/useTheme';
import { BACKGROUND_MODE_STORAGE_KEY } from '@/lib/background';

const Controls = () => {
  const { toggleFocusMode } = useFocusMode();
  const { setBackgroundMode } = usePreferences();
  return <><button onClick={toggleFocusMode}>Focus fixture</button><button onClick={() => setBackgroundMode('animated')}>Animate fixture</button></>;
};
const mount = () => render(<ThemeProvider><PreferencesProvider><FocusModeProvider><Controls /><Dashboard /></FocusModeProvider></PreferencesProvider></ThemeProvider>);
beforeEach(() => {
  localStorage.clear(); history.replaceState(null, '', '#/');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  // Drain navigation's scheduled scroll before restoring jsdom's unimplemented method.
  await new Promise(requestAnimationFrame);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '#/');
});

describe('dashboard background boundary', () => {
  it.each([null, 'static', 'animated'])('preserves background identity through all views with %s preference', async (mode) => {
    if (mode) localStorage.setItem(BACKGROUND_MODE_STORAGE_KEY, mode);
    const { container, unmount } = mount();
    await screen.findByRole('heading', { name: 'Home fixture' });
    const video = container.querySelector('video');
    for (const [hash, heading] of [['#/workout', 'Workout fixture'], ['#/nutrition', 'Nutrition fixture'], ['#/profile', 'Profile fixture'], ['#/', 'Home fixture']]) {
      act(() => { history.replaceState(null, '', hash); window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await screen.findByRole('heading', { name: heading });
      expect(container.querySelector('video')).toBe(video);
    }
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(mode === 'animated' ? 1 : 0);
    unmount();
    if (video) expect(video.hasAttribute('src')).toBe(false);
  });
  it('removes both Static and Animated backgrounds in Focus Mode and releases playback', async () => {
    const { container } = mount();
    await screen.findByRole('heading', { name: 'Home fixture' });
    fireEvent.click(screen.getByRole('button', { name: 'Focus fixture' }));
    expect(container.querySelector('[data-test-id="video-bg-root"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Focus fixture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Animate fixture' }));
    const video = container.querySelector('video')!;
    fireEvent.click(screen.getByRole('button', { name: 'Focus fixture' }));
    expect(container.querySelector('video')).toBeNull();
    expect(video.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Focus fixture' }));
    expect(container.querySelector('video')).not.toBe(video);
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });
});

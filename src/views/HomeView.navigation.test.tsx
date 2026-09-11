import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import HomeView from './HomeView';
import { InsightHero } from '@/components/dashboard/InsightHero';
import { FitssNavBar } from '@/components/FitssNavBar';
import { useAppNavigation } from '@/hooks/useAppNavigation';
import { getRouteForView, NAVIGATION_CONFIG } from '@/lib/navigation';
import { generateInsights } from '@/lib/insights/engine';
import { ThemeProvider } from '@/hooks/useTheme';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import '@/lib/i18n';

// Only data/secondary surfaces are isolated. Home, its insight engine and CTA,
// the owning navigation hook, browser router and navbar are the real components.
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({ activeDays: 0 }) }));
vi.mock('@/hooks/useTrainingNudge', () => ({ useTrainingNudge: () => ({ nudges: [], dismiss: vi.fn() }) }));
vi.mock('@/components/charts/WeeklyActivity', () => ({ WeeklyActivity: () => null }));

const profile = { id: 'fixture-only', full_name: 'Test', created_at: '2020-01-01T12:00:00Z' };
const date = new Date('2026-09-11T12:00:00Z');
const workoutPlan = { id: 'fixture-plan', user_id: profile.id, created_at: date.toISOString(), content: {} };

function DashboardHarness({ keepHero = false }: { keepHero?: boolean }) {
    const { activeView, navigateTo } = useAppNavigation();
    return <>
        <output aria-label="Current view">{activeView}</output>
        {keepHero ? <InsightHero insight={generateInsights(undefined, profile, 0, null)} onNavigate={navigateTo} /> :
            activeView === 'dashboard' ? <HomeView generatingPlans={false} workoutPlan={workoutPlan} onGeneratePlans={() => {}} profile={profile} selectedDate={date} onNavigate={navigateTo} /> :
                <h1>{NAVIGATION_CONFIG[activeView].label}</h1>}
        <FitssNavBar activeView={activeView} onChange={navigateTo} />
    </>;
}

function renderDashboard(keepHero = false) {
    return render(<ThemeProvider><FocusModeProvider><BrowserRouter basename="/fitssai-coach"><Routes>
        <Route path="/dashboard" element={<DashboardHarness keepHero={keepHero} />} />
        <Route path="*" element={<h1>404</h1>} />
    </Routes></BrowserRouter></FocusModeProvider></ThemeProvider>);
}

beforeEach(() => {
    history.replaceState(null, '', '/fitssai-coach/dashboard#/');
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => {
    // Let the navigation hook's scheduled scroll reset finish before restoring jsdom.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    vi.restoreAllMocks();
});

describe('Home insight dashboard navigation', () => {
    it('opens canonical Workout from the real Home CTA and restores Home with Back', async () => {
        renderDashboard();
        const initialLength = history.length;
        fireEvent.click(screen.getByRole('button', { name: /Los geht's/ }));
        expect(window.location.pathname).toBe('/fitssai-coach/dashboard');
        expect(window.location.hash).toBe(`#${getRouteForView('workout')}`);
        expect(screen.queryByText('404')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Current view')).toHaveTextContent('workout');
        expect(screen.getByRole('button', { name: 'Trainingsplan' })).toHaveAttribute('aria-current', 'page');
        expect(document.title).toBe(NAVIGATION_CONFIG.workout.title);
        expect(history.length).toBe(initialLength + 1);

        act(() => history.back());
        await waitFor(() => expect(screen.getByLabelText('Current view')).toHaveTextContent('dashboard'));
        expect(screen.getByRole('button', { name: /Los geht's/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
        expect(window.location.hash).toBe('#/');

        act(() => history.forward());
        await waitFor(() => expect(screen.getByLabelText('Current view')).toHaveTextContent('workout'));
        expect(screen.queryByText('404')).not.toBeInTheDocument();
    });

    it('does not add duplicate history entries when the insight is activated repeatedly', () => {
        // Keep the hero mounted to exercise the hook's same-view guard directly.
        renderDashboard(true);
        const initialLength = history.length;
        const button = screen.getByRole('button', { name: /Los geht's/ });
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.click(button);
        expect(history.length).toBe(initialLength + 1);
        expect(window.location.pathname).toBe('/fitssai-coach/dashboard');
        expect(window.location.hash).toBe(`#${getRouteForView('workout')}`);
        expect(screen.getByLabelText('Current view')).toHaveTextContent('workout');
        expect(screen.queryByText('404')).not.toBeInTheDocument();
    });
});

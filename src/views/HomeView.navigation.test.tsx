import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import HomeView from './HomeView';
import userEvent from '@testing-library/user-event';
import type { TrainingNudge } from '@/lib/nudges';
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
const nudgeState = vi.hoisted(() => ({ nudges: [] as TrainingNudge[], dismiss: vi.fn() }));
vi.mock('@/hooks/useTrainingNudge', () => ({ useTrainingNudge: () => nudgeState }));
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
    nudgeState.nudges = [];
    nudgeState.dismiss.mockClear();
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


describe('Home primary actions and hierarchy', () => {
    it('puts training, its nudge and nutrition before insight, review, activity and motivation in DOM order', async () => {
        nudgeState.nudges = [{
            type: 'planned-session-today', key: 'plan|Week 1|0|planned-session-today',
            dayKey: 'plan|Week 1|0', title: 'Heute ist eine Trainingseinheit geplant.',
            body: 'Wenn es heute für dich passt, kannst du deinen Plan öffnen.', browserDeliverable: true,
        }];
        const { container } = renderDashboard();
        await screen.findByText('— David Goggins');
        const ordered = [
            screen.getByRole('heading', { level: 1 }),
            screen.getByRole('button', { name: 'Heutiges Training' }),
            screen.getByRole('region', { name: 'Trainingshinweis' }),
            screen.getByRole('button', { name: 'Ernährung' }),
            screen.getByRole('button', { name: /Los geht's/ }),
            screen.getByRole('region', { name: 'Wochenrückblick' }),
            screen.getByRole('region', { name: /Aktivitätsübersicht/ }),
            container.querySelector('blockquote')!,
        ];
        for (let index = 1; index < ordered.length; index++) {
            expect(ordered[index - 1].compareDocumentPosition(ordered[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        const nudge = screen.getByRole('region', { name: 'Trainingshinweis' });
        fireEvent.click(within(nudge).getByRole('button', { name: 'Hinweis ausblenden' }));
        expect(nudgeState.dismiss).toHaveBeenCalledWith('plan|Week 1|0');
        fireEvent.click(within(nudge).getByRole('button', { name: 'Plan öffnen' }));
        expect(screen.getByLabelText('Current view')).toHaveTextContent('workout');
    });

    it.each([
        ['Heutiges Training', 'workout', '{Enter}'],
        ['Heutiges Training', 'workout', ' '],
        ['Ernährung', 'nutrition', '{Enter}'],
        ['Ernährung', 'nutrition', ' '],
    ])('opens %s with keyboard %s %s', async (name, destination, key) => {
        const user = userEvent.setup();
        renderDashboard();
        const action = screen.getByRole('button', { name });
        expect(action.tagName).toBe('BUTTON');
        expect(action).toHaveAccessibleDescription(name === 'Heutiges Training' ? 'Kein Plan aktiv' : 'Kein Plan');
        // Reach the action through native tab order, then activate it.
        for (let index = 0; index < 8 && document.activeElement !== action; index++) await user.tab();
        expect(action).toHaveFocus();
        await user.keyboard(key);
        expect(screen.getByLabelText('Current view')).toHaveTextContent(destination);
        expect(window.location.hash).toBe(`#${getRouteForView(destination as 'workout' | 'nutrition')}`);
    });

    it.each([['Heutiges Training', 'workout'], ['Ernährung', 'nutrition']])('opens %s on click', (name, destination) => {
        renderDashboard();
        fireEvent.click(screen.getByRole('button', { name }));
        expect(screen.getByLabelText('Current view')).toHaveTextContent(destination);
    });
});

import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InsightHero } from './InsightHero';
import { generateInsights } from '@/lib/insights/engine';
import type { Insight } from '@/lib/insights/types';

/*
  InsightHero used to route its text through `useAINudge` — a hardcoded string
  table behind a 1.5s setTimeout — and then badge the result with a sparkle
  that told the user a model had written it. Nothing in this build generates
  text, so these tests pin the honest behaviour.
*/

const insight: Insight = {
    id: 'streak-4',
    type: 'streak',
    priority: 'medium',
    title: 'Du bist on fire! 🔥',
    message: 'Schon 4 Trainingstage diese Woche. Starke Leistung!',
    icon: 'Flame',
    payload: { activeDays: 4 },
};

const renderHero = (value: Insight | null) =>
    render(
        <MemoryRouter>
            <InsightHero insight={value} />
        </MemoryRouter>
    );

describe('InsightHero', () => {
    it.each(['Los geht\'s', 'Training starten', 'Plan ansehen'])('%s delegates Workout to dashboard navigation', (actionLabel) => {
        const onNavigate = vi.fn();
        render(<MemoryRouter><InsightHero insight={{ ...insight, actionType: 'navigate', actionTarget: 'workout', actionLabel }} onNavigate={onNavigate} /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: new RegExp(actionLabel) }));
        expect(onNavigate).toHaveBeenCalledOnce();
        expect(onNavigate).toHaveBeenCalledWith('workout');
    });

    it('preserves navigation for ordinary URL actions', () => {
        const onNavigate = vi.fn();
        render(<MemoryRouter initialEntries={['/dashboard']}><Routes>
            <Route path="/dashboard" element={<InsightHero insight={{ ...insight, actionType: 'navigate', actionTarget: '/legal/privacy', actionLabel: 'Datenschutz' }} onNavigate={onNavigate} />} />
            <Route path="/legal/privacy" element={<h1>Datenschutzseite</h1>} />
            <Route path="*" element={<h1>404</h1>} />
        </Routes></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: /Datenschutz/ }));
        expect(screen.getByRole('heading', { name: 'Datenschutzseite' })).toBeInTheDocument();
        expect(onNavigate).not.toHaveBeenCalled();
        expect(screen.queryByText('404')).not.toBeInTheDocument();
    });

    it('preserves dismissal without navigation', () => {
        const onDismiss = vi.fn();
        const onNavigate = vi.fn();
        render(<MemoryRouter><InsightHero insight={generateInsights(undefined, null, 5, null)} onDismiss={onDismiss} onNavigate={onNavigate} /></MemoryRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Feiern' }));
        expect(onDismiss).toHaveBeenCalledOnce();
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it('renders the deterministic insight text verbatim', () => {
        renderHero(insight);

        expect(screen.getByText(insight.title)).toBeInTheDocument();
        expect(screen.getByText(insight.message)).toBeInTheDocument();
    });

    it('schedules no timer that swaps the text later', () => {
        // The mock nudge replaced the copy after a 1500ms setTimeout. With fake
        // timers we can advance far past that and prove nothing changes.
        vi.useFakeTimers();
        try {
            renderHero(insight);
            expect(screen.getByText(insight.title)).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(5000);
            });

            expect(screen.getByText(insight.title)).toBeInTheDocument();
            expect(screen.getByText(insight.message)).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders no AI badge or thinking indicator', () => {
        const { baseElement } = renderHero(insight);

        // The sparkle badge that claimed model authorship, and the pulsing dot
        // that stood for "AI is thinking".
        expect(baseElement.querySelector('.lucide-sparkles')).toBeNull();
        expect(baseElement.querySelector('.animate-ping')).toBeNull();
        expect(baseElement.textContent).not.toMatch(/\bKI\b/);
        expect(baseElement.textContent).not.toMatch(/\bAI\b/);
    });

    it('renders nothing without an insight', () => {
        const { container } = renderHero(null);
        expect(container).toBeEmptyDOMElement();
    });

    it('still renders what the insights engine actually produces', () => {
        // End-to-end over the real deterministic source, so the surface cannot
        // be emptied by a change to the engine without this failing.
        const produced = generateInsights({ activeDays: 4 }, null, 4, null);

        expect(produced).not.toBeNull();
        renderHero(produced);
        expect(screen.getByText(produced!.title)).toBeInTheDocument();
    });
});

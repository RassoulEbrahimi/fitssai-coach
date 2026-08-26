import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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

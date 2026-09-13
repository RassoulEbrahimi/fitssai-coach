import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import HomeView, { gogginsQuotes } from './HomeView';
import { ThemeProvider } from '@/hooks/useTheme';
import { FocusModeProvider } from '@/contexts/FocusModeContext';
import '@/lib/i18n';

// Only data/secondary surfaces are isolated; the quote card is the real one.
vi.mock('@/hooks/useWeeklyActivity', () => ({ useWeeklyActivity: () => ({ activeDays: 0 }) }));
vi.mock('@/hooks/useTrainingNudge', () => ({ useTrainingNudge: () => ({ nudges: [], dismiss: () => {} }) }));
vi.mock('@/components/charts/WeeklyActivity', () => ({ WeeklyActivity: () => null }));

const profile = { id: 'fixture-only', full_name: 'Test', created_at: '2020-01-01T12:00:00Z' };
const date = new Date('2026-09-11T12:00:00Z');
const workoutPlan = { id: 'fixture-plan', user_id: profile.id, created_at: date.toISOString(), content: {} };

function renderHome() {
    return render(<StrictMode><ThemeProvider><FocusModeProvider><BrowserRouter>
        <HomeView generatingPlans={false} workoutPlan={workoutPlan} onGeneratePlans={() => {}} profile={profile} selectedDate={date} />
    </BrowserRouter></FocusModeProvider></ThemeProvider></StrictMode>);
}

/** The rendered quote without its typographic wrapping quotes. */
function renderedQuote(container: HTMLElement) {
    const blockquote = container.querySelector('blockquote');
    expect(blockquote).not.toBeNull();
    return blockquote!.textContent!.replace(/^"|"$/g, '');
}

/** A `Skeleton` placeholder block, as MotivationSkeleton renders them. */
const SKELETON_BLOCK = '.animate-pulse.bg-muted';

/** The quote card: the wrapper holding the quote and its refresh control. */
function quoteCard() {
    return screen.getByRole('button', { name: 'Neues Zitat laden' }).parentElement!;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Home motivation quote', () => {
    it('renders a valid quote on the first render, without advancing any timer', () => {
        // Fake timers that are never advanced: a delayed quote could not appear.
        vi.useFakeTimers();
        const { container } = renderHome();
        expect(gogginsQuotes).toContain(renderedQuote(container));
        expect(screen.getByText('— David Goggins')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Neues Zitat laden' })).toBeInTheDocument();
    });

    it('does not show the quote loading skeleton', () => {
        const { container } = renderHome();
        // MotivationSkeleton is built from Skeleton blocks (pulsing muted bars); the
        // GradientCard's own decorative glow also pulses, so match the blocks exactly.
        const card = quoteCard();
        expect(card.querySelector('blockquote')).not.toBeNull();
        expect(container.querySelector(SKELETON_BLOCK)).toBeNull();
        expect(container.querySelectorAll('blockquote')).toHaveLength(1);
    });

    it('refreshes to the next drawn quote immediately and keeps the card rendered', () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const { container } = renderHome();
        expect(renderedQuote(container)).toBe(gogginsQuotes[0]);

        random.mockReturnValue(0.999);
        fireEvent.click(screen.getByRole('button', { name: 'Neues Zitat laden' }));
        expect(renderedQuote(container)).toBe(gogginsQuotes[gogginsQuotes.length - 1]);
        expect(container.querySelector(SKELETON_BLOCK)).toBeNull();
        expect(screen.getByRole('button', { name: 'Neues Zitat laden' })).toBeInTheDocument();
    });

    it.each([['Enter', '{Enter}'], ['Space', ' ']])('refreshes from the keyboard with %s and keeps focus on the control', async (_name, key) => {
        const user = userEvent.setup();
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const { container } = renderHome();
        const refresh = screen.getByRole('button', { name: 'Neues Zitat laden' });
        refresh.focus();

        random.mockReturnValue(0.999);
        await user.keyboard(key);
        expect(renderedQuote(container)).toBe(gogginsQuotes[gogginsQuotes.length - 1]);
        expect(refresh).toHaveFocus();
        expect(container.querySelector(SKELETON_BLOCK)).toBeNull();
    });

    it('keeps the quote stable across unrelated rerenders', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const { container, rerender } = renderHome();
        random.mockReturnValue(0.999);
        rerender(<StrictMode><ThemeProvider><FocusModeProvider><BrowserRouter>
            <HomeView generatingPlans={false} workoutPlan={workoutPlan} onGeneratePlans={() => {}} profile={profile} selectedDate={new Date(date)} />
        </BrowserRouter></FocusModeProvider></ThemeProvider></StrictMode>);
        expect(renderedQuote(container)).toBe(gogginsQuotes[0]);
    });

    it('does not reintroduce an artificial quote loading state or timer', () => {
        const source = readFileSync(resolve(__dirname, 'HomeView.tsx'), 'utf8');
        expect(source).not.toMatch(/isLoadingQuote|MotivationSkeleton/);
        expect(source).not.toMatch(/setTimeout\s*\(/);
    });
});

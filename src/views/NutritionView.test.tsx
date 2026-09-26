import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/lib/i18n';
import NutritionView from './NutritionView';
import { toLegacyNutritionPlan } from '@/lib/nutrition/legacy';

/*
  Nutrition is read-only. Its empty state used to carry a "Pläne jetzt
  erstellen" button wired — via Dashboard — to the *workout* plan generator,
  which itself only threw AI_UNAVAILABLE.

  NUT-04: a stored legacy document reaches this view only through the legacy
  adapter, and its content is rendered by LegacyNutritionPlanView.
*/

const legacyNutritionPlan = toLegacyNutritionPlan('legacy-1', {
    content: {
        Montag: [
            { meal: 'Frühstück', description: 'Haferflocken mit Beeren', calories: 420 },
        ],
    },
});

const legacyContent = (container: HTMLElement) =>
    container.querySelector('[data-testid="legacy-nutrition-plan"]');

describe('NutritionView', () => {
    it('renders a plan when one exists', () => {
        render(<NutritionView legacyNutritionPlan={legacyNutritionPlan} />);

        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
    });

    it('renders a legacy document through the legacy compatibility component', () => {
        const { container } = render(<NutritionView legacyNutritionPlan={legacyNutritionPlan} />);

        const legacy = legacyContent(container);
        expect(legacy).not.toBeNull();
        expect(legacy).toHaveTextContent(/Haferflocken mit Beeren/);
        expect(legacy).toHaveTextContent('420 kcal');
    });

    it('renders no legacy compatibility content without a legacy document', () => {
        const states = [{}, { isLoading: true }, { isError: true, onRetry: () => {} }];
        for (const state of states) {
            const { container, unmount } = render(<NutritionView legacyNutritionPlan={null} {...state} />);
            expect(legacyContent(container)).toBeNull();
            unmount();
        }
    });

    it('does not crash on a malformed legacy document and shows what is displayable', () => {
        const malformed = toLegacyNutritionPlan('legacy-2', {
            content: {
                breakfast: 'not a list',
                lunch: [null, 7, ['nested'], { meal: { nested: true }, description: ['x'], calories: { kcal: 1 } }],
                dinner: [{ meal: 'Linsen-Dal', calories: { kcal: 500 } }],
                constructor: [{ meal: 'Reis', description: 'mit Gemüse', calories: '300' }],
            },
        });

        const { container } = render(<NutritionView legacyNutritionPlan={malformed} />);

        const legacy = legacyContent(container);
        expect(legacy).toHaveTextContent('Linsen-Dal');
        expect(legacy).toHaveTextContent('Abendessen');
        // Unknown bucket names keep their stored key as the label.
        expect(legacy).toHaveTextContent('constructor');
        expect(legacy).toHaveTextContent('300 kcal');
        // Malformed buckets and items are left out, never shown as headings.
        expect(legacy).not.toHaveTextContent('Frühstück');
        expect(legacy).not.toHaveTextContent('Mittagessen');
        // A calorie value that cannot be shown gets no badge.
        expect(screen.getAllByText(/kcal/)).toHaveLength(1);
    });

    it('does not crash on a legacy document with no content', () => {
        for (const data of [{}, { content: null }, null, 'garbage']) {
            const { container, unmount } = render(
                <NutritionView legacyNutritionPlan={toLegacyNutritionPlan('legacy-3', data)} />
            );
            expect(legacyContent(container)).not.toBeNull();
            expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
            unmount();
        }
    });

    it('keeps known meal buckets in chronological order', () => {
        const ordered = toLegacyNutritionPlan('legacy-4', {
            content: {
                extra: [{ meal: 'Shake', description: '' }],
                dinner: [{ meal: 'Suppe', description: '' }],
                breakfast: [{ meal: 'Müsli', description: '' }],
                lunch: [{ meal: 'Salat', description: '' }],
            },
        });

        render(<NutritionView legacyNutritionPlan={ordered} />);

        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
            'Frühstück', 'Mittagessen', 'Abendessen', 'extra',
        ]);
    });

    it('shows a truthful empty state that promises no generation', () => {
        const { baseElement } = render(<NutritionView legacyNutritionPlan={null} />);

        expect(screen.getByText(/Noch kein Ernährungsplan/)).toBeInTheDocument();
        expect(baseElement.textContent).not.toMatch(/Generiere/i);
        expect(baseElement.textContent).not.toMatch(/erstellen/i);
    });

    it('offers no generation control', () => {
        const { baseElement } = render(<NutritionView legacyNutritionPlan={null} />);

        expect(baseElement.querySelectorAll('button')).toHaveLength(0);
    });

    it('shows the nutrition skeleton while the nutrition query is loading with no data', () => {
        render(<NutritionView legacyNutritionPlan={null} isLoading />);

        expect(screen.getByRole('status', { name: /Ernährungsplan wird geladen/ })).toBeInTheDocument();
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
        expect(screen.queryByText(/konnte nicht geladen werden/)).not.toBeInTheDocument();
    });

    it('distinguishes a failed nutrition query from "no plan exists"', () => {
        render(<NutritionView legacyNutritionPlan={null} isError />);

        expect(screen.getByRole('alert')).toHaveTextContent(/Ernährungsplan konnte nicht geladen werden/);
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
    });

    it('retries the nutrition query only', () => {
        const onRetry = vi.fn();
        render(<NutritionView legacyNutritionPlan={null} isError onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('promises no generation in the error state', () => {
        const { baseElement } = render(<NutritionView legacyNutritionPlan={null} isError onRetry={() => {}} />);

        expect(baseElement.textContent).not.toMatch(/Generiere/i);
        expect(baseElement.textContent).not.toMatch(/erstellen/i);
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('keeps a usable plan visible during a background refetch or a failed refresh', () => {
        const { rerender } = render(<NutritionView legacyNutritionPlan={legacyNutritionPlan} isLoading />);
        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();

        rerender(<NutritionView legacyNutritionPlan={legacyNutritionPlan} isError onRetry={() => {}} />);

        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
    });
});

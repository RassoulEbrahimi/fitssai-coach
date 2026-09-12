import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/lib/i18n';
import NutritionView from './NutritionView';
import type { NutritionPlan } from '@/lib/types';

/*
  Nutrition is read-only. Its empty state used to carry a "Pläne jetzt
  erstellen" button wired — via Dashboard — to the *workout* plan generator,
  which itself only threw AI_UNAVAILABLE.
*/

const plan: NutritionPlan = {
    content: {
        Montag: [
            { meal: 'Frühstück', description: 'Haferflocken mit Beeren', calories: 420 },
        ],
    },
};

describe('NutritionView', () => {
    it('renders a plan when one exists', () => {
        render(<NutritionView nutritionPlan={plan} />);

        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
    });

    it('shows a truthful empty state that promises no generation', () => {
        const { baseElement } = render(<NutritionView nutritionPlan={null} />);

        expect(screen.getByText(/Noch kein Ernährungsplan/)).toBeInTheDocument();
        expect(baseElement.textContent).not.toMatch(/Generiere/i);
        expect(baseElement.textContent).not.toMatch(/erstellen/i);
    });

    it('offers no generation control', () => {
        const { baseElement } = render(<NutritionView nutritionPlan={null} />);

        expect(baseElement.querySelectorAll('button')).toHaveLength(0);
    });

    it('shows the nutrition skeleton while the nutrition query is loading with no data', () => {
        render(<NutritionView nutritionPlan={null} isLoading />);

        expect(screen.getByRole('status', { name: /Ernährungsplan wird geladen/ })).toBeInTheDocument();
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
        expect(screen.queryByText(/konnte nicht geladen werden/)).not.toBeInTheDocument();
    });

    it('distinguishes a failed nutrition query from "no plan exists"', () => {
        render(<NutritionView nutritionPlan={null} isError />);

        expect(screen.getByRole('alert')).toHaveTextContent(/Ernährungsplan konnte nicht geladen werden/);
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
    });

    it('retries the nutrition query only', () => {
        const onRetry = vi.fn();
        render(<NutritionView nutritionPlan={null} isError onRetry={onRetry} />);

        fireEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('promises no generation in the error state', () => {
        const { baseElement } = render(<NutritionView nutritionPlan={null} isError onRetry={() => {}} />);

        expect(baseElement.textContent).not.toMatch(/Generiere/i);
        expect(baseElement.textContent).not.toMatch(/erstellen/i);
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('keeps a usable plan visible during a background refetch or a failed refresh', () => {
        const { rerender } = render(<NutritionView nutritionPlan={plan} isLoading />);
        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();

        rerender(<NutritionView nutritionPlan={plan} isError onRetry={() => {}} />);

        expect(screen.getByText(/Haferflocken mit Beeren/)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText(/Noch kein Ernährungsplan/)).not.toBeInTheDocument();
    });
});

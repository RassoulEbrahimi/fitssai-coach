import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});

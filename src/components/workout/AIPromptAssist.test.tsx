import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AIPromptAssist } from './AIPromptAssist';

/*
  This surface used to run an 823-line generation flow whose entry point threw
  AI_UNAVAILABLE on its first line: a focus picker, a prompt form, an
  "analysing" step on a 1800ms timer and a success overlay, all leading to an
  error toast. These tests pin the honest replacement.
*/

describe('AIPromptAssist', () => {
    it('states plainly that KI suggestions are unavailable', () => {
        render(<AIPromptAssist />);

        expect(
            screen.getByText(/KI-Vorschläge sind noch nicht verfügbar/i)
        ).toBeInTheDocument();
    });

    it('points at manual entry as the working alternative', () => {
        render(<AIPromptAssist />);

        expect(screen.getByText(/Manuell hinzufügen/)).toBeInTheDocument();
    });

    it('offers no control that would start a generation', () => {
        const { baseElement } = render(<AIPromptAssist />);

        expect(baseElement.querySelectorAll('button')).toHaveLength(0);
        expect(baseElement.querySelectorAll('input, textarea')).toHaveLength(0);
    });

    it('simulates no thinking or loading state', () => {
        // The old flow waited 1800ms on a timer before failing.
        vi.useFakeTimers();
        try {
            const { baseElement } = render(<AIPromptAssist />);

            act(() => {
                vi.advanceTimersByTime(5000);
            });

            expect(baseElement.querySelector('.animate-spin')).toBeNull();
            expect(baseElement.querySelector('.animate-ping')).toBeNull();
            expect(baseElement.textContent).not.toMatch(/analysiere|wird generiert|denkt nach/i);
            // Still the same honest message, not a result.
            expect(baseElement.textContent).toMatch(/noch nicht verfügbar/i);
        } finally {
            vi.useRealTimers();
        }
    });

    it('takes no generation callbacks at all', () => {
        // A props-free component cannot be handed an onGenerate that throws.
        expect(AIPromptAssist).toHaveLength(0);
    });

    it('uses German copy only', () => {
        const { baseElement } = render(<AIPromptAssist />);

        expect(baseElement.textContent).not.toMatch(/Generate|Loading|Suggestion/i);
    });
});

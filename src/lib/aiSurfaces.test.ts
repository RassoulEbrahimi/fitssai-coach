import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source-level guards for the AI honesty cleanup.
 *
 * These assert over the repository itself, because what is being protected is
 * the *absence* of things: a feedback button whose only backend threw, a
 * simulated generation flow, and Supabase-era modules that nothing imported.
 * A rendering test cannot show that such a surface is gone for good.
 */

const SRC = join(process.cwd(), 'src');

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
    });

/**
 * Comments legitimately name the removed symbols to record why they went, so
 * the guards below scan code only.
 */
const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const allSources = sourceFiles(SRC);
const readAll = () =>
    allSources.map((f) => ({ file: f, text: stripComments(readFileSync(f, 'utf-8')) }));

describe('removed AI modules', () => {
    const removed = [
        'integrations/supabase/types.ts',
        'integrations/supabase/ai_adaptation.ts',
        'integrations/supabase/tables/ai_feedback.ts',
        'lib/adaptivePrompt.ts',
        'hooks/useAINudge.tsx',
        'components/feedback/WorkoutFeedbackCard.tsx',
        'lib/prompt/contextBuilder.ts',
        'hooks/useWorkoutContext.tsx',
        'components/ui/AdaptiveHint.tsx',
        'components/ui/AISuccessOverlay.tsx',
        'components/workout/SmartFocusBar.tsx',
        'components/workout/InlineEditableText.tsx',
    ];

    it.each(removed)('%s no longer exists', (relative) => {
        expect(existsSync(join(SRC, relative))).toBe(false);
    });

    const symbols = [
        'useAINudge',
        'saveAIFeedback',
        'WorkoutFeedbackCard',
        'buildAdaptivePrompt',
        'getUserFeedbackSummary',
        'buildContextAwarePrompt',
        'useWorkoutContext',
        'AISuccessOverlay',
        'SmartFocusBar',
    ];

    it.each(symbols)('%s is imported by nothing', (symbol) => {
        const users = readAll()
            // The guard list in this very file names them on purpose.
            .filter(({ file }) => !file.endsWith('aiSurfaces.test.ts'))
            .filter(({ text }) => new RegExp(`\\b${symbol}\\b`).test(text))
            .map(({ file }) => file);

        expect(users).toEqual([]);
    });
});

describe('no always-throwing AI paths remain', () => {
    it('AI_UNAVAILABLE is not thrown from a live UI component', () => {
        const offenders = readAll()
            .filter(({ file }) => /components|views/.test(file))
            .filter(({ text }) => /AI_UNAVAILABLE/.test(text))
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('Nutrition is not wired to workout-plan generation', () => {
        const dashboard = stripComments(
            readFileSync(join(SRC, 'components/Dashboard.tsx'), 'utf-8')
        );
        const nutritionBlock = dashboard.slice(
            dashboard.indexOf('<NutritionView'),
            dashboard.indexOf('/>', dashboard.indexOf('<NutritionView'))
        );

        expect(nutritionBlock).not.toMatch(/onGeneratePlans/);
        expect(nutritionBlock).not.toMatch(/generatePlan/);
    });

    it('NutritionView declares no generation props', () => {
        const view = stripComments(readFileSync(join(SRC, 'views/NutritionView.tsx'), 'utf-8'));

        expect(view).not.toMatch(/onGeneratePlans/);
        expect(view).not.toMatch(/isGenerating/);
    });
});

describe("no fabricated workout duration", () => {
    it('the activity calculation contains no MINUTES_PER_EXERCISE constant', () => {
        const hook = stripComments(
            readFileSync(join(SRC, 'hooks/useWeeklyActivity.tsx'), 'utf-8')
        );

        expect(hook).not.toMatch(/MINUTES_PER_EXERCISE/);
    });

    it('no source multiplies a count by a per-exercise minute constant', () => {
        /*
          Guards the shape of the old bug rather than its name: a constant
          number of minutes applied per exercise or per log. Renaming the
          constant would not get past this.
        */
        const offenders = readAll()
            .filter(({ file }) => !file.endsWith('aiSurfaces.test.ts'))
            .filter(({ text }) =>
                /(MINUTES|MINUTEN)_PER_(EXERCISE|WORKOUT|LOG|SET)/i.test(text) ||
                /minutes\s*\+=\s*\d/i.test(text) ||
                /\bestimatedMinutes\b/i.test(text)
            )
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('weekly activity sums a measured duration instead', () => {
        const hook = stripComments(
            readFileSync(join(SRC, 'hooks/useWeeklyActivity.tsx'), 'utf-8')
        );

        expect(hook).toMatch(/readDurationSec/);
        expect(hook).toMatch(/measuredMinutes/);
    });
});

describe("new log writes carry a calendar day", () => {
    it.each([
        ['hooks/useSetTracking.tsx', 'set-parent logs'],
        ['lib/offlineHandlers.ts', 'offline set replay'],
        ['lib/sessionRecord.ts', 'session duration'],
    ])('%s writes workoutDay', (relative) => {
        const source = stripComments(readFileSync(join(SRC, relative), 'utf-8'));

        expect(source).toMatch(/workoutDay/);
    });

    it('the session record writes a duration but never a completion claim', () => {
        const source = stripComments(readFileSync(join(SRC, 'lib/sessionRecord.ts'), 'utf-8'));

        expect(source).toMatch(/durationSec/);
        expect(source).not.toMatch(/completed:\s*true/);
    });
});

describe("landing copy claims no active AI backend", () => {
    interface LandingMessages {
        features?: {
            title?: string;
            description?: string;
            aiPlans?: { title?: string; description?: string };
        };
    }

    const messages = JSON.parse(
        readFileSync(join(SRC, 'messages/de.json'), 'utf-8')
    ) as LandingMessages;

    const landingCopy = [
        messages.features?.title,
        messages.features?.description,
        messages.features?.aiPlans?.title,
        messages.features?.aiPlans?.description,
    ].filter((value): value is string => typeof value === 'string');

    it('has copy to check', () => {
        expect(landingCopy.length).toBeGreaterThan(0);
    });

    it.each(landingCopy)('%s makes no present-tense AI capability claim', (copy) => {
        // "Powered by fortschrittlicher KI" and "Fortschrittliche KI analysiert
        // dein Profil …" both described a model that does not exist.
        expect(copy).not.toMatch(/Powered by/i);
        expect(copy).not.toMatch(/KI\s+analysiert/i);
        expect(copy).not.toMatch(/fortschrittlicher\s+KI/i);
        expect(copy).not.toMatch(/KI-gestützte\s+Pläne/i);
    });
});

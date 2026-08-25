import { describe, it, expect } from 'vitest';
import { getWorkoutWeekDay, getWorkoutDate, PLAN_WEEKS } from './workoutDateUtils';
import { addDays } from 'date-fns';

describe('workoutDateUtils', () => {
    const planStartDate = '2025-11-01T00:00:00.000Z'; // Saturday, Nov 1st 2025

    it('should identify Week 1 correctly', () => {
        const date = new Date(planStartDate);
        const { weekKey } = getWorkoutWeekDay(planStartDate, date);
        expect(weekKey).toBe('Week 1');
    });

    it('should identify Week 4 correctly', () => {
        // 3 weeks (21 days) after plan start
        const date = addDays(new Date(planStartDate), 21);
        const { weekKey } = getWorkoutWeekDay(planStartDate, date);
        expect(weekKey).toBe('Week 4');
    });

    /*
     * This test previously asserted the *old* broken behaviour: it expected a
     * date five weeks out to clamp to "Week 4" while the code actually
     * returned "Week 6", so it failed permanently. PR6 makes the four-week
     * programme explicit — a date past Week 4 is out of the plan, and the
     * week key never exceeds the plan length.
     */
    it('does not report a week beyond the four-week plan', () => {
        const date = addDays(new Date(planStartDate), 35); // would be "Week 6"
        const { weekKey, weekNumber, isAfterPlan } = getWorkoutWeekDay(planStartDate, date);

        expect(weekKey).toBe('Week 4');
        expect(isAfterPlan).toBe(true);
        expect(weekNumber).toBeGreaterThan(PLAN_WEEKS);
    });

    it('does not report a week beyond the plan for a very old plan', () => {
        const date = addDays(new Date(planStartDate), 43 * 7);
        const { weekKey, isAfterPlan } = getWorkoutWeekDay(planStartDate, date);

        expect(weekKey).toBe('Week 4');
        expect(isAfterPlan).toBe(true);
    });

    it('flags dates before the plan start', () => {
        const date = addDays(new Date(planStartDate), -10);
        const { isBeforeStart, dayIndex } = getWorkoutWeekDay(planStartDate, date);

        expect(isBeforeStart).toBe(true);
        // Day index stays in range instead of going negative.
        expect(dayIndex).toBeGreaterThanOrEqual(0);
        expect(dayIndex).toBeLessThanOrEqual(6);
    });

    it('round-trips a week/day back to the same date', () => {
        const original = getWorkoutDate(planStartDate, 'Week 3', 4);
        const { weekKey, dayIndex } = getWorkoutWeekDay(planStartDate, original);

        expect(weekKey).toBe('Week 3');
        expect(dayIndex).toBe(4);
    });
});

import { describe, it, expect } from 'vitest';
import { getWorkoutWeekDay, getWorkoutDate } from './workoutDateUtils';
import { addDays, format } from 'date-fns';

describe('workoutDateUtils', () => {
    const planStartDate = '2025-11-01T00:00:00.000Z'; // Saturday, Nov 1st 2025

    it('should identify Week 1 correctly', () => {
        // Nov 1 is a Saturday. Plan starts nearest Monday? 
        // Actually getPlanStartMonday uses startOfWeek.
        // Nov 1 is Saturday. If week starts Monday, then Mon Oct 27 is start of that week?
        // Let's check the date logic.
        // If we pass a date in the first week, it should be Week 1.

        // Let's testing a date 2 days after plan start
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

    it('should currently CLAMP to Week 4 for dates in Week 6 (Reproduce Bug)', () => {
        // 5 weeks (35 days) after plan start = Week 6
        const date = addDays(new Date(planStartDate), 35);
        const { weekKey } = getWorkoutWeekDay(planStartDate, date);
        // CURRENT BUGGY BEHAVIOR: expects 'Week 4' because of clamping
        // DESIRED BEHAVIOR (after fix): 'Week 6'
        expect(weekKey).toBe('Week 4');
    });
});

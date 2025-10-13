import { useState, useEffect } from "react";
import { getBerlinToday, getBerlinNow, TARGET_TIMEZONE } from "@/lib/dateUtils";
import { toZonedTime } from "date-fns-tz";
import { addDays, startOfDay } from "date-fns";
import { logEvent } from "@/lib/telemetryClient";

/**
 * Hook that provides reactive "today" in Berlin timezone
 * Automatically updates at midnight Berlin time
 */
export const useBerlinToday = () => {
  const [today, setToday] = useState(getBerlinToday());

  useEffect(() => {
    const updateToday = () => {
      const newToday = getBerlinToday();
      setToday(newToday);
      
      // Log telemetry event for midnight rollover
      logEvent("midnight_rollover", { 
        newToday,
        timezone: TARGET_TIMEZONE,
        timestamp: new Date().toISOString()
      });
      
      console.log(`[useBerlinToday] Midnight rollover detected, new today: ${newToday}`);
    };

    // Calculate milliseconds until next midnight in Berlin timezone
    const calculateMsUntilBerlinMidnight = () => {
      const nowBerlin = getBerlinNow();
      
      // Get start of next day in Berlin
      const tomorrowBerlin = addDays(startOfDay(nowBerlin), 1);
      
      // Calculate difference between now and tomorrow midnight (both in local representation)
      const nowUtc = new Date();
      const msUntilMidnight = tomorrowBerlin.getTime() - nowUtc.getTime();
      
      console.log(`[useBerlinToday] Time until next Berlin midnight: ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
      
      return Math.max(0, msUntilMidnight);
    };

    const msUntilMidnight = calculateMsUntilBerlinMidnight();

    // Set timeout to fire at Berlin midnight
    const midnightTimer = setTimeout(() => {
      updateToday();
      
      // After first midnight rollover, set up recurring daily updates
      // Use setInterval for subsequent days (every 24 hours)
      const dailyInterval = setInterval(() => {
        updateToday();
      }, 24 * 60 * 60 * 1000);

      // Return cleanup for the interval (handled by outer cleanup)
      return () => clearInterval(dailyInterval);
    }, msUntilMidnight);

    // Cleanup function
    return () => {
      clearTimeout(midnightTimer);
    };
  }, []);

  return today;
};

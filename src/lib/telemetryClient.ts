import { supabase } from '@/integrations/supabase/client';

interface TelemetryEvent {
  eventName: string;
  timestamp: string;
  userId?: string;
  payload?: any;
}

interface TelemetryError {
  error: string;
  context?: string;
  timestamp: string;
  userId?: string;
  stack?: string;
}

interface TelemetryRetry {
  eventName: string;
  attempt: number;
  delay: number;
  timestamp: string;
  userId?: string;
}

// Fire-and-forget logging to console
const sendToConsole = (type: string, data: any) => {
  console.log(`[Telemetry:${type}]`, JSON.stringify(data, null, 2));
};

// Optional: Save to Supabase (non-blocking)
const saveToSupabase = async (logType: string, data: any) => {
  try {
    // Uncomment when telemetry_logs table is created:
    // await supabase.from('telemetry_logs').insert({
    //   log_type: logType,
    //   data,
    //   created_at: new Date().toISOString(),
    // });
  } catch (error) {
    // Silent fail - don't let telemetry break the app
  }
};

// Get user ID asynchronously without blocking
const getUserId = async (): Promise<string | undefined> => {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id;
  } catch {
    return undefined;
  }
};

/**
 * Log a user event (e.g., week switch, exercise toggle, cache hit, prefetch)
 * Fire-and-forget - does not block UI rendering
 */
export const logEvent = (eventName: string, payload?: object) => {
  // Fire-and-forget async operation
  Promise.resolve().then(async () => {
    const userId = await getUserId();
    
    const event: TelemetryEvent = {
      eventName,
      timestamp: new Date().toISOString(),
      userId,
      payload,
    };
    
    sendToConsole('Event', event);
    
    // Special handling for cache/prefetch events
    if (eventName === 'cache_hit' || eventName === 'prefetch_week' || eventName === 'offline_fallback') {
      console.log(`[Telemetry:${eventName.toUpperCase()}]`, payload);
    }
    
    saveToSupabase('event', event).catch(() => {});
  });
};

/**
 * Log an error with context
 * Fire-and-forget - does not block UI rendering
 */
export const logError = (error: any, context?: string) => {
  Promise.resolve().then(async () => {
    const userId = await getUserId();
    
    const errorLog: TelemetryError = {
      error: error?.message || String(error),
      context,
      timestamp: new Date().toISOString(),
      userId,
      stack: error?.stack,
    };
    
    sendToConsole('Error', errorLog);
    saveToSupabase('error', errorLog).catch(() => {});
  });
};

/**
 * Log a retry attempt with exponential backoff info
 * Fire-and-forget - does not block UI rendering
 */
export const logRetry = (eventName: string, attempt: number, delay: number) => {
  Promise.resolve().then(async () => {
    const userId = await getUserId();
    
    const retryLog: TelemetryRetry = {
      eventName,
      attempt,
      delay,
      timestamp: new Date().toISOString(),
      userId,
    };
    
    sendToConsole('Retry', retryLog);
    saveToSupabase('retry', retryLog).catch(() => {});
  });
};

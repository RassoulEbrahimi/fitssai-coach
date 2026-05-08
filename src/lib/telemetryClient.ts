import { auth } from "@/lib/firebase";

interface TelemetryEvent  { eventName: string; timestamp: string; userId?: string; payload?: any; }
interface TelemetryError  { error: string; context?: string; timestamp: string; userId?: string; stack?: string; }
interface TelemetryRetry  { eventName: string; attempt: number; delay: number; timestamp: string; userId?: string; }

const log = (type: string, data: any) =>
  console.log(`[Telemetry:${type}]`, JSON.stringify(data, null, 2));

const userId = () => auth.currentUser?.uid;

export const logEvent = (eventName: string, payload?: object) => {
  Promise.resolve().then(() => {
    const ev: TelemetryEvent = { eventName, timestamp: new Date().toISOString(), userId: userId(), payload };
    log("Event", ev);
    if (["cache_hit","prefetch_week","offline_fallback"].includes(eventName))
      console.log(`[Telemetry:${eventName.toUpperCase()}]`, payload);
  });
};

export const logError = (error: any, context?: string) => {
  Promise.resolve().then(() => {
    const ev: TelemetryError = { error: error?.message || String(error), context,
      timestamp: new Date().toISOString(), userId: userId(), stack: error?.stack };
    log("Error", ev);
  });
};

export const logRetry = (eventName: string, attempt: number, delay: number) => {
  Promise.resolve().then(() => {
    const ev: TelemetryRetry = { eventName, attempt, delay, timestamp: new Date().toISOString(), userId: userId() };
    log("Retry", ev);
  });
};

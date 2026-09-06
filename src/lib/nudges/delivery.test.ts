import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NUDGE_RECORD_STORAGE_KEY,
  emptyNudgeRecord,
  isBrowserNotificationSupported,
  isNudgeDelivered,
  isNudgeDismissed,
  markNudgeDelivered,
  markNudgeDismissed,
  persistNudgeRecord,
  pruneNudgeRecord,
  readNotificationChannelState,
  readNudgeRecord,
  requestNotificationPermission,
  showBrowserNudge,
} from "./delivery";
import type { TrainingNudge } from "./eligibility";

/*
  Delivery, tested against the two things that can actually go wrong: claiming
  a capability the browser does not have, and showing the same reminder twice.

  jsdom ships no Notifications API, which is the honest default here — the
  "unsupported" path is what a browser without it really produces, rather than
  something mocked into existence.
*/

const nudge: TrainingNudge = {
  type: "planned-session-today",
  key: "plan-1|Week 1|0|planned-session-today",
  dayKey: "plan-1|Week 1|0",
  title: "Heute ist eine Trainingseinheit geplant.",
  body: "Wenn es heute für dich passt, kannst du deinen Plan öffnen.",
  browserDeliverable: true,
};

/** Install a Notification double with a given permission. */
const stubNotification = (
  permission: NotificationPermission,
  requestPermission = vi.fn(async () => permission)
) => {
  const constructor = vi.fn();
  const Notification = function (this: unknown, title: string, options?: NotificationOptions) {
    constructor(title, options);
  } as unknown as typeof window.Notification;
  (Notification as unknown as { permission: NotificationPermission }).permission = permission;
  (Notification as unknown as { requestPermission: unknown }).requestPermission = requestPermission;
  Object.defineProperty(window, "Notification", {
    value: Notification,
    configurable: true,
    writable: true,
  });
  return { constructor, requestPermission };
};

const removeNotification = () => {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "Notification");
};

beforeEach(() => {
  localStorage.clear();
  removeNotification();
});

afterEach(() => {
  removeNotification();
  vi.restoreAllMocks();
});

describe("notification capability", () => {
  it("reports unsupported where the API does not exist", () => {
    expect(isBrowserNotificationSupported()).toBe(false);
    expect(readNotificationChannelState()).toBe("unsupported");
  });

  it("reports the browser's own permission, never a cached one", () => {
    stubNotification("granted");
    expect(readNotificationChannelState()).toBe("granted");

    // The user revoked it in browser settings; the next read must say so.
    stubNotification("default");
    expect(readNotificationChannelState()).toBe("default");
  });

  it("reports denied as denied", () => {
    stubNotification("denied");
    expect(readNotificationChannelState()).toBe("denied");
  });
});

describe("permission request", () => {
  it("asks the browser when the state is still unanswered", async () => {
    const { requestPermission } = stubNotification("default", vi.fn(async () => "granted"));

    await expect(requestNotificationPermission()).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not ask again once the user has denied", async () => {
    // Re-prompting a denial is the nagging this feature must not do.
    const { requestPermission } = stubNotification("denied");

    await expect(requestNotificationPermission()).resolves.toBe("denied");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not ask where notifications are unsupported", async () => {
    await expect(requestNotificationPermission()).resolves.toBe("unsupported");
  });
});

describe("showing a browser nudge", () => {
  it("shows nothing without permission", async () => {
    stubNotification("denied");
    await expect(showBrowserNudge(nudge)).resolves.toBe(false);

    stubNotification("default");
    await expect(showBrowserNudge(nudge)).resolves.toBe(false);
  });

  it("shows nothing where the API is unsupported", async () => {
    await expect(showBrowserNudge(nudge)).resolves.toBe(false);
  });

  it("prefers the service-worker registration when one is available", async () => {
    stubNotification("granted");
    const showNotification = vi.fn(async () => {});

    await expect(
      showBrowserNudge(nudge, { getRegistration: async () => ({ showNotification }) })
    ).resolves.toBe(true);

    expect(showNotification).toHaveBeenCalledWith(nudge.title, expect.objectContaining({
      body: nudge.body,
      // Tagged by training day, not by wording, so a re-show replaces instead
      // of stacking a second reminder for the same session.
      tag: nudge.dayKey,
    }));
  });

  it("falls back to the constructor when there is no registration", async () => {
    stubNotification("granted");
    const createNotification = vi.fn();

    await expect(
      showBrowserNudge(nudge, { getRegistration: async () => null, createNotification })
    ).resolves.toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it("reports failure instead of throwing when the platform refuses", async () => {
    // Android Chrome throws on `new Notification()`; the app must survive it.
    stubNotification("granted");

    await expect(
      showBrowserNudge(nudge, {
        getRegistration: async () => {
          throw new Error("no worker");
        },
        createNotification: () => {
          throw new TypeError("Illegal constructor");
        },
      })
    ).resolves.toBe(false);
  });
});

describe("the per-device nudge record", () => {
  it("starts empty and remembers a delivery", () => {
    const record = markNudgeDelivered(emptyNudgeRecord(), nudge.key, "2025-01-06");

    expect(isNudgeDelivered(record, nudge.key)).toBe(true);
    expect(isNudgeDismissed(record, nudge.key)).toBe(false);
  });

  it("survives a reload, so the same day is not nudged twice", () => {
    persistNudgeRecord(markNudgeDelivered(readNudgeRecord(), nudge.key, "2025-01-06"));

    expect(isNudgeDelivered(readNudgeRecord(), nudge.key)).toBe(true);
  });

  it("remembers a dismissal separately from a delivery", () => {
    const record = markNudgeDismissed(emptyNudgeRecord(), nudge.key, "2025-01-06");

    expect(isNudgeDismissed(record, nudge.key)).toBe(true);
    expect(isNudgeDelivered(record, nudge.key)).toBe(false);
  });

  it("does not suppress the next training day", () => {
    const record = markNudgeDelivered(emptyNudgeRecord(), nudge.key, "2025-01-06");
    const tomorrow = "plan-1|Week 1|2|planned-session-today";

    expect(isNudgeDelivered(record, tomorrow)).toBe(false);
  });

  it("drops entries from past days rather than growing forever", () => {
    const stale = markNudgeDelivered(emptyNudgeRecord(), "old", "2025-01-01");
    const pruned = pruneNudgeRecord(markNudgeDelivered(stale, nudge.key, "2025-01-06"), "2025-01-06");

    expect(Object.keys(pruned.delivered)).toEqual([nudge.key]);
  });

  it("treats unreadable storage as no memory at all", () => {
    localStorage.setItem(NUDGE_RECORD_STORAGE_KEY, "{not json");
    expect(readNudgeRecord()).toEqual(emptyNudgeRecord());

    localStorage.setItem(NUDGE_RECORD_STORAGE_KEY, JSON.stringify({ delivered: 7 }));
    expect(readNudgeRecord()).toEqual(emptyNudgeRecord());
  });

  it("keeps working when storage itself throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readNudgeRecord()).toEqual(emptyNudgeRecord());
    expect(() => persistNudgeRecord(emptyNudgeRecord())).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

import { describe, it, expect } from "vitest";
import { countUnread, getNotifications, hasUnread } from "./notifications";

describe("notification source", () => {
  it("ships no sample notifications", () => {
    // Regression: the popover used to render three hardcoded entries.
    expect(getNotifications()).toEqual([]);
  });

  it("reports no unread items while there is no source", () => {
    const notifications = getNotifications();
    expect(countUnread(notifications)).toBe(0);
    expect(hasUnread(notifications)).toBe(false);
  });

  it("counts only unread entries once a real source exists", () => {
    const sample = [
      { id: "a", title: "A", timeAgo: "vor 1 Std.", read: false },
      { id: "b", title: "B", timeAgo: "vor 2 Std.", read: true },
      { id: "c", title: "C", timeAgo: "vor 3 Std.", read: false },
    ];
    expect(countUnread(sample)).toBe(2);
    expect(hasUnread(sample)).toBe(true);
  });

  it("contains no invented content or placeholder tokens", () => {
    const serialized = JSON.stringify(getNotifications());
    expect(serialized).not.toMatch(/\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/);
    expect(serialized.toLowerCase()).not.toContain("lorem");
  });
});

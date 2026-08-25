import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import RestTimerBar from "./RestTimerBar";
import { getRestAnnouncement } from "@/lib/restTimeParser";

describe("getRestAnnouncement", () => {
  it("announces the 30 second milestone with units", () => {
    expect(getRestAnnouncement(30, false)).toBe("30 Sekunden Pause verbleibend");
  });

  it("announces the 10 second milestone with units", () => {
    expect(getRestAnnouncement(10, false)).toBe("10 Sekunden Pause verbleibend");
  });

  it("announces the end of the pause", () => {
    expect(getRestAnnouncement(0, false)).toBe("Pause beendet");
    expect(getRestAnnouncement(5, true)).toBe("Pause beendet");
  });

  it("stays silent on every other second", () => {
    // The whole point: no second-by-second chatter.
    for (const seconds of [90, 60, 45, 31, 29, 20, 11, 9, 3, 1]) {
      expect(getRestAnnouncement(seconds, false)).toBeNull();
    }
  });
});

describe("RestTimerBar accessibility", () => {
  const renderBar = (props: Partial<React.ComponentProps<typeof RestTimerBar>> = {}) =>
    render(
      <RestTimerBar
        remainingSeconds={30}
        totalSeconds={90}
        isComplete={false}
        onSkip={vi.fn()}
        {...props}
      />
    );

  it("exposes a timer role with a polite live region", () => {
    renderBar();
    const timer = screen.getByRole("timer");

    expect(timer).toBeInTheDocument();
    expect(timer).toHaveAttribute("aria-live", "polite");
  });

  it("puts the milestone text in the live region", () => {
    renderBar({ remainingSeconds: 30 });
    expect(screen.getByRole("timer")).toHaveTextContent("30 Sekunden Pause verbleibend");
  });

  it("leaves the live region empty between milestones", () => {
    renderBar({ remainingSeconds: 47 });
    expect(screen.getByRole("timer")).toHaveTextContent("");
  });

  it("names the skip control clearly", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Pause überspringen" })).toBeInTheDocument();
  });

  it("gives the skip control a 44px target", () => {
    renderBar();
    const skip = screen.getByRole("button", { name: "Pause überspringen" });
    expect(skip.className).toContain("h-11");
    expect(skip.className).toContain("w-11");
  });

  it("keeps the skip control exposed to assistive tech", () => {
    renderBar();
    const skip = screen.getByRole("button", { name: "Pause überspringen" });
    // A focusable control must never sit inside an aria-hidden subtree.
    expect(skip.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("calls onSkip when activated", async () => {
    const onSkip = vi.fn();
    renderBar({ onSkip });

    screen.getByRole("button", { name: "Pause überspringen" }).click();

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

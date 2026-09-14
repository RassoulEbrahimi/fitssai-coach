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

describe('RestTimerBar accessibility', () => {
  it('offers an accessible reopen control and a readable non-live countdown', () => {
    const onOpen = vi.fn();
    render(<RestTimerBar remainingSeconds={47} setNumber={2} isPaused={false} onOpen={onOpen} />);
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off');
    expect(screen.getByRole('timer')).toHaveTextContent('00:47');
    screen.getByRole('button', { name: 'Pause für Satz 2 öffnen' }).click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it('identifies paused rest', () => {
    render(<RestTimerBar remainingSeconds={90} setNumber={1} isPaused onOpen={vi.fn()} />);
    expect(screen.getByText('Pausiert')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('01:30');
  });
});

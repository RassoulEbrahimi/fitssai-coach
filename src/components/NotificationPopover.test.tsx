import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/hooks/useTheme";
import { NotificationPopover } from "./NotificationPopover";

// jsdom has no matchMedia; ThemeProvider needs it to resolve the "system" theme.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const renderPopover = () =>
  render(
    <ThemeProvider>
      <NotificationPopover />
    </ThemeProvider>
  );

describe("NotificationPopover", () => {
  it("shows no unread badge when there are no real unread items", () => {
    // Regression: three sample notifications produced a permanent "2" badge.
    const { container } = renderPopover();

    const trigger = screen.getByRole("button", { name: /Benachrichtigungen/i });
    expect(trigger).toHaveAccessibleName("Benachrichtigungen");
    expect(trigger.textContent).not.toMatch(/\d/);
    expect(container.querySelector(".bg-emerald-500.text-white")).toBeNull();
  });

  it("renders the German empty state instead of invented activity", async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: /Benachrichtigungen/i }));

    expect(await screen.findByText("Du bist auf dem neuesten Stand.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows none of the old sample notifications", async () => {
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole("button", { name: /Benachrichtigungen/i }));
    await screen.findByText("Du bist auf dem neuesten Stand.");

    for (const stale of [
      /Neues Ziel erreicht/i,
      /Trainingsplan aktualisiert/i,
      /Wöchentlicher Fortschritt/i,
      /Alle anzeigen/i,
    ]) {
      expect(screen.queryByText(stale)).not.toBeInTheDocument();
    }
  });
});

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FitssNavBar } from "./FitssNavBar";
import { FocusModeProvider } from "@/contexts/FocusModeContext";
import { ThemeProvider } from "@/hooks/useTheme";
import { type AppView } from "@/lib/navigation";

// Exercise the actual consumer and motion buttons with the app's existing labels.
const destinations = [
  { id: "dashboard", name: "Dashboard" },
  { id: "workout", name: "Trainingsplan" },
  { id: "nutrition", name: "Ernährungsplan" },
  { id: "profile", name: "Profil" },
] as const;

function Harness({ onChange = () => {} }: { onChange?: (view: AppView) => void }) {
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  return (
    <ThemeProvider>
      <FocusModeProvider>
        <FitssNavBar activeView={activeView} onChange={(view) => {
          onChange(view);
          setActiveView(view);
        }} />
      </FocusModeProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  // Motion synthesizes pointer events for keyboard presses; jsdom lacks them.
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("primary navigation", () => {
  it.each([320, 375, 1280])("names all four destinations at %i px even without visible labels", (width) => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
    render(<Harness />);
    const nav = screen.getByRole("navigation", { name: "Hauptnavigation" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(4);

    for (const [index, { name }] of destinations.entries()) {
      const label = within(buttons[index]).getByText(name);
      if (width < 768) {
        // jsdom does not lay out responsive CSS. Reproduce its mobile effect
        // on the accessibility tree; real breakpoint/layout checks run in-browser.
        label.style.display = "none";
        expect(label).not.toBeVisible();
      } else {
        expect(label).toHaveTextContent(name);
      }
      expect(within(nav).getByRole("button", { name, exact: true })).toBe(buttons[index]);
      expect(buttons[index]).toHaveAccessibleName(name);
    }
    expect(within(nav).getByRole("button", { current: "page" })).toHaveAccessibleName("Dashboard");
    expect(within(nav).getAllByRole("button", { current: false })).toHaveLength(3);
  });

  it("activates each destination and moves current-page semantics with controlled state", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    for (const { id, name } of destinations) {
      await user.click(screen.getByRole("button", { name }));
      expect(onChange).toHaveBeenLastCalledWith(id);
      expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1);
      expect(screen.getByRole("button", { current: "page" })).toHaveAccessibleName(name);
    }
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("keeps destination tab order and native Enter/Space activation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    for (const [index, { id, name }] of destinations.entries()) {
      await user.tab();
      expect(screen.getByRole("button", { name })).toHaveFocus();
      await user.keyboard(index % 2 === 0 ? "{Enter}" : " ");
      expect(onChange).toHaveBeenLastCalledWith(id);
      expect(screen.getByRole("button", { current: "page" })).toHaveAccessibleName(name);
    }
    expect(onChange).toHaveBeenCalledTimes(4);
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Ernährungsplan" })).toHaveFocus();
  });

  it("follows an externally changed destination without activating it", () => {
    const onChange = vi.fn();
    const mount = (activeView: AppView) => (
      <ThemeProvider><FocusModeProvider>
        <FitssNavBar activeView={activeView} onChange={onChange} />
      </FocusModeProvider></ThemeProvider>
    );
    const { rerender } = render(mount("dashboard"));
    rerender(mount("profile"));
    expect(screen.getByRole("button", { current: "page" })).toHaveAccessibleName("Profil");
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(onChange).not.toHaveBeenCalled();
  });
});

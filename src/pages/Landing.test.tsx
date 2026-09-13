import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/*
  UI02-14: the hero used to render a "Demo ansehen" button with no handler, no
  link and no target — a CTA that advertised a demo the product does not have.
  It was removed; the only hero CTA is "Jetzt starten", and every control in the
  hero must actually do something.
*/

const authState: { user: { uid: string } | null } = { user: null };
vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: authState.user, loading: false }) }));
// The navbar is not under test and pulls in theme/PWA providers.
vi.mock("@/components/Navbar", () => ({ default: () => null }));

import "@/lib/i18n";
import Hero from "@/components/Hero";
import Landing from "./Landing";

beforeEach(() => {
  authState.user = null;
});

describe("Hero CTAs", () => {
  it("renders exactly one CTA: an accessible 'Jetzt starten' button", () => {
    const { container } = render(<Hero onGetStarted={vi.fn()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("Jetzt starten");
    expect(container.querySelectorAll("a")).toHaveLength(0);

    // The arrow is decorative and must not contribute to the announced name.
    const icon = buttons[0].querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("does not render the non-functional demo CTA", () => {
    render(<Hero onGetStarted={vi.fn()} />);

    expect(screen.queryByText(/Demo ansehen/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /demo/i })).not.toBeInTheDocument();
  });

  it("invokes onGetStarted on click, Enter and Space", async () => {
    const user = userEvent.setup();
    const onGetStarted = vi.fn();
    render(<Hero onGetStarted={onGetStarted} />);
    const cta = screen.getByRole("button", { name: "Jetzt starten" });

    await user.click(cta);
    expect(onGetStarted).toHaveBeenCalledTimes(1);

    await user.tab();
    expect(cta).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onGetStarted).toHaveBeenCalledTimes(2);
    await user.keyboard(" ");
    expect(onGetStarted).toHaveBeenCalledTimes(3);
  });

  it("wires every hero button to an action", async () => {
    const user = userEvent.setup();
    const onGetStarted = vi.fn();
    render(<Hero onGetStarted={onGetStarted} />);

    for (const button of screen.getAllByRole("button")) {
      onGetStarted.mockClear();
      await user.click(button);
      expect(onGetStarted).toHaveBeenCalled();
    }
  });
});

describe("Landing primary CTA navigation", () => {
  const renderLanding = () =>
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth/sign-in" element={<h1>Anmeldeseite</h1>} />
          <Route path="/dashboard" element={<h1>Dashboardseite</h1>} />
        </Routes>
      </MemoryRouter>
    );

  it("sends a signed-out visitor to /auth/sign-in", async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Jetzt starten" }));
    expect(screen.getByRole("heading", { name: "Anmeldeseite" })).toBeInTheDocument();
  });

  it("sends a signed-in user to /dashboard", async () => {
    authState.user = { uid: "u1" };
    const user = userEvent.setup();
    renderLanding();

    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Jetzt starten" }));
    expect(screen.getByRole("heading", { name: "Dashboardseite" })).toBeInTheDocument();
  });
});

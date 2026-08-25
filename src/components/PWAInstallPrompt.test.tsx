import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PWAInstallPrompt } from "./PWAInstallPrompt";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));

/** The install banner only appears after the browser offers the prompt. */
const offerInstall = () => {
  const event = new Event("beforeinstallprompt");
  act(() => {
    window.dispatchEvent(event);
  });
};

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

describe("PWAInstallPrompt", () => {
  it("stays hidden until the browser offers an install", () => {
    const { container } = render(<PWAInstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses German copy for the heading and description", () => {
    // Regression: the heading read "Install App" in an otherwise German app.
    render(<PWAInstallPrompt />);
    offerInstall();

    expect(screen.getByRole("heading", { name: "App installieren" })).toBeInTheDocument();
    expect(screen.getByText(/schneller und auch offline nutzbar/i)).toBeInTheDocument();
    expect(screen.queryByText(/Install App|Install FitssAI/i)).not.toBeInTheDocument();
  });

  it("gives the install and dismiss controls distinct accessible names", () => {
    render(<PWAInstallPrompt />);
    offerInstall();

    expect(screen.getByRole("button", { name: "Installieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hinweis schließen" })).toBeInTheDocument();
  });
});

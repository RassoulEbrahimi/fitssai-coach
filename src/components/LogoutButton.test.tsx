import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const signOut = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));
vi.mock("firebase/auth", () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

import { LogoutButton } from "./LogoutButton";
import { THEME_STORAGE_KEY } from "@/lib/theme";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const confirmLogout = async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LogoutButton />
    </MemoryRouter>
  );
  await user.click(screen.getByRole("button", { name: /Abmelden/i }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Abmelden" }));
};

describe("LogoutButton storage handling", () => {
  it("does not wipe the whole origin", async () => {
    // Regression: logout called localStorage.clear().
    localStorage.setItem("some-other-app.token", "not-ours");
    const clearSpy = vi.spyOn(Storage.prototype, "clear");

    await confirmLogout();

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(clearSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem("some-other-app.token")).toBe("not-ours");
    clearSpy.mockRestore();
  });

  it("preserves the theme preference", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    await confirmLogout();

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("clears the account-scoped training session", async () => {
    localStorage.setItem("fitssai.training.session", '{"id":"x"}');
    localStorage.setItem("fitssai.training.cache", "{}");

    await confirmLogout();

    await waitFor(() => expect(localStorage.getItem("fitssai.training.session")).toBeNull());
    expect(localStorage.getItem("fitssai.training.cache")).toBeNull();
  });
});

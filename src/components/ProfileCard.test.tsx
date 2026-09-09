import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useAuth", () => {
  // Stable identity: the admin-role effect keys on `user`, so a fresh object
  // per render would re-run it on every commit.
  const user = { uid: "admin-uid", id: "admin-uid", email: "admin@example.com" };
  return { useAuth: () => ({ user }) };
});

vi.mock("@/hooks/useAISessions", () => ({
  useAISessions: () => ({ aiSessionsCount: 0, loading: false }),
}));

// The admin tile is gated on a Firestore role read; grant it so the link renders.
vi.mock("firebase/firestore", () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({ role: "admin" }) }),
  setDoc: async () => undefined,
  Timestamp: { now: () => ({}) },
}));

import { ProfileCard } from "./ProfileCard";
import { ThemeProvider } from "@/hooks/useTheme";

/*
  The admin tile is rendered inside BrowserRouter basename="/fitssai-coach"
  (see App.tsx), the path GitHub Pages serves the app from. /admin is a real
  in-app route, so its link has to resolve under that basename — a
  root-relative anchor would leave the SPA for the Pages account root.
*/
describe("ProfileCard admin link", () => {
  const renderCard = (basename?: string) =>
    render(
      <MemoryRouter basename={basename} initialEntries={[`${basename ?? ""}/dashboard`]}>
        <ThemeProvider>
          <ProfileCard profile={{}} onProfileUpdate={() => {}} workoutProgress={{ completed: 0, total: 0 }} />
        </ThemeProvider>
      </MemoryRouter>
    );

  it("resolves the admin link inside the deployment basename", async () => {
    renderCard("/fitssai-coach");

    const admin = await screen.findByRole("link", { name: /Adminbereich/i });
    expect(admin).toHaveAttribute("href", "/fitssai-coach/admin");
  });

  it("points at the in-app admin route when served from the domain root", async () => {
    renderCard();

    expect(await screen.findByRole("link", { name: /Adminbereich/i })).toHaveAttribute(
      "href",
      "/admin"
    );
  });
});

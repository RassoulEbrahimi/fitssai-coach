import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Firebase is not configured in tests; the auth surface only needs the hook's
// shape, not a live connection.
vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

// i18n is initialised by App.tsx in the running app; load it here so the
// German strings resolve instead of falling back to raw keys.
import "@/lib/i18n";
import AuthPage from "./AuthPage";

let renderResult: ReturnType<typeof render> | null = null;

const renderAt = (path: string) =>
  (renderResult = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth/:mode" element={<AuthPage />} />
      </Routes>
    </MemoryRouter>
  ));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/auth/:mode routing", () => {
  it("renders the login form at /auth/sign-in", () => {
    renderAt("/auth/sign-in");

    // The confirm-password field only exists in registration mode.
    expect(screen.queryByLabelText(/Passwort bestätigen/i)).not.toBeInTheDocument();

    // The mode tab and the submit button share the label, so target the submit.
    const { container } = renderResult!;
    const submit = container.querySelector('form button[type="submit"]');
    expect(submit).toHaveTextContent(/Anmelden/i);
  });

  it("renders the registration form at /auth/sign-up", () => {
    // Regression: this used to render the sign-in form.
    renderAt("/auth/sign-up");

    expect(screen.getByLabelText(/Passwort bestätigen/i)).toBeInTheDocument();
  });

  it("falls back to the login form for an unknown mode", () => {
    renderAt("/auth/voellig-unbekannt");

    expect(screen.queryByLabelText(/Passwort bestätigen/i)).not.toBeInTheDocument();
  });
});

describe("auth form semantics", () => {
  it("associates a label with the email field and uses the email autocomplete", () => {
    renderAt("/auth/sign-in");

    const email = screen.getByLabelText(/E-Mail-Adresse/i);
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
  });

  it("uses current-password when signing in", () => {
    renderAt("/auth/sign-in");

    const password = screen.getByLabelText(/^Passwort$/i);
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });

  it("uses new-password when registering", () => {
    renderAt("/auth/sign-up");

    expect(screen.getByLabelText(/^Passwort$/i)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/Passwort bestätigen/i)).toHaveAttribute(
      "autocomplete",
      "new-password"
    );
  });

  it("names the password visibility toggle", () => {
    renderAt("/auth/sign-in");

    expect(screen.getByRole("button", { name: /Passwort anzeigen/i })).toBeInTheDocument();
  });

  it("submits through a real form", () => {
    const { container } = renderAt("/auth/sign-in");

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    expect(form?.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it("does not expose legal links while no legal content is available", () => {
    renderAt("/auth/sign-in");

    expect(screen.queryByRole("navigation", { name: "Rechtliches" })).not.toBeInTheDocument();
    for (const label of ["Impressum", "Datenschutz", "AGB"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });
});

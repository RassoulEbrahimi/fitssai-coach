import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const setDoc = vi.fn(
  async (_ref: unknown, _data: Record<string, unknown>, _options?: unknown) => undefined
);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("firebase/firestore", () => ({
  doc: (...path: unknown[]) => ({ path }),
  setDoc: (ref: unknown, data: Record<string, unknown>, options?: unknown) =>
    setDoc(ref, data, options),
  Timestamp: { now: () => ({ __ts: true }) },
  collection: (...path: unknown[]) => ({ path }),
  getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "u1", id: "u1" } }) }));
vi.mock("@/components/AIAnalyticsCard", () => ({ AIAnalyticsCard: () => null }));

import "@/lib/i18n";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { ThemeProvider } from "@/hooks/useTheme";
import ProfileView from "./ProfileView";
import { NOT_SPECIFIED } from "@/lib/coachingPreferences";

const baseProfile = {
  id: "u1",
  full_name: "Test",
  email: "t@example.com",
  weight: 80,
  height: 180,
  age: 30,
};

const renderProfile = (profile: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <ThemeProvider>
      <PreferencesProvider>
      <ProfileView
        profile={profile as never}
        onProfileUpdate={() => {}}
        workoutProgress={{ completed: 0, total: 0 }}
      />
      </PreferencesProvider>
      </ThemeProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  setDoc.mockResolvedValue(undefined);
});

describe("training preferences — existing user with nothing stored", () => {
  it("says the preferences were never given rather than showing a default", () => {
    const { container } = renderProfile(baseProfile);

    // Three preferences, none answered.
    const occurrences = (container.textContent ?? "").split(NOT_SPECIFIED).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("shows no invented equipment or frequency", () => {
    const { container } = renderProfile(baseProfile);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/Voll ausgestattetes Fitnessstudio/);
    expect(text).not.toMatch(/\d+ Tage pro Woche/);
    expect(text).not.toMatch(/\d+ Minuten/);
  });

  it("offers an edit path", () => {
    renderProfile(baseProfile);

    expect(
      screen.getByRole("button", { name: /Trainingsangaben bearbeiten/i })
    ).toBeInTheDocument();
  });
});

describe("training preferences — stored values", () => {
  const withPreferences = {
    ...baseProfile,
    equipment: ["dumbbells", "pullup_bar"],
    daysPerWeek: 4,
    sessionMinutes: 45,
  };

  it("renders what is stored, in German", () => {
    const { container } = renderProfile(withPreferences);
    const text = container.textContent ?? "";

    expect(text).toContain("Kurzhanteln, Klimmzugstange");
    expect(text).toContain("4 Tage pro Woche");
    expect(text).toContain("45 Minuten");
  });
});

describe("saving training preferences", () => {
  const openDialog = () => {
    renderProfile(baseProfile);
    fireEvent.click(screen.getByRole("button", { name: /Trainingsangaben bearbeiten/i }));
  };

  it("adds the fields to the existing document with merge", async () => {
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Kurzhanteln/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/ }));

    await waitFor(() => expect(setDoc).toHaveBeenCalled());

    const [, data, options] = setDoc.mock.calls[0];
    expect(data.equipment).toEqual(["dumbbells"]);
    // Merge, so nothing else on the profile is replaced.
    expect(options).toEqual({ merge: true });
  });

  it("does not claim success when the write fails", async () => {
    setDoc.mockRejectedValueOnce(new Error("permission-denied"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Kurzhanteln/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("omits a preference the user never touched instead of storing a placeholder", async () => {
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: /Kurzhanteln/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Speichern$/ }));

    await waitFor(() => expect(setDoc).toHaveBeenCalled());

    const [, data] = setDoc.mock.calls[0];
    expect(data).not.toHaveProperty("daysPerWeek");
    expect(data).not.toHaveProperty("sessionMinutes");
  });
});

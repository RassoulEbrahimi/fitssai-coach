import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/hooks/useTheme";

vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  doc: vi.fn(),
  setDoc: vi.fn(),
  Timestamp: { now: () => ({}) },
}));
// The selector loads the catalogue from Firestore; the modal tests only care
// about the tabs, so keep it inert.
vi.mock("@/components/ExerciseSelector", () => ({
  ExerciseSelector: () => <div data-testid="exercise-selector" />,
  PREDEFINED_EXERCISES: [],
}));

import { AddWorkoutModal } from "./AddWorkoutModal";

// The KI tab renders AIPromptAssist, which reads workout context via useQuery
// and an avatar that reads the theme.
const withProviders = (ui: React.ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>
  );
};

const open = (mode?: "ai" | "manual") =>
  render(
    withProviders(
      <AddWorkoutModal
        isOpen
        mode={mode}
        onClose={() => {}}
        dayContext={{ weekKey: "week1", dayIndex: 0 }}
      />
    )
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddWorkoutModal tabs", () => {
  it("opens in manual mode by default", () => {
    open();

    const manual = screen.getByRole("tab", { name: /Manuell hinzufügen/ });
    expect(manual).toHaveAttribute("data-state", "active");
    expect(screen.getByRole("tab", { name: /KI-Vorschlag/ })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("puts manual before the KI suggestion", () => {
    // Regression: the order used to be "AI Suggestion | Manual Add".
    open();

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent ?? "");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatch(/Manuell hinzufügen/);
    expect(tabs[1]).toMatch(/KI-Vorschlag/);
  });

  it("uses German labels only", () => {
    const { baseElement } = open();

    expect(baseElement.textContent).not.toMatch(/AI Suggestion/);
    expect(baseElement.textContent).not.toMatch(/Manual Add/);
  });

  it("still switches to the KI tab", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("tab", { name: /KI-Vorschlag/ }));

    expect(screen.getByRole("tab", { name: /KI-Vorschlag/ })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.getByRole("tab", { name: /Manuell hinzufügen/ })).toHaveAttribute(
      "data-state",
      "inactive"
    );
  });

  it("honours an explicitly requested KI mode", () => {
    // The dedicated autofill button opens the KI tab on purpose; only the
    // default is manual.
    open("ai");

    expect(screen.getByRole("tab", { name: /KI-Vorschlag/ })).toHaveAttribute(
      "data-state",
      "active"
    );
  });
});

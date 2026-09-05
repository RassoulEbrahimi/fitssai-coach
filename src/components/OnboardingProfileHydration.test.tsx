/**
 * The Profile screen straight after onboarding.
 *
 * A new user's first dashboard visit happens before the profile document
 * exists (sign-up navigates to /dashboard, which renders while it checks and
 * only then redirects to /onboarding). That read caches "no profile" for an
 * hour and persists it. Onboarding used to write to Firestore directly, so
 * nothing told the cache the document now existed, and the dashboard rendered
 * that pre-onboarding entry — every field a placeholder — until some later
 * transition happened to refetch it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Hoisted: the firebase/firestore factory below runs before module scope.
const { MockTimestamp } = vi.hoisted(() => {
  class MockTimestamp {
    constructor(private readonly date: Date) {}
    static now() {
      return new MockTimestamp(new Date());
    }
    toDate() {
      return this.date;
    }
  }
  return { MockTimestamp };
});

/** The user document, as Firestore holds it. Onboarding writes into it. */
let storedDoc: Record<string, unknown> | null = null;

const setDoc = vi.fn(
  async (_ref: unknown, data: Record<string, unknown>, _options?: unknown) => {
    storedDoc = { ...(storedDoc ?? {}), ...data };
  }
);
const getDoc = vi.fn(async (_ref: unknown) => ({
  exists: () => storedDoc !== null,
  data: () => storedDoc,
}));

vi.mock("firebase/firestore", () => ({
  doc: (...path: unknown[]) => ({ path }),
  setDoc: (ref: unknown, data: Record<string, unknown>, options?: unknown) =>
    setDoc(ref, data, options),
  getDoc: (ref: unknown) => getDoc(ref),
  Timestamp: MockTimestamp,
  collection: (...path: unknown[]) => ({ path }),
  getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "u1", id: "u1" }, loading: false }),
}));
vi.mock("@/components/AIAnalyticsCard", () => ({ AIAnalyticsCard: () => null }));

import "@/lib/i18n";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import { ThemeProvider } from "@/hooks/useTheme";
import OnboardingForm from "./OnboardingForm";
import ProfileView from "@/views/ProfileView";
import { useProfile } from "@/hooks/queries/useProfile";
import { NOT_SPECIFIED } from "@/lib/coachingPreferences";

/** The app's client: a long staleTime is what makes a stale entry stick. */
const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 1000 * 60 * 60 * 24, staleTime: 1000 * 60 * 5 },
    },
  });

const Providers = ({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) => (
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <ThemeProvider>
        <PreferencesProvider>{children}</PreferencesProvider>
      </ThemeProvider>
    </MemoryRouter>
  </QueryClientProvider>
);

/** What the dashboard renders for the profile tab: the cached profile. */
const DashboardProfile = () => {
  const { data: profile } = useProfile();
  return (
    <ProfileView
      profile={profile ?? undefined}
      onProfileUpdate={() => {}}
      workoutProgress={{ completed: 0, total: 0 }}
    />
  );
};

/** Radix Select needs pointer-capture, which jsdom does not implement. */
const stubPointerCapture = () => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
};

const chooseOption = async (trigger: HTMLElement, optionName: RegExp) => {
  fireEvent.keyDown(trigger, { key: "Enter" });
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.click(option);
};

/** Every step of onboarding, as a user completes it. */
const completeOnboarding = async (onComplete: () => void) => {
  fireEvent.change(screen.getByLabelText("Vorname"), { target: { value: "Mia" } });
  fireEvent.change(screen.getByLabelText(/Alter/), { target: { value: "31" } });
  fireEvent.change(screen.getByLabelText(/Gewicht/), { target: { value: "72" } });
  fireEvent.change(screen.getByLabelText(/Größe/), { target: { value: "168" } });
  fireEvent.click(screen.getByRole("button", { name: /Weiter/ }));

  await screen.findByText("Muskeln aufbauen");
  fireEvent.click(screen.getByRole("radio", { name: /Muskeln aufbauen/ }));
  fireEvent.click(screen.getByRole("button", { name: /Weiter/ }));

  const dietTrigger = await screen.findByText("Wähle deine Ernährungsvorliebe");
  await chooseOption(dietTrigger, /Proteinreich/);
  await chooseOption(
    screen.getByText("Wähle dein Erfahrungslevel"),
    /Fortgeschritten \(6 Monate/
  );
  fireEvent.click(screen.getByRole("button", { name: /Weiter/ }));

  fireEvent.click(await screen.findByRole("button", { name: /Kurzhanteln/ }));
  await chooseOption(screen.getByLabelText("Trainingstage pro Woche"), /^4 Tage$/);
  await chooseOption(screen.getByLabelText("Gewünschte Trainingsdauer"), /45 Minuten/);

  fireEvent.click(screen.getByRole("button", { name: /Setup abschließen/ }));
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
  stubPointerCapture();
  storedDoc = null;
});

describe("profile display after onboarding", () => {
  it("persists the answers under the field names the profile reads", async () => {
    const client = makeClient();
    const onComplete = vi.fn();

    render(
      <Providers client={client}>
        <OnboardingForm onComplete={onComplete} />
      </Providers>
    );
    await completeOnboarding(onComplete);

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, data, options] = setDoc.mock.calls[0];
    expect(data).toMatchObject({
      fullName: "Mia",
      age: 31,
      weight: 72,
      height: 168,
      fitnessGoal: "gainMuscle",
      dietaryPreference: "highProtein",
      experienceLevel: "intermediate",
      equipment: ["dumbbells"],
      daysPerWeek: 4,
      sessionMinutes: 45,
    });
    expect(data.updatedAt).toBeInstanceOf(MockTimestamp);
    // Merge, so nothing already on the document is replaced.
    expect(options).toEqual({ merge: true });
  });

  it("renders the saved values on the first profile render after onboarding", async () => {
    const client = makeClient();
    const onComplete = vi.fn();

    // The dashboard visit a new user makes before onboarding: no document
    // yet, so "no profile" is what the cache holds afterwards.
    const before = render(
      <Providers client={client}>
        <DashboardProfile />
      </Providers>
    );
    await waitFor(() => expect(getDoc).toHaveBeenCalled());
    expect(client.getQueryData(["profile", "u1"])).toBeNull();
    before.unmount();

    const onboarding = render(
      <Providers client={client}>
        <OnboardingForm onComplete={onComplete} />
      </Providers>
    );
    await completeOnboarding(onComplete);
    onboarding.unmount();

    // The redirect: the profile screen mounts, and must not need a refetch
    // — let alone a hard refresh — to show what was just saved.
    const { container } = render(
      <Providers client={client}>
        <DashboardProfile />
      </Providers>
    );

    expect(screen.getByText("Mia")).toBeInTheDocument();
    expect(container.textContent).toContain("Muskeln aufbauen");
    expect(container.textContent).toContain("Proteinreich");
    expect(container.textContent).toContain("Kurzhanteln");
    expect(container.textContent).toContain("4 Tage pro Woche");
    expect(container.textContent).toContain("45 Minuten");
    expect(container.textContent).not.toContain(NOT_SPECIFIED);

    // 72 kg, 168 cm, 31 years: none of them a placeholder.
    ["72", "168", "31"].forEach((value) =>
      expect(screen.getAllByText(value).length).toBeGreaterThan(0)
    );
  });

  it("refetches the profile once the dashboard mounts, so the cache cannot drift", async () => {
    const client = makeClient();
    const onComplete = vi.fn();

    const before = render(
      <Providers client={client}>
        <DashboardProfile />
      </Providers>
    );
    await waitFor(() => expect(getDoc).toHaveBeenCalledTimes(1));
    before.unmount();

    const onboarding = render(
      <Providers client={client}>
        <OnboardingForm onComplete={onComplete} />
      </Providers>
    );
    await completeOnboarding(onComplete);
    onboarding.unmount();

    // Without the invalidation the entry stays fresh for the whole staleTime
    // and this mount would read the cache and stop there.
    render(
      <Providers client={client}>
        <DashboardProfile />
      </Providers>
    );
    await waitFor(() => expect(getDoc).toHaveBeenCalledTimes(2));

    await act(async () => {
      await client.getQueryCache().find({ queryKey: ["profile", "u1"] })?.promise;
    });
    expect(screen.getByText("Mia")).toBeInTheDocument();
  });
});

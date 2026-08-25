import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const activity = vi.fn();
vi.mock("@/hooks/useWeeklyActivity", () => ({
  useWeeklyActivity: (...args: unknown[]) => activity(...args),
}));
vi.mock("@/lib/firebase", () => ({ auth: {}, db: {} }));

import "@/lib/i18n";
import { WeeklyActivity } from "./WeeklyActivity";

const EMPTY = {
  dailyData: [0, 0, 0, 0, 0, 0, 0],
  dayLabels: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  activeDays: 0,
  totalMinutes: 0,
  totalWorkouts: 0,
  targetMinutes: 350,
  isLoading: false,
  refresh: vi.fn(),
};

const WITH_HISTORY = {
  ...EMPTY,
  dailyData: [30, 0, 45, 0, 20, 0, 0],
  activeDays: 3,
  totalMinutes: 95,
  totalWorkouts: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
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

describe("WeeklyActivity — zero activity", () => {
  beforeEach(() => activity.mockReturnValue(EMPTY));

  it("renders the dedicated empty state", () => {
    render(<WeeklyActivity />);

    const empty = screen.getByTestId("activity-empty-state");
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent("Noch keine Aktivität");
  });

  it("does not overlay the message on the metrics", () => {
    // Regression: the empty state was an `absolute inset-0` layer floating on
    // top of the bar chart, which is what collided visually.
    const { container } = render(<WeeklyActivity />);

    const empty = screen.getByTestId("activity-empty-state");
    expect(empty.className).not.toMatch(/\babsolute\b/);
    expect(empty.className).not.toMatch(/inset-0/);
    expect(container.querySelector(".absolute.inset-0")).toBeNull();
  });

  it("drops the meaningless bar chart instead of muting it", () => {
    render(<WeeklyActivity />);

    for (const label of EMPTY.dayLabels) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("still shows the zero metrics", () => {
    const { container } = render(<WeeklyActivity />);

    expect(container.textContent).toContain("von 7 Tagen aktiv");
    expect(container.textContent).toContain("von 350 min");
  });

  it("uses German motivational copy only", () => {
    const { container } = render(<WeeklyActivity />);

    expect(container.textContent).toContain("Bleib dran – morgen zählt auch!");
    expect(container.textContent).not.toContain("Keep pushing, tomorrow counts!");
    expect(container.textContent).not.toMatch(/Strong week/i);
  });
});

describe("WeeklyActivity — with history", () => {
  beforeEach(() => activity.mockReturnValue(WITH_HISTORY));

  it("renders the normal progress state, not the empty state", () => {
    render(<WeeklyActivity />);

    expect(screen.queryByTestId("activity-empty-state")).not.toBeInTheDocument();
    expect(screen.getByText("Aktivitätsfortschritt")).toBeInTheDocument();
  });

  it("renders the day labels and real statistics", () => {
    const { container } = render(<WeeklyActivity />);

    for (const label of WITH_HISTORY.dayLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("95");
  });
});

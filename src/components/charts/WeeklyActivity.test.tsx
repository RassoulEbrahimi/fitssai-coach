import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  measuredMinutes: 0,
  measuredWorkouts: 0,
  unmeasuredWorkouts: 0,
  totalWorkouts: 0,
  targetMinutes: 350,
  isLoading: false,
  refresh: vi.fn(),
};

const WITH_HISTORY = {
  ...EMPTY,
  dailyData: [30, 0, 45, 0, 20, 0, 0],
  activeDays: 3,
  measuredMinutes: 95,
  measuredWorkouts: 3,
  totalWorkouts: 3,
};

/** Workouts happened, but none of them was timed — every pre-PR47 history. */
const LEGACY_UNMEASURED = {
  ...EMPTY,
  dailyData: [0, 0, 0, 0, 0, 0, 0],
  activeDays: 3,
  measuredMinutes: 0,
  measuredWorkouts: 0,
  unmeasuredWorkouts: 3,
  totalWorkouts: 3,
};

/** Some sessions timed, some not: the total is a floor, not the whole truth. */
const MIXED = {
  ...EMPTY,
  dailyData: [30, 0, 0, 0, 0, 0, 0],
  activeDays: 3,
  measuredMinutes: 30,
  measuredWorkouts: 1,
  unmeasuredWorkouts: 2,
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

  it("keeps the active-days metric but claims no minutes", () => {
    // With nothing measured, "0 von 350 min" would assert that the user trained
    // for no time. The days count is real, so it stays.
    const { container } = render(<WeeklyActivity />);

    expect(container.textContent).toContain("von 7 Tagen aktiv");
    expect(container.textContent).not.toContain("von 350 min");
    expect(container.textContent).toContain("Dauer nicht erfasst");
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
    // Everything in this period was measured, so it is a true total.
    expect(container.textContent).not.toContain("mind.");
  });
});

describe("WeeklyActivity refresh handler", () => {
  it("calls refetch with no arguments, not with the click event", async () => {
    /*
     * Regression: onClick={refresh} handed React's MouseEvent straight to
     * TanStack Query's refetch(options?: RefetchOptions), where it was read as
     * an options bag. The handler must swallow the event.
     */
    const refresh = vi.fn().mockResolvedValue(undefined);
    activity.mockReturnValue({ ...WITH_HISTORY, refresh });
    const user = userEvent.setup();

    render(<WeeklyActivity />);
    await user.click(screen.getByRole("button", { name: "Aktualisieren" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
    const [firstArg] = refresh.mock.calls[0];
    expect(firstArg).toBeUndefined();
  });
});

describe("WeeklyActivity — duration honesty", () => {
  it("shows no fabricated minutes when no session was ever timed", () => {
    activity.mockReturnValue(LEGACY_UNMEASURED);
    const { container } = render(<WeeklyActivity />);

    // Three real workouts, so the empty state must not appear...
    expect(screen.queryByTestId("activity-empty-state")).not.toBeInTheDocument();
    expect(container.textContent).toContain("3");
    // ...but there is no measured time to report.
    expect(container.textContent).toContain("Dauer nicht erfasst");
    expect(container.textContent).not.toMatch(/\d+ von 350 min/);
  });

  it("drops the minutes chart when there are no minutes to plot", () => {
    activity.mockReturnValue(LEGACY_UNMEASURED);
    render(<WeeklyActivity />);

    // Seven empty bars would read as a broken chart, not as "not recorded".
    for (const label of LEGACY_UNMEASURED.dayLabels) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("marks a partly measured period as a floor, not a total", () => {
    activity.mockReturnValue(MIXED);
    const { container } = render(<WeeklyActivity />);

    expect(container.textContent).toContain("mind.");
    expect(container.textContent).toContain("30");
    expect(container.textContent).toContain("von 350 min");
  });
});

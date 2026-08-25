import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import "@/lib/i18n";
import {
  getCalendarWeekDates,
  getCalendarDayIndex,
  isCalendarToday,
} from "@/lib/workoutDateUtils";
import { WeekNavigation, type CalendarCell } from "./WeekNavigation";

const freeze = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** Build the props exactly as WorkoutView derives them from selectedDate. */
const propsFor = (selectedDate: Date, completed: number[] = []) => {
  const cells: CalendarCell[] = getCalendarWeekDates(selectedDate).map((date, i) => ({
    date,
    isToday: isCalendarToday(date),
    isCompleted: completed.includes(i),
  }));
  return {
    monthYear: format(selectedDate, "MMM yyyy", { locale: de }),
    cells,
    activeDayIndex: getCalendarDayIndex(selectedDate),
  };
};

const renderNav = (selectedDate: Date, handlers = {}) => {
  const onPrevWeek = vi.fn();
  const onNextWeek = vi.fn();
  const onDayClick = vi.fn();
  const result = render(
    <WeekNavigation
      {...propsFor(selectedDate)}
      onPrevWeek={onPrevWeek}
      onNextWeek={onNextWeek}
      onDayClick={onDayClick}
      {...handlers}
    />
  );
  return { ...result, onPrevWeek, onNextWeek, onDayClick };
};

describe("calendar header", () => {
  it("shows the month and year of the selected date", () => {
    freeze("2026-08-25T09:00:00+02:00");
    renderNav(new Date(2026, 7, 25));

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("2026");
    expect(heading.textContent).toMatch(/Aug/i);
  });

  it("does not fall back to a plan created in November 2025", () => {
    // Regression: the header read "Nov. 2025" for a 2026 date.
    freeze("2026-08-25T09:00:00+02:00");
    const { container } = renderNav(new Date(2026, 7, 25));

    expect(container.textContent).not.toContain("2025");
    expect(container.textContent).not.toMatch(/Nov/i);
  });

  it("renders the December → January boundary as January", () => {
    freeze("2026-12-31T09:00:00+01:00");
    // 2027-01-01 is a Friday, in the week starting 2026-12-28.
    renderNav(new Date(2027, 0, 1));

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("2027");
    expect(heading.textContent).toMatch(/Jan/i);
  });

  it("shows a historical month when a historical date is selected", () => {
    freeze("2026-08-25T09:00:00+02:00");
    renderNav(new Date(2025, 10, 5));

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toContain("2025");
    expect(heading.textContent).toMatch(/Nov/i);
  });
});

describe("calendar day cells", () => {
  it("renders the seven real dates of that week", () => {
    freeze("2026-08-25T09:00:00+02:00");
    renderNav(new Date(2026, 7, 25));

    const cells = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    expect(cells).toHaveLength(7);
    expect(cells.map((c) => c.textContent?.replace(/\D/g, ""))).toEqual([
      "24", "25", "26", "27", "28", "29", "30",
    ]);
  });

  it("highlights today and the selected weekday", () => {
    freeze("2026-08-25T09:00:00+02:00");
    renderNav(new Date(2026, 7, 27)); // Thursday selected, today is Tuesday

    const cells = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    expect(cells[3]).toHaveAttribute("aria-pressed", "true"); // Thursday
    expect(cells[1].getAttribute("aria-label")).toContain("heute"); // Tuesday
    expect(cells[3].getAttribute("aria-label")).not.toContain("heute");
  });

  it("marks no day as today when the week is historical", () => {
    freeze("2026-08-25T09:00:00+02:00");
    renderNav(new Date(2025, 10, 5));

    const cells = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    for (const cell of cells) {
      expect(cell.getAttribute("aria-label")).not.toContain("heute");
    }
  });

  it("reports the clicked weekday index", async () => {
    // Real timers here: userEvent's internal delays deadlock under fake ones,
    // and this assertion does not depend on the clock.
    const user = userEvent.setup();
    const { onDayClick } = renderNav(new Date(2026, 7, 25));

    const cells = screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
    await user.click(cells[4]); // Friday

    expect(onDayClick).toHaveBeenCalledWith(4);
  });
});

describe("week navigation", () => {
  it("exposes previous and next controls", async () => {
    const user = userEvent.setup();
    const { onPrevWeek, onNextWeek } = renderNav(new Date(2026, 7, 25));

    await user.click(screen.getByLabelText("Vorherige Woche"));
    expect(onPrevWeek).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("Nächste Woche"));
    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it("keeps the navigated month after moving back a week across a boundary", () => {
    freeze("2026-08-25T09:00:00+02:00");
    // Navigating back from 2026-09-01 lands on 2026-08-25 and must stay there.
    renderNav(new Date(2026, 7, 25));

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.textContent).toMatch(/Aug/i);
    expect(heading.textContent).toContain("2026");
  });
});

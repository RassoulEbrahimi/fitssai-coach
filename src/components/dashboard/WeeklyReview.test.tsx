import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeeklyReview } from "./WeeklyReview";
import { buildWeeklyFacts, type PlanDayInput, type WeeklyFactsInput } from "@/lib/coaching";
import {
  computeWeeklyReviewMetrics,
  type WeeklyReviewMetricsInput,
} from "@shared/weeklyRecommendation";

/*
  The weekly review states only what was logged. These tests pin the four
  states the section can be in — nothing, everything, partly measured time and
  partly usable history — and that none of them claims a model was involved.
*/

const THREE_DAY_WEEK: readonly PlanDayInput[] = [
  { dayIndex: 0, exerciseCount: 4 },
  { dayIndex: 1, exerciseCount: 0 },
  { dayIndex: 2, exerciseCount: 5 },
  { dayIndex: 3, exerciseCount: 0 },
  { dayIndex: 4, exerciseCount: 4 },
  { dayIndex: 5, exerciseCount: 0 },
  { dayIndex: 6, exerciseCount: 0 },
];

const facts = (over: Partial<WeeklyFactsInput> = {}) =>
  buildWeeklyFacts({
    weekKey: "Week 2",
    planDays: THREE_DAY_WEEK,
    completions: [],
    weekLogs: [],
    ...over,
  });

const allDone = [0, 2, 4].map((dayIndex) => ({ weekKey: "Week 2", dayIndex, completed: true }));

const measured = [0, 2, 4].map((dayIndex) => ({
  weekKey: "Week 2",
  dayIndex,
  durationSec: 2700,
}));

describe("WeeklyReview", () => {
  it("says there is nothing yet rather than showing zeros", () => {
    render(<WeeklyReview facts={facts({ planDays: [], completions: [] })} />);

    expect(screen.getByText("Noch keine Trainingsdaten für diese Woche.")).toBeInTheDocument();
    expect(screen.queryByText("Erledigt")).not.toBeInTheDocument();
  });

  it("shows the measured week", () => {
    render(
      <WeeklyReview facts={facts({ completions: allDone, weekLogs: measured })} />
    );

    expect(screen.getByText("3 von 3")).toBeInTheDocument();
    expect(screen.getByText("100 %")).toBeInTheDocument();
    expect(screen.getByText("2 Std. 15 Min.")).toBeInTheDocument();
    expect(screen.queryByText("Dauer teilweise erfasst")).not.toBeInTheDocument();
  });

  it("labels a partly measured total as a lower bound", () => {
    render(
      <WeeklyReview
        facts={facts({
          completions: allDone,
          weekLogs: [
            { weekKey: "Week 2", dayIndex: 0, durationSec: 2700 },
            { weekKey: "Week 2", dayIndex: 2, durationSec: null },
            { weekKey: "Week 2", dayIndex: 4, durationSec: null },
          ],
        })}
      />
    );

    expect(screen.getByText("mind. 45 Min.")).toBeInTheDocument();
    expect(screen.getByText("Dauer teilweise erfasst")).toBeInTheDocument();
  });

  it("never renders a measured duration of zero", () => {
    render(<WeeklyReview facts={facts({ completions: allDone })} />);

    expect(screen.getByText("Dauer nicht erfasst")).toBeInTheDocument();
    expect(screen.queryByText(/^0 Min\./)).not.toBeInTheDocument();
  });

  it("notes incomplete older entries in plain German", () => {
    render(
      <WeeklyReview
        facts={facts({
          completions: allDone,
          // One older entry carries no plan position, so it cannot be counted.
          weekLogs: [...measured, { workoutDay: "2024-01-15", durationSec: null }],
        })}
      />
    );

    const note = screen.getByText("Für ältere Trainingseinträge sind nicht alle Details verfügbar.");

    expect(note).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/firestore|schema|migration|legacy/i);
  });

  it("claims no AI involvement and shows no sparkle", () => {
    const { container } = render(
      <WeeklyReview facts={facts({ completions: allDone, weekLogs: measured })} />
    );

    expect(container.textContent ?? "").not.toMatch(/\bKI\b|\bAI\b/);
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
    expect(container.querySelector(".animate-ping")).toBeNull();
  });

  it("makes no medical, injury or shame claim", () => {
    const { container } = render(
      <WeeklyReview
        facts={facts({
          completions: [],
          progression: [{ kind: "reduced-volume", exerciseName: "Rudern", previous: 4, current: 2 }],
        })}
      />
    );

    expect(container.textContent ?? "").not.toMatch(
      /übertrain|verletz|schmerz|rehab|müdigkeit|faul|versagt/i
    );
  });
});

/*
  The recommendation section is opt-in via `metrics`, so everything above still
  describes the numbers on their own. These describe the two together: the same
  week, one set of figures, and no suggestion that anything was changed.
*/

const reviewMetrics = (over: Partial<WeeklyReviewMetricsInput> = {}) =>
  computeWeeklyReviewMetrics({
    weekKey: "Week 2",
    weekNumber: 2,
    hasPlan: true,
    planDays: THREE_DAY_WEEK,
    completions: [],
    weekLogs: [],
    ...over,
  });

describe("WeeklyReview with a recommendation", () => {
  it("shows the numbers and the recommendation from the same week", () => {
    render(
      <WeeklyReview
        facts={facts({ completions: allDone.slice(0, 2) })}
        metrics={reviewMetrics({ completions: allDone.slice(0, 2) })}
      />
    );

    expect(screen.getByText("2 von 3")).toBeInTheDocument();
    expect(screen.getByText("67 %")).toBeInTheDocument();
    expect(screen.getByText("Empfehlung für dich")).toBeInTheDocument();
    expect(screen.getByText(/2 von 3 Trainingstagen abgeschlossen \(67 %\)/)).toBeInTheDocument();
  });

  it("states that the recommendation changes nothing", () => {
    render(
      <WeeklyReview facts={facts({ completions: allDone })} metrics={reviewMetrics({ completions: allDone })} />
    );

    expect(screen.getByText(/Dein Trainingsplan wird dadurch nicht verändert/)).toBeInTheDocument();
  });

  it("still recommends something when there is no data for the week", () => {
    render(
      <WeeklyReview
        facts={facts({ planDays: [], completions: [] })}
        metrics={reviewMetrics({ hasPlan: false, planDays: [], weekNumber: null })}
      />
    );

    expect(screen.getByText("Noch keine Trainingsdaten für diese Woche.")).toBeInTheDocument();
    expect(screen.getByText("Noch nichts geplant")).toBeInTheDocument();
  });

  it("attributes nothing to a model before one has been asked", () => {
    const { container } = render(
      <WeeklyReview
        facts={facts({ completions: allDone, weekLogs: measured })}
        metrics={reviewMetrics({ completions: allDone })}
      />
    );

    // The button offers a model; nothing on screen claims one already wrote
    // anything, and the arithmetic above carries no badge.
    expect(screen.queryByText(/Formulierung vom KI-Coach/)).toBeNull();
    expect(container.querySelector(".lucide-sparkles")).toBeNull();
  });

  it("offers no action that would change the plan", () => {
    render(
      <WeeklyReview
        facts={facts({ completions: allDone })}
        metrics={reviewMetrics({ completions: allDone })}
        onViewPlan={() => undefined}
      />
    );

    expect(screen.getByRole("button", { name: "Plan ansehen" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /anpassen|ändern|erstellen|generieren|übernehmen/i })
    ).toBeNull();
  });
});

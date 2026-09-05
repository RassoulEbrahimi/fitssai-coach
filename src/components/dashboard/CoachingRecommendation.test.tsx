import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachingRecommendation } from "./CoachingRecommendation";
import {
  computeWeeklyReviewMetrics,
  type ReviewCompletion,
  type ReviewPlanDay,
  type WeeklyReviewMetricsInput,
} from "@shared/weeklyRecommendation";
import { WeeklyReviewError } from "@/lib/backend/weeklyReview";

const fetchWeeklyReview = vi.hoisted(() => vi.fn());

vi.mock("@/lib/backend/weeklyReview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend/weeklyReview")>()),
  fetchWeeklyReview,
}));

/*
  The recommendation is the one place the app tells a user what to do next, so
  these tests are mostly about restraint: it says it is a suggestion, it never
  claims the plan changed, it works before and without a model, and it never
  presents its own arithmetic as a model's words.
*/

const THREE_DAY_WEEK: readonly ReviewPlanDay[] = [
  { dayIndex: 0, exerciseCount: 4 },
  { dayIndex: 1, exerciseCount: 0 },
  { dayIndex: 2, exerciseCount: 5 },
  { dayIndex: 3, exerciseCount: 0 },
  { dayIndex: 4, exerciseCount: 4 },
  { dayIndex: 5, exerciseCount: 0 },
  { dayIndex: 6, exerciseCount: 0 },
];

const done = (days: number[]): ReviewCompletion[] =>
  days.map((dayIndex) => ({ weekKey: "Week 2", dayIndex, completed: true }));

const metrics = (over: Partial<WeeklyReviewMetricsInput> = {}) =>
  computeWeeklyReviewMetrics({
    weekKey: "Week 2",
    weekNumber: 2,
    hasPlan: true,
    planDays: THREE_DAY_WEEK,
    completions: [],
    weekLogs: [],
    ...over,
  });

const aiResponse = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  metrics: metrics({ completions: done([0, 2]) }),
  recommendation: {
    category: "maintain" as const,
    headline: "Zwei von drei",
    message: "Du hast zwei der drei geplanten Einheiten geschafft und liegst damit gut im Rennen.",
    reason: "Zwei abgeschlossene Trainingstage von drei geplanten.",
    source: "ai" as const,
  },
  aiStatus: "ai" as const,
  quota: { remaining: 7, limit: 8, period: "2026-09" },
  planFinished: false,
  ...over,
});

beforeEach(() => {
  fetchWeeklyReview.mockReset();
});

describe("the recommendation is there before any backend is", () => {
  it("renders without a network call", () => {
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    expect(screen.getByText("Empfehlung für dich")).toBeInTheDocument();
    expect(screen.getByText(/2 von 3 Trainingstagen abgeschlossen \(67 %\)/)).toBeInTheDocument();
    expect(fetchWeeklyReview).not.toHaveBeenCalled();
  });

  it("says it is a suggestion and that the plan is untouched", () => {
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    expect(
      screen.getByText(/Dein Trainingsplan wird dadurch nicht verändert/)
    ).toBeInTheDocument();
  });

  it("offers to open the plan, never to change it", async () => {
    const onViewPlan = vi.fn();
    render(<CoachingRecommendation metrics={metrics()} onViewPlan={onViewPlan} />);

    const cta = screen.getByRole("button", { name: "Plan ansehen" });
    await userEvent.click(cta);

    expect(onViewPlan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /anpassen|ändern|erstellen|generieren/i })).toBeNull();
  });

  it("asks for consistency when nothing was completed", () => {
    render(<CoachingRecommendation metrics={metrics()} />);

    expect(screen.getByText("Fang klein an")).toBeInTheDocument();
    expect(screen.getByText(/0 von 3 Trainingstagen abgeschlossen \(0 %\)/)).toBeInTheDocument();
  });

  it("acknowledges a full week without adding workload by itself", () => {
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2, 4]) })} />);

    expect(screen.getByText("Woche vollständig abgeschlossen")).toBeInTheDocument();
    expect(screen.getByText(/Halte diesen Umfang zunächst bei/)).toBeInTheDocument();
  });

  it("mentions no duration when none was measured", () => {
    const { container } = render(
      <CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />
    );

    expect(container.textContent ?? "").not.toMatch(/Trainingszeit|Std\.|\d+ Min\./);
  });

  it("claims no model wrote it", () => {
    const { container } = render(<CoachingRecommendation metrics={metrics()} />);

    expect(container.querySelector(".lucide-sparkles")).toBeNull();
    expect(screen.queryByText(/Formulierung vom KI-Coach/)).toBeNull();
  });

  it("offers no explanation for a week the plan says nothing about", () => {
    render(
      <CoachingRecommendation
        metrics={metrics({ hasPlan: false, planDays: [], weekNumber: null })}
      />
    );

    // Nothing to phrase, so nothing is offered and nothing could be spent.
    expect(screen.queryByRole("button", { name: /KI-Coach/ })).toBeNull();
    expect(screen.getByText("Noch nichts geplant")).toBeInTheDocument();
  });
});

describe("asking the coach to phrase it", () => {
  it("only calls the backend on an explicit click", async () => {
    fetchWeeklyReview.mockResolvedValue(aiResponse());
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    expect(fetchWeeklyReview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    await waitFor(() => expect(fetchWeeklyReview).toHaveBeenCalledTimes(1));
  });

  it("labels the model's wording as the model's", async () => {
    fetchWeeklyReview.mockResolvedValue(aiResponse());
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    expect(await screen.findByText("Zwei von drei")).toBeInTheDocument();
    expect(screen.getByText(/Formulierung vom KI-Coach/)).toBeInTheDocument();
  });

  it("keeps its own words when the backend cannot reach the model", async () => {
    fetchWeeklyReview.mockRejectedValue(new WeeklyReviewError("UNAVAILABLE"));
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    expect(
      await screen.findByText(/Erklärung vom KI-Coach ist gerade nicht verfügbar/)
    ).toBeInTheDocument();
    // The numbers never depended on the model, so they are still there.
    expect(screen.getByText(/2 von 3 Trainingstagen abgeschlossen \(67 %\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Formulierung vom KI-Coach/)).toBeNull();
  });

  it("invents nothing when the backend answers with its own fallback", async () => {
    fetchWeeklyReview.mockResolvedValue(
      aiResponse({
        aiStatus: "unavailable",
        recommendation: {
          category: "maintain",
          headline: "Du bist auf Kurs",
          message: "Zwei von drei Einheiten sind abgeschlossen.",
          reason: "Grundlage: 2 von 3 Trainingstagen abgeschlossen (67 %).",
          source: "deterministic",
        },
      })
    );
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    expect(await screen.findByText(/nicht verfügbar/)).toBeInTheDocument();
    expect(screen.queryByText(/Formulierung vom KI-Coach/)).toBeNull();
  });

  it("says so plainly when the monthly budget is gone", async () => {
    fetchWeeklyReview.mockResolvedValue(
      aiResponse({
        aiStatus: "quota_exceeded",
        recommendation: { ...aiResponse().recommendation, source: "deterministic" },
        quota: { remaining: 0, limit: 8, period: "2026-09" },
      })
    );
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    expect(
      await screen.findByText(/keine KI-Erklärungen mehr verfügbar/)
    ).toBeInTheDocument();
  });

  it("cannot be fired twice by a double click", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchWeeklyReview.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    const button = screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("button", { name: /Wird formuliert/ }));

    expect(fetchWeeklyReview).toHaveBeenCalledTimes(1);

    // Let the one in-flight call settle, so the assertion above is about the
    // disabled button rather than about a promise nobody awaited.
    resolve(aiResponse());
    expect(await screen.findByText("Zwei von drei")).toBeInTheDocument();
    expect(fetchWeeklyReview).toHaveBeenCalledTimes(1);
  });
});

describe("what the recommendation never says", () => {
  const cases = [
    metrics(),
    metrics({ completions: done([0]) }),
    metrics({ completions: done([0, 2]) }),
    metrics({ completions: done([0, 2, 4]) }),
    metrics({ hasPlan: false, planDays: [], weekNumber: null }),
  ];

  it.each(cases.map((m, index) => [index, m] as const))(
    "case %i makes no medical, nutrition or plan-change claim",
    (_index, m) => {
      const { container } = render(<CoachingRecommendation metrics={m} />);
      const text = container.textContent ?? "";

      expect(text).not.toMatch(/übertrain|verletz|schmerz|rehab|diagnos|arzt/i);
      expect(text).not.toMatch(/kalorien|protein|ernährung|supplement/i);
      // "nicht verändert" is the promise; anything else about changing is not.
      expect(text).not.toMatch(/automatisch|angepasst|aktualisiert|neu erstellt/i);
      expect(text).not.toMatch(/faul|versagt|Ausrede/i);
    }
  );
});

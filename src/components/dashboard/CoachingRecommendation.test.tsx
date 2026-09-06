import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const FIVE_DAY_WEEK: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
  dayIndex,
  exerciseCount: dayIndex < 5 ? 4 : 0,
}));

const EVERY_DAY_WEEK: readonly ReviewPlanDay[] = Array.from({ length: 7 }, (_, dayIndex) => ({
  dayIndex,
  exerciseCount: 3,
}));

const done = (days: number[]): ReviewCompletion[] =>
  days.map((dayIndex) => ({ weekKey: "Week 2", dayIndex, completed: true }));

const previousWeek = (days: number[]): ReviewCompletion[] =>
  days.map((dayIndex) => ({ weekKey: "Week 1", dayIndex, completed: true }));

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
    expect(screen.getByText(/alle 3 geplanten Einheiten dieser Woche abgeschlossen/)).toBeInTheDocument();
    // Named as a reason to change nothing, never as room for more.
    expect(screen.getByText(/ein guter Grund, nichts zu ändern/)).toBeInTheDocument();
  });

  it("does not tell the reader to train more after two full weeks", () => {
    /*
      The app counts ticked-off sessions. It records nothing about effort,
      fatigue or recovery, so two full weeks say the plan was followed — not
      that its owner has room for more. The section says so out loud.
    */
    const { container } = render(
      <CoachingRecommendation
        metrics={metrics({
          completions: [...done([0, 2, 4]), ...previousWeek([0, 2, 4])],
          previousWeek: { weekKey: "Week 1", planDays: THREE_DAY_WEEK },
        })}
      />
    );

    expect(screen.getByText("Zwei vollständige Wochen")).toBeInTheDocument();
    expect(screen.getByText(/kannst du selbst entscheiden/)).toBeInTheDocument();
    // Progression is conditional on how training feels — which the app admits
    // it does not know, in the same sentence.
    expect(screen.getByText(/weiterhin gut anfühlt/)).toBeInTheDocument();
    expect(screen.getByText(/kann nicht beurteilen, wie sich dein Training anfühlt/)).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/bereit für|steigere |trainiere mehr|zeit für mehr/i);
  });

  it("asks about the schedule after two low weeks instead of prescribing less", () => {
    const { container } = render(
      <CoachingRecommendation
        metrics={metrics({
          planDays: FIVE_DAY_WEEK,
          completions: [...done([0]), ...previousWeek([0])],
          previousWeek: { weekKey: "Week 1", planDays: FIVE_DAY_WEEK },
        })}
      />
    );

    expect(screen.getByText("Passt der Wochenplan zu deiner Woche?")).toBeInTheDocument();
    expect(screen.getByText(/Woran das lag, weiß die App nicht/)).toBeInTheDocument();
    // Why sessions were missed is not recorded, so no verdict is drawn from it.
    expect(container.textContent ?? "").not.toMatch(/reduzier|zu viel|pensum|überforder|weniger trainieren/i);
  });

  it("calls a seven-day plan dense without a claim about the reader", () => {
    const { container } = render(
      <CoachingRecommendation
        metrics={metrics({
          planDays: EVERY_DAY_WEEK,
          completions: done([0, 1, 2, 3, 4, 5, 6]),
        })}
      />
    );

    expect(screen.getByText("Dein Plan sieht sieben Trainingstage vor")).toBeInTheDocument();
    expect(screen.getByText(/dichter Wochenplan/)).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/erholung|erholt|regeneration|deload|müde/i);
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

describe("one click, one unit of quota", () => {
  /*
    Every accepted explanation spends one unit of the month's weekly-summary
    budget. So the cost of a duplicate request is not a wasted round trip — it
    is one of a small number of explanations the user gets this month, spent on
    a sentence they already have on screen.

    The button being disabled while a call is in flight is the visible half.
    The other half is that the handler refuses to start a second call at all,
    which is what covers the window between the click and the re-render.
  */

  it("starts one request even when the handler fires twice before a re-render", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchWeeklyReview.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    const button = screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ });

    // Both clicks land inside one act, so React has not re-rendered between
    // them and `disabled` cannot be what stops the second one.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    expect(fetchWeeklyReview).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(aiResponse());
    });
    expect(fetchWeeklyReview).toHaveBeenCalledTimes(1);
  });

  it("disables the button and says what it is doing while the call is open", async () => {
    fetchWeeklyReview.mockReturnValue(new Promise(() => undefined));
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    const button = screen.getByRole("button", { name: /Wird formuliert/ });
    expect(button).toBeDisabled();
  });

  it("offers a retry after a failure, and spends exactly one more unit on it", async () => {
    fetchWeeklyReview.mockRejectedValueOnce(new WeeklyReviewError("UNAVAILABLE"));
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));

    // The failure is named, and the button says what pressing it now does.
    expect(await screen.findByText(/gerade nicht verfügbar/)).toBeInTheDocument();
    const retry = await screen.findByRole("button", { name: "Erneut versuchen" });

    fetchWeeklyReview.mockResolvedValueOnce(aiResponse());
    await userEvent.click(retry);

    expect(await screen.findByText("Zwei von drei")).toBeInTheDocument();
    expect(fetchWeeklyReview).toHaveBeenCalledTimes(2);
  });

  it("stops offering the call once the monthly budget is gone", async () => {
    fetchWeeklyReview.mockResolvedValue(
      aiResponse({
        aiStatus: "quota_exceeded",
        recommendation: { ...aiResponse().recommendation, source: "deterministic" },
        quota: { remaining: 0, limit: 8, period: "2026-09" },
      })
    );
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    await userEvent.click(screen.getByRole("button", { name: /Vom KI-Coach erklären lassen/ }));
    expect(await screen.findByText(/keine KI-Erklärungen mehr verfügbar/)).toBeInTheDocument();

    /*
      A retry cannot succeed until the month turns over, so offering one would
      only invite a user to press a button that does nothing.
    */
    expect(screen.queryByRole("button", { name: /KI-Coach|Erneut versuchen/ })).toBeNull();
    expect(fetchWeeklyReview).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of the backend until the user asks for it", async () => {
    render(<CoachingRecommendation metrics={metrics({ completions: done([0, 2]) })} />);

    // No call on mount, on render, or on a timer: the deterministic
    // recommendation is already on screen and costs nothing.
    await waitFor(() => expect(fetchWeeklyReview).not.toHaveBeenCalled());
  });
});

describe("what the recommendation never says", () => {
  const cases = [
    metrics(),
    metrics({ completions: done([0]) }),
    metrics({ completions: done([0, 2]) }),
    metrics({ completions: done([0, 2, 4]) }),
    metrics({ hasPlan: false, planDays: [], weekNumber: null }),
    metrics({
      completions: [...done([0, 2, 4]), ...previousWeek([0, 2, 4])],
      previousWeek: { weekKey: "Week 1", planDays: THREE_DAY_WEEK },
    }),
    metrics({
      planDays: FIVE_DAY_WEEK,
      completions: [...done([0]), ...previousWeek([0])],
      previousWeek: { weekKey: "Week 1", planDays: FIVE_DAY_WEEK },
    }),
    metrics({ planDays: EVERY_DAY_WEEK, completions: done([0, 1, 2, 3, 4, 5, 6]) }),
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

  it.each(cases.map((m, index) => [index, m] as const))(
    "case %i infers nothing the app has no data for",
    (_index, m) => {
      /*
        The five things this product is never allowed to claim, because nothing
        is persisted that could support them: detected fatigue, insufficient
        recovery, overtraining, readiness to progress, and a need to deload.
      */
      const { container } = render(<CoachingRecommendation metrics={m} />);
      const text = container.textContent ?? "";

      expect(text).not.toMatch(/erschöpf|ausgelaugt|müdigkeit|\bmüde\b|überlast|überforder/i);
      expect(text).not.toMatch(/regeneration|erholung|erholt|deload|entlastungswoche/i);
      expect(text).not.toMatch(/bereit für|zeit für mehr|nächste stufe|dein körper|belastbarkeit/i);
      expect(text).not.toMatch(/reduzier|verringer|pensum|trainiere (mehr|weniger|öfter)/i);
    }
  );
});

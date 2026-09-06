import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainingNudgeCard } from "./TrainingNudgeCard";
import { NUDGE_DELIVERY_NOTE } from "@/lib/nudges";
import type { TrainingNudge } from "@/lib/nudges";

const dayNudge: TrainingNudge = {
  type: "planned-session-today",
  key: "plan-1|Week 1|0|planned-session-today",
  dayKey: "plan-1|Week 1|0",
  title: "Heute ist eine Trainingseinheit geplant.",
  body: "Wenn es heute für dich passt, kannst du deinen Plan öffnen.",
  browserDeliverable: true,
};

const weeklyNudge: TrainingNudge = {
  type: "weekly-consistency",
  key: "plan-1|Week 1|0|weekly-consistency",
  /* Same training day as the day nudge above — one dismissal closes both. */
  dayKey: "plan-1|Week 1|0",
  title: "Diese Woche sind noch 2 von 3 geplanten Einheiten offen.",
  body: "Gezählt werden abgeschlossene Einheiten aus deinem Plan.",
  browserDeliverable: false,
};

describe("TrainingNudgeCard", () => {
  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<TrainingNudgeCard nudges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the nudge and says when hints appear", () => {
    render(<TrainingNudgeCard nudges={[dayNudge]} />);

    expect(screen.getByText(dayNudge.title)).toBeInTheDocument();
    expect(screen.getByText(dayNudge.body)).toBeInTheDocument();
    // The delivery limit is on the card itself, not buried in settings.
    expect(screen.getByText(NUDGE_DELIVERY_NOTE)).toBeInTheDocument();
  });

  it("adds the weekly count as context under the day nudge", () => {
    render(<TrainingNudgeCard nudges={[dayNudge, weeklyNudge]} />);

    expect(screen.getByText(weeklyNudge.title)).toBeInTheDocument();
  });

  it("offers one action, and it only opens the plan", async () => {
    const onOpenPlan = vi.fn();
    render(<TrainingNudgeCard nudges={[dayNudge]} onOpenPlan={onOpenPlan} />);

    await userEvent.click(screen.getByRole("button", { name: "Plan öffnen" }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it("hides the action when there is nowhere to navigate", () => {
    render(<TrainingNudgeCard nudges={[dayNudge]} />);
    expect(screen.queryByRole("button", { name: "Plan öffnen" })).not.toBeInTheDocument();
  });

  it("dismisses the training day, not one phrasing of it", async () => {
    /*
      The card hands back `dayKey`, so a dismissal covers the day however its
      wording changes later — dismissing "geplant" must not come back as "noch
      offen" once an exercise is ticked off.
    */
    const onDismiss = vi.fn();
    render(<TrainingNudgeCard nudges={[dayNudge, weeklyNudge]} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: "Hinweis ausblenden" }));
    expect(onDismiss).toHaveBeenCalledWith(dayNudge.dayKey);
    expect(onDismiss).not.toHaveBeenCalledWith(dayNudge.key);
  });
});

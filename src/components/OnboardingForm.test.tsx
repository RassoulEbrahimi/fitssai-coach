import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import "@/lib/i18n";
import OnboardingForm from "./OnboardingForm";
import OnboardingPage from "@/pages/OnboardingPage";

const mocks = vi.hoisted(() => ({
  save: vi.fn(), success: vi.fn(), error: vi.fn(), authLoading: false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "onboarding-test" }, loading: mocks.authLoading }),
}));
vi.mock("@/hooks/queries/useProfile", () => ({
  useUpdateProfile: () => ({ mutateAsync: mocks.save }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authLoading = false;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
});

const next = () => fireEvent.click(screen.getByRole("button", { name: "Weiter" }));
const fillPersonal = () => {
  for (const [label, value] of [["Vorname", "Mia"], ["Alter", "31"], ["Gewicht (kg)", "72"], ["Größe (cm)", "168"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
};
const expectStep = async (step: number, heading: string) => {
  expect(await screen.findByRole("heading", { level: 2, name: heading })).toBeVisible();
  expect(screen.getByText(`Schritt ${step} von 4`)).toBeVisible();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("progressbar", { name: "Fortschritt der Einrichtung" }))
    .toHaveAttribute("aria-valuetext", `Schritt ${step} von 4`);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(step));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "4");
  expect(document.body.textContent).not.toMatch(/Step \d of \d|Saving\.\.\.|Build strength|Reduce body fat|Enhance cardiovascular|Stay fit and healthy|Überprüfung|onboarding\./);
};
const goToGoals = async () => {
  fillPersonal();
  next();
  await expectStep(2, "Fitnessziel");
};
const goToDiet = async () => {
  await goToGoals();
  fireEvent.click(screen.getByRole("radio", { name: /Muskeln aufbauen/ }));
  next();
  await expectStep(3, "Ernährung & Erfahrung");
};
// Use the real Radix controls. Keyboard opening and selection also assert the
// trigger's accessible name comes from its visible label, before and after use.
const choose = async (label: string, option: string) => {
  const user = userEvent.setup();
  const trigger = screen.getByRole("combobox", { name: label });
  expect(screen.getByLabelText(label, { exact: true })).toBe(trigger);
  act(() => trigger.focus());
  await user.keyboard("{Enter}");
  const item = await screen.findByRole("option", { name: option });
  act(() => item.focus());
  await user.keyboard("{Enter}");
  await waitFor(() => expect(trigger).toHaveTextContent(option));
  expect(trigger).toHaveAccessibleName(label);
};
const goToTraining = async () => {
  await goToDiet();
  await choose("Ernährungsform", "Proteinreich");
  await choose("Erfahrungslevel", "Fortgeschritten");
  next();
  await expectStep(4, "Training");
};
const fillTraining = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Kurzhanteln" }));
  fireEvent.click(screen.getByRole("button", { name: "Körpergewicht" }));
  await choose("Trainingstage pro Woche", "4 Tage");
  await choose("Gewünschte Trainingsdauer", "45 Minuten");
};

describe("German onboarding", () => {
  it("localizes the page's initial loading state", () => {
    mocks.authLoading = true;
    render(<MemoryRouter><OnboardingPage /></MemoryRouter>);
    expect(screen.getByText("Wird geladen...")).toBeVisible();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("keeps four accurately named steps and preserves answers when going back", async () => {
    render(<OnboardingForm onComplete={vi.fn()} />);
    await expectStep(1, "Persönliche Angaben");
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    await goToTraining();
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    await expectStep(3, "Ernährung & Erfahrung");
    expect(screen.getByRole("combobox", { name: "Ernährungsform" })).toHaveTextContent("Proteinreich");
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    await expectStep(2, "Fitnessziel");
    expect(screen.getByRole("radio", { name: /Muskeln aufbauen/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
    await expectStep(1, "Persönliche Angaben");
    expect(screen.getByLabelText("Vorname")).toHaveValue("Mia");
  });

  it("associates German required errors with the personal inputs", async () => {
    render(<OnboardingForm onComplete={vi.fn()} />);
    next();
    for (const [label, message] of [["Vorname", "Bitte gib deinen Vornamen ein."], ["Alter", "Bitte gib dein Alter ein."], ["Gewicht (kg)", "Bitte gib dein Gewicht ein."], ["Größe (cm)", "Bitte gib deine Größe ein."]]) {
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(message);
    }
    fillPersonal();
    next();
    await expectStep(2, "Fitnessziel");
  });

  it.each([
    ["Vorname", "M", "Der Vorname muss mindestens 2 Zeichen lang sein."],
    ["Vorname", "M".repeat(51), "Der Vorname darf höchstens 50 Zeichen lang sein."],
    ["Alter", "12", "Du musst mindestens 13 Jahre alt sein."],
    ["Alter", "121", "Das Alter darf höchstens 120 Jahre betragen."],
    ["Alter", "20.5", "Bitte gib dein Alter als ganze Zahl ein."],
    ["Gewicht (kg)", "29", "Das Gewicht muss mindestens 30 kg betragen."],
    ["Gewicht (kg)", "301", "Das Gewicht darf höchstens 300 kg betragen."],
    ["Gewicht (kg)", "72.5", "Bitte gib dein Gewicht in ganzen Kilogramm ein."],
    ["Größe (cm)", "99", "Die Größe muss mindestens 100 cm betragen."],
    ["Größe (cm)", "251", "Die Größe darf höchstens 250 cm betragen."],
    ["Größe (cm)", "168.5", "Bitte gib deine Größe in ganzen Zentimetern ein."],
  ])("retains the bounds and localizes %s=%s", async (label, value, message) => {
    render(<OnboardingForm onComplete={vi.fn()} />);
    fillPersonal();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    next();
    expect(await screen.findByText(message)).toBeVisible();
    await expectStep(1, "Persönliche Angaben");
  });

  it("keeps goal labels clickable, descriptions German and arrow-key selection working", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm onComplete={vi.fn()} />);
    await goToGoals();
    next();
    expect(await screen.findByText("Bitte wähle ein Fitnessziel.")).toBeVisible();
    expect(screen.getByRole("radiogroup", { name: "Fitnessziel" })).toHaveAccessibleDescription("Bitte wähle ein Fitnessziel.");
    const descriptions = ["Kraft und Muskelmasse aufbauen", "Körperfett reduzieren und definierter werden", "Ausdauer und Herz-Kreislauf-Fitness verbessern", "Fitness und Gesundheit erhalten"];
    const values = ["gainMuscle", "loseFat", "improveCardio", "maintain"];
    for (let index = 0; index < descriptions.length; index++) {
      await user.click(screen.getByText(descriptions[index]));
      expect(screen.getAllByRole("radio")[index]).toBeChecked();
      expect(screen.getAllByRole("radio")[index]).toHaveAttribute("value", values[index]);
    }
    expect(screen.queryByText("Bitte wähle ein Fitnessziel.")).not.toBeInTheDocument();
    act(() => screen.getAllByRole("radio")[0].focus());
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(screen.getAllByRole("radio")[1]).toBeChecked());
    await user.keyboard("{/ArrowDown}");
  });

  it("labels all four Selects and clears stale errors on keyboard selection", async () => {
    render(<OnboardingForm onComplete={vi.fn()} />);
    await goToDiet();
    expect(screen.getByText("Ernährungsform auswählen")).toBeVisible();
    expect(screen.getByText("Erfahrungslevel auswählen")).toBeVisible();
    next();
    for (const [label, message, option] of [["Ernährungsform", "Bitte wähle deine Ernährungsform.", "Vegan"], ["Erfahrungslevel", "Bitte wähle dein Erfahrungslevel.", "Anfänger"]]) {
      await screen.findByText(message);
      expect(screen.getByRole("combobox", { name: label })).toHaveAccessibleDescription(message);
      expect(screen.getByRole("combobox", { name: label })).toHaveAttribute("aria-invalid", "true");
      await choose(label, option);
      await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument());
      expect(screen.getByRole("combobox", { name: label })).toHaveAttribute("aria-invalid", "false");
    }
    next();
    await expectStep(4, "Training");
    expect(screen.getByText("Trainingstage auswählen")).toBeVisible();
    expect(screen.getByText("Trainingsdauer auswählen")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Abschließen" }));
    const equipmentError = "Bitte wähle mindestens eine Ausrüstungsoption.";
    await screen.findByText(equipmentError);
    expect(screen.getByRole("group", { name: "Verfügbare Ausrüstung" })).toHaveAccessibleDescription(`Mehrfachauswahl möglich. ${equipmentError}`);
    for (const [label, message, option] of [["Trainingstage pro Woche", "Bitte wähle 1 bis 7 Trainingstage pro Woche.", "1 Tag"], ["Gewünschte Trainingsdauer", "Bitte wähle eine Trainingsdauer zwischen 15 und 180 Minuten.", "120 Minuten"]]) {
      expect(screen.getByRole("combobox", { name: label })).toHaveAccessibleDescription(message);
      await choose(label, option);
      await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument());
      expect(screen.getByRole("combobox", { name: label })).toHaveAttribute("aria-invalid", "false");
    }
    const user = userEvent.setup();
    const equipment = screen.getByRole("button", { name: "Kurzhanteln" });
    act(() => equipment.focus());
    await user.keyboard(" ");
    expect(equipment).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(equipmentError)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Körpergewicht" }));
    expect(equipment).toHaveAttribute("aria-pressed", "true");
    await user.click(equipment);
    expect(equipment).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Körpergewicht" })).toHaveAttribute("aria-pressed", "true");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([true, false])("localizes pending and save outcome (success=%s), retaining the payload", async (success) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((res, rej) => { resolve = res; reject = rej; }));
    const complete = vi.fn();
    render(<OnboardingForm onComplete={complete} />);
    await goToTraining();
    await fillTraining();
    fireEvent.click(screen.getByRole("button", { name: "Abschließen" }));
    const pending = await screen.findByRole("button", { name: "Wird gespeichert..." });
    expect(pending).toBeDisabled();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
    fireEvent.click(pending);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith({ full_name: "Mia", age: 31, weight: 72, height: 168, fitness_goal: "gainMuscle", dietary_preference: "highProtein", experience_level: "intermediate", equipment: ["dumbbells", "bodyweight"], daysPerWeek: 4, sessionMinutes: 45 });
    await act(async () => { if (success) resolve(); else reject(new Error("Network failed")); });
    if (success) {
      expect(mocks.success).toHaveBeenCalledWith("Profil wurde gespeichert.");
      expect(complete).toHaveBeenCalledTimes(1);
      expect(mocks.error).not.toHaveBeenCalled();
    } else {
      expect(mocks.error).toHaveBeenCalledWith("Profil konnte nicht gespeichert werden. Bitte versuche es erneut.");
      expect(complete).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    }
    expect(screen.getByRole("button", { name: "Abschließen" })).toBeEnabled();
  });
});

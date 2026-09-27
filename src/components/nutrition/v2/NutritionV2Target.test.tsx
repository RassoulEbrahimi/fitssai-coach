import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";

/*
  NUT-08: the TARGET card, its freshness notice and the target setup.

  Target values are labelled as the target and nothing else. Rendering and
  opening the setup call nothing and create nothing. Confirming saves the
  changed profile answers first and only then asks the server — whose real
  production answer today is TARGET_POLICY_NOT_CONFIGURED, shown neutrally.
*/

const store = vi.hoisted(() => ({ docs: new Map<string, unknown>() }));

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/"), id: segments[segments.length - 1] })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  getDoc: vi.fn(async (ref: { path: string; id: string }) => {
    const data = store.docs.get(ref.path);
    return { id: ref.id, exists: () => data !== undefined, data: () => data };
  }),
}));

const session = vi.hoisted(() => ({
  user: { uid: "alice", id: "alice" } as { uid: string; id: string } | null,
  profile: { status: "success", data: { id: "alice", age: 30 } } as { status: string; data: unknown },
  saveProfile: vi.fn(),
}));

const callable = vi.hoisted(() => ({ callNutritionSetTarget: vi.fn() }));

vi.mock("firebase/firestore", () => firestore);
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: session.user }) }));
vi.mock("@/hooks/queries/useProfile", () => ({
  useProfile: () => session.profile,
  useUpdateProfile: () => ({ mutateAsync: session.saveProfile }),
}));
vi.mock("@/lib/nutrition/v2/targetCallable", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nutrition/v2/targetCallable")>()),
  callNutritionSetTarget: callable.callNutritionSetTarget,
}));

import { NutritionV2TargetCard } from "./NutritionV2TargetCard";
import { NutritionV2TargetSection } from "./NutritionV2TargetSection";
import { NutritionTargetCallError } from "@/lib/nutrition/v2/targetCallable";
import { webSha256Hex } from "@/lib/nutrition/v2/sha256";
import { computeNutritionTargetFingerprint, type TargetVersion } from "@shared/nutrition";
import { makeState, makeTarget, values } from "@/test/nutritionV2Fixtures";

const STATE_PATH = "users/alice/nutrition_v2_state/current";
const targetPath = (id: string) => `users/alice/nutrition_v2_targets/${id}`;

const PROFILE = {
  id: "alice",
  age: 30,
  height: 172.5,
  weight: 68.25,
  biological_sex: "female",
  activity_level: "moderatelyActive",
  fitness_goal: "loseFat",
  nutrition_target_mode: "calculated",
  manual_target_kcal: null,
};

const PLAN_WORDS = /geplant|erfasst|verbraucht|gegessen/i;

const renderSection = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NutritionV2TargetSection />
      </QueryClientProvider>
    ),
  };
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
};

const openSetup = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Ziel festlegen" }));
  return screen.findByRole("dialog", { name: "Ziel festlegen" });
};

const submitSetup = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: "Ziel festlegen" }));

beforeEach(() => {
  store.docs.clear();
  firestore.getDoc.mockClear();
  session.user = { uid: "alice", id: "alice" };
  session.profile = { status: "success", data: { ...PROFILE } };
  session.saveProfile.mockReset();
  session.saveProfile.mockResolvedValue(undefined);
  callable.callNutritionSetTarget.mockReset();
  callable.callNutritionSetTarget.mockRejectedValue(new NutritionTargetCallError("TARGET_POLICY_NOT_CONFIGURED"));
});

afterEach(() => {
  delete (navigator as { onLine?: boolean }).onLine;
  // TanStack Query follows these events; leave it online for the next test.
  window.dispatchEvent(new Event("online"));
});

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

describe("the target card", () => {
  const success = (target: TargetVersion | null) => ({ status: "success" as const, data: target });

  it("labels the four values as the target, rounded for presentation only", () => {
    const target = makeTarget("tv-1", { values: values(2199.6, 139.5, 250.4, 70.49) });
    const before = structuredClone(target);
    render(<NutritionV2TargetCard target={success(target)} freshness={{ status: "fresh" }} />);

    const section = screen.getByRole("region", { name: "Ziel" });
    const list = within(section).getByTestId("nutrition-v2-target-values");
    expect(list).toHaveAccessibleName("Deine Zielwerte pro Tag");
    expect(within(list).getByTestId("nutrition-v2-target-kcal")).toHaveTextContent("Kalorien2.200 kcal");
    expect(within(list).getByTestId("nutrition-v2-target-proteinG")).toHaveTextContent("Eiweiß140 g");
    expect(within(list).getByTestId("nutrition-v2-target-carbsG")).toHaveTextContent("Kohlenhydrate250 g");
    expect(within(list).getByTestId("nutrition-v2-target-fatG")).toHaveTextContent("Fett70 g");
    expect(section).not.toHaveTextContent(PLAN_WORDS);
    // The model keeps the unrounded values.
    expect(target).toEqual(before);
  });

  it("names the mode and the date it applies from", () => {
    render(<NutritionV2TargetCard target={success(makeTarget())} freshness={{ status: "fresh" }} />);
    expect(screen.getByRole("region", { name: "Ziel" })).toHaveTextContent("Selbst festgelegtes Ziel · gilt seit 23. September 2026");
  });

  it("says when no target is set yet", () => {
    render(<NutritionV2TargetCard target={success(null)} freshness={{ status: "checking" }} onSetUp={() => undefined} />);
    expect(screen.getByRole("region", { name: "Ziel" })).toHaveTextContent("Du hast noch kein Ernährungsziel festgelegt.");
    expect(screen.getByRole("button", { name: "Ziel festlegen" })).toBeInTheDocument();
  });

  it("shows a neutral stale notice with an explicit review action", () => {
    const onSetUp = vi.fn();
    render(<NutritionV2TargetCard target={success(makeTarget())} freshness={{ status: "stale" }} onSetUp={onSetUp} />);

    const notice = screen.getByTestId("nutrition-v2-target-freshness");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("Deine Profildaten haben sich seit diesem Ziel geändert.");
    expect(notice).not.toHaveTextContent(/unsicher|gefährlich|falsch|Fehler/i);
    fireEvent.click(within(notice).getByRole("button", { name: "Ziel prüfen" }));
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });

  it("asks to check the profile when it cannot compare, distinct from fresh", () => {
    const { rerender } = render(
      <NutritionV2TargetCard
        target={success(makeTarget())}
        freshness={{ status: "cannotCompare", missingFields: ["height"], invalidFields: [], unknownFields: [] }}
      />
    );
    expect(screen.getByTestId("nutrition-v2-target-freshness")).toHaveTextContent("Profilangaben prüfen");
    expect(screen.getByTestId("nutrition-v2-target-freshness")).toHaveAttribute("data-freshness", "cannotCompare");

    rerender(<NutritionV2TargetCard target={success(makeTarget())} freshness={{ status: "fresh" }} />);
    expect(screen.queryByTestId("nutrition-v2-target-freshness")).toBeNull();
    rerender(<NutritionV2TargetCard target={success(makeTarget())} freshness={{ status: "checking" }} />);
    expect(screen.queryByTestId("nutrition-v2-target-freshness")).toBeNull();
  });

  it("renders nothing while no read is allowed", () => {
    const { container } = render(<NutritionV2TargetCard target={{ status: "disabled" }} freshness={{ status: "checking" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* ------------------------------------------------------------------ *
 * Section: reads, freshness, setup
 * ------------------------------------------------------------------ */

describe("the target section", () => {
  const seedTarget = async (profileData: Record<string, unknown>) => {
    const fields = ["activityLevel", "biologicalSex", "fitnessGoal", "height", "weight"] as const;
    const policy = { id: "test-fixture-calculated", version: 1 };
    const fingerprint = await computeNutritionTargetFingerprint(
      {
        mode: "calculated",
        policy,
        fields,
        values: {
          activityLevel: profileData.activity_level as never,
          biologicalSex: profileData.biological_sex as never,
          fitnessGoal: profileData.fitness_goal as never,
          height: profileData.height as number,
          weight: profileData.weight as number,
        },
      },
      webSha256Hex
    );
    store.docs.set(STATE_PATH, makeState({ activePlanId: null, currentTargetVersionId: "tv-1" }));
    store.docs.set(targetPath("tv-1"), makeTarget("tv-1", { mode: "calculated", policy, profileFingerprint: fingerprint }));
  };

  it("shows the current target through the state pointer and calls nothing", async () => {
    await seedTarget(PROFILE);
    renderSection();

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toHaveTextContent("2.200 kcal");
    await waitFor(() => expect(screen.queryByText("Ziel ändern")).toBeInTheDocument());
    expect(screen.queryByTestId("nutrition-v2-target-freshness")).toBeNull();
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
    expect(session.saveProfile).not.toHaveBeenCalled();
  });

  it("marks the target stale after a relevant profile change, without writing", async () => {
    await seedTarget(PROFILE);
    session.profile = { status: "success", data: { ...PROFILE, weight: 72 } };
    renderSection();

    expect(await screen.findByTestId("nutrition-v2-target-freshness")).toHaveAttribute("data-freshness", "stale");
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
    expect(session.saveProfile).not.toHaveBeenCalled();
    expect(store.docs.get(targetPath("tv-1"))).toMatchObject({ targetVersionId: "tv-1" });
  });

  it("does not mark it stale for an irrelevant profile change", async () => {
    await seedTarget(PROFILE);
    session.profile = { status: "success", data: { ...PROFILE, dietary_preference: "keto", meals_per_day: 3 } };
    renderSection();

    await screen.findByText("Ziel ändern");
    expect(screen.queryByTestId("nutrition-v2-target-freshness")).toBeNull();
  });

  it("asks to check the profile when a required answer is gone", async () => {
    await seedTarget(PROFILE);
    session.profile = { status: "success", data: { ...PROFILE, height: null } };
    renderSection();

    expect(await screen.findByTestId("nutrition-v2-target-freshness")).toHaveTextContent("Profilangaben prüfen");
  });

  it("renders nothing for a minor and reads no target", async () => {
    session.profile = { status: "success", data: { ...PROFILE, age: 17 } };
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(firestore.getDoc).not.toHaveBeenCalledWith(expect.objectContaining({ path: STATE_PATH }));
  });

  it("opens the setup without calling anything or creating any document", async () => {
    renderSection();
    const dialog = await openSetup();

    expect(within(dialog).getByRole("group", { name: "Art des Ziels" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Größe (cm)")).toHaveValue("172.5");
    fireEvent.change(within(dialog).getByLabelText("Gewicht (kg)"), { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Selbst festlegen" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));

    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
    expect(session.saveProfile).not.toHaveBeenCalled();
    expect([...store.docs.keys()]).toEqual([]);
  });

  it("saves the changed profile first, then asks the server, and shows NOT_CONFIGURED neutrally", async () => {
    const order: string[] = [];
    session.saveProfile.mockImplementation(async () => void order.push("profile"));
    callable.callNutritionSetTarget.mockImplementation(async () => {
      order.push("target");
      throw new NutritionTargetCallError("TARGET_POLICY_NOT_CONFIGURED");
    });
    renderSection();
    const dialog = await openSetup();

    fireEvent.change(within(dialog).getByLabelText("Gewicht (kg)"), { target: { value: "70,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sehr aktiv" }));
    submitSetup(dialog);

    const message = await within(dialog).findByTestId("nutrition-v2-target-setup-message");
    expect(order).toEqual(["profile", "target"]);
    expect(session.saveProfile.mock.calls).toEqual([[{ weight: 70.5, activity_level: "veryActive" }]]);
    expect(callable.callNutritionSetTarget.mock.calls).toHaveLength(1);
    expect(Object.keys(callable.callNutritionSetTarget.mock.calls[0][0]).sort()).toEqual(["mode", "requestId"]);
    expect(callable.callNutritionSetTarget.mock.calls[0][0].mode).toBe("calculated");

    expect(message).toHaveAttribute("role", "status");
    expect(message).toHaveTextContent("Die Zielberechnung ist noch nicht verfügbar.");
    expect(message).toHaveTextContent("Deine Profilangaben wurden gespeichert.");
    expect(message).not.toHaveTextContent(/Fehler|fehlgeschlagen/);
    expect(message.className).not.toMatch(/destructive/);
    // Nothing was created on the client.
    expect([...store.docs.keys()]).toEqual([]);
  });

  it("asks the server without a profile save when nothing changed", async () => {
    renderSection();
    const dialog = await openSetup();
    submitSetup(dialog);

    await within(dialog).findByTestId("nutrition-v2-target-setup-message");
    expect(session.saveProfile).not.toHaveBeenCalled();
    expect(callable.callNutritionSetTarget).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByTestId("nutrition-v2-target-setup-message")).not.toHaveTextContent("gespeichert");
  });

  it("lists missing profile fields by name only", async () => {
    callable.callNutritionSetTarget.mockRejectedValue(
      new NutritionTargetCallError("PROFILE_INCOMPLETE", { missingFields: ["height"], invalidFields: ["activityLevel"] })
    );
    renderSection();
    const dialog = await openSetup();
    submitSetup(dialog);

    const message = await within(dialog).findByTestId("nutrition-v2-target-setup-message");
    expect(message).toHaveTextContent("Für dieses Ziel fehlen noch Angaben: Größe.");
    expect(message).toHaveTextContent("Bitte prüfe diese Angaben: Aktivitätslevel.");
    expect(message).not.toHaveTextContent(/172|68|female|moderatelyActive/);
  });

  it("refuses invalid answers locally and saves nothing", async () => {
    renderSection();
    const dialog = await openSetup();
    fireEvent.change(within(dialog).getByLabelText("Größe (cm)"), { target: { value: "0" } });
    submitSetup(dialog);

    expect(await within(dialog).findByText("Bitte prüfe diese Angabe.")).toBeInTheDocument();
    expect(session.saveProfile).not.toHaveBeenCalled();
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
  });

  it("does not ask for a target when the profile save failed", async () => {
    session.saveProfile.mockRejectedValue(new Error("permission-denied"));
    renderSection();
    const dialog = await openSetup();
    fireEvent.change(within(dialog).getByLabelText("Gewicht (kg)"), { target: { value: "71" } });
    submitSetup(dialog);

    const message = await within(dialog).findByRole("alert");
    expect(message).toHaveTextContent("Deine Profilangaben konnten nicht gespeichert werden. Es wurde kein Ziel festgelegt.");
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
  });

  it("is unavailable offline: nothing is saved, sent or queued", async () => {
    renderSection();
    const dialog = await openSetup();
    setOnline(false);

    expect(await within(dialog).findByText("Ein Ziel kann nur mit Internetverbindung festgelegt werden.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ziel festlegen" })).toBeDisabled();
    fireEvent.submit(within(dialog).getByRole("button", { name: "Ziel festlegen" }).closest("form") as HTMLFormElement);

    expect(session.saveProfile).not.toHaveBeenCalled();
    expect(callable.callNutritionSetTarget).not.toHaveBeenCalled();
    expect(localStorage.getItem("FITSSAI_OFFLINE_QUEUE")).toBeNull();

    // Close it, so Radix restores what it hid from assistive technology.
    fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("converges on the new target after the server set it", async () => {
    callable.callNutritionSetTarget.mockImplementation(async () => {
      // What the server's transaction commits.
      store.docs.set(STATE_PATH, makeState({ activePlanId: null, currentTargetVersionId: "tv-9" }));
      store.docs.set(targetPath("tv-9"), makeTarget("tv-9", { values: values(1800.4, 120, 200, 60) }));
      return { ok: true, targetVersionId: "tv-9", replay: false };
    });
    renderSection();
    const dialog = await openSetup();
    fireEvent.click(within(dialog).getByRole("button", { name: "Selbst festlegen" }));
    fireEvent.change(within(dialog).getByLabelText("Kalorienziel pro Tag (kcal)"), { target: { value: "1800" } });
    submitSetup(dialog);

    expect(await screen.findByTestId("nutrition-v2-target-kcal")).toHaveTextContent("1.800 kcal");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(session.saveProfile.mock.calls).toEqual([[{ manual_target_kcal: 1800, nutrition_target_mode: "manual" }]]);
    expect(callable.callNutritionSetTarget.mock.calls[0][0].mode).toBe("manual");
  });
});

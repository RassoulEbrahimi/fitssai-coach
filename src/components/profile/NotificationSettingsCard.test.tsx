import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationSettingsCard } from "./NotificationSettingsCard";

/*
  The control surface, tested against the promise it makes: the state shown is
  the browser's, permission is never requested without a click, and a denial
  is never re-prompted or dressed up as "enabled".
*/

const requestPermission = vi.fn(async () => "granted" as NotificationPermission);

const stubNotification = (permission: NotificationPermission) => {
  const Notification = function () {} as unknown as typeof window.Notification;
  (Notification as unknown as { permission: NotificationPermission }).permission = permission;
  (Notification as unknown as { requestPermission: unknown }).requestPermission = requestPermission;
  Object.defineProperty(window, "Notification", {
    value: Notification,
    configurable: true,
    writable: true,
  });
};

const removeNotification = () =>
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "Notification");

beforeEach(() => {
  requestPermission.mockClear();
  removeNotification();
});

afterEach(removeNotification);

describe("NotificationSettingsCard", () => {
  it("says so where the browser has no notifications, and offers no button", () => {
    render(<NotificationSettingsCard />);

    expect(screen.getByText("Nicht verfügbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erlauben" })).not.toBeInTheDocument();
  });

  it("never asks for permission on mount", () => {
    stubNotification("default");
    render(<NotificationSettingsCard />);

    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.getByText("Nicht aktiviert")).toBeInTheDocument();
  });

  it("asks only when the user presses the button", async () => {
    stubNotification("default");
    render(<NotificationSettingsCard />);

    await userEvent.click(screen.getByRole("button", { name: "Erlauben" }));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Erlaubt")).toBeInTheDocument();
  });

  it("shows a denial as blocked, and does not offer to ask again", () => {
    stubNotification("denied");
    render(<NotificationSettingsCard />);

    expect(screen.getByText("Blockiert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erlauben" })).not.toBeInTheDocument();
  });

  it("reports permission from the browser rather than an app-side flag", () => {
    stubNotification("granted");
    render(<NotificationSettingsCard />);

    expect(screen.getByText("Erlaubt")).toBeInTheDocument();
  });

  it("states that nothing arrives while the app is closed", () => {
    render(<NotificationSettingsCard />);

    expect(
      screen.getByText(/keine Benachrichtigungen bei geschlossener App/i)
    ).toBeInTheDocument();
  });
});

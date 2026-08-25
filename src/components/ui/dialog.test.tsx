import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

/**
 * Mirrors how AddWorkoutModal now uses the primitive: an external trigger
 * controls `open`, and closing routes through `onOpenChange`. These assertions
 * are the behaviour the hand-rolled overlay did not provide.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Übung hinzufügen
      </button>
      <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Training hinzufügen</DialogTitle>
            <DialogDescription>Übungen hinzufügen</DialogDescription>
          </DialogHeader>
          <button type="button">Erstes Feld</button>
          <button type="button">Zweites Feld</button>
        </DialogContent>
      </Dialog>
      <button type="button">Ausserhalb</button>
    </>
  );
}

describe("dialog primitive accessibility", () => {
  it("opens from the trigger with dialog semantics and a meaningful title", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Captured before opening: once the dialog is up this element is removed
    // from the accessibility tree, so role queries can no longer reach it.
    const outside = screen.getByRole("button", { name: "Ausserhalb" });

    await user.click(screen.getByRole("button", { name: "Übung hinzufügen" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Training hinzufügen")).toBeInTheDocument();

    // Radix enforces modality by marking the rest of the page aria-hidden
    // rather than by setting aria-modal on the dialog itself.
    expect(outside.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ausserhalb" })).toBeNull();
  });

  it("traps focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const outside = screen.getByRole("button", { name: "Ausserhalb" });
    const trigger = screen.getByRole("button", { name: "Übung hinzufügen" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");

    // Tab repeatedly; focus must never reach the page behind the dialog.
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(outside).not.toHaveFocus();
      expect(trigger).not.toHaveFocus();
    }
    // And it does come back around to the dialog's own controls.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Übung hinzufügen" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("releases focus and restores the page after closing", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Übung hinzufügen" });
    const outside = screen.getByRole("button", { name: "Ausserhalb" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Focus is no longer held inside the (removed) dialog, and the page behind
    // is back in the accessibility tree and focusable.
    expect(document.activeElement?.closest('[role="dialog"]')).toBeFalsy();
    expect(outside.closest('[aria-hidden="true"]')).toBeNull();

    trigger.focus();
    expect(trigger).toHaveFocus();
  });

  it("re-opens cleanly after being closed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Übung hinzufügen" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("exposes a named close control", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Übung hinzufügen" }));
    await screen.findByRole("dialog");

    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});

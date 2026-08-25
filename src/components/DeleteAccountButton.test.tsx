import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeleteAccountButton } from "./DeleteAccountButton";

describe("DeleteAccountButton", () => {
  it("renders nothing while support contact details are not configured", () => {
    // Neither SUPPORT_EMAIL nor DELETION_RESPONSE_COMMITMENT has been
    // supplied, so no deletion CTA may be exposed.
    const { container } = render(<DeleteAccountButton />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: /Konto löschen/i })).not.toBeInTheDocument();
  });

  it("exposes no backend or migration jargon", () => {
    const { container } = render(<DeleteAccountButton />);

    expect(container.textContent ?? "").not.toMatch(/Firebase|Migration|Blaze|Cloud Function/i);
  });
});

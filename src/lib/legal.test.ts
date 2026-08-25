import { describe, it, expect } from "vitest";
import {
  LEGAL_DOCUMENTS,
  getAvailableLegalDocuments,
  getLegalDocument,
  hasAvailableLegalDocuments,
} from "./legal";

describe("legal registry", () => {
  it("declares the three required documents", () => {
    expect(LEGAL_DOCUMENTS.map((d) => d.id)).toEqual([
      "impressum",
      "datenschutz",
      "agb",
    ]);
  });

  it("gives each document a German label and a route", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.label).toBeTruthy();
      expect(doc.path).toMatch(/^\/legal\//);
    }
  });

  it("ships with no document marked available", () => {
    // No approved legal copy exists yet, so nothing may be exposed.
    expect(LEGAL_DOCUMENTS.every((doc) => doc.available === false)).toBe(true);
    expect(getAvailableLegalDocuments()).toEqual([]);
    expect(hasAvailableLegalDocuments()).toBe(false);
  });

  it("contains no legal prose — only document names", () => {
    // Labels are titles, not statements. Anything long enough to read as
    // legal copy would be a content decision, not a structural one.
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.label.length).toBeLessThan(30);
      expect(doc.label).not.toMatch(/\./);
    }
  });

  it("contains no placeholder tokens", () => {
    const serialized = JSON.stringify(LEGAL_DOCUMENTS);
    expect(serialized).not.toMatch(/\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]/);
    expect(serialized.toLowerCase()).not.toContain("lorem");
    expect(serialized.toLowerCase()).not.toContain("tbd");
  });

  it("looks documents up by id", () => {
    expect(getLegalDocument("impressum")?.label).toBe("Impressum");
    expect(getLegalDocument("unknown")).toBeUndefined();
    expect(getLegalDocument(undefined)).toBeUndefined();
  });
});

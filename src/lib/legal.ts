/**
 * Legal document registry.
 *
 * The structure exists so routes and a footer can be wired up now, but no
 * legal text is invented here. Each document stays `available: false` until
 * real, approved copy is added — and while a document is unavailable its
 * entry point is not rendered at all, so nothing ships that could read as a
 * legal statement or as an unfinished placeholder.
 *
 * To publish one: add the reviewed copy to a component, point `path` at its
 * route, and flip `available` to true. Nothing else needs to change.
 */

export type LegalDocumentId = "impressum" | "datenschutz" | "agb";

export interface LegalDocument {
  id: LegalDocumentId;
  /** German label for the link. Naming a document is not legal copy. */
  label: string;
  path: string;
  /**
   * False until reviewed content exists. Gates both the route content and the
   * footer entry point.
   */
  available: boolean;
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { id: "impressum", label: "Impressum", path: "/legal/impressum", available: false },
  { id: "datenschutz", label: "Datenschutz", path: "/legal/datenschutz", available: false },
  { id: "agb", label: "AGB", path: "/legal/agb", available: false },
] as const;

/** Only documents with reviewed content may be linked. */
export const getAvailableLegalDocuments = (): LegalDocument[] =>
  LEGAL_DOCUMENTS.filter((doc) => doc.available);

export const getLegalDocument = (id: string | undefined): LegalDocument | undefined =>
  LEGAL_DOCUMENTS.find((doc) => doc.id === id);

/** True when at least one document can be shown; the footer hides entirely otherwise. */
export const hasAvailableLegalDocuments = (): boolean => getAvailableLegalDocuments().length > 0;

import { Navigate, useParams } from "react-router-dom";
import { getLegalDocument } from "@/lib/legal";

/**
 * `/legal/:document`
 *
 * The route exists so the structure is in place, but a document with no
 * reviewed content is not rendered as an empty or provisional page — it
 * redirects instead. That keeps unfinished legal surfaces unreachable in
 * production without special-casing the router.
 */
const LegalPage = () => {
  const { document: documentId } = useParams<{ document: string }>();
  const doc = getLegalDocument(documentId);

  if (!doc || !doc.available) {
    return <Navigate to="/" replace />;
  }

  // Reviewed content is rendered per document once it exists.
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{doc.label}</h1>
    </main>
  );
};

export default LegalPage;

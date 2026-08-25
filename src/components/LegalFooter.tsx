import { Link } from "react-router-dom";
import { getAvailableLegalDocuments } from "@/lib/legal";

/**
 * Signed-out legal footer.
 *
 * Renders nothing at all while no legal document has reviewed content, so the
 * signed-out surface never shows a link to an empty page or any provisional
 * wording. Once a document is marked available in the registry, its link
 * appears here automatically.
 */
export const LegalFooter = ({ className = "" }: { className?: string }) => {
  const documents = getAvailableLegalDocuments();
  if (documents.length === 0) return null;

  return (
    <nav aria-label="Rechtliches" className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {documents.map((doc) => (
          <li key={doc.id}>
            <Link
              to={doc.path}
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {doc.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default LegalFooter;

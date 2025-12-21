import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * ScrollToTop
 * 
 * Automatically resets the window scroll position to (0,0) whenever
 * the pathname or hash changes. This ensures valid "page-like" navigation
 * behavior in a Single Page Application.
 */
export default function ScrollToTop() {
    const { pathname } = useLocation();

    useEffect(() => {
        // Reset the dedicated scroll container
        const scrollContainer = document.getElementById("app-scroll");
        if (scrollContainer) {
            scrollContainer.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
        // Also reset window scroll just in case (e.g. for mobile address bar)
        window.scrollTo(0, 0);
    }, [pathname]);

    return null;
}

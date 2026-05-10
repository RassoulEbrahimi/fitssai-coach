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
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });

        // Keep resetting the legacy container during the scroll-model transition.
        const scrollContainer = document.getElementById("app-scroll");
        if (scrollContainer) {
            scrollContainer.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
    }, [pathname]);

    return null;
}

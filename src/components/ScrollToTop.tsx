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
    const { pathname, hash } = useLocation();

    useEffect(() => {
        // Immediate scroll reset
        window.scrollTo(0, 0);
    }, [pathname, hash]);

    return null;
}

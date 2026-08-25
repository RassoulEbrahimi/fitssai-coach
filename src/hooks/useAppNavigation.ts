import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { AppView, parseHashRoute, getRouteForView, NAVIGATION_CONFIG, NAVIGATION_Order } from '@/lib/navigation';

interface UseAppNavigationReturn {
    activeView: AppView;
    navigateTo: (view: AppView) => void;
    direction: 1 | -1;
    /** Query parameters carried by the current hash, e.g. `?w=2&d=3`. */
    routeParams: URLSearchParams;
}

export const useAppNavigation = (): UseAppNavigationReturn => {
    // Initialize from the current hash, path and query parsed separately.
    const initialRoute = parseHashRoute(window.location.hash);

    const [activeView, setActiveView] = useState<AppView>(initialRoute.view);
    const [direction, setDirection] = useState<1 | -1>(1);
    const previousViewRef = useRef<AppView>(activeView);

    /**
     * Query parameters as they were on first load. Deep links are restored
     * once, from this snapshot: the workout view rewrites the hash as the
     * user browses weeks, so reading live params later would fight it.
     */
    const initialParamsRef = useRef<URLSearchParams>(initialRoute.params);

    // Sync state with URL hash changes (bi-directional)
    useEffect(() => {
        const handleHashChange = () => {
            const { view: newView } = parseHashRoute(window.location.hash);
            if (newView !== activeView) {
                setActiveView(newView);
            }
        };

        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, [activeView]);

    // Handle document title and scroll reset on view change
    useLayoutEffect(() => {
        // Update direction
        const prevIndex = NAVIGATION_Order.indexOf(previousViewRef.current);
        const nextIndex = NAVIGATION_Order.indexOf(activeView);

        if (prevIndex !== nextIndex) {
            setDirection(nextIndex > prevIndex ? 1 : -1);
        }

        previousViewRef.current = activeView;

        // Update Title
        document.title = NAVIGATION_CONFIG[activeView].title;

        // Reset Scroll
        const resetAppScroll = () => {
            window.scrollTo({ top: 0, left: 0, behavior: "auto" });

            const el = document.getElementById("app-scroll");
            if (el) {
                el.scrollTo({ top: 0, left: 0, behavior: "auto" });
            }
        };

        resetAppScroll();
        // Double-trigger for safety with layout/animations
        requestAnimationFrame(resetAppScroll);

    }, [activeView]);

    const navigateTo = useCallback((view: AppView) => {
        if (view === activeView) return;

        const path = getRouteForView(view);
        // Push new state
        history.pushState(null, '', `#${path}`);
        setActiveView(view);

        // Haptic feedback (optional)
        try {
            if (navigator.vibrate) navigator.vibrate(8);
        } catch (e) {
            // ignore
        }
    }, [activeView]);

    return { activeView, navigateTo, direction, routeParams: initialParamsRef.current };
};

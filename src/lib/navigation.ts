import { Home, Dumbbell, Utensils, User, LucideIcon } from "lucide-react";

export type AppView = 'dashboard' | 'workout' | 'nutrition' | 'profile';

export interface ViewConfig {
    id: AppView;
    label: string;
    path: string; // hash path, e.g., '/' or '/workout'
    icon: LucideIcon;
    title: string; // Document title
}

export const NAVIGATION_CONFIG: Record<AppView, ViewConfig> = {
    dashboard: {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/',
        icon: Home,
        title: 'FitssAI — Dashboard',
    },
    workout: {
        id: 'workout',
        label: 'Trainingsplan',
        path: '/workout',
        icon: Dumbbell,
        title: 'FitssAI — Trainingsplan',
    },
    nutrition: {
        id: 'nutrition',
        label: 'Ernährungsplan',
        path: '/nutrition',
        icon: Utensils,
        title: 'FitssAI — Ernährungsplan',
    },
    profile: {
        id: 'profile',
        label: 'Profil',
        path: '/profile',
        icon: User,
        title: 'FitssAI — Profil',
    },
};

export const NAVIGATION_Order: AppView[] = ['dashboard', 'workout', 'nutrition', 'profile'];

export const getRouteForView = (view: AppView): string => {
    return NAVIGATION_CONFIG[view].path;
};

export interface ParsedRoute {
    view: AppView;
    /** Query parameters from the hash, e.g. `#/workout?w=2&d=3`. */
    params: URLSearchParams;
}

/**
 * Split a hash into pathname and query, then resolve the view.
 *
 * The hash carries its own query string (`#/workout?w=2&d=3`), so the path
 * must be isolated before it is matched against the route table — comparing
 * the raw hash meant any deep link with parameters fell back to Dashboard.
 */
export const parseHashRoute = (hash: string): ParsedRoute => {
    const raw = (hash || '').replace(/^#/, '');
    const queryStart = raw.indexOf('?');
    const pathname = (queryStart === -1 ? raw : raw.slice(0, queryStart)).toLowerCase();
    const search = queryStart === -1 ? '' : raw.slice(queryStart + 1);

    const params = new URLSearchParams(search);

    if (pathname === '' || pathname === '/') {
        return { view: 'dashboard', params };
    }

    // Tolerate a trailing slash so `#/workout/` resolves like `#/workout`.
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const entry = Object.values(NAVIGATION_CONFIG).find(cfg => cfg.path === normalized);

    return { view: entry ? entry.id : 'dashboard', params };
};

export const getViewForRoute = (hash: string): AppView => parseHashRoute(hash).view;

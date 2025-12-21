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

export const getViewForRoute = (hash: string): AppView => {
    const clean = (hash || '').replace(/^#/, '').toLowerCase();

    // Direct match or root
    if (clean === '' || clean === '/') return 'dashboard';

    // Find matching config
    const entry = Object.values(NAVIGATION_CONFIG).find(cfg => cfg.path === clean);
    return entry ? entry.id : 'dashboard';
};

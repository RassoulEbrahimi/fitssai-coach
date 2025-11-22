import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
import RootRedirect from "@/components/RootRedirect";
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import OnboardingPage from './pages/OnboardingPage';
import AdminPanel from './pages/AdminPanel';
import NotFound from './pages/NotFound';
import { FarewellPage } from './pages/FarewellPage';
import "./lib/i18n";

// Create persistent query client with 24h cache expiration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

// Create persister using localStorage with manual implementation
const persister = {
  persistClient: async (client: any) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('FITSSAI_CACHE', JSON.stringify(client));
      }
    } catch (error) {
      // Silent fail - storage not available
    }
  },
  restoreClient: async () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const cached = window.localStorage.getItem('FITSSAI_CACHE');
        return cached ? JSON.parse(cached) : undefined;
      }
    } catch (error) {
      // Silent fail - storage not available
    }
    return undefined;
  },
  removeClient: async () => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('FITSSAI_CACHE');
      }
    } catch (error) {
      // Silent fail
    }
  },
};

const App = () => {
  const { i18n } = useTranslation();

  useEffect(() => {
    // DE-only mode: Force German language and LTR direction
    document.documentElement.dir = 'ltr';
    document.documentElement.lang = 'de';
  }, []);

  useEffect(() => {
    // Prevent browser from auto-restoring scroll on back navigation
    if ('scrollRestoration' in history) {
      const prev = history.scrollRestoration;
      history.scrollRestoration = 'manual';
      return () => { history.scrollRestoration = prev; };
    }
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buster: 'fitssai-v1', // Increment to invalidate all caches
      }}
    >
      <ThemeProvider>
        <PreferencesProvider>
          <AuthProvider>
            <TooltipProvider>
            <div className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:p-2 focus:bg-background focus:z-50">
              <a href="#main-content" className="mr-4">Zum Hauptinhalt springen</a>
              <a href="#navigation">Zur Navigation springen</a>
            </div>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/auth/:mode" element={<AuthPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/farewell" element={<FarewellPage />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
            </TooltipProvider>
          </AuthProvider>
        </PreferencesProvider>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
};

export default App;

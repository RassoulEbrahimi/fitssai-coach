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
import { FocusModeProvider } from "@/contexts/FocusModeContext";
import { TrainingProvider } from "@/contexts/TrainingContext";
import RootRedirect from "@/components/RootRedirect";
import ScrollToTop from "@/components/ScrollToTop";
import "./lib/i18n";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Suspense, lazy } from "react";
import PageSkeleton from "@/components/skeletons/PageSkeleton"; // Assuming this exists or using a generic loader
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";

// Lazy load pages
const AuthPage = lazy(() => import('./pages/AuthPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const NotFound = lazy(() => import('./pages/NotFound'));
const FarewellPage = lazy(() => import('./pages/FarewellPage').then(module => ({ default: module.FarewellPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));

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
    <QueryProvider>
      <ThemeProvider>
        <PreferencesProvider>
          <FocusModeProvider>
            <TrainingProvider>
              <AuthProvider>
                <TooltipProvider>
                  <div className="sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 focus:p-2 focus:bg-background focus:z-50">
                    <a href="#main-content" className="mr-4">Zum Hauptinhalt springen</a>
                    <a href="#navigation">Zur Navigation springen</a>
                  </div>
                  <Toaster />
                  <Sonner />
                  <PWAInstallPrompt />
                  <BrowserRouter basename="/fitssai-coach">
                    <ScrollToTop />
                    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>}>
                      <Routes>
                        <Route path="/" element={<RootRedirect />} />
                        <Route path="/auth/reset" element={<ResetPasswordPage />} />
                        <Route path="/auth/:mode" element={<AuthPage />} />
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/onboarding" element={<OnboardingPage />} />
                        <Route path="/admin" element={<AdminPanel />} />
                        <Route path="/farewell" element={<FarewellPage />} />
                        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </Suspense>
                  </BrowserRouter>
                </TooltipProvider>
              </AuthProvider>
            </TrainingProvider>
          </FocusModeProvider>
        </PreferencesProvider>
      </ThemeProvider>
    </QueryProvider>
  );
};

export default App;

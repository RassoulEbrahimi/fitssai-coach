import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shown when authentication could not be initialized on this load.
 *
 * The app continues signed out rather than behind a blank frame, so sign-in and
 * password reset stay reachable. This says why, in one line, instead of leaving
 * a returning user to conclude they were silently logged out.
 */
export const AuthUnavailableBanner: React.FC = () => {
  const { authUnavailable } = useAuth();

  if (!authUnavailable) return null;

  return (
    <div
      className="w-full bg-destructive/10 text-destructive px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium"
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>Anmeldung konnte nicht geladen werden. Bitte melde dich erneut an.</span>
    </div>
  );
};

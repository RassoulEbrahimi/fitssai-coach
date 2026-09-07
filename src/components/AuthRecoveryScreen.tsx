import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { AuthInitFailure } from '@/lib/authInitialization';

interface AuthRecoveryScreenProps {
  cause: AuthInitFailure;
  /** True while the automatic repair is clearing state and reloading. */
  repairing: boolean;
  onRetry: () => void;
}

/**
 * What is shown instead of the app when authentication could not start.
 *
 * Deliberately not a sign-in form. The instance behind it cannot publish an
 * identity, so a sign-in here would succeed against the server and leave the
 * app signed out anyway — the worst of both, telling the user something worked
 * when nothing did. Better to say what is wrong and offer the one action that
 * can actually fix it.
 */
export const AuthRecoveryScreen: React.FC<AuthRecoveryScreenProps> = ({ cause, repairing, onRetry }) => (
  <div
    className="min-h-screen w-full flex items-center justify-center bg-background p-6"
    role="alert"
    aria-live="polite"
  >
    <div className="max-w-sm w-full text-center space-y-4">
      {repairing ? (
        <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-8 w-8 mx-auto text-destructive" aria-hidden="true" />
      )}

      <h1 className="text-lg font-semibold text-foreground">
        {repairing ? 'Anmeldung wird wiederhergestellt' : 'Anmeldung nicht verfügbar'}
      </h1>

      <p className="text-sm text-muted-foreground">
        {repairing
          ? 'Die App wird gleich neu geladen.'
          : cause === 'unresponsive'
            ? 'Die Anmeldung antwortet nicht. Deine Trainingsdaten bleiben gespeichert.'
            : 'Die Anmeldung konnte nicht gestartet werden. Deine Trainingsdaten bleiben gespeichert.'}
      </p>

      {!repairing && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Erneut versuchen
        </button>
      )}
    </div>
  </div>
);

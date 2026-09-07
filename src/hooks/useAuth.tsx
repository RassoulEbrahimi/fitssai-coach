import { useState, useEffect, useCallback, createContext, useContext, Fragment } from "react";
import { User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { signOutAccount } from '@/lib/signOut';
import { clearSignOutSensitiveStorage } from '@/lib/storage';
import { observeAuthInitializationFailure, type AuthInitFailure } from '@/lib/authInitialization';
import { attemptAuthPersistenceRecovery, clearAuthRecoveryMarker } from '@/lib/authPersistenceRecovery';
import { AuthRecoveryScreen } from '@/components/AuthRecoveryScreen';

// AppUser extends FirebaseUser with `.id` alias to `.uid`
// so all existing `user?.id` references continue to work.
export type AppUser = FirebaseUser & { id: string };

const wrapUser = (u: FirebaseUser | null): AppUser | null => {
  if (!u) return null;
  return Object.assign(Object.create(Object.getPrototypeOf(u)), u, { id: u.uid });
};

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  /**
   * Authentication could not be started on this load, so there is no identity
   * to be had from this Auth instance and none can arrive later. Consumers are
   * never mounted in this state; the recovery screen stands in their place.
   */
  authUnavailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthGate =
  | { status: 'pending' }
  | { status: 'ready' }
  | { status: 'unavailable'; cause: AuthInitFailure; repairing: boolean };

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [gate, setGate] = useState<AuthGate>({ status: 'pending' });

  /*
    Every way this can end has to leave a usable screen.

    `repairing` is only true while a reload is genuinely on its way. Anything
    else — the guard that could not be stored, storage that cannot be reached,
    IndexedDB that would not open, a repair already spent, or an error nobody
    anticipated — puts the retry button back and keeps the recovery mode. An
    unhandled rejection here would leave a spinner over an app the user has no
    way out of, so the whole promise is caught, not just its known outcomes.
  */
  const runRecovery = useCallback((cause: AuthInitFailure, { force }: { force: boolean }) => {
    const stop = (detail: unknown) => {
      if (detail) console.error('[Auth] Recovery did not complete.', detail);
      setGate({ status: 'unavailable', cause, repairing: false });
    };
    return attemptAuthPersistenceRecovery({ auth, force }).then(
      outcome => { if (outcome.status !== 'reloading') stop(outcome); },
      error => stop(error),
    );
  }, []);

  useEffect(() => {
    /*
      Two ways out of the gate, and only the observer can publish a user.

      The observer is authoritative: it resolves the gate with whatever identity
      Firebase restored, including none. Failure resolves it only to "no
      identity is coming", because an initialization that rejected has none to
      offer. Holding the gate instead would leave the whole app behind a
      permanently blank frame.

      Whichever arrives first wins and the loser is disconnected. The observer
      still outranks a declared failure if it somehow fires afterwards — a slow
      restore that eventually lands is a real identity and is not thrown away.
    */
    const stopWatchingInit = observeAuthInitializationFailure(auth, (cause, reason) => {
      console.error('[Auth] Initialization did not resolve.', cause, reason);
      clearSignOutSensitiveStorage();
      setUser(null);

      /*
        A rejected initialization is proof: `_isInitialized` will never be set,
        so this instance drops every publication for the rest of its life —
        signing in against it would report success and leave the app signed
        out. Only a fresh instance can help, which means clearing the persisted
        auth state that broke it and reloading. Once per tab, so a store that
        cannot be repaired does not reload forever.

        An unresponsive initialization proves nothing, so nothing is destroyed
        for it; the user is offered the repair instead of having it done to them.
      */
      if (cause !== 'initialization-failed') {
        setGate({ status: 'unavailable', cause, repairing: false });
        return;
      }
      setGate({ status: 'unavailable', cause, repairing: true });
      void runRecovery(cause, { force: false });
    });

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      stopWatchingInit();
      clearSignOutSensitiveStorage();
      // Authentication works here, so a repair is no longer owed and the next
      // genuine failure — this visit or a later one — may try again.
      clearAuthRecoveryMarker();
      setUser(wrapUser(firebaseUser));
      setGate({ status: 'ready' });
    });

    return () => {
      stopWatchingInit();
      unsub();
    };
    // runRecovery is stable, so listing it re-subscribes nothing.
  }, [runRecovery]);

  const retryRecovery = useCallback(() => {
    if (gate.status !== 'unavailable') return;
    setGate({ ...gate, repairing: true });
    // Asked for by hand, so it is honoured even after the automatic attempt and
    // even where the loop guard cannot be stored: the click is the bound.
    void runRecovery(gate.cause, { force: true });
  }, [gate, runRecovery]);

  return (
    <AuthContext.Provider value={{
      user,
      loading: gate.status === 'pending',
      authUnavailable: gate.status === 'unavailable',
      signOut: signOutAccount,
    }}>
      {/* Never hydrate before identity resolves; replace mounted account state on UID change. */}
      {gate.status === 'ready' && <Fragment key={user?.uid ?? 'signed-out'}>{children}</Fragment>}
      {gate.status === 'unavailable' && (
        <AuthRecoveryScreen cause={gate.cause} repairing={gate.repairing} onRetry={retryRecovery} />
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

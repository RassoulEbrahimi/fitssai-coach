import { useState, useEffect, createContext, useContext, Fragment } from "react";
import { User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { signOutAccount } from '@/lib/signOut';
import { clearSignOutSensitiveStorage } from '@/lib/storage';
import { observeAuthInitializationFailure } from '@/lib/authInitialization';

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
   * Authentication could not be initialized, so there is no identity to be had
   * on this load. Consumers are mounted signed-out; nothing account-scoped
   * hydrates. Distinct from a resolved signed-out state so the UI can say so.
   */
  authUnavailable: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser]       = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  useEffect(() => {
    /*
      Two ways out of the gate, and only one of them can publish a user.

      The observer is authoritative: it resolves the gate with whatever identity
      Firebase restored, including none. The failure signal only ever resolves
      it to signed-out, because an initialization that rejected has no identity
      to offer and a malformed persisted user is not a signed-in one. Holding
      the gate instead would leave the whole app — sign-in and password reset
      included — behind a permanently blank frame.

      Whichever arrives first wins, and the loser is disconnected. If the
      observer somehow fires after a failure was declared, it is still the
      authority and promotes the app to the real account; that transition is
      the same UID change every other sign-in goes through, so it remounts
      cleanly rather than looping.
    */
    // Armed before subscribing, so an observer that reports synchronously can
    // still disarm it rather than leaving a watchdog running behind a resolved
    // identity.
    const stopWatchingInit = observeAuthInitializationFailure(auth, (reason) => {
      console.error('[Auth] Initialization failed; continuing signed out.', reason);
      clearSignOutSensitiveStorage();
      setUser(null);
      setAuthUnavailable(true);
      setLoading(false);
    });
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      stopWatchingInit();
      clearSignOutSensitiveStorage();
      setAuthUnavailable(false);
      setUser(wrapUser(firebaseUser));
      setLoading(false);
    });
    return () => {
      stopWatchingInit();
      unsub();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, authUnavailable, signOut: signOutAccount }}>
      {/* Never hydrate before identity resolves; replace mounted account state on UID change. */}
      {!loading && <Fragment key={user?.uid ?? 'signed-out'}>{children}</Fragment>}
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

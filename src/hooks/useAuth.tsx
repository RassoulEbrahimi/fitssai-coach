import { useState, useEffect, createContext, useContext } from "react";
import { User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";

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
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser]       = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(wrapUser(firebaseUser));
      setLoading(false);
    });
    return unsub;
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
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

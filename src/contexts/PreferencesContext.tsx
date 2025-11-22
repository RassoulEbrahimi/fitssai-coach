import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const STORAGE_KEY = 'fitssai.preferences.enableAdvancedGlass';

interface PreferencesContextValue {
  enableAdvancedGlass: boolean;
  setEnableAdvancedGlass: (value: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [enableAdvancedGlass, setEnableAdvancedGlassState] = useState<boolean>(() => {
    // Default to false (advanced effects OFF by default)
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const setEnableAdvancedGlass = (value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
      setEnableAdvancedGlassState(value);
    } catch (error) {
      console.error('Failed to save advanced glass preference:', error);
    }
  };

  // Sync across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnableAdvancedGlassState(e.newValue === 'true');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return (
    <PreferencesContext.Provider value={{ enableAdvancedGlass, setEnableAdvancedGlass }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}

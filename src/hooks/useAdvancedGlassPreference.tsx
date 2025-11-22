import { useState, useEffect } from 'react';

const STORAGE_KEY = 'fitssai.preferences.enableAdvancedGlass';

export function useAdvancedGlassPreference() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    // Default to false (advanced effects OFF by default)
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'true';
    } catch {
      return false;
    }
  });

  const setEnabled = (value: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
      setEnabledState(value);
      // Dispatch custom event for instant reactivity across components
      window.dispatchEvent(new Event('fitssai-advanced-glass-updated'));
    } catch (error) {
      console.error('Failed to save advanced glass preference:', error);
    }
  };

  // Sync across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setEnabledState(e.newValue === 'true');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return { enabled, setEnabled };
}

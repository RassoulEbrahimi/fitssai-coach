import React, { createContext, useContext, useState, useCallback } from "react";

interface FocusModeContextType {
  isFocusMode: boolean;
  setFocusMode: (value: boolean) => void;
  toggleFocusMode: () => void;
}

const FocusModeContext = createContext<FocusModeContextType | undefined>(undefined);

export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [isFocusMode, setIsFocusMode] = useState(false);

  const setFocusMode = useCallback((value: boolean) => {
    setIsFocusMode(value);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => !prev);
  }, []);

  return (
    <FocusModeContext.Provider value={{ isFocusMode, setFocusMode, toggleFocusMode }}>
      {children}
    </FocusModeContext.Provider>
  );
}

export function useFocusMode() {
  const context = useContext(FocusModeContext);
  if (context === undefined) {
    throw new Error("useFocusMode must be used within a FocusModeProvider");
  }
  return context;
}

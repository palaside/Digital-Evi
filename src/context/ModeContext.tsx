import React, { createContext, useContext, useState, ReactNode } from 'react';

export type AppMode = 'CHAT' | 'SLIP' | 'HYBRID';

interface ModeContextProps {
  mode: AppMode | null;
  setMode: (mode: AppMode) => void;
  hasChosen: boolean;
}

const ModeContext = createContext<ModeContextProps | undefined>(undefined);

export const ModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeInternal] = useState<AppMode | null>(null);
  const hasChosen = !!mode;
  const setMode = (m: AppMode) => {
    setModeInternal(m);
    localStorage.setItem('selectedAppMode', m);
  };
  return (
    <ModeContext.Provider value={{ mode, setMode, hasChosen }}>
      {children}
    </ModeContext.Provider>
  );
};

export const useMode = (): ModeContextProps => {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return ctx;
};

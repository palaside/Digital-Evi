// src/components/ModeSelectorPanel.tsx
import React from 'react';
import { useMode } from '@/context/ModeContext';

/**
 * Panel that renders mode selection buttons.
 * Currently only the SLIP button is required as the first button.
 */
export const ModeSelectorPanel: React.FC = () => {
  const { setMode, mode } = useMode();

  const handleClick = (m: 'CHAT' | 'SLIP' | 'HYBRID') => {
    setMode(m);
  };

  return (
    <div className="flex gap-2 items-center mt-2">
      {/* SLIP button – must be first */}
      <button
        onClick={() => handleClick('SLIP')}
        className={`btn-proportional-primary glass-button glass-button-cyan text-xs ${mode === 'SLIP' ? 'border-2 border-cyan-300' : ''}`}
        title="SLIP mode"
      >
        SLIP
      </button>
      {/* Other mode buttons can be added here in the future */}
    </div>
  );
};

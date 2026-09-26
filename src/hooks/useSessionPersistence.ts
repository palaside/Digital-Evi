"use client";

import { useEffect, useState } from "react";

export function useSessionPersistence<T>(key: string, initialValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`digital_evi_${key}`);
      if (stored) {
        setState(JSON.parse(stored));
      }
    } catch {
      // Ignore parse/storage errors
    } finally {
      setHydrated(true);
    }
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(`digital_evi_${key}`, JSON.stringify(state));
    } catch {
      // Ignore quota/storage errors
    }
  }, [key, state, hydrated]);

  return [state, setState];
}

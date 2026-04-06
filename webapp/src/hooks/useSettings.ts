import { useCallback, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import type { Settings } from '../types';

export function useSettings() {
  const { state, dispatch } = useApp();
  const { settings } = state;

  // Apply dark mode whenever the setting changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.dark);
  }, [settings.dark]);

  const updateSettings = useCallback(
    (partial: Partial<Settings>) => {
      dispatch({ type: 'SET_SETTINGS', settings: partial });
    },
    [dispatch],
  );

  const saveSettings = useCallback(() => {
    // SET_SETTINGS already persists to localStorage in the reducer,
    // so this is a no-op save (for explicit "Save" button semantics).
    localStorage.setItem('agentSettings', JSON.stringify(settings));
  }, [settings]);

  return { settings, updateSettings, saveSettings };
}

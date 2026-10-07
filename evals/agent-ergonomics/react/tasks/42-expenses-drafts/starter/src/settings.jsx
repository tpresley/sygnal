import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// The user's settings, saved in this browser (localStorage) and restored on reload.
const STORAGE_KEY = 'expenses-settings'
const DEFAULT_SETTINGS = { currency: 'USD', defaultCategory: '' }

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))?.settings
    return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

const SettingsContext = createContext(null)

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings }))
  }, [settings])

  const changeSetting = useCallback((name, value) => setSettings((old) => ({ ...old, [name]: value })), [])
  const value = useMemo(() => ({ ...settings, changeSetting }), [settings, changeSetting])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** { currency, defaultCategory, changeSetting(name, value) } */
export function useSettings() {
  return useContext(SettingsContext)
}

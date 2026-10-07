import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NO_BUDGETS } from './expenses.js'

// The user's settings, saved in this browser (localStorage) and restored on reload.
const STORAGE_KEY = 'expenses-settings'
const DEFAULT_SETTINGS = { currency: 'USD', defaultCategory: '', budgets: NO_BUDGETS }

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))?.settings
    return saved ? { ...DEFAULT_SETTINGS, ...saved, budgets: { ...NO_BUDGETS, ...saved.budgets } } : DEFAULT_SETTINGS
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

  const changeBudget = useCallback((category, value) => setSettings((old) => ({ ...old, budgets: { ...old.budgets, [category]: value } })), [])
  const changeSetting = useCallback((name, value) => setSettings((old) => ({ ...old, [name]: value })), [])
  const value = useMemo(() => ({ ...settings, changeSetting, changeBudget }), [settings, changeSetting, changeBudget])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** { currency, defaultCategory, budgets, changeSetting(name, value), changeBudget(category, value) } */
export function useSettings() {
  return useContext(SettingsContext)
}

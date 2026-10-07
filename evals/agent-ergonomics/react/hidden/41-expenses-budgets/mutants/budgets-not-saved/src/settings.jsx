import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NO_BUDGETS } from './expenses.js'

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
  const [budgets, setBudgets] = useState(NO_BUDGETS)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings }))
  }, [settings])

  const changeBudget = useCallback((category, value) => setBudgets((old) => ({ ...old, [category]: value })), [])
  const changeSetting = useCallback((name, value) => setSettings((old) => ({ ...old, [name]: value })), [])
  const value = useMemo(() => ({ ...settings, budgets, changeSetting, changeBudget }), [settings, budgets, changeSetting, changeBudget])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

/** { currency, defaultCategory, budgets, changeSetting(name, value), changeBudget(category, value) } */
export function useSettings() {
  return useContext(SettingsContext)
}

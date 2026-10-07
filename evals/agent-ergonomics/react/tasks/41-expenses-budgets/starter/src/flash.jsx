import { createContext, useCallback, useContext, useMemo, useState } from 'react'

// The message a page shows after an action ("Expense added"), read by FlashMessage.
const FlashContext = createContext(null)

export function FlashProvider({ children }) {
  const [flash, setFlash] = useState(null)
  // a new message replaces the old one; its id restarts FlashMessage's timer
  const showFlash = useCallback((text) => setFlash((old) => ({ id: (old?.id ?? 0) + 1, text })), [])
  const dismissFlash = useCallback(() => setFlash(null), [])
  const value = useMemo(() => ({ flash, showFlash, dismissFlash }), [flash, showFlash, dismissFlash])
  return <FlashContext.Provider value={value}>{children}</FlashContext.Provider>
}

export function useFlash() {
  return useContext(FlashContext)
}

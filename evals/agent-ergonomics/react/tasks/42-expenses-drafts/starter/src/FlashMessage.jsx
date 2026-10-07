import { useEffect } from 'react'
import { useFlash } from './flash.jsx'

// Shows the current message until it is dismissed or 3 seconds have passed.
// A new message replaces the old one and gets its own 3 seconds.
export default function FlashMessage() {
  const { flash, dismissFlash } = useFlash()

  useEffect(() => {
    if (!flash) return undefined
    const timer = setTimeout(dismissFlash, 3000)
    return () => clearTimeout(timer)
  }, [flash, dismissFlash])

  return (
    <div className="flash-bar">
      {flash && (
        <p className="flash" role="status">
          {flash.text}
        </p>
      )}
      {flash && (
        <button className="dismiss" onClick={dismissFlash}>
          Dismiss
        </button>
      )}
    </div>
  )
}

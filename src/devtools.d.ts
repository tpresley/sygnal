// 'sygnal/devtools' (D77): importing it installs the DevTools bridge
// (window.__SYGNAL_DEVTOOLS__) in a browser, for the Sygnal DevTools extension.
// Dev only: sygnal/vite injects it in dev; without Vite, import it before run().
// Self-contained (like the other dev entries' types); the same shape as
// SygnalDevTools in 'sygnal'.

export interface SygnalDevTools {
  /** true while the browser extension is connected */
  readonly connected: boolean
  /** Diagnostics collected so far (same as getDiagnostics() from 'sygnal') */
  getDiagnostics(): Array<{ code: string; severity: string; message: string; [key: string]: any }>
  /** The app graph; present only when the 'sygnal/diagnostics' dev entry is loaded */
  inspect?(): any
}

/** The bridge singleton of this entry (also window.__SYGNAL_DEVTOOLS__ once installed). */
export declare function getDevTools(): SygnalDevTools
/** Install the bridge (done on import; idempotent). Undefined outside a browser. */
export declare function installDevTools(): SygnalDevTools | undefined

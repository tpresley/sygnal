/*
 * Browser signals (PLAN-3 §1.6, H-6): window focus / the page becoming visible, and the network
 * coming back online. makeFetchDriver's refetchOnFocus / refetchOnReconnect and refetchEvery use
 * them; PLAN-4's browser sources reuse them. Safe without a DOM (SSR, Node): nothing fires.
 */

export type BrowserSignal = 'focus' | 'online';

/** true while the document is hidden (a background tab); false without a DOM */
export const isHidden = (): boolean => (globalThis as any).document?.visibilityState == 'hidden';

/**
 * Calls `fn('focus')` when the window gains focus or the document becomes visible, and
 * `fn('online')` when the browser goes online. Returns the unsubscribe function.
 */
export const onBrowserSignals = (fn: (signal: BrowserSignal) => void): (() => void) => {
  const w: any = (globalThis as any).window;
  if (!w?.addEventListener) return () => {};
  const focus = () => isHidden() || fn('focus'), online = () => fn('online');
  const on: Array<[any, string, () => void]> = [[w, 'focus', focus], [w, 'online', online], [w.document, 'visibilitychange', focus]];
  on.forEach(([t, e, f]) => t?.addEventListener(e, f));
  return () => on.forEach(([t, e, f]) => t?.removeEventListener(e, f));
};

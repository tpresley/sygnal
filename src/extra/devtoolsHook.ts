import type {SygnalDevTools} from './devtools';

/**
 * The installed DevTools bridge, or undefined (D77: the bridge itself lives in the
 * 'sygnal/devtools' dev entry, which sygnal/vite injects in dev).
 */
export function getDevTools(): SygnalDevTools | undefined {
  return (globalThis as any).__SYGNAL_DEVTOOLS__;
}

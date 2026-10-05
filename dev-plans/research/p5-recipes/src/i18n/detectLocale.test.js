// @vitest-environment node
// G-443 (3-G): detectLocale() on the server. Node 21+ has a global `navigator` (with the
// server's language), so `typeof navigator` no longer tells the server from the browser: the
// server rendered in its own locale. It is 'en' there now; the browser's language in a browser.
// (Not shown on the page.)
import { test, expect, vi, afterEach } from 'vitest'
import { detectLocale } from './i18n.js'

afterEach(() => vi.unstubAllGlobals())

test('on the server: en, whatever navigator.language says', () => {
  vi.stubGlobal('navigator', { language: 'fr-FR' })
  expect(typeof window).toBe('undefined')
  expect(detectLocale()).toBe('en')
})

test('in a browser: the language when supported, else en', () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { language: 'fr-CA' })
  expect(detectLocale()).toBe('fr')
  vi.stubGlobal('navigator', { language: 'de-DE' })
  expect(detectLocale()).toBe('en')
  vi.stubGlobal('navigator', {})
  expect(detectLocale()).toBe('en')
})

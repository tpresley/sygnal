/**
 * 7.2 (sygnal/canvas research, maintainer decision 2): `keymap(DOM, table)`, keyboard shortcuts as
 * named action streams. Useful outside canvases, so it is on the main export (tree-shaken: 0 B for
 * an app that doesn't import it).
 *
 *   App.intent = ({ DOM }) => ({
 *     ...keymap(DOM, { 'mod+z': 'UNDO', 'shift+mod+z': 'REDO', delete: 'DELETE', left: ['NUDGE', { dx: -1 }] }),
 *     UNDO: xs.merge(DOM.click('.undo'), keys.UNDO),     // or merged with a button
 *   })
 *
 * - A combo is modifiers then a key, `+`-joined: `mod` (⌘ or Ctrl), `ctrl`, `meta`, `shift`, `alt`.
 *   The key is `e.key` lower-cased (`a`, `=`, `escape`, `backspace`, `arrowleft`; aliases `left`
 *   `right` `up` `down` `del` `esc` `space`), and digits match `e.code` (`shift+1` is `!` in `e.key`).
 *   A combo matches only its own modifiers (`z` is not `shift+z`).
 * - An entry's value is an action name (its stream emits `undefined`) or `[name, data]`; several
 *   combos may name one action (one stream).
 * - A matched key is default-prevented (⌘D doesn't bookmark), and no shortcut fires while the
 *   focus is in an input, a textarea, a select or a contenteditable element.
 * - `on` (default 'document'): the selector whose keydown events count.
 */
const ALIAS: Record<string, string> = {left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', del: 'delete', esc: 'escape', space: ' '}
const typing = (t: any) => /^(INPUT|TEXTAREA|SELECT)$/i.test(t?.tagName || '') || !!t?.isContentEditable

type Combo = {key: string, mod: boolean, ctrl: boolean, meta: boolean, shift: boolean, alt: boolean}
const parse = (c: string): Combo => {
  const parts = c.toLowerCase().split('+'), key = parts.pop() || '+', has = (m: string) => parts.includes(m)
  return {key: ALIAS[key] || key, mod: has('mod') || has('cmd'), ctrl: has('ctrl'), meta: has('meta'), shift: has('shift'), alt: has('alt')}
}
// shift+1 is "!" in e.key: digits match e.code
const keyOf = (e: any) => /^Digit\d$/.test(e.code || '') ? e.code.slice(5) : (e.key || '').toLowerCase()
const matches = (c: Combo, e: any) => keyOf(e) == c.key && !!e.shiftKey == c.shift && !!e.altKey == c.alt &&
  (c.mod ? !!(e.metaKey || e.ctrlKey) : !!e.ctrlKey == c.ctrl && !!e.metaKey == c.meta)

export function keymap(DOM: any, table: Record<string, string | [string, any]>, {on = 'document'}: {on?: string} = {}): Record<string, any> {
  const entries = Object.keys(table).map(combo => { const a = table[combo]; return {combo: parse(combo), name: Array.isArray(a) ? a[0] : a, data: Array.isArray(a) ? a[1] : undefined} })
  const find = (e: any) => typing(e.target) ? null : entries.find(x => matches(x.combo, e)) || null
  const keys = DOM.select(on).events('keydown', {preventDefault: (e: any) => !!find(e)}).map(find).filter(Boolean)
  const out: Record<string, any> = {}
  for (const x of entries) out[x.name] ||= keys.filter((k: any) => k.name == x.name).map((k: any) => k.data)
  return out
}

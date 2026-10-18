/**
 * textDocument/completion (PLAN-7 N-2, P4-1): Sygnal names inside the strings and object keys
 * TypeScript treats as opaque. Answered on the main thread, without a check: the cursor's context
 * comes from the document's current text (cursorContext.js: parse → repair → line prefix), and
 * the names and their owners from the completion index of the folder's last check
 * (completionIndex.js, built in the check worker), so a completion costs one parse of one file
 * (a few, when it needs a repair) and never waits for a running check.
 *
 *   indexState(index, sources) → state         kept per folder after each check
 *   complete({ text, offset, file, state, snippets, readFile })
 *     → { strategy, repair?, context, matched, items } | null
 *       null: the cursor is in no region (nothing parsed); strategy/repair: cursorContext.js's;
 *       context: its kind; matched: the context belongs to a region of its kind (a component's
 *       intent object, model ...), even when no name is left to offer
 *   completionList(result)     → CompletionList | null
 *
 * Ownership: the index's regions (intent function, the objects it returns, the model object, the
 * view, the action-naming statics) are offsets into the text the check analysed. The cursor is
 * mapped into that text through the common prefix and suffix of the two texts (an edit since
 * the check maps to its start), so the index of a file that doesn't parse now (its last good
 * text, core.js) still places the cursor: the 'line' strategy relies on it. A cursor outside
 * every region gets null before anything is parsed: no items outside Sygnal contexts.
 *
 * Contexts → names (all from the cursor's component unless noted):
 *   intent key                         model actions nothing triggers yet
 *   model key                          triggered actions without a model entry (intent, next,
 *                                      reply, timers/browser/resources/connections/route, agent),
 *                                      then BOOTSTRAP / INITIALIZE / DISPOSE; a snippet
 *                                      `NAME: (state, data) => ({ ...state })` for a fresh key
 *                                      when the client supports snippets
 *   DOM.select('…') / DOM.click('…')   the view's classes (.x) and ids (#x); after `.` only
 *                                      classes, after `#` only ids
 *   EVENTS.select('…')                 EVENTS types emitted anywhere in the project
 *   event('…') / emit('…')             EVENTS types selected anywhere in the project
 *   next('…'), ok/error/progress/delta/tool/block: '…' in the model, timers' action/frame, browser's
 *   action/error, resources' ok/error, connections' message/open/close/error
 *                                      the model's actions
 *   <Collection from="…">              initialState and calculated keys
 */
import path from 'node:path'
import { cursorContext } from './cursorContext.js'
import { lineStarts, positionAt } from '../edits.js'
import { textHash } from './convert.js'
import { BUILTIN_ACTIONS, HTTP_REPLY_KEYS, LLM_REPLY_KEYS } from '../model/modelEntries.js'

export const TRIGGER_CHARACTERS = ["'", '"', '`', '.', '#']

/** LSP CompletionItemKind values used here. */
export const Kind = Object.freeze({ Field: 5, Class: 7, Value: 12, Reference: 18, EnumMember: 20, Event: 23 })

const MODEL_VALUE_KEYS = new Set([...HTTP_REPLY_KEYS, ...LLM_REPLY_KEYS])
const LIFECYCLE = ['BOOTSTRAP', 'INITIALIZE', 'DISPOSE']
const IDENT = /^[A-Za-z_$][\w$]*$/
const VIA = {
  intent: 'intent action', next: 'next() target', reply: 'reply action', timer: 'timer action',
  browser: 'browser action', resource: 'resource reply', connection: 'connection action',
  route: 'route action', agent: 'agent action',
}

/** The main thread's view of one check's completion index. */
export function indexState(index, sources = new Map()) {
  if (!index) return null
  const byFile = new Map()
  for (const f of index.files) byFile.set(f.file, { hash: f.hash, text: f.text ?? null, regions: f.regions, verified: undefined })
  return { index, byFile, sources }
}

/** The text a file's regions refer to, or null when it isn't known any more. */
function indexText(state, file, entry, readFile) {
  if (entry.verified !== undefined) return entry.verified
  let text = entry.text ?? state.sources.get(file)
  if (text == null && readFile) text = readFile(file)
  entry.verified = text != null && textHash(text) === entry.hash ? text : null
  return entry.verified
}

/** Offsets between the analysed text (old) and the current one (new): common prefix and suffix. */
export function textMapper(oldText, newText) {
  const max = Math.min(oldText.length, newText.length)
  let p = 0
  while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++
  const oldEnd = oldText.length - s
  const newEnd = newText.length - s
  return {
    // the end of the changed span (where a truncation or a replacement leaves the cursor) maps to its start
    toOld: (o) => o <= p ? o : o > newEnd ? o - newEnd + oldEnd : p,
    toNew: (o) => o <= p ? o : o >= oldEnd ? o - oldEnd + newEnd : p,
  }
}

const uniqueBy = (list, key) => {
  const seen = new Map()
  for (const x of list) if (!seen.has(key(x))) seen.set(key(x), x)
  return [...seen.values()]
}

function placesOf(list, type, field) {
  const files = uniqueBy(list.filter(e => e.type === type && e.file), e => e.file).map(e => path.basename(e.file))
  if (!files.length) return field === 'emitted' ? 'built in' : 'implicitly'
  return files.length > 1 ? `${files[0]} and ${files.length - 1} more` : files[0]
}

/** Names for a context, in the cursor's regions: [{ label, kind, detail, sort, insert? }] or null. */
function namesFor(ctx, regions, state, oldCursor, toNew) {
  const comps = (kinds) => uniqueBy(regions.filter(r => kinds.includes(r.kind)), r => r.comp).map(r => ({ r, c: state.index.components[r.comp] }))
  const entries = (list) => list.flatMap(({ c }) => c.entries.map(name => ({ label: name, kind: Kind.EnumMember, detail: `model action · ${c.name}`, sort: '0' })))
  switch (ctx.kind) {
    case 'key': {
      // the key's own object is the region's object: the same start (before the cursor, so it maps
      // exactly; its end may not, after a truncation or a repair); for 'line', not inside a value
      const atTop = (r) => ctx.objects
        ? ctx.objects[0]?.[0] === toNew(r.start)
        : !(r.values || []).some(([s, e]) => s < oldCursor && oldCursor <= e)
      const model = comps(['model']).filter(({ r }) => atTop(r))
      if (model.length) {
        const out = []
        for (const { c } of model) {
          const handled = new Set(c.entries)
          for (const t of c.triggers) if (!handled.has(t.name) && !BUILTIN_ACTIONS.has(t.name)) out.push({ label: t.name, kind: Kind.EnumMember, detail: `${VIA[t.via] || t.via} · ${c.name} (no model entry)`, sort: '0', modelKey: true })
          for (const b of LIFECYCLE) if (!handled.has(b)) out.push({ label: b, kind: Kind.EnumMember, detail: 'built-in action', sort: '2', modelKey: true })
        }
        return out
      }
      const intent = comps(['intentObject']).filter(({ r }) => atTop(r))
      if (intent.length) {
        return intent.flatMap(({ c }) => {
          const triggered = new Set(c.triggers.map(t => t.name))
          return c.entries.filter(n => !triggered.has(n) && !BUILTIN_ACTIONS.has(n) && !n.includes('|'))
            .map(name => ({ label: name, kind: Kind.EnumMember, detail: `model action · ${c.name} (no trigger)`, sort: '0' }))
        })
      }
      return null
    }
    case 'selector': {
      const list = comps(['intent'])
      if (!list.length) return null
      const out = []
      for (const { c } of list) {
        for (const x of c.classes) out.push({ label: '.' + x, kind: Kind.Class, detail: `class in ${c.name}'s view`, sort: '0' })
        for (const x of c.ids) out.push({ label: '#' + x, kind: Kind.Reference, detail: `id in ${c.name}'s view`, sort: '1' })
      }
      return out
    }
    case 'events': {
      const { emitted } = state.index.events
      return uniqueBy(emitted, e => e.type).map(e => ({ label: e.type, kind: Kind.Event, detail: `EVENTS type emitted in ${placesOf(emitted, e.type, 'emitted')}`, sort: '0' }))
    }
    case 'emit': {
      const { selected } = state.index.events
      return uniqueBy(selected, e => e.type).map(e => ({ label: e.type, kind: Kind.Event, detail: `EVENTS type selected in ${placesOf(selected, e.type, 'selected')}`, sort: '0' }))
    }
    case 'next':
      return entries(comps(['model', 'modelHelper']))
    case 'value': {
      const list = [
        ...(MODEL_VALUE_KEYS.has(ctx.key) ? comps(['model', 'modelHelper']) : []),
        ...comps(['names']).filter(({ r }) => r.keys.includes(ctx.key)),
      ]
      return list.length ? entries(list) : null
    }
    case 'from':
      return comps(['view']).flatMap(({ c }) => c.stateKeys.map(k => ({ label: k.name, kind: Kind.Field, detail: `${k.via} key · ${c.name}`, sort: k.via === 'initialState' ? '0' : '1' })))
  }
  return null
}

/** The range a selector completion replaces: the class/id token at the cursor (with its `.` / `#`). */
function selectorToken(text, offset, token) {
  const before = /[.#]?[\w-]*$/.exec(text.slice(token.start, offset))[0]
  const after = /^[\w-]*/.exec(text.slice(offset, Math.max(offset, token.end)))[0]
  return { start: offset - before.length, end: offset + after.length, typed: before }
}

const snippetEscape = (s) => s.replace(/[$}\\]/g, '\\$&')

export function complete({ text, offset, file, state, snippets = false, readFile }) {
  const entry = state?.byFile.get(file)
  if (!entry || !entry.regions.length) return null
  const old = indexText(state, file, entry, readFile)
  if (old == null) return null
  const { toOld, toNew } = textMapper(old, text)
  const oldCursor = toOld(offset)
  const regions = entry.regions.filter(r => r.start < oldCursor && oldCursor < r.end)
  if (!regions.length) return null // fast: not in a Sygnal region, nothing parsed

  const { strategy, repair, context: ctx } = cursorContext(text, offset, file)
  const result = { strategy, repair, context: ctx?.kind ?? null, matched: false, items: [] }
  if (!ctx) return result
  const names = namesFor(ctx, regions, state, oldCursor, toNew)
  result.matched = !!names
  if (!names?.length) return result

  let range = { start: ctx.token.start, end: Math.max(offset, ctx.token.end) }
  let only = null
  if (ctx.kind === 'selector') {
    const t = selectorToken(text, offset, ctx.token)
    range = t
    if (t.typed.startsWith('.')) only = '.'
    else if (t.typed.startsWith('#')) only = '#'
  }
  const starts = lineStarts(text)
  const pos = (o) => { const p = positionAt(starts, o); return { line: p.line - 1, character: p.column - 1 } }
  const lspRange = { start: pos(range.start), end: pos(range.end) }
  // a fresh bare model key may get a handler snippet; a comma when another property follows
  const after = text.slice(range.end).replace(/^\s*/, '')
  const comma = after && !/^[,}]/.test(after) ? ',' : ''
  const snippetOk = snippets && ctx.kind === 'key' && ctx.fresh && !ctx.token.quote

  const seen = new Set()
  for (const n of names) {
    if (only && !n.label.startsWith(only)) continue
    if (seen.has(n.label)) continue
    seen.add(n.label)
    const bare = ctx.kind === 'key' && !ctx.token.quote && !IDENT.test(n.label) ? `'${n.label}'` : n.label
    const item = {
      label: n.label,
      kind: n.kind,
      detail: n.detail,
      sortText: `${n.sort}${n.label}`,
      filterText: n.label,
      textEdit: { range: lspRange, newText: bare },
    }
    if (snippetOk && n.modelKey) {
      item.insertTextFormat = 2
      item.textEdit = { range: lspRange, newText: `${snippetEscape(bare)}: (state, data) => ({ ...state$0 })${comma}` }
    }
    result.items.push(item)
  }
  return result
}

/** The LSP answer: a CompletionList, or null when nothing applies (TypeScript's items stand alone). */
export function completionList(result) {
  if (!result?.items.length) return null
  return { isIncomplete: false, items: result.items }
}

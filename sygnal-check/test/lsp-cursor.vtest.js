// PLAN-7 N-2 (P4-1): the completion cursor context (src/lsp/cursorContext.js) on its own: the
// parse → repair → line-prefix chain and the contexts it recognises, on valid and mid-edit text.
// `|` marks the cursor.
import { describe, it, expect } from 'vitest'
import { cursorContext, classifyLine, repairs, closeAll } from '../src/lsp/cursorContext.js'
import { textMapper } from '../src/lsp/completion.js'

const at = (marked, file = 'App.jsx') => {
  const offset = marked.indexOf('|')
  const text = marked.slice(0, offset) + marked.slice(offset + 1)
  const r = cursorContext(text, offset, file)
  const tok = r.context?.token
  return { ...r, text, offset, kind: r.context?.kind ?? null, typed: tok?.text, replaced: tok && text.slice(tok.start, tok.end) }
}

const INTENT = (body) => `function App() { return <div className="a" /> }
App.intent = ({ DOM, EVENTS }) => ({
${body}
  OLD: DOM.click('.old'),
})
`

describe('strings', () => {
  it('DOM selector strings: select, the shorthands, chained select; not events()', () => {
    expect(at(INTENT("  A: DOM.click('.a|'),")).kind).toBe('selector')
    expect(at(INTENT("  A: DOM.select('.a|').events('click'),")).kind).toBe('selector')
    expect(at(INTENT("  A: DOM.select('.a').select('#b|').events('click'),")).kind).toBe('selector')
    expect(at(INTENT("  A: DOM.select('.a').events('cl|'),")).kind).toBe(null)
    expect(at(INTENT("  A: DOM.elements('.a|'),")).kind).toBe(null)
    const r = at(INTENT("  A: DOM.click('.a|dd'),"))
    expect(r).toMatchObject({ strategy: 'parse', typed: '.a', replaced: '.add' })
  })

  it('aliases: a renamed DOM source and (sources) => sources.DOM', () => {
    expect(at("X.intent = ({ DOM: d }) => ({ A: d.click('.|') })").kind).toBe('selector')
    expect(at("X.intent = (sources) => ({ A: sources.DOM.click('.|') })").kind).toBe('selector')
    expect(at("X.intent = ({ EVENTS: ev }) => ({ A: ev.select('|') })").kind).toBe('events')
  })

  it('EVENTS.select, event()/emit(), next() (also a renamed third parameter), reply values, from', () => {
    expect(at(INTENT("  A: EVENTS.select('|'),")).kind).toBe('events')
    expect(at("X.model = { A: { EVENTS: event('|', s => s) } }").kind).toBe('emit')
    expect(at("X.model = { A: emit(\"S|\") }").kind).toBe('emit')
    expect(at("X.model = { A: (s, d, next) => { next('|'); return s } }").kind).toBe('next')
    expect(at("X.model = { A: (s, d, go) => { go('|'); return s } }").kind).toBe('next')
    expect(at("X.model = { A: { HTTP: () => ({ url: '/x', ok: 'L|' }) } }").context).toMatchObject({ kind: 'value', key: 'ok' })
    expect(at('const v = <Collection of={Item} from="it|ems" />').context).toMatchObject({ kind: 'from', token: { text: 'it' } })
    expect(at("const v = <Collection of={Item} from={'|'} />").kind).toBe('from')
    expect(at('const v = <Other from="|" />').kind).toBe(null)
  })

  it('template literals without expressions count; plain strings and comments do not', () => {
    expect(at(INTENT('  A: DOM.click(`.|`),')).kind).toBe('selector')
    expect(at('const v = <p title="pl|ain">x</p>').kind).toBe(null)
    expect(at("const s = 'hel|lo'").kind).toBe(null)
    expect(at(INTENT("  // DOM.click('.|')")).kind).toBe(null)
  })
})

describe('keys', () => {
  it('an identifier key, a quoted key, an empty slot; objects innermost first; fresh', () => {
    const r = at(INTENT('  NE|W: DOM.click(".n"),'))
    expect(r).toMatchObject({ strategy: 'parse', kind: 'key', typed: 'NE', replaced: 'NEW' })
    expect(r.context.fresh).toBe(false)
    expect(r.context.objects).toHaveLength(1)
    const q = at("X.model = { 'A|': (s) => s }")
    expect(q).toMatchObject({ kind: 'key', typed: 'A', replaced: 'A' })
    const slot = at('X.model = {\n  A: (s) => s,\n  |\n}')
    expect(slot).toMatchObject({ kind: 'key', typed: '', replaced: '' })
    expect(slot.context.fresh).toBe(true)
    const nested = at('X.model = { A: { ST|ATE: (s) => s } }')
    expect(nested.context.objects).toHaveLength(2)
  })

  it('the start of an existing key inserts before it rather than replacing it', () => {
    const r = at('X.model = {\n  |A: (s) => s,\n}')
    expect(r).toMatchObject({ kind: 'key', typed: '', replaced: '' })
  })

  it('no key context in a value position or after a value without a comma', () => {
    expect(at('X.model = { A: (s) => s| }').kind).toBe(null)
    expect(at('X.model = { A: fo|o }').kind).toBe(null)
  })
})

describe('mid-edit text (0-S3 §3)', () => {
  it('an unterminated string: repaired by closing the quote and the call', () => {
    const r = at(INTENT("  A: DOM.click('.|"))
    expect(r).toMatchObject({ strategy: 'repair', repair: "')," , kind: 'selector', typed: '.', replaced: '.' })
  })

  it('a new key without a colon: repaired with `: 0,`; the token ends at the cursor', () => {
    const r = at(INTENT('  NE|'))
    expect(r).toMatchObject({ strategy: 'repair', repair: ': 0,', kind: 'key', typed: 'NE', replaced: 'NE' })
    expect(r.context.fresh).toBe(true)
    expect(r.context.objects).toHaveLength(1)
    // the object range is in the original text (the suffix is dropped)
    const [s, e] = r.context.objects[0]
    expect(r.text[s]).toBe('{')
    expect(r.text[e - 1]).toBe('}')
  })

  it('an open call on a new entry', () => {
    const r = at(INTENT("  X: DOM.click('|"))
    expect(r).toMatchObject({ strategy: 'repair', kind: 'selector' })
  })

  it('a truncated file falls back to the line prefix', () => {
    const r = at(`function App() {\n  return <div className="a">\n    <p>Don't stop</p>\n</div>\n}\nApp.intent = ({ DOM }) => ({\n  A: DOM.click('.|`)
    expect(r.strategy === 'repair' || r.strategy === 'line').toBe(true)
    expect(r.kind).toBe('selector')
    const k = at('App.model = {\n  A: (s) => s,\n  B: (s) => <p>it\'s</p>,\n  NE|')
    expect(k.kind).toBe('key')
  })
})

describe('helpers', () => {
  it('classifyLine (approach C)', () => {
    const c = (prefix) => classifyLine(prefix, prefix.length)?.kind ?? null
    expect(c("  A: DOM.click('.ad")).toBe('selector')
    expect(c("  A: DOM.select('.a').events('cl")).toBe(null)
    expect(c("  A: EVENTS.select('SA")).toBe('events')
    expect(c("    EVENTS: event('SA")).toBe('emit')
    expect(c("    next('LO")).toBe('next')
    expect(classifyLine("    ok: 'LO", 11)).toMatchObject({ kind: 'value', key: 'ok' })
    expect(c('    <Collection of={X} from="it')).toBe('from')
    expect(c('  NE')).toBe('key')
    expect(c('  // NE')).toBe(null)
  })

  it('repairs: quote-closing suffixes inside a string, key suffixes outside, closeAll last', () => {
    expect(repairs("x = f('ab").slice(0, 3)).toEqual(["'", "')", "'),"])
    expect(repairs('x = { NE')[0]).toBe(': 0,')
    expect(closeAll("f({ a: [1, 'x")).toBe("']})")
    expect(closeAll('f({ a:')).toBe('0})')
  })

  it('textMapper: an edit maps to its start; text after it shifts', () => {
    const m = textMapper('{ A: 1 }', '{ A: 1, NE }')
    expect(m.toOld(9)).toBe(6)
    expect(m.toOld(12)).toBe(8)
    expect(m.toNew(8)).toBe(12)
    expect(m.toNew(0)).toBe(0)
  })
})

/**
 * SYG109: a number for a style property that needs a unit (rules/syg109-numeric-style.js).
 * --fix writes '10px' for a literal.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles } from '../src/index.js'

const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg109-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const app = (jsx, top = '') => `import { run } from 'sygnal'
${top}
function App({ state }) { return ${jsx} }
App.initialState = { w: 1 }
run(App)
`
const opts = (src, more = {}) => ({ cwd: ROOT, sources: { [FILE]: src, ...more } })
const found = (jsx, top) => checkFiles([FILE], opts(app(jsx, top))).filter(d => d.code === 'SYG109')

describe('SYG109: a numeric style value without a unit', () => {
  it('reports a non-zero literal for a property that needs a unit (warn)', () => {
    const [d, ...rest] = found('<div style={{ width: 10 }} />')
    expect(rest).toEqual([])
    expect(d.severity).toBe('warn')
    expect(d.component).toBe('App')
    expect(d.message).toContain('width: 10')
    expect(d.fix).toContain("'10px'")
    expect(d.data).toMatchObject({ property: 'width', value: 10, tag: 'div' })
  })

  it.each([
    ['negative', '<div style={{ marginLeft: -4 }} />', 'marginLeft'],
    ['decimal', '<div style={{ fontSize: 1.5 }} />', 'fontSize'],
    ['string key', "<div style={{ 'font-size': 14 }} />", 'font-size'],
    ['a const number', '<div style={{ width: W }} />', 'width', 'const W = 10'],
    ['delayed', '<div style={{ delayed: { left: 5 } }} />', 'left'],
    ['remove', '<div style={{ remove: { top: 5 } }} />', 'top'],
    ['destroy', '<div style={{ destroy: { height: 2 } }} />', 'height'],
    ['a const style object', '<div style={S} />', 'width', 'const S = { width: 10 }'],
    ['a custom element', '<my-card style={{ width: 10 }} />', 'width'],
    ['a transition time', '<div style={{ transitionDuration: 300 }} />', 'transitionDuration'],
  ])('reports %s', (_, jsx, property, top) => {
    const ds = found(jsx, top)
    expect(ds).toHaveLength(1)
    expect(ds[0].data.property).toBe(property)
  })

  it('reports a control for an HTML element, and not one built on a primitive', () => {
    const c = "import { controls } from 'sygnal'\n"
    expect(found('<Go style={{ padding: 10 }}>x</Go>', c + "const { Go } = controls({ Go: 'button' })")).toHaveLength(1)
    expect(found('<Go style={{ padding: 10 }}>x</Go>', c + "import { Pressable } from 'sygnal/primitives'\nconst { Go } = controls({ Go: Pressable })")).toEqual([])
  })

  it('a const style object used twice is one finding', () => {
    expect(found('<div><p style={S} /><p style={S} /></div>', 'const S = { width: 10 }')).toHaveLength(1)
  })

  it.each([
    ['zero', '<div style={{ width: 0 }} />'],
    ['a string', "<div style={{ width: '10px' }} />"],
    ['a dynamic value', '<div style={{ width: state.w }} />'],
    ['a let number', '<div style={{ width: W }} />', 'let W = 10'],
    ['a string const', '<div style={{ width: W }} />', "const W = '10px'"],
    ['a custom property', "<div style={{ '--gap': 10 }} />"],
    ['opacity', '<div style={{ opacity: 0.5 }} />'],
    ['zIndex', '<div style={{ zIndex: 3 }} />'],
    ['lineHeight', '<div style={{ lineHeight: 1.4 }} />'],
    ['flex', '<div style={{ flex: 1, flexGrow: 2, flexShrink: 0 }} />'],
    ['fontWeight', '<div style={{ fontWeight: 700 }} />'],
    ['gridColumn', '<div style={{ gridColumn: 2 }} />'],
    ['SVG strokeWidth', '<svg><rect style={{ strokeWidth: 2 }} /></svg>'],
    ['a dashed unitless key', "<div style={{ 'line-height': 1.4 }} />"],
    ['fontSizeAdjust (a CSS number)', '<div style={{ fontSizeAdjust: 0.5 }} />'],
    ['delayed unitless', '<div style={{ delayed: { opacity: 1 } }} />'],
    ['a component (the prop is its own)', '<Card style={{ width: 10 }} />', 'function Card() { return <div /> }'],
    ['a primitive tag (it appends px)', '<View style={{ width: 10 }} />', "import { View } from 'sygnal/primitives'"],
  ])('leaves %s alone', (_, jsx, top) => {
    expect(found(jsx, top)).toEqual([])
  })

  it.each(['terminal', 'react-native', 'host', 'canvas', 'three'])('skips a project using sygnal/%s, even in other files', (renderer) => {
    const entry = path.join(ROOT, 'entry.js')
    const appSrc = app('<div style={{ width: 10 }} />')
    const sources = { [FILE]: appSrc, [entry]: `import 'sygnal/${renderer}'\nimport './App.jsx'\n` }
    expect(checkFiles([FILE, entry], { cwd: ROOT, sources }).filter(d => d.code === 'SYG109')).toEqual([])
  })

  it('--fix writes the string with px for a literal, and the finding is gone', () => {
    const src = app("<div style={{ width: 10, marginLeft: -4, color: 'red' }} />")
    const out = fixFiles([FILE], opts(src)).texts.get(FILE)
    expect(out).toContain("{ width: '10px', marginLeft: '-4px', color: 'red' }")
    expect(checkFiles([FILE], opts(out)).filter(d => d.code === 'SYG109')).toEqual([])
  })

  it('no --fix for a const, or a time or an angle', () => {
    expect(found('<div style={{ width: W }} />', 'const W = 10')[0].fixes).toBeUndefined()
    expect(found('<div style={{ transitionDelay: 300 }} />')[0].fixes).toBeUndefined()
    expect(found('<div style={{ rotate: 45 }} />')[0].fixes).toBeUndefined()
  })
})

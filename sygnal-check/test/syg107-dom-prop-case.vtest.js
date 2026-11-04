/**
 * SYG107 (7.2, Sift preview.5 #2/#3): a DOM property name in the wrong case on an HTML element
 * (rules/syg107-dom-prop-case.js). --fix renames it.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles } from '../src/index.js'

const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg107-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const app = (jsx) => `import { run } from 'sygnal'
function App({ state }) { return ${jsx} }
App.initialState = { q: '' }
run(App)
`
const opts = (src) => ({ cwd: ROOT, sources: { [FILE]: src } })
const found = (jsx) => checkFiles([FILE], opts(app(jsx))).filter(d => d.code === 'SYG107')
const fix = (jsx) => fixFiles([FILE], opts(app(jsx))).texts.get(FILE)

describe('SYG107: a DOM property name in the wrong case', () => {
  it("reports React's spellings and the attributes' lowercase, naming the property (warn)", () => {
    for (const [jsx, name, good] of [
      ['<input autoComplete="off" />', 'autoComplete', 'autocomplete'],
      ['<input inputmode="numeric" />', 'inputmode', 'inputMode'],
      ['<input maxlength={4} />', 'maxlength', 'maxLength'],
      ['<input readonly />', 'readonly', 'readOnly'],
      ['<img srcSet="a.png 2x" alt="" />', 'srcSet', 'srcset'],
      ['<video autoPlay />', 'autoPlay', 'autoplay'],
      ['<table><tbody><tr><td colspan={2}>x</td></tr></tbody></table>', 'colspan', 'colSpan'],
      ['<iframe allowFullScreen title="x" />', 'allowFullScreen', 'allowFullscreen'],
      ['<form encType="multipart/form-data" />', 'encType', 'enctype'],
    ]) {
      const d = found(jsx)
      expect(d, jsx).toHaveLength(1)
      expect(d[0].severity).toBe('warn')
      expect(d[0].data).toMatchObject({ name, property: good })
      expect(d[0].message).toContain(`the DOM property is ${good}`)
    }
  })

  it('leaves the right names, the attributes the pragma writes, SVG, custom elements and components alone', () => {
    for (const jsx of [
      '<input autocomplete="off" inputMode="numeric" maxLength={4} readOnly />',
      '<label htmlFor="a" tabindex={0} role="note">x</label>',
      '<div spellCheck={false} contentEditable="true" draggable />',
      '<div aria-readonly="true" attrs-inputmode="numeric" data-maxlength="4" />',
      '<svg viewBox="0 0 1 1"><text textLength={4} lengthAdjust="spacing">x</text></svg>',
      '<my-field maxlength={4} />',
      '<Field autoComplete="off" />',
    ]) expect(found(jsx), jsx).toEqual([])
  })

  it('--fix renames the attribute', () => {
    expect(fix('<input autoComplete="off" inputmode="numeric" />')).toContain('<input autocomplete="off" inputMode="numeric" />')
  })
})

/**
 * PLAN-5 2-Z (W-2): the adapters' widgets in sygnal-check. fromZag (sygnal/zag) and fromReact
 * (sygnal/react) calls make widget tags like defineWidget (their events and commands come from
 * the options), and Menu / Select / Combobox from their ui subpaths (D211) are known widget tags: their
 * className counts for SYG110, their events for SYG141, their commands for SYG142, and the tag
 * as a selector is SYG143.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-adapters-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (ds) => ds.map(d => d.code).sort()

describe('sygnal/ui/menu|select|combobox tags', () => {
  const app = (intent, model = '') => ({
    'Order.jsx': `
import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'
export function Order({ state }) {
  return <div>
    <Menu className="actions" label="Actions" items={['edit']} />
    <Select className="size" label="Size" items={['S', 'M']} value={state.size} />
    <Combobox className="city" label="City" items={['Paris']} value={state.city} />
    <button className="open">Open</button>
  </div>
}
Order.initialState = { size: null, city: null, last: '' }
Order.intent = ({ DOM }) => (${intent})
Order.model = { ${model} }
`,
  })

  it('canonical use is clean under --strict (classes seen, declared events, declared commands)', () => {
    const ds = check(app(`{
      PICK: DOM.select('.actions').events('select').detail(),
      SIZE: DOM.select('.size').events('value-change').detail(),
      CITY: DOM.select('.city').events('value-change').detail(),
      TYPED: DOM.select('.city').events('input-change').detail(),
      OPEN: DOM.click('.open'),
    }`, `PICK: (s, last) => ({ ...s, last }), SIZE: (s, size) => ({ ...s, size }), CITY: (s, city) => ({ ...s, city }),
      TYPED: (s) => s, OPEN: { ELEMENT: { open: '.actions' } }`), { strict: true })
    expect(codes(ds)).toEqual([])
  })

  it('a near-typo event is SYG141; a near-typo command is SYG142; the tag as a selector is SYG143', () => {
    const ds = check(app(`{ PICK: DOM.select('.actions').events('selet').detail(), X: DOM.select(Menu).events('select') }`,
      `PICK: (s) => s, X: (s) => s, OPEN: { ELEMENT: { opne: '.size' } }`))
    expect(codes(ds)).toEqual(expect.arrayContaining(['SYG141', 'SYG143']))
    const cmd = check(app(`{ OPEN: DOM.click('.actions') }`, `OPEN: { ELEMENT: { opne: '.size' } }`))
    expect(codes(cmd)).toContain('SYG142')
  })
})

describe('fromZag / fromReact widgets', () => {
  it('a fromZag tag: className seen, object events and commands', () => {
    const ds = check({
      'Actions.jsx': `
import { fromZag } from 'sygnal/zag'
import * as menu from '@zag-js/menu'
export const Actions = fromZag(menu, (api, props) => <div><button {...api.getTriggerProps()}>{props.label}</button></div>, {
  events: { select: ['onSelect', (d) => d.value] },
  commands: { open: (api) => api.setOpen(true) },
})
`,
      'Bar.jsx': `
import { Actions } from './Actions.jsx'
export function Bar({ state }) { return <div><Actions className="actions" label="A" /><p>{state.last}</p></div> }
Bar.initialState = { last: '' }
Bar.intent = ({ DOM }) => ({ PICK: DOM.select('.actions').events('select').detail(), TYPO: DOM.select('.actions').events('selcet'), OPEN: DOM.select('.actions').events('open-change') })
Bar.model = { PICK: (s, last) => ({ ...s, last }), TYPO: (s) => s, OPEN: { ELEMENT: { open: '.actions' } } }
`,
    })
    expect(codes(ds)).toEqual(['SYG141'])
  })

  it('a fromReact tag: object or array events', () => {
    const ds = check({
      'Review.jsx': `
import { fromReact } from 'sygnal/react'
import { StarRating } from 'some-react-lib'
const Stars = fromReact(StarRating, { events: { rate: 'onChange' } })
const Other = fromReact(StarRating, { events: ['onChange'] })
export function Review({ state }) { return <div><Stars className="rating" value={state.rating} /><Other className="other" /></div> }
Review.initialState = { rating: 0 }
Review.intent = ({ DOM }) => ({ RATE: DOM.select('.rating').events('rate').detail(), O: DOM.select('.other').events('onChange').detail() })
Review.model = { RATE: (s, rating) => ({ ...s, rating }), O: (s) => s }
`,
    })
    expect(codes(ds)).toEqual([])
  })
})

describe("sygnal/three's Scene tag", () => {
  const app = (intent) => ({
    'World.jsx': `
import { Scene } from 'sygnal/three'
export function World({ state }) {
  return <main>
    <Scene className="viewport" width={300} height={200} camera={state.camera}>
      <mesh className="cube" role="button" tabIndex={0} aria-label="Cube" />
    </Scene>
  </main>
}
World.initialState = { camera: { position: [0, 0, 5] }, hits: 0 }
World.intent = ({ DOM }) => (${intent})
World.model = { CAMERA: (s, camera) => ({ ...s, camera }), HIT: (s) => ({ ...s, hits: s.hits + 1 }) }
`,
  })

  it('its className is the host\'s (no SYG110), camerachange is declared; its children are the view\'s', () => {
    const ds = check(app(`{ CAMERA: DOM.select('.viewport').events('camerachange').detail(), HIT: DOM.click('.cube') }`), { strict: true })
    expect(codes(ds)).toEqual([])
  })

  it('a near-typo of camerachange is SYG141; the tag as a selector is SYG143', () => {
    const ds = check(app(`{ CAMERA: DOM.select('.viewport').events('camerachang').detail(), HIT: DOM.select(Scene).events('click') }`))
    expect(codes(ds)).toEqual(expect.arrayContaining(['SYG141', 'SYG143']))
  })
})

describe("sygnal/sandbox's Sandboxed tag", () => {
  const app = (intent) => ({
    'Card.jsx': `
import { Sandboxed } from 'sygnal/sandbox'
export function Card({ state }) {
  return <main>
    <Sandboxed className="gen" kernel={state.kernel} source={state.source} emits={{}} />
    <p>{state.answer}</p>
  </main>
}
Card.initialState = { kernel: '', source: '', answer: '' }
Card.intent = ({ DOM }) => (${intent})
Card.model = { ANSWER: (s, e) => ({ ...s, answer: String(e.data) }), FAILED: (s) => s }
`,
  })

  it("its className is the host's (no SYG110); emit and sandboxerror are declared", () => {
    const ds = check(app(`{ ANSWER: DOM.select('.gen').events('emit').detail(), FAILED: DOM.select('.gen').events('sandboxerror').detail() }`), { strict: true })
    expect(codes(ds)).toEqual([])
  })

  it('a near-typo of an event is SYG141', () => {
    const ds = check(app(`{ ANSWER: DOM.select('.gen').events('emits').detail(), FAILED: DOM.select('.gen').events('sandboxerror').detail() }`))
    expect(codes(ds)).toContain('SYG141')
  })
})

/**
 * PLAN-5 B-3: sygnal-check and the `browser` static.
 *
 *   SYG102   the action / error names a `browser` static declares are triggers
 *   SYG112   a browser action with no model entry
 *   SYG643   static: `browser` declared by a component of an app whose run() call registers no
 *            browser driver (makeBrowserDriver(), makeBrowserDriverWith(...))
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-2b-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const sources = Object.keys(files).map(f => path.join(tmp, f))
  return checkFiles(sources, { cwd: tmp, ignore: ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708'] })
}
const codes = (d) => d.map(x => `${x.code} ${x.severity}`).sort()

const CARD = `export function Card({ state }) { return <div><img className="cover" /><p>{state.seen}</p></div> }
Card.initialState = { seen: false, pos: null }
Card.browser = (state) => ({
  seen: !state.seen && { intersection: '.cover', action: 'SEEN' },
  here: { geolocation: true, action: 'POS', error: 'GEO_FAILED' },
})
Card.model = {
  SEEN: (s) => ({ ...s, seen: true }),
  POS: (s, pos) => ({ ...s, pos }),
  GEO_FAILED: (s) => s,
}
`

describe('browser actions', () => {
  it('action and error names are triggers: no SYG102', () => {
    expect(check({ 'Card.jsx': CARD })).toEqual([])
  })

  it('a browser action with no model entry is SYG112 (with the suggestion)', () => {
    const d = check({ 'Card.jsx': CARD.replace("action: 'SEEN'", "action: 'SEENN'") })
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG112 error'])
    const e = d.find(x => x.code === 'SYG112')
    expect(e.message).toContain("Card.browser names 'SEENN' as an action")
    expect(e.data.suggestion).toBe('SEEN')
  })
})

describe('SYG643 (static): no browser driver', () => {
  const app = (drivers) => ({
    'src/Card.jsx': CARD,
    'src/App.jsx': `import { Card } from './Card.jsx'
export function App() { return <main><Card /></main> }
`,
    'src/main.js': `import { run, makeBrowserDriver, makeBrowserDriverWith, mediaSource } from 'sygnal'
import { App } from './App.jsx'
run(App, ${drivers})
`,
  })

  it('no browser driver: a warning naming makeBrowserDriver()', () => {
    const d = check(app('{}')).filter(x => x.code === 'SYG643')
    expect(codes(d)).toEqual(['SYG643 warn'])
    expect(d[0].message).toContain('Card declares Card.browser')
    expect(d[0].data).toEqual({ static: 'browser', driver: 'makeBrowserDriver()' })
  })

  it('makeBrowserDriver() or makeBrowserDriverWith(...): nothing', () => {
    expect(check(app('{ BROWSER: makeBrowserDriver() }')).filter(x => x.code === 'SYG643')).toEqual([])
    expect(check(app('{ B: makeBrowserDriverWith(mediaSource) }')).filter(x => x.code === 'SYG643')).toEqual([])
  })
})

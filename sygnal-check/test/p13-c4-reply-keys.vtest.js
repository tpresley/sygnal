// PLAN-13 C-4 (#33): replyKeys in sygnal-check.config.json: a custom driver's reply keys feed
// SYG102 and SYG112; without the setting, an unknown key naming an entry makes SYG102 info
import { describe, expect, it } from 'vitest'
import { check } from '../src/index.js'
import { loadConfig } from '../src/config.js'

const DIR = '/virtual/app'
const app = `import { run } from 'sygnal'
function Up() { return <button className="go">go</button> }
Up.initialState = { n: 0 }
Up.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Up.model = {
  GO: { UPLOAD: () => ({ file: 'a', progress: 'UP_PROGRESS', cancelled: 'UP_CANCELLED', ok: 'UP_DONE' }) },
  UP_PROGRESS: (s) => s, UP_DONE: (s) => s, UP_CANCELLED: (s) => s,
}
run(Up)
`
const io = (config, src = app) => {
  const files = { [`${DIR}/src/App.jsx`]: src, [`${DIR}/package.json`]: '{"name":"p"}', ...(config && { [`${DIR}/sygnal-check.config.json`]: JSON.stringify(config) }) }
  return { exists: (f) => f in files, read: (f) => { if (!(f in files)) throw Object.assign(new Error('nope'), { code: 'ENOENT' }); return files[f] }, files }
}
const run = (config, src) => {
  const x = io(config, src)
  return check([`${DIR}/src/App.jsx`], { cwd: DIR, io: x, sources: x.files }).filter(d => ['SYG102', 'SYG112', 'SYG900'].includes(d.code))
}

describe('C-4: replyKeys', () => {
  it('without it: SYG102 for the custom reply action is info, pointing at replyKeys', () => {
    const [d, ...rest] = run(null)
    expect(rest).toEqual([])
    expect(d).toMatchObject({ code: 'SYG102', severity: 'info', data: { action: 'UP_CANCELLED', key: 'cancelled', sink: 'UPLOAD' } })
    expect(d.fix).toContain('"replyKeys": { "UPLOAD": ["cancelled"] }')
  })
  it('global or per sink: the reply action is a trigger', () => {
    expect(run({ replyKeys: ['cancelled'] })).toEqual([])
    expect(run({ replyKeys: { UPLOAD: ['cancelled'] } })).toEqual([])
    // another sink's keys don't count
    expect(run({ replyKeys: { OTHER: ['cancelled'] } }).map(d => [d.code, d.severity])).toEqual([['SYG102', 'info']])
  })
  it('the custom key is checked by SYG112', () => {
    const d = run({ replyKeys: ['cancelled'] }, app.replace("cancelled: 'UP_CANCELLED'", "cancelled: 'UP_CANCELED'"))
    expect(d.map(x => x.code).sort()).toEqual(['SYG102', 'SYG112'])
    expect(d.find(x => x.code === 'SYG112').data).toMatchObject({ action: 'UP_CANCELED', key: 'cancelled' })
  })
  it('a bad value is a SYG900 warning and ignored', () => {
    for (const bad of ['cancelled', [1], { UPLOAD: 'x' }, ['not a key']]) {
      const x = io({ replyKeys: bad })
      const r = loadConfig(DIR, { io: x })
      expect(r.config.replyKeys).toBeUndefined()
      expect(r.diagnostics.map(d => d.code)).toEqual(['SYG900'])
    }
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { afterEach } from 'vitest'
import { startServer, tempDir, uriOf } from './lsp-helpers.js'
let cleanup = []
afterEach(() => { for (const f of cleanup.splice(0)) f() })

it('the language server reads replyKeys from the config file', async () => {
  const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', 'sygnal-check.config.json': '{ "replyKeys": ["cancelled"] }', 'src/App.jsx': app })
  const client = startServer()
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ rootUri: uriOf(dir) })
  const A = path.join(dir, 'src/App.jsx')
  client.open(A, app)
  await client.settle()
  expect(client.diags(A).map(d => d.code)).not.toContain('SYG102')
})

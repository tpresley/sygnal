// sygnal/yjs and sygnal/yjs/testing as built: yjs and y-protocols stay external (optional peers,
// D209), as does fractional-indexing (a regular dependency); xs and ABORT come from the external
// 'sygnal' (one core per app, and its xstream interop). Both
// formats load in plain Node (CJS require()s fractional-indexing, an ES module: Node >= 20.19 /
// 22.12, the engines range).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const dist = path.resolve(__dirname, '../dist')
const read = (f) => fs.readFileSync(path.join(dist, f), 'utf8')
const imports = (src) => [...src.matchAll(/(?:from |require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('.'))

describe('sygnal/yjs entries', () => {
  it('sygnal/yjs: the external core, yjs and fractional-indexing, nothing else', () => {
    for (const f of ['yjs.esm.js', 'yjs.cjs.js']) {
      expect(new Set(imports(read(f)))).toEqual(new Set(['sygnal', 'yjs', 'fractional-indexing']))
      expect(read(f)).not.toMatch(/class App\b|createElementWithModules/)
    }
  })
  it('sygnal/yjs/testing: yjs and y-protocols/awareness only', () => {
    for (const f of ['yjs-testing.esm.js', 'yjs-testing.cjs.js']) expect(new Set(imports(read(f)))).toEqual(new Set(['yjs', 'y-protocols/awareness']))
  })
  it('both formats load in plain Node: two drivers on a network converge', () => {
    const cwd = path.resolve(__dirname, '..')
    const go = `const net = createNetwork(), a = net.join(), b = net.join(); const xs = X;
      const sa = xs.create(), sb = xs.create(); makeYjsDriver({ doc: a.doc, provider: a })(sa); const so = makeYjsDriver({ doc: b.doc, provider: b })(sb);
      let got; so.remote('board').addListener({ next: (r) => { got = r.value } });
      sa.shamefullySendNext({ key: 'board', value: { items: [{ id: 1, text: 'hi' }] } });
      sb.shamefullySendNext({ key: 'board', value: { items: [] } });
      console.log(JSON.stringify(got), typeof shared().merge); a.leave(); b.leave()`
    const esm = execFileSync(process.execPath, ['--input-type=module', '-e', `import { makeYjsDriver, shared } from 'sygnal/yjs'; import { createNetwork } from 'sygnal/yjs/testing'; import { xs as X } from 'sygnal'; ${go}`], { cwd, encoding: 'utf8', timeout: 20000 })
    const cjs = execFileSync(process.execPath, ['-e', `const { makeYjsDriver, shared } = require('sygnal/yjs'); const { createNetwork } = require('sygnal/yjs/testing'); const { xs: X } = require('sygnal'); ${go}`], { cwd, encoding: 'utf8', timeout: 20000 })
    for (const out of [esm, cjs]) expect(out.trim()).toBe('{"items":[{"id":1,"text":"hi"}]} function')
  })
})

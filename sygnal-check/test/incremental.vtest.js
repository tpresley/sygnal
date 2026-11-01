// Native-tooling round 2: incremental checking (Project `previous`, run.js createRuleMemo,
// checkFiles({ session }), live.js). A build reuses the previous build's model for the files that
// can't have changed and replays the per-file rules' findings for them; this must give exactly the
// findings of a fresh check after any sequence of edits.
//
// The fuzz: copies of example apps, the checker's fixture sets and a generated app with
// cross-file EVENTS, children and imports go through seeded random edits (literals renamed,
// lines deleted, duplicated or moved, imports dropped or added, text cut mid-token so it doesn't
// parse, files restored, new files) applied through unsaved buffers (`sources`) or written to
// disk (the size/mtime path). After every step:
//   - checkFiles with a session (and its own parse cache) = a fresh checkFiles, as JSON;
//   - createLiveProject().build() (the language server's and --watch's project, with its last
//     good substitution) = the build of a live project with the same history and
//     `incremental: false`: diagnostics and graph JSON.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, createParseCache, createCheckSession, createLiveProject, buildProject } from '../src/index.js'
import { expandInputs } from '../src/files.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const tmps = []
afterAll(() => { for (const t of tmps) fs.rmSync(t, { recursive: true, force: true }) })

function copyDir(from, to) {
  for (const d of fs.readdirSync(from, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name === 'dist') continue
    const a = path.join(from, d.name), b = path.join(to, d.name)
    if (d.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyDir(a, b) } else fs.copyFileSync(a, b)
  }
}

/** A small app across files: a root importing children that emit / select EVENTS, a shared helper. */
function generated(dir, n = 12) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "gen", "private": true }')
  fs.writeFileSync(path.join(dir, 'src/helpers.js'), `export const Row = ({ label }) => <li className="row">{label}</li>\nexport const TYPE = 'SHARED'\n`)
  for (let i = 0; i < n; i++) {
    const kids = [2 * i + 1, 2 * i + 2].filter(k => k < n)
    fs.writeFileSync(path.join(dir, `src/C${i}.jsx`), `import { event } from 'sygnal'
import { Row, TYPE } from './helpers.js'
${kids.map(k => `import C${k} from './C${k}.jsx'`).join('\n')}

export default function C${i}({ state }) {
  return (
    <section className="c${i}">
      <button className="inc">+</button>
      <input className="name" value={state.name} />
      <label>Name <input className="labelled" /></label>
      <Row label="r${i}" />
      ${kids.map(k => `<C${k} />`).join('\n      ')}
    </section>
  )
}
C${i}.initialState = { count: 0, name: '' }
C${i}.intent = ({ DOM, EVENTS }) => ({
  INC: DOM.click('.inc'),
  NAME: DOM.input('.name').map(e => e.target.value),
  PING: EVENTS.select('PING_${(i + 1) % n}'),
  SHARED: EVENTS.select(TYPE),
})
C${i}.model = {
  INC: { STATE: (s) => ({ ...s, count: s.count + 1 }), EVENTS: event('PING_${i}', (s) => s.count) },
  NAME: (s, name) => ({ ...s, name }),
  PING: (s) => s,
  SHARED: (s) => s,
}
`)
  }
  fs.writeFileSync(path.join(dir, 'src/main.js'), `import { run } from 'sygnal'\nimport C0 from './C0.jsx'\nrun(C0)\n`)
}

function rng(seed) {
  let x = seed >>> 0 || 1
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 2 ** 32 }
}

/** One random edit of `text` (the file's current text); `others` are the project's other files. */
function mutate(text, rand, others, file) {
  const pick = (a) => a[Math.floor(rand() * a.length)]
  const lines = text.split('\n')
  const op = Math.floor(rand() * 9)
  switch (op) {
    case 0: case 1: { // rename a string literal (a class, a selector, an EVENTS type, an import path)
      const lits = [...text.matchAll(/(['"])([A-Za-z_.#][\w.#/ -]{0,40})\1/g)]
      if (!lits.length) break
      const m = pick(lits)
      const repl = rand() < 0.5 ? m[2] + 'x' : m[2].slice(0, -1)
      return text.slice(0, m.index + 1) + repl + text.slice(m.index + 1 + m[2].length)
    }
    case 2: { // delete a line
      lines.splice(Math.floor(rand() * lines.length), 1)
      return lines.join('\n')
    }
    case 3: { // duplicate or move a line
      const i = Math.floor(rand() * lines.length), j = Math.floor(rand() * lines.length)
      const [l] = rand() < 0.5 ? [lines[i]] : lines.splice(i, 1)
      lines.splice(j, 0, l)
      return lines.join('\n')
    }
    case 4: { // rename an action-like key (INC → INCX) at one place
      const keys = [...text.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)]
      if (!keys.length) break
      const m = pick(keys)
      return text.slice(0, m.index) + m[1] + 'X' + text.slice(m.index + m[1].length)
    }
    case 5: { // drop an import, or import another project file
      const imps = lines.map((l, i) => [l, i]).filter(([l]) => /^import /.test(l))
      if (imps.length && rand() < 0.5) { lines.splice(pick(imps)[1], 1); return lines.join('\n') }
      const other = pick(others)
      if (!other || other === file) break
      let rel = path.relative(path.dirname(file), other).split(path.sep).join('/')
      if (!rel.startsWith('.')) rel = './' + rel
      return `import * as Zz${Math.floor(rand() * 1e6)} from '${rel}'\n` + text
    }
    case 6: // cut the text mid-way (usually doesn't parse)
      return text.slice(0, Math.floor(rand() * text.length))
    case 7: { // a new component in the file, listening for something
      const n = Math.floor(rand() * 1e6)
      return text + `\nfunction Zq${n}() { return <div className="zq"><input /></div> }\nZq${n}.intent = ({ DOM, EVENTS }) => ({ GO: DOM.click('.nope'), E: EVENTS.select('PING_1') })\nZq${n}.model = { GO: (s) => s }\n`
    }
    default: break
  }
  return text + `\n// edit ${Math.floor(rand() * 1e6)}\n`
}

const json = (x) => JSON.stringify(x)

function fuzz({ name, dir, paths, seed, steps, strict = true }) {
  it(`${name}: ${steps} seeded edits, incremental = fresh after each`, () => {
    const filesNow = () => expandInputs(paths.map(p => path.join(dir, p)), { cwd: dir }).files
    const originals = new Map(filesNow().map(f => [f, fs.readFileSync(f, 'utf8')]))
    expect(originals.size).toBeGreaterThan(0)
    const rand = rng(seed)
    const sources = new Map()
    const session = createCheckSession(), cache = createParseCache()
    const live = createLiveProject({ root: dir })
    const twin = createLiveProject({ root: dir, incremental: false }) // the same history, fresh builds
    const settings = { strict, paths, config: false }
    let reusedSome = false
    for (let step = 0; step < steps; step++) {
      const files = filesNow()
      const r = rand()
      if (r < 0.06) {
        // a new file (the file list changes: a fresh build)
        const f = path.join(dir, paths[0], `New${step}.jsx`)
        fs.writeFileSync(f, `export default function New${step}() { return <p className="n" /> }\nNew${step}.initialState = {}\n`)
      } else if (r < 0.16) {
        // restore a file (buffer dropped or disk rewritten)
        const f = [...originals.keys()][Math.floor(rand() * originals.size)]
        sources.delete(f)
        fs.writeFileSync(f, originals.get(f))
      } else {
        const f = files[Math.floor(rand() * files.length)]
        const cur = sources.get(f) ?? fs.readFileSync(f, 'utf8')
        const next = mutate(cur, rand, files, f)
        if (rand() < 0.5) sources.set(f, next)
        else { sources.delete(f); fs.writeFileSync(f, next) }
      }
      const list = filesNow()
      const opts = { cwd: dir, strict, sources: new Map(sources) }
      const fresh = checkFiles(list, opts)
      const incr = checkFiles(list, { ...opts, cache, session })
      if (session.previous.rebuilt && session.previous.rebuilt.size < list.length) reusedSome = true
      if (json(incr) !== json(fresh)) {
        const a = new Set(fresh.map(json)), b = new Set(incr.map(json))
        const missing = [...a].filter(x => !b.has(x)).slice(0, 3), extra = [...b].filter(x => !a.has(x)).slice(0, 3)
        throw new Error(`${name} step ${step}: incremental differs from fresh\n missing: ${missing.join('\n  ')}\n extra: ${extra.join('\n  ')}`)
      }
      const lb = live.build({ settings, sources: new Map(sources) })
      const fb = twin.build({ settings, sources: new Map(sources) })
      expect(json(lb.diagnostics), `${name} step ${step}: live diagnostics`).toBe(json(fb.diagnostics))
      expect(lb.json, `${name} step ${step}: live graph`).toBe(fb.json)
    }
    expect(reusedSome).toBe(true) // the incremental path was taken, not only fresh builds
  }, 120_000)
}

describe('incremental checking = a fresh check, after seeded random edits', () => {
  const make = (label, fill) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sygnal-check-incr-${label}-`))
    tmps.push(dir)
    fill(dir)
    return dir
  }
  const examples = ['kanban', 'todomvc', 'plan5-showcase', 'ai-panel-spa', 'ai-showcase', 'advanced-feature-tests', 'ts-example-2048']
  for (const [i, ex] of examples.entries()) {
    const dir = make(ex, (d) => copyDir(path.join(repo, 'examples', ex), d))
    fuzz({ name: `examples/${ex}`, dir, paths: [fs.existsSync(path.join(dir, 'src')) ? 'src' : '.'], seed: 1000 + i, steps: ex === 'plan5-showcase' || ex === 'ai-showcase' ? 30 : 40 })
  }
  for (const [i, set] of ['bad', 'good', 'strict/bad'].entries()) {
    const dir = make(set.replace('/', '-'), (d) => copyDir(path.join(here, 'fixtures', set), d))
    fuzz({ name: `fixtures/${set}`, dir, paths: ['.'], seed: 2000 + i, steps: 30 })
  }
  fuzz({ name: 'generated (cross-file EVENTS, children, shared imports)', dir: make('gen', (d) => generated(d)), paths: ['src'], seed: 3000, steps: 80 })
  fuzz({ name: 'generated, default rules', dir: make('gen2', (d) => generated(d, 20)), paths: ['src'], seed: 3001, steps: 60, strict: false })
})

describe('what an incremental build reuses', () => {
  it('a leaf edit rebuilds the leaf and its importers only; an unchanged build rebuilds nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-incr-reuse-'))
    tmps.push(dir)
    generated(dir, 7) // C0 → C1, C2; C1 → C3, C4; C2 → C5, C6
    const files = expandInputs([path.join(dir, 'src')], { cwd: dir }).files
    const cache = createParseCache()
    const p1 = buildProject(files, { cwd: dir, cache })
    expect(p1.rebuilt).toBe(null) // a fresh build
    const p2 = buildProject(files, { cwd: dir, cache, previous: p1 })
    expect([...p2.rebuilt]).toEqual([])
    expect(p2.files.get(files[0])).toBe(p1.files.get(files[0])) // the same FileInfo
    const leaf = path.join(dir, 'src/C4.jsx')
    const p3 = buildProject(files, { cwd: dir, cache, previous: p2, sources: new Map([[leaf, fs.readFileSync(leaf, 'utf8') + '\n// x\n']]) })
    const rel = (s) => [...s].map(p => path.relative(dir, p)).sort()
    expect(rel(p3.rebuilt)).toEqual(['src/C0.jsx', 'src/C1.jsx', 'src/C4.jsx'])
    const helpers = path.join(dir, 'src/helpers.js')
    const p4 = buildProject(files, { cwd: dir, cache, previous: p3, sources: new Map([[helpers, fs.readFileSync(helpers, 'utf8') + '\n// x\n']]) })
    expect(p4.rebuilt.size).toBe(8) // every component imports helpers.js (main.js doesn't)
    // a different file list: a fresh build
    const p5 = buildProject(files.slice(1), { cwd: dir, cache, previous: p4 })
    expect(p5.rebuilt).toBe(null)
  })

  it('an import that didn\'t resolve rebuilds its importer once the file appears', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-incr-new-'))
    tmps.push(dir)
    const a = path.join(dir, 'A.jsx')
    fs.writeFileSync(a, `import B from './B.jsx'\nexport default function A() { return <B /> }\nA.intent = ({ DOM }) => ({ GO: DOM.click('.go') })\nA.model = { GO: (s) => s }\n`)
    const session = createCheckSession(), cache = createParseCache()
    const before = checkFiles([a], { cwd: dir, cache, session })
    expect(before.map(d => d.code)).toContain('SYG110') // '.go' isn't rendered (B unknown: maybe it is)
    fs.writeFileSync(path.join(dir, 'B.jsx'), `export default function B() { return <button className="go" /> }\n`)
    const after = checkFiles([a], { cwd: dir, cache, session })
    expect(session.previous.rebuilt.has(a)).toBe(true)
    expect(json(after)).toBe(json(checkFiles([a], { cwd: dir })))
  })
})

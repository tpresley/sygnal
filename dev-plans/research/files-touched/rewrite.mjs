#!/usr/bin/env node
// Materialize reference solutions rewritten with a fix, so "files touched" is recomputed on real trees.
//
//   node dev-plans/research/files-touched/rewrite.mjs <outDir>
//
// <outDir>/root-drivers/<task>/{starter,solution}   F1: main.js's drivers moved to `App.drivers` in App.jsx
// <outDir>/ts-colocate/<task>/{starter,solution}    F2: the state type next to its component, SygnalEvents next to the emitter
//
// `solution` here is the finished tree (starter + the eval's solution overlay + the rewrite).
import fs from 'node:fs'
import path from 'node:path'
import { armPaths, copyDir, applySolution } from '../../../evals/agent-ergonomics/lib/common.mjs'

export const F1_TASKS = ['05-driver-quote', '11-search-debounce', '13-course-portal', '17-address-lookup', '22-chat-socket', '23-quote-resource', '24-list-detail-cache', '25-router-spa', '26-autosave-draft', '30-checkout-form', '44-streaming-chat', '45-packing-assistant', '46-ticket-triage']
export const F2_TASKS = ['18-ts-collection-pin', '19-ts-events-status', '20-ts-board-moves', '21-ts-selection-panel']

const read = (f) => fs.readFileSync(f, 'utf8')
const write = (f, s) => fs.writeFileSync(f, s)
function edit(file, pairs) {
  let s = read(file)
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`rewrite: no "${a.slice(0, 50)}" in ${file}`)
    s = s.replace(a, b)
  }
  write(file, s)
}

function pair(arm, task, out) {
  const starter = path.join(armPaths(arm).tasks, task, 'starter')
  const s = path.join(out, task, 'starter')
  const d = path.join(out, task, 'solution')
  copyDir(starter, s)
  copyDir(starter, d)
  applySolution(d, arm, task)
  return { s, d }
}

/** F1: everything main.js adds moves to App.jsx; main.js goes back to the starter's `run(App)`. */
export function rootDrivers(out) {
  for (const task of F1_TASKS) {
    const { s, d } = pair('sygnal', task, out)
    const main = read(path.join(d, 'src/main.js'))
    const app = path.join(d, 'src/App.jsx')
    const m = main.match(/run\(App,\s*(\{[\s\S]*\})\s*\)\s*$/m)
    if (!m) throw new Error(`rewrite: no run(App, {...}) in ${task}`)
    const body = main.slice(0, m.index)
    const importsEnd = [...body.matchAll(/^import .*$/gm)].at(-1)
    const lastImport = importsEnd.index + importsEnd[0].length
    const helpers = body.slice(lastImport).trim()
    let appSrc = read(app)
    const lines = []
    for (const im of body.matchAll(/^import (.*) from '(.*)'$/gm)) {
      if (/^\.\/(App|routes)\b/.test(im[2]) || im[1] === 'App') continue
      const named = im[1].match(/^\{\s*(.*?)\s*\}$/)
      const names = named ? named[1].split(/\s*,\s*/).filter((n) => n !== 'run' && !new RegExp(`\\b${n}\\b`).test(appSrc.split('\n').filter((l) => l.startsWith('import')).join('\n'))) : null
      if (names && !names.length) continue
      lines.push(names ? `import { ${names.join(', ')} } from '${im[2]}'` : im[0])
    }
    const firstNonImport = appSrc.split('\n').findIndex((l, i, a) => l && !l.startsWith('import') && (i === 0 || a[i - 1].startsWith('import') || !a[i - 1]))
    const appLines = appSrc.split('\n')
    appLines.splice(firstNonImport, 0, ...lines, ...(helpers ? ['', helpers, ''] : []))
    appSrc = appLines.join('\n').replace(/\s*$/, '\n') + `\nApp.drivers = ${m[1]}\n`
    write(app, appSrc)
    write(path.join(d, 'src/main.js'), read(path.join(s, 'src/main.js')))
  }
}

const take = (f, re) => {
  const src = read(f)
  const m = src.match(re)
  if (!m) throw new Error(`rewrite: no ${re} in ${f}`)
  write(f, src.replace(re, ''))
  return m[0]
}
const AFTER = /(^import .*$\n)(?!import)/m
const insert = (f, text) => edit(f, [[read(f).match(AFTER)[0], `${read(f).match(AFTER)[1]}\n${text}\n`]])

const typeBlock = (name) => new RegExp(`(/\\*\\*[^\\n]*\\*/\\n)?export type ${name} = [\\s\\S]*?\\n}\\n\\n?`)
const lineType = (name) => new RegExp(`(/\\*\\*[^\\n]*\\*/\\n)?export type ${name} = .*\\n\\n?`)

/** Moves a TypeScript fixture's state/event types next to the code they describe, in the starter and the finished tree. */
export function tsColocate(out) {
  const both = (task, f) => {
    const { s, d } = pair('sygnal', task, out)
    for (const dir of [s, d]) f(path.join(dir, 'src'), dir === d)
  }
  both('18-ts-collection-pin', (src) => {
    insert(path.join(src, 'App.tsx'), `import type { Task } from './types'\n\n${take(path.join(src, 'types.ts'), typeBlock('AppState')).trim()}`)
    edit(path.join(src, 'App.tsx'), [["import type { AppState } from './types'\n", '']])
  })
  both('19-ts-events-status', (src, finished) => {
    const ev = read(path.join(src, 'events.ts'))
    fs.rmSync(path.join(src, 'events.ts'))
    if (finished) insert(path.join(src, 'Editor.tsx'), ev.slice(ev.indexOf('declare module')))
  })
  both('20-ts-board-moves', (src, finished) => {
    if (!finished) return
    const t = path.join(src, 'types.ts')
    const card = take(t, lineType('CardMove')).trim()
    const list = take(t, lineType('ListMove')).trim()
    edit(path.join(src, 'Card.tsx'), [["import type { CardState, CardMove } from './types'", "import type { CardState } from './types'"]])
    insert(path.join(src, 'Card.tsx'), card)
    edit(path.join(src, 'List.tsx'), [["import type { ListState, ListMove } from './types'", "import type { ListState } from './types'\nimport type { CardMove } from './Card'"]])
    insert(path.join(src, 'List.tsx'), list)
  })
  both('21-ts-selection-panel', (src, finished) => {
    const t = path.join(src, 'types.ts')
    const app = path.join(src, 'App.tsx')
    const moved = [take(t, typeBlock('AppState')), take(t, typeBlock('AppCalculated')), ...(finished ? [take(t, lineType('SelectedTask'))] : []), take(t, typeBlock('AppContext'))]
    const names = finished ? 'AppState, AppCalculated, AppContext, SelectedTask' : 'AppState, AppCalculated, AppContext'
    edit(app, [[`import type { ${names} } from './types'`, "import type { FiltersState, ProjectState, TaskState } from './types'"]])
    insert(app, moved.map((x) => x.trim()).join('\n\n'))
    edit(path.join(src, 'ProjectSection.tsx'), [["import type { ProjectState, TaskState, AppContext } from './types'", "import type { ProjectState, TaskState } from './types'\nimport type { AppContext } from './App'"]])
    if (finished) {
      edit(path.join(src, 'TaskRow.tsx'), [["import type { TaskState, AppContext } from './types'", "import type { TaskState } from './types'\nimport type { AppContext } from './App'"]])
      edit(path.join(src, 'DetailsPanel.tsx'), [["import type { AppContext } from './types'", "import type { AppContext } from './App'"]])
      const ev = read(path.join(src, 'events.ts'))
      insert(path.join(src, 'TaskRow.tsx'), ev.slice(ev.indexOf('declare module')))
    }
    fs.rmSync(path.join(src, 'events.ts'))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.resolve(process.argv[2] ?? 'out')
  fs.rmSync(out, { recursive: true, force: true })
  rootDrivers(path.join(out, 'root-drivers'))
  tsColocate(path.join(out, 'ts-colocate'))
  console.log(`rewrote ${F1_TASKS.length} + ${F2_TASKS.length} tasks to ${out}`)
}

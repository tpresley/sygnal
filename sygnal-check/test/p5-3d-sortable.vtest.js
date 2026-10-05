/**
 * PLAN-5 3-D (B-1): sygnal-check and the first-party `sortable` behavior (FIRST_PARTY.sortable
 * in src/model/behaviors.js, rules/a11y/syg724-sortable.js): the canonical recipe is clean under
 * --strict and a11y (its item / handle selectors are rendered by the Collection item: delegated,
 * not SYG104), option typos are SYG127, a selector rendered nowhere is still SYG110, a host
 * 'sort.DROPPED' entry is accepted, and SYG724 reports an unfocusable or unnamed handle and a
 * missing live region.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p5-3d-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const GRIP = `<button type="button" className="grip" aria-label={\`Reorder \${state.title}\`} aria-describedby={context.sort.helpId}>⠿</button>`
const LIVE = `<p role="status" aria-live="assertive">{state.sort.message}</p>`
// the canonical recipe (docs guide/drag-and-drop)
const LIST = ({ grip = GRIP, live = LIVE, opts = "from: 'tasks', item: '.task', handle: '.grip'", extra = '' } = {}) => `import { Collection, sortable } from 'sygnal'

function Task({ state, context }) {
  const cls = context.sort.dragging === String(state.id) ? 'task dragging' : 'task'
  return (
    <li className={cls} data-id={state.id}>
      ${grip}
      <span className="title">{state.title}</span>
    </li>
  )
}

export function TaskList({ state }) {
  return (
    <section>
      <p id={state.sort.helpId} hidden>Press Space to pick up a task, the arrow keys to move it, Space to drop it.</p>
      <ul className="tasks"><Collection of={Task} from="tasks" /></ul>
      ${live}
    </section>
  )
}
TaskList.initialState = { tasks: [{ id: 1, title: 'Write spec' }, { id: 2, title: 'Ship' }] }
TaskList.uses = { sort: sortable({ ${opts} }) }
TaskList.context = { sort: (state) => state.sort }
TaskList.model = {
  'sort.DROPPED': { EFFECT: (state, move) => console.log(move) },
${extra}}
`

describe('3-D: the sortable behavior in sygnal-check', () => {
  it('the canonical recipe has no findings (strict, a11y)', () => {
    expect(check({ 'TaskList.jsx': LIST() }, { strict: true })).toEqual([])
  })

  it('two lists (from: [a, b]) and no handle (a focusable, named item) are clean too', () => {
    const src = LIST({ opts: "from: ['tasks', 'done'], item: '.task'" })
      .replace('<li className={cls} data-id={state.id}>', '<li className={cls} data-id={state.id} tabIndex={0} aria-label={state.title}>')
      .replace(GRIP, '')
      .replace("TaskList.initialState = { tasks: [{ id: 1, title: 'Write spec' }, { id: 2, title: 'Ship' }] }", "TaskList.initialState = { tasks: [], done: [] }")
    expect(check({ 'TaskList.jsx': src }, { strict: true })).toEqual([])
  })

  it('an item class built dynamically in the Collection item is accepted (delegated)', () => {
    const src = LIST().replace("const cls = context.sort.dragging === String(state.id) ? 'task dragging' : 'task'",
      "const cls = ['task', context.sort.dragging === String(state.id) && 'dragging'].filter(Boolean).join(' ')")
    expect(check({ 'TaskList.jsx': src }, { strict: true })).toEqual([])
  })

  it('an option typo is SYG127 (and without its handle, the <li> item is what keyboard users would need to focus: SYG724)', () => {
    const d = check({ 'TaskList.jsx': LIST({ opts: "from: 'tasks', item: '.task', handel: '.grip'" }) })
    expect(codes(d)).toEqual(['SYG127 error', 'SYG724 warn'])
    expect(d.find(x => x.code === 'SYG127').message).toContain("'handel'")
  })

  it('a handle selector rendered nowhere is SYG110 (delegated selectors are still checked)', () => {
    const d = check({ 'TaskList.jsx': LIST({ opts: "from: 'tasks', item: '.task', handle: '.grpi'" }) })
    expect(d.map(x => x.code)).toEqual(['SYG110'])
    expect(d[0].message).toContain('grpi')
  })

  it('a host model entry nobody triggers is still SYG102', () => {
    const d = check({ 'TaskList.jsx': LIST({ extra: '  NEVER: (state) => state,\n' }) })
    expect(d.map(x => x.code)).toEqual(['SYG102'])
  })

  it('SYG724: a handle that can\'t take focus', () => {
    const d = check({ 'TaskList.jsx': LIST({ grip: '<span className="grip">⠿</span>' }) })
    expect(codes(d)).toEqual(['SYG724 warn'])
    expect(d[0].message).toMatch(/can't take keyboard focus/)
    expect(d[0].data).toMatchObject({ key: 'sort', problem: 'focus', element: 'span' })
  })

  it('SYG724: a focusable handle with no name (a <button> without a name is SYG705\'s)', () => {
    const d = check({ 'TaskList.jsx': LIST({ grip: '<span className="grip" tabIndex={0}><i className="icon-grip" /></span>' }) })
    expect(codes(d)).toEqual(['SYG724 warn'])
    expect(d[0].data.problem).toBe('name')
    const b = check({ 'TaskList.jsx': LIST({ grip: '<button type="button" className="grip"><i className="icon-grip" /></button>' }) })
    expect(codes(b)).toEqual(['SYG705 warn'])
  })

  it('SYG724: no live region for the announcements', () => {
    const d = check({ 'TaskList.jsx': LIST({ live: '<p className="msg">{state.sort.message}</p>' }) })
    expect(codes(d)).toEqual(['SYG724 warn'])
    expect(d[0].data.problem).toBe('live-region')
    expect(d[0].message).toContain('state.sort.message')
  })

  it('SYG724 says nothing when it can\'t see everything (a dynamic handle, an unresolved child)', () => {
    expect(check({ 'TaskList.jsx': LIST({ grip: '<span className="grip">⠿</span>', opts: "from: 'tasks', item: '.task', handle: HANDLE" }).replace("import { Collection, sortable } from 'sygnal'", "import { Collection, sortable } from 'sygnal'\nconst HANDLE = ['.grip'].join('')") }).filter(d => d.code === 'SYG724')).toEqual([])
    const src = LIST({ live: '<Announcer text={state.sort.message} />' }).replace("import { Collection, sortable } from 'sygnal'", "import { Collection, sortable } from 'sygnal'\nimport { Announcer } from 'some-ui-kit'")
    expect(check({ 'TaskList.jsx': src }).filter(d => d.code === 'SYG724')).toEqual([])
  })
})

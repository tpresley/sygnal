// S-2 throwaway probe: a runtime inspect() graph of kanban, through renderComponent (mock DOM).
// Not collected by any suite. To run it, copy it into examples/kanban/src/ (the kanban Vite config
// loads sygnal/diagnostics as a setup file), run `npx vitest run src/kanban.probe.test.js` there,
// then delete the copy. Writes runtime/kanban.runtime.json (+ .state.json: per-instance state,
// which inspect() does not include) next to this file's original.
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { renderComponent } from 'sygnal'
import { resetChecks } from 'sygnal/diagnostics'
import RootComponent from './RootComponent.jsx'
import { mockDragDriver } from './testHelpers.js'

const OUT = process.env.PROBE_OUT

it('runtime inspect() of kanban after a short session', async () => {
  resetChecks()
  const dnd = mockDragDriver()
  const t = renderComponent(RootComponent, { drivers: { DND: dnd.driver } })
  await t.ready()
  const before = t.inspect({ actions: true })
  t.simulateEvent('.add-lane-btn', 'click')
  await t.waitForState(s => s.lanes.length === 4)
  t.simulateEvent('.add-task-btn', 'click')
  await t.waitForState(s => s.lanes[0].isAddingTask)
  t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', value: 'Write tests' })
  await t.waitForState(s => s.lanes[0].tasks.length === 3)
  t.simulateEvent('.task-card[data-task-id="task-2"] .delete-task-btn', 'click')
  await t.waitForState(s => !s.lanes[0].tasks.some(x => x.id === 'task-2'))
  t.simulateEvent('.lane-header[data-lane-id="lane-4"] .move-lane-left', 'click')
  await t.waitForState(s => s.lanes.map(l => l.id).join() === 'lane-1,lane-2,lane-4,lane-3')
  await t.settle()
  const after = t.inspect({ actions: 40 })
  fs.writeFileSync(path.join(OUT, 'kanban.runtime.initial.json'), JSON.stringify(before, null, 2))
  fs.writeFileSync(path.join(OUT, 'kanban.runtime.json'), JSON.stringify(after, null, 2))
  fs.writeFileSync(path.join(OUT, 'kanban.state.json'), JSON.stringify({ root: t.state }, null, 2))
  t.dispose()
})

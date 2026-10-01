// 2B: runtime inspect on the kanban example, against the BUILT packages ('sygnal' +
// 'sygnal/diagnostics', like an app would load them; run `npm run build` first), and the
// static graph of the same source: both validate against sygnal-check/schema/inspect.schema.json.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import xs from 'xstream'
import { validate } from '../sygnal-check/src/schema.js'
import { graph } from '../sygnal-check/src/graph.js'

const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../sygnal-check/schema/inspect.schema.json', import.meta.url)), 'utf8'))
const kanban = fileURLToPath(new URL('../examples/kanban', import.meta.url))

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

// the drag driver needs a real DOM; a source with the same API that never fires
const never = () => Object.assign(xs.never(), { data: () => xs.never() })
const DND = () => ({ dragstart: never, dragend: never, drop: never, dragover: never, dragenter: never, dragleave: never })

let sygnal, RootComponent, reactShim = false
beforeAll(async () => {
  sygnal = await import('sygnal')
  await import('sygnal/diagnostics')
  // the root vitest compiles the example's .jsx as classic React.createElement calls
  if (typeof globalThis.React === 'undefined') { globalThis.React = { createElement: sygnal.createElement }; reactShim = true }
  RootComponent = (await import('../examples/kanban/src/RootComponent.jsx')).default
})
afterAll(() => { if (reactShim) delete globalThis.React })

const byName = (g, name) => g.components.filter(c => c.name === name)

describe('kanban: runtime inspect (renderComponent + built dev entry)', () => {
  it('returns the live graph of the tree', async () => {
    const t = sygnal.renderComponent(RootComponent, { drivers: { DND } })
    try {
      await t.ready()
      t.simulateEvent('.add-lane-btn', 'click')
      await t.waitForState(s => s.lanes.length === 4)
      t.simulateEvent('.delete-lane-btn', 'click') // the first lane emits DELETE_LANE
      await t.waitForState(s => s.lanes.length === 3)
      await new Promise(r => setTimeout(r, 50))
      const g = t.inspect()
      if (process.env.SYGNAL_INSPECT_DUMP) writeFileSync(process.env.SYGNAL_INSPECT_DUMP, JSON.stringify(g, null, 2))
      expect(validate(schema, g)).toEqual([])

      const [root] = byName(g, 'RootComponent')
      expect(root.kind).toBe('root')
      expect(root.contextProvides).toEqual(['draggingTaskId', 'draggingLaneId'])
      expect(root.eventsSelected).toEqual(['DELETE_LANE', 'MOVE_LANE_LEFT', 'MOVE_LANE_RIGHT'])
      expect(root.children).toEqual([{ name: 'LaneComponent', via: 'collection', count: 3 }])
      expect(root.selectors).toEqual([{ selector: '.add-lane-btn', events: ['click'], matched: true, isolationHit: null }])
      expect(root.actions.find(a => a.name === 'BOOTSTRAP')).toEqual({ name: 'BOOTSTRAP', trigger: 'builtin', sinks: ['DND'] })

      const lanes = byName(g, 'LaneComponent')
      expect(lanes).toHaveLength(3)
      for (const lane of lanes) {
        expect(lane.kind).toBe('collection-item')
        expect(lane.parentId).toBe(root.id)
        expect(lane.selectors.every(s => s.isolationHit === null)).toBe(true)
      }
      expect(byName(g, 'TaskCard').every(c => c.kind === 'collection-item')).toBe(true)
      // lane-2's task (the TaskCards of the deleted lane-1 are not disposed by the core yet,
      // so they are still listed, under the removed lane's id)
      const laneIds = lanes.map(l => l.id)
      expect(byName(g, 'TaskCard').filter(c => laneIds.includes(c.parentId))).toHaveLength(1)
      // the lane that emitted DELETE_LANE was removed (and pruned); the event is still on the bus map
      expect(g.events.DELETE_LANE.selectors).toEqual(['RootComponent'])
      t.expectNoDiagnostics()
    } finally {
      t.dispose()
    }
  })
})

describe('kanban: static graph (sygnal-check --graph)', () => {
  it('has the same shape, with what the source shows', () => {
    const g = graph(['src'], { cwd: kanban })
    if (process.env.SYGNAL_GRAPH_DUMP) writeFileSync(process.env.SYGNAL_GRAPH_DUMP, JSON.stringify(g, null, 2))
    expect(validate(schema, g)).toEqual([])
    expect(g.components.map(c => [c.name, c.kind])).toEqual([
      ['LaneComponent', 'collection-item'], ['RootComponent', 'root'], ['TaskCard', 'collection-item'],
    ])
    expect(g.events.DELETE_LANE).toEqual({ emitters: ['LaneComponent'], selectors: ['RootComponent'] })
    expect(byName(g, 'RootComponent')[0].children).toEqual([{ name: 'LaneComponent', via: 'collection', from: 'lanes' }])
    expect(byName(g, 'TaskCard')[0].contextConsumes).toEqual(['draggingTaskId'])
  })
})

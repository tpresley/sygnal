// Zero-diagnostics smoke test: the whole board (RootComponent → Collection of
// LaneComponent → Collection of TaskCard) runs with the runtime dev checks and
// strict mode on, through a realistic sequence of user interactions, and must
// not produce a single warn/error diagnostic.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
// The kanban Vite config's sygnal() plugin already loads this as a Vitest
// setup file; importing it here keeps the test meaningful on its own.
import { checks, isStrictEnabled, resetChecks } from 'sygnal/diagnostics'
import RootComponent from './RootComponent.jsx'
import { mockDragDriver, waitForHtml } from './testHelpers.js'

const laneIds = (s) => s.lanes.map(l => l.id)
const lane = (s, id) => s.lanes.find(l => l.id === id)
const tick = () => new Promise(r => setTimeout(r, 20))

describe('kanban smoke test (dev checks + strict, zero diagnostics)', () => {
  let t
  // The checks report each finding once per process (per component + key), so
  // without a reset a finding raised in an earlier test would be skipped here.
  beforeEach(() => resetChecks())
  afterEach(() => {
    t?.dispose()
    t = null
  })

  it('the dev checks are loaded and strict mode is on while rendered', async () => {
    t = renderComponent(RootComponent, { drivers: { DND: mockDragDriver().driver }, strict: true })
    await t.ready()
    expect(checks.length).toBeGreaterThan(0)
    expect(isStrictEnabled()).toBe(true)
  })

  it('add, rename, move and delete lanes; add, drag and delete tasks', async () => {
    const dnd = mockDragDriver()
    t = renderComponent(RootComponent, { drivers: { DND: dnd.driver }, strict: true })
    await t.ready()
    expect(dnd.configs.map(c => c.category)).toEqual(['task', 'lane', 'lane-sort'])

    // waitForState() also matches states recorded earlier, so every predicate
    // below only holds after the step it waits for.

    // Add a lane
    t.simulateEvent('.add-lane-btn', 'click')
    let s = await t.waitForState(s => s.lanes.length === 4)
    expect(laneIds(s)).toEqual(['lane-1', 'lane-2', 'lane-3', 'lane-4'])
    expect(s.lanes[2].isLast).toBe(false)
    expect(s.lanes[3].isLast).toBe(true)

    // Rename it: double-click the title, type, press Enter
    const header = '.lane-header[data-lane-id="lane-4"]'
    await waitForHtml(t, 'data-lane-id="lane-4"')
    t.simulateEvent(`${header} .lane-title`, 'dblclick')
    s = await t.waitForState(s => lane(s, 'lane-4').isEditing)
    expect(lane(s, 'lane-4').titleDraft).toBe('New Lane')
    await waitForHtml(t, 'class="lane-title-input"')
    await waitForHtml(t, '<input class="lane-title-input" type="text" value="New Lane">')
    t.simulateEvent(`${header} .lane-title-input`, 'input', { value: 'Review' })
    await t.waitForState(s => lane(s, 'lane-4').titleDraft === 'Review')
    // The controlled input now renders the typed text, so a re-render keeps it
    await waitForHtml(t, '<input class="lane-title-input" type="text" value="Review">')
    t.simulateEvent(`${header} .lane-title-input`, 'keydown', { key: 'Enter', value: ' Review ' })
    s = await t.waitForState(s => lane(s, 'lane-4').title === 'Review')
    expect(lane(s, 'lane-4').isEditing).toBe(false)
    await waitForHtml(t, '<h2 class="lane-title">Review</h2>')

    // Add a task to the first lane ('.add-task-btn' matches lane-1's button first)
    t.simulateEvent('.add-task-btn', 'click')
    await t.waitForState(s => lane(s, 'lane-1').isAddingTask)
    // A selector that matches no rendered element is delivered to every
    // listener on that selector (all four lanes), so wait for the input first
    await waitForHtml(t, 'class="new-task-input"')
    t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', value: '  Write tests ' })
    s = await t.waitForState(s => lane(s, 'lane-1').tasks.length === 3)
    expect(lane(s, 'lane-1').tasks[2].title).toBe('Write tests')
    expect(lane(s, 'lane-1').isAddingTask).toBe(false)

    // Delete a task (TaskCard PARENT → LaneComponent CHILD)
    t.simulateEvent('.task-card[data-task-id="task-2"] .delete-task-btn', 'click')
    s = await t.waitForState(s => !lane(s, 'lane-1').tasks.some(task => task.id === 'task-2'))
    expect(lane(s, 'lane-1').tasks.map(task => task.title)).toEqual(['Design homepage mockups', 'Write tests'])

    // Drag task-1 onto the "In Progress" lane, before task-3
    dnd.emit('task:dragstart', { dataset: { taskId: 'task-1' } })
    s = await t.waitForState(s => s.dragging?.taskId === 'task-1')
    await waitForHtml(t, 'task-card dragging')
    dnd.emit('lane:drop', { dropZone: { dataset: { laneId: 'lane-2' } }, insertBefore: { dataset: { taskId: 'task-3' } } })
    s = await t.waitForState(s => lane(s, 'lane-2').tasks.length === 2)
    expect(s.dragging).toBe(null)
    expect(lane(s, 'lane-2').tasks.map(task => task.id)).toEqual(['task-1', 'task-3'])

    // Move the new lane left with its arrow button (LaneComponent EVENTS → root)
    t.simulateEvent(`${header} .move-lane-left`, 'click')
    s = await t.waitForState(s => laneIds(s).join() === 'lane-1,lane-2,lane-4,lane-3')
    expect(s.lanes[3].isLast).toBe(true)

    // Reorder lanes by dragging: lane-3 dropped on lane-1's header
    dnd.emit('lane-sort:dragstart', { dataset: { laneId: 'lane-3' } })
    await t.waitForState(s => s.draggingLane === 'lane-3')
    dnd.emit('lane-sort:drop', { dropZone: { dataset: { laneId: 'lane-1' } }, insertBefore: null })
    s = await t.waitForState(s => s.lanes[0].id === 'lane-3')
    expect(s.draggingLane).toBe(null)
    expect(laneIds(s)).toEqual(['lane-3', 'lane-1', 'lane-2', 'lane-4'])

    // Delete a lane
    t.simulateEvent('.lane-header[data-lane-id="lane-2"] .delete-lane-btn', 'click')
    s = await t.waitForState(s => !s.lanes.some(l => l.id === 'lane-2'))
    expect(laneIds(s)).toEqual(['lane-3', 'lane-1', 'lane-4'])

    await tick()
    t.expectNoDiagnostics()
  })
})

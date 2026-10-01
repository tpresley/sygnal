import { describe, it, expect, afterEach } from 'vitest'
import { ABORT, renderComponent } from 'sygnal'
import LaneComponent from './LaneComponent.jsx'

const { model } = LaneComponent

function makeLaneState(overrides = {}) {
  return {
    id: 'lane-1',
    title: 'To Do',
    tasks: [
      { id: 'task-1', title: 'Task 1', description: '' },
      { id: 'task-2', title: 'Task 2', description: '' },
    ],
    isEditing: false,
    isAddingTask: false,
    isFirst: true,
    isLast: false,
    ...overrides,
  }
}

describe('LaneComponent', () => {
  describe('START_EDIT', () => {
    it('sets isEditing to true', () => {
      const result = model.START_EDIT(makeLaneState())
      expect(result.isEditing).toBe(true)
    })

    it('preserves other state properties', () => {
      const state = makeLaneState()
      const result = model.START_EDIT(state)
      expect(result.title).toBe(state.title)
      expect(result.tasks).toBe(state.tasks)
    })
  })

  describe('START_EDIT draft', () => {
    it('starts the draft from the current title', () => {
      const result = model.START_EDIT(makeLaneState({ title: 'Doing' }))
      expect(result.titleDraft).toBe('Doing')
    })
  })

  describe('EDIT_TITLE', () => {
    it('updates the draft only', () => {
      const state = makeLaneState({ isEditing: true, titleDraft: 'To Do' })
      const result = model.EDIT_TITLE(state, 'To Do!')
      expect(result.titleDraft).toBe('To Do!')
      expect(result.title).toBe('To Do')
      expect(result.isEditing).toBe(true)
    })
  })

  describe('FINISH_EDIT', () => {
    it('updates title and stops editing', () => {
      const state = makeLaneState({ isEditing: true })
      const result = model.FINISH_EDIT(state, 'New Title')
      expect(result.title).toBe('New Title')
      expect(result.isEditing).toBe(false)
    })

    it('trims whitespace from title', () => {
      const state = makeLaneState({ isEditing: true })
      const result = model.FINISH_EDIT(state, '  Trimmed  ')
      expect(result.title).toBe('Trimmed')
    })

    it('keeps original title when new title is empty', () => {
      const state = makeLaneState({ isEditing: true, title: 'Original' })
      const result = model.FINISH_EDIT(state, '')
      expect(result.title).toBe('Original')
    })

    it('keeps original title when new title is only whitespace', () => {
      const state = makeLaneState({ isEditing: true, title: 'Original' })
      const result = model.FINISH_EDIT(state, '   ')
      expect(result.title).toBe('Original')
    })
  })

  describe('SHOW_ADD_TASK', () => {
    it('sets isAddingTask to true', () => {
      const result = model.SHOW_ADD_TASK(makeLaneState())
      expect(result.isAddingTask).toBe(true)
    })
  })

  describe('ADD_TASK', () => {
    it('adds a new task and hides input', () => {
      const state = makeLaneState({ isAddingTask: true })
      const result = model.ADD_TASK(state, 'New Task')
      expect(result.tasks).toHaveLength(3)
      expect(result.tasks[2].title).toBe('New Task')
      expect(result.isAddingTask).toBe(false)
    })

    it('trims whitespace from task title', () => {
      const result = model.ADD_TASK(makeLaneState({ isAddingTask: true }), '  Trimmed Task  ')
      expect(result.tasks[2].title).toBe('Trimmed Task')
    })

    it('returns ABORT for empty title', () => {
      const result = model.ADD_TASK(makeLaneState(), '')
      expect(result).toBe(ABORT)
    })

    it('returns ABORT for whitespace-only title', () => {
      const result = model.ADD_TASK(makeLaneState(), '   ')
      expect(result).toBe(ABORT)
    })

    it('generates a task id starting with task-', () => {
      const result = model.ADD_TASK(makeLaneState({ isAddingTask: true }), 'Task A')
      expect(result.tasks[2].id).toMatch(/^task-/)
    })

    it('new task has empty description', () => {
      const result = model.ADD_TASK(makeLaneState({ isAddingTask: true }), 'Task A')
      expect(result.tasks[2].description).toBe('')
    })

    it('appends new task at the end', () => {
      const result = model.ADD_TASK(makeLaneState({ isAddingTask: true }), 'New Task')
      expect(result.tasks[0].id).toBe('task-1')
      expect(result.tasks[1].id).toBe('task-2')
      expect(result.tasks[2].title).toBe('New Task')
    })
  })

  describe('CANCEL_ADD_TASK', () => {
    it('sets isAddingTask to false', () => {
      const state = makeLaneState({ isAddingTask: true })
      const result = model.CANCEL_ADD_TASK(state)
      expect(result.isAddingTask).toBe(false)
    })

    it('returns ABORT when not adding a task', () => {
      const result = model.CANCEL_ADD_TASK(makeLaneState({ isAddingTask: false }))
      expect(result).toBe(ABORT)
    })
  })

  describe('DELETE_TASK', () => {
    it('removes the specified task', () => {
      const result = model.DELETE_TASK(makeLaneState(), 'task-1')
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].id).toBe('task-2')
    })

    it('handles deleting non-existent task gracefully', () => {
      const result = model.DELETE_TASK(makeLaneState(), 'nonexistent')
      expect(result.tasks).toHaveLength(2)
    })

    it('can delete all tasks', () => {
      let state = makeLaneState()
      state = model.DELETE_TASK(state, 'task-1')
      state = model.DELETE_TASK(state, 'task-2')
      expect(state.tasks).toHaveLength(0)
    })
  })

  describe('DELETE_LANE (EVENTS emitter)', () => {
    it('emits DELETE_LANE event with lane id', () => {
      const state = makeLaneState({ id: 'lane-5' })
      const result = model.DELETE_LANE.EVENTS(state)
      expect(result).toEqual({ type: 'DELETE_LANE', data: { laneId: 'lane-5' } })
    })
  })

  describe('MOVE_LEFT (EVENTS emitter)', () => {
    it('emits MOVE_LANE_LEFT event with lane id', () => {
      const state = makeLaneState({ id: 'lane-3' })
      const result = model.MOVE_LEFT.EVENTS(state)
      expect(result).toEqual({ type: 'MOVE_LANE_LEFT', data: { laneId: 'lane-3' } })
    })
  })

  describe('MOVE_RIGHT (EVENTS emitter)', () => {
    it('emits MOVE_LANE_RIGHT event with lane id', () => {
      const state = makeLaneState({ id: 'lane-2' })
      const result = model.MOVE_RIGHT.EVENTS(state)
      expect(result).toEqual({ type: 'MOVE_LANE_RIGHT', data: { laneId: 'lane-2' } })
    })
  })
})

// End-to-end: DOM event → intent → model → sinks, through renderComponent's
// mock DOM. These exercise the real wiring (selectors, .map(e => e.target.value),
// Collection → CHILD), not just the reducers.
describe('LaneComponent (end to end with simulateEvent)', () => {
  let t
  afterEach(() => {
    t?.dispose()
    t = null
  })

  it('adds a task: click "+ Add Task", type a title, press Enter', async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState() })
    t.simulateEvent('.add-task-btn', 'click')
    await t.waitForState(s => s.isAddingTask)

    t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', target: { value: '  Write docs ' } })
    const s = await t.waitForState(s => s.tasks.length === 3)

    expect(s.isAddingTask).toBe(false)
    expect(s.tasks[2].title).toBe('Write docs')
    t.expectNoDiagnostics()
  })

  it('ignores keys other than Enter in the new-task input', async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState({ isAddingTask: true }) })
    t.simulateEvent('.new-task-input', 'keydown', { key: 'a', target: { value: 'x' } })
    await t.settle()
    expect(t.states.at(-1).tasks).toHaveLength(2)
  })

  it('renames the lane: double-click the title, then blur the input', async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState() })
    t.simulateEvent('.lane-title', 'dblclick')
    await t.waitForState(s => s.isEditing)

    t.simulateEvent('.lane-title-input', 'blur', { target: { value: 'Backlog' } })
    const s = await t.waitForState(s => s.title === 'Backlog')
    expect(s.isEditing).toBe(false)
    expect(t.html()).toContain('<h2 class="lane-title">Backlog</h2>')
  })

  it('keeps the typed title across a re-render, then commits it on Enter', async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState() })
    t.simulateEvent('.lane-title', 'dblclick')
    await t.waitForState(s => s.isEditing)
    expect(t.html()).toContain('<input class="lane-title-input" type="text" value="To Do">')

    t.simulateEvent('.lane-title-input', 'input', { value: 'Backlog' })
    await t.waitForState(s => s.titleDraft === 'Backlog')
    // An unrelated re-render while editing: the controlled input keeps the
    // typed text, because it is rendered from the draft
    t.simulateEvent('.add-task-btn', 'click')
    await t.waitForState(s => s.isAddingTask)
    expect(t.html()).toContain('<input class="lane-title-input" type="text" value="Backlog">')

    t.simulateEvent('.lane-title-input', 'keydown', { key: 'Enter', value: 'Backlog' })
    const s = await t.waitForState(s => s.title === 'Backlog')
    expect(s.isEditing).toBe(false)
    t.expectNoDiagnostics()
  })

  it("deletes only the clicked TaskCard (TaskCard PARENT → lane CHILD)", async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState() })
    // Second card's delete button; '.delete-task-btn' alone would hit the first card
    t.simulateEvent('.task-card[data-task-id="task-2"] .delete-task-btn', 'click')
    const s = await t.waitForState(s => s.tasks.length === 1)
    expect(s.tasks.map(task => task.id)).toEqual(['task-1'])
  })

  it('emits DELETE_LANE and MOVE_LANE_RIGHT on the EVENTS bus', async () => {
    t = renderComponent(LaneComponent, { initialState: makeLaneState({ id: 'lane-7' }) })
    t.simulateEvent('.delete-lane-btn', 'click')
    t.simulateEvent('.move-lane-right', 'click')
    await t.settle()
    expect(t.emitted).toEqual([
      { type: 'DELETE_LANE', data: { laneId: 'lane-7' } },
      { type: 'MOVE_LANE_RIGHT', data: { laneId: 'lane-7' } },
    ])
  })
})

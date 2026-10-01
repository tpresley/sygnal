import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderComponent, createElement } from 'sygnal'
import TaskCard from './TaskCard.jsx'

// The root `npx vitest` also runs this file, but without the kanban Vite
// config (no Sygnal JSX transform), so the .jsx views compile to classic
// React.createElement calls there. Point those at Sygnal's createElement.
let reactShim = false
beforeAll(() => {
  if (typeof globalThis.React === 'undefined') {
    globalThis.React = { createElement }
    reactShim = true
  }
})
afterAll(() => {
  if (reactShim) delete globalThis.React
})

const { model } = TaskCard

describe('TaskCard', () => {
  describe('DELETE (PARENT emitter)', () => {
    it('emits DELETE event with task id', () => {
      const state = { id: 'task-42', title: 'Test Task', description: '' }
      const result = model.DELETE.PARENT(state)
      expect(result).toEqual({ type: 'DELETE', taskId: 'task-42' })
    })

    it('uses the correct task id from state', () => {
      const state = { id: 'task-99', title: 'Another', description: 'desc' }
      const result = model.DELETE.PARENT(state)
      expect(result.taskId).toBe('task-99')
    })
  })

  it('clicking the delete button sends DELETE to the parent (end to end)', async () => {
    const t = renderComponent(TaskCard, { initialState: { id: 'task-7', title: 'Ship it', description: '' } })
    t.simulateEvent('.delete-task-btn', 'click')
    await t.ready()
    await new Promise(r => setTimeout(r, 20))
    expect(t.sinkValues('PARENT')).toEqual([{ type: 'DELETE', taskId: 'task-7' }])
    expect(t.html()).toContain('<span class="task-title">Ship it</span>')
    t.dispose()
  })
})

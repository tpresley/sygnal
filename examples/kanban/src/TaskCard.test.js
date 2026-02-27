import { describe, it, expect } from 'vitest'
import TaskCard from './TaskCard.jsx'

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
})

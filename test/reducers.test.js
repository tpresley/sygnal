import { describe, it, expect } from 'vitest'
import { set, toggle, emit } from '../src/extra/reducers.js'

describe('set()', () => {
  it('merges a static partial object into state', () => {
    const reducer = set({ isEditing: true })
    const state = { name: 'foo', isEditing: false }
    expect(reducer(state)).toEqual({ name: 'foo', isEditing: true })
  })

  it('does not mutate the original state', () => {
    const state = { a: 1, b: 2 }
    const reducer = set({ b: 3 })
    const next = reducer(state)
    expect(state.b).toBe(2)
    expect(next.b).toBe(3)
  })

  it('accepts a dynamic function that receives (state, data)', () => {
    const reducer = set((state, title) => ({ title }))
    const result = reducer({ title: 'old', count: 5 }, 'new')
    expect(result).toEqual({ title: 'new', count: 5 })
  })

  it('passes next and props to dynamic function', () => {
    let captured = {}
    const nextFn = () => {}
    const props = { x: 1 }
    const reducer = set((_state, _data, next, props) => {
      captured = { next, props }
      return { updated: true }
    })
    reducer({ updated: false }, null, nextFn, props)
    expect(captured.next).toBe(nextFn)
    expect(captured.props).toBe(props)
  })

  it('merges multiple fields from static object', () => {
    const reducer = set({ a: 10, b: 20 })
    expect(reducer({ a: 1, b: 2, c: 3 })).toEqual({ a: 10, b: 20, c: 3 })
  })
})

describe('toggle()', () => {
  it('flips a false field to true', () => {
    const reducer = toggle('visible')
    expect(reducer({ visible: false })).toEqual({ visible: true })
  })

  it('flips a true field to false', () => {
    const reducer = toggle('visible')
    expect(reducer({ visible: true })).toEqual({ visible: false })
  })

  it('preserves other state fields', () => {
    const reducer = toggle('open')
    expect(reducer({ open: false, name: 'x' })).toEqual({ open: true, name: 'x' })
  })

  it('does not mutate original state', () => {
    const state = { flag: true }
    toggle('flag')(state)
    expect(state.flag).toBe(true)
  })
})

describe('emit()', () => {
  it('returns a model entry with EVENTS sink', () => {
    const entry = emit('REFRESH')
    expect(entry).toHaveProperty('EVENTS')
    expect(typeof entry.EVENTS).toBe('function')
  })

  it('emits type with no data when called with type only', () => {
    const entry = emit('REFRESH')
    expect(entry.EVENTS({})).toEqual({ type: 'REFRESH', data: undefined })
  })

  it('emits type with static data', () => {
    const entry = emit('DELETE', { id: 42 })
    expect(entry.EVENTS({})).toEqual({ type: 'DELETE', data: { id: 42 } })
  })

  it('emits type with dynamic data from state', () => {
    const entry = emit('DELETE_LANE', (state) => ({ laneId: state.id }))
    expect(entry.EVENTS({ id: 7 })).toEqual({
      type: 'DELETE_LANE',
      data: { laneId: 7 },
    })
  })

  it('passes actionData to dynamic function', () => {
    const entry = emit('MOVE', (_state, actionData) => ({ pos: actionData }))
    expect(entry.EVENTS({ id: 1 }, 'left')).toEqual({
      type: 'MOVE',
      data: { pos: 'left' },
    })
  })
})

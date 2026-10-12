import { describe, it, expect } from 'vitest'
import { answers } from 'sygnal/ai'
import { PARTS } from './parts.js'
import { selectQuestions, readSelection, layoutQuestions, readLayout, bestOrder, selectRequest, layoutRequest } from './compose.js'

const SELECT = selectQuestions(PARTS)
const use = (...ids) => Object.fromEntries(PARTS.map((p) => [`use_${p.id}`, ids.includes(p.id) ? 'use' : 'omit']))

describe('select', () => {
  it('asks one omit/use choice per part and one side-by-side gate', () => {
    expect(Object.keys(SELECT)).toEqual([...PARTS.map((p) => `use_${p.id}`), 'row'])
    expect(SELECT.use_tasks.criteria).toEqual({ omit: 'None of these elements is needed.', use: "Checklist of the user's tasks for today" })
    expect(SELECT.row.type).toBe('noul')
  })

  it('reads the chosen parts in catalog order, and a row only for 2+ parts', () => {
    const reply = answers(SELECT, { ...use('tasks', 'weather'), row: 0.9 })
    expect(readSelection(PARTS, reply.answers)).toEqual({ ids: ['tasks', 'weather'], row: true })
    expect(readSelection(PARTS, answers(SELECT, { ...use('tasks'), row: 0.9 }).answers)).toEqual({ ids: ['tasks'], row: false })
    expect(readSelection(PARTS, answers(SELECT, { ...use('tasks', 'weather'), row: 0.2 }).answers).row).toBe(false)
  })

  it('sends only the request as the state; the parts travel as the criteria', () => {
    const r = selectRequest({ url: '/decide', model: 'nimble', prompt: 'My tasks', parts: PARTS })
    expect(r).toMatchObject({ url: '/decide', method: 'POST', key: 'compose', latest: true, ok: 'SELECTED', error: 'COMPOSE_FAILED' })
    expect(r.json).toEqual({ model: 'nimble', state: { user_request: 'My tasks' }, questions: SELECT })
  })
})

describe('layout', () => {
  it('asks which of every pair comes higher, and where each part goes when there is a row', () => {
    const q = layoutQuestions(PARTS, { ids: ['revenue', 'churn', 'revenueChart'], row: true })
    expect(Object.keys(q)).toEqual([
      'place_revenue', 'place_churn', 'place_revenueChart',
      'above_revenue__churn', 'above_revenue__revenueChart', 'above_churn__revenueChart',
    ])
    expect(Object.keys(q.above_revenue__churn.criteria)).toEqual(['revenue', 'churn'])
    expect(Object.keys(layoutQuestions(PARTS, { ids: ['tickets', 'orders'], row: false }))).toEqual(['above_tickets__orders'])
  })

  it('orders by summed pairwise probability, ties in catalog order', () => {
    const ids = ['tickets', 'orders', 'feedback']
    const q = layoutQuestions(PARTS, { ids, row: false })
    const reply = answers(q, {
      above_tickets__orders: { probabilities: { tickets: 0.2, orders: 0.8 } },
      above_tickets__feedback: { probabilities: { tickets: 0.9, feedback: 0.1 } },
      above_orders__feedback: { probabilities: { orders: 0.7, feedback: 0.3 } },
    })
    expect(bestOrder(ids, reply.answers)).toEqual(['orders', 'tickets', 'feedback'])
    expect(bestOrder(ids, {})).toEqual(ids)
  })

  it('puts the row where its first part ranks, and unwraps a row of one', () => {
    const selection = { ids: ['revenue', 'churn', 'revenueChart'], row: true }
    const q = layoutQuestions(PARTS, selection)
    const reply = answers(q, {
      place_revenue: 'row', place_churn: 'row', place_revenueChart: 'page',
      above_revenue__churn: 'revenue', above_revenue__revenueChart: 'revenueChart', above_churn__revenueChart: 'revenueChart',
    })
    expect(readLayout(selection, reply.answers)).toEqual([{ id: 'revenueChart' }, { row: ['revenue', 'churn'] }])

    const alone = answers(q, { place_revenue: 'row', place_churn: 'page', place_revenueChart: 'page' })
    expect(readLayout(selection, alone.answers)).toEqual([{ id: 'revenue' }, { id: 'churn' }, { id: 'revenueChart' }])
  })

  it('sends the chosen parts with their descriptions', () => {
    const r = layoutRequest({ url: '/decide', model: 'nimble', prompt: 'p', parts: PARTS, selection: { ids: ['tickets', 'orders'], row: false } })
    expect(r).toMatchObject({ key: 'compose', ok: 'ARRANGED', error: 'COMPOSE_FAILED' })
    expect(r.json.state.selected_elements).toEqual([
      { id: 'tickets', content: 'List of open support tickets, by priority' },
      { id: 'orders', content: 'Table of the most recent orders (customer, amount, status)' },
    ])
  })
})

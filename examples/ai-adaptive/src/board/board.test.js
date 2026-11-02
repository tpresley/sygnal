// The self-arranging board: the rules (no model) and the model (scripted with composeWith).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith, toTree } from 'sygnal/ai'
import BoardLab from './BoardLab.jsx'
import { catalog } from './catalog.js'
import { attention, brief, rulesTree } from './attention.js'
import { START, step } from './world.js'

let t
afterEach(() => { t?.dispose(); t = null })

/** the page, top to bottom: 'part' or 'part:id', rows as row(a,b), the quiet section as quiet(…) */
function shape(layout) {
  const one = (n) => {
    const name = n.params?.id !== undefined ? `${n.part}:${n.params.id}` : n.part
    return n.children ? `${n.part}(${n.children.map(one).join(',')})` : name
  }
  return toTree(layout).map(one)
}

const at = (tick) => {
  let s = { ...START, role: 'oncall', arrange: 'rules', playing: false, pins: [], snoozed: [], log: [] }
  while (s.tick < tick) s = step(s)
  return s
}

async function start(state = {}) {
  t = renderComponent(BoardLab, { strict: true, initialState: { ...BoardLab.initialState, ...state } })
  await t.ready()
  await t.waitForState((s) => (s.arrange === 'model' ? s.page.status === 'composing' : s.page.layout))
}

const steps = async (n) => {
  for (let i = 0; i < n; i++) {
    const tick = t.state.tick
    t.simulateEvent('.step', 'click')
    await t.next((s) => s.tick === tick + 1)
  }
  await t.settle()
}

describe('attention', () => {
  it('scores a calm morning as calm', () => {
    expect(attention(at(0)).every((i) => i.band === 'calm')).toBe(true)
  })

  it('puts an unacknowledged SEV1 above everything at 09:30', () => {
    const items = attention(at(6))
    expect(items[0]).toMatchObject({ key: 'incident:42', band: 'act' })
    expect(items.find((i) => i.key === 'incident:41').band).toBe('act')
  })
})

describe('arranged by the rules', () => {
  it('folds a calm board into the quiet section', async () => {
    await start()
    expect(shape(t.state.page.layout)).toEqual(['quiet(reviews,deploys,services,slo,agenda,queue,oncall)'])
    expect(t.requests('LLM')).toHaveLength(0)
  })

  it('rearranges as the morning goes bad, and back', async () => {
    await start()
    await steps(6)
    expect(shape(t.state.page.layout)).toEqual([
      'incident:42', 'incident:41',
      'row(queue,slo,services)',
      'row(deploys,agenda)',
      'quiet(reviews,oncall)',
    ])
    expect(t.html()).toContain('SEV1 · Checkout returns 502 for every order')
    await steps(6)
    expect(shape(t.state.page.layout)).toEqual(['quiet(reviews,deploys,services,slo,agenda,queue,oncall)'])
  })

  it('does not rearrange when only numbers move within a band', async () => {
    await start()
    await steps(1)
    const before = t.state.page.layout
    expect(t.state.log).toHaveLength(1)
    expect(t.state.page.layout).toBe(before)
  })

  it('keeps an incident card (and its note) while the board moves under it', async () => {
    await start()
    await steps(4)
    t.simulateEvent('[data-node="incident:41"] .note-text', 'input', { value: 'Paged the payments team' })
    await t.settle()
    expect(t.state.incidents[0].note).toBe('Paged the payments team')
    await steps(2) // a SEV1 lands above it
    expect(shape(t.state.page.layout)[1]).toBe('incident:41')
    expect(t.html()).toContain('Paged the payments team')
  })

  it('acknowledging a SEV2 moves it out of the "act" band', async () => {
    await start()
    await steps(4)
    expect(shape(t.state.page.layout)[0]).toBe('incident:41')
    t.simulateEvent('[data-node="incident:41"] .ack', 'click')
    await t.next((s) => s.incidents[0].acked)
    await t.settle()
    expect(shape(t.state.page.layout)[0]).not.toBe('incident:41')
  })

  it('pins a part to the top and snoozes another off the board', async () => {
    await start()
    t.simulateEvent('[data-node="reviews"] .pin', 'click')
    await t.next((s) => s.pins.includes('reviews'))
    await t.settle()
    expect(shape(t.state.page.layout)[0]).toBe('reviews')
    t.simulateEvent('[data-node="agenda"] .snooze', 'click')
    await t.next((s) => s.snoozed.includes('agenda'))
    await t.settle()
    expect(shape(t.state.page.layout).join()).not.toContain('agenda')
  })
})

describe('arranged by the model', () => {
  const MODEL_TREE = [
    { part: 'incident', params: { id: 42, size: 'full', why: 'Checkout is down for everyone' } },
    { part: 'incident', params: { id: 41, size: 'full', why: 'Payments degraded' } },
    { part: 'row', children: [{ part: 'slo', params: { size: 'compact', why: 'Budget burning fast' } }, { part: 'services', params: { size: 'compact', why: 'Two services unhealthy' } }] },
    { part: 'quiet', children: [{ part: 'reviews' }, { part: 'oncall' }] },
  ]

  it('sends a brief of the situation, and shows the reasons the model wrote', async () => {
    await start({ ...at(6), arrange: 'model' })
    expect(t.state.page.status).toBe('composing')
    const request = t.requests('LLM').at(-1)
    expect(request.messages.at(-1).content).toBe(brief(t.state))
    expect(request.messages.at(-1).content).toContain('incident 42: SEV1')
    await composeWith(t, catalog, MODEL_TREE)
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout)).toEqual(['incident:42', 'incident:41', 'row(slo,services)', 'quiet(reviews,oncall)'])
    expect(t.html()).toContain('Checkout is down for everyone')
  })

  it('puts back a pin the model dropped', async () => {
    await start({ ...at(6), arrange: 'model', pins: ['agenda'] })
    expect(t.requests('LLM').at(-1).messages.at(-1).content).toContain('Keep agenda at the very top')
    await composeWith(t, catalog, MODEL_TREE)
    await t.waitForState((s) => s.log.some((l) => l.by === 'app'))
    await t.settle()
    expect(shape(t.state.page.layout)[0]).toBe('agenda')
  })

  it('a change while the model arranges waits for it (busy: queue), and a pin fix keeps it', async () => {
    await start({ ...at(6), arrange: 'model', pins: ['agenda'] })
    expect(t.requests('LLM')).toHaveLength(1)
    // the person pins another card while the model writes: the next arrangement waits
    t.simulateAction('PIN', 'reviews')
    await t.next((s) => s.page.queued)
    expect(t.requests('LLM')).toHaveLength(1)
    expect(t.html()).toContain('again after this one')
    // the first one lands (held to the pin), and the waiting one starts with the new pins
    await composeWith(t, catalog, MODEL_TREE)
    await t.waitForState((s) => s.log.some((l) => l.by === 'app'))
    expect(shape(t.state.page.layout)[0]).toBe('agenda')
    expect(t.state.page).toMatchObject({ status: 'composing', queued: null })
    expect(t.requests('LLM')).toHaveLength(2)
    expect(t.requests('LLM')[1].messages.at(-1).content).toContain('reviews')
    await composeWith(t, catalog, MODEL_TREE)
    await t.waitForState((s) => s.page.status === 'done')
    expect(shape(t.state.page.layout).slice(0, 2)).toEqual(['agenda', 'reviews'])
  })

  it('falls back to the rules when the model fails', async () => {
    await start({ ...at(6), arrange: 'model' })
    await t.fail('LLM', 500, 'page.FAILED')
    await t.waitForState((s) => s.page.status === 'done' && s.page.layout.nodes['incident:42'])
    expect(shape(t.state.page.layout)).toEqual(rulesTree(t.state).map((n) => (n.children ? `${n.part}(${n.children.map((c) => (c.params?.id !== undefined ? `${c.part}:${c.params.id}` : c.part)).join(',')})` : n.params?.id !== undefined ? `${n.part}:${n.params.id}` : n.part)))
  })
})

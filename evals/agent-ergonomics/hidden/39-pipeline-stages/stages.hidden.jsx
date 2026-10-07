import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click } from './dom.js'

// 39 (mod, level M, change): a Screen stage between Applied and Interview, and rejection is no
// longer final: Reconsider puts a rejected candidate back in the stage they were rejected from.

const $ = (sel) => document.querySelector(sel)
const cards = () => [...document.querySelectorAll('ul.candidates li.candidate')]
const names = () => cards().map((li) => textOf(li.querySelector('.name')))
function cardOf(name) {
  const li = cards().find((el) => textOf(el.querySelector('.name')) === name)
  if (!li) throw new Error(`no card "${name}" in: ${bodyText()}`)
  return li
}
const buttonOf = (name, label) => [...cardOf(name).querySelectorAll('button')].find((b) => textOf(b) === label) ?? null
const stageOf = (name) => textOf(cardOf(name).querySelector('.stage'))
const tabs = () => [...document.querySelectorAll('nav.stage-tabs button')].map((b) => textOf(b))
function tab(label) {
  const b = [...document.querySelectorAll('nav.stage-tabs button')].find((el) => textOf(el).startsWith(`${label} (`))
  if (!b) throw new Error(`no "${label}" tab in: ${tabs().join(' | ')}`)
  return b
}
const summary = () => textOf($('p.summary'))
const log = () => [...document.querySelectorAll('section.activity li')].map((li) => textOf(li))

async function press(name, label, expectedStage) {
  const b = buttonOf(name, label)
  if (!b) throw new Error(`no "${label}" button on ${name}'s card in: ${textOf(cardOf(name))}`)
  await click(b)
  await waitFor(() => expect(stageOf(name)).toBe(expectedStage))
}

describe('39 pipeline: Screen stage and Reconsider', () => {
  it('adds a "Screen (N)" tab between Applied and Interview', async () => {
    await mountApp()
    expect(tabs()).toEqual(['All (8)', 'Applied (2)', 'Screen (0)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)'])
    await click(tab('Screen'))
    await waitFor(() => expect(tab('Screen').classList.contains('active')).toBe(true))
    expect(names()).toEqual([])
    expect(bodyText()).toContain('No candidates in this stage.')
  })

  it('Advance goes Applied → Screen → Interview, with live tab counts and log entries', async () => {
    await mountApp()
    await press('Ana Ruiz', 'Advance', 'Screen')
    expect(tabs()).toEqual(['All (8)', 'Applied (1)', 'Screen (1)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)'])
    expect(log()).toEqual(['Ana Ruiz moved to Screen'])
    await press('Ben Ode', 'Advance', 'Screen')
    expect(tabs().slice(1, 3)).toEqual(['Applied (0)', 'Screen (2)'])

    await click(tab('Screen'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Ben Ode']))
    expect(bodyText()).not.toContain('No candidates in this stage.')

    // Advancing out of Screen takes the card off the Screen tab.
    await click(buttonOf('Ana Ruiz', 'Advance'))
    await waitFor(() => expect(names()).toEqual(['Ben Ode']))
    expect(tabs()).toEqual(['All (8)', 'Applied (0)', 'Screen (1)', 'Interview (3)', 'Offer (2)', 'Hired (1)', 'Rejected (1)'])
    expect(log()).toEqual(['Ana Ruiz moved to Interview', 'Ben Ode moved to Screen', 'Ana Ruiz moved to Screen'])

    await click(tab('All'))
    await waitFor(() => expect(names()).toHaveLength(8))
    await press('Ana Ruiz', 'Advance', 'Offer')
    await press('Ana Ruiz', 'Advance', 'Hired')
    expect(buttonOf('Ana Ruiz', 'Advance')).toBeNull()
  })

  it('Screen counts as active, and Reject works from Screen', async () => {
    await mountApp()
    expect(summary()).toBe('6 active · 1 hired')
    await press('Ben Ode', 'Advance', 'Screen')
    expect(summary()).toBe('6 active · 1 hired')
    expect(buttonOf('Ben Ode', 'Reject')).not.toBeNull()
    await press('Ben Ode', 'Reject', 'Rejected')
    expect(summary()).toBe('5 active · 1 hired')
    expect(tabs().slice(2, 3)).toEqual(['Screen (0)'])
    expect(tabs().at(-1)).toBe('Rejected (2)')
    expect(log()[0]).toBe('Ben Ode rejected')
  })

  it('Reconsider puts a rejected candidate back in the stage they were rejected from', async () => {
    await mountApp()
    for (const name of ['Ana Ruiz', 'Cy Lam', 'Eli Stone', 'Gus Hale']) expect(buttonOf(name, 'Reconsider'), name).toBeNull()

    await press('Dee Park', 'Reject', 'Rejected')
    expect(buttonOf('Dee Park', 'Reconsider')).not.toBeNull()
    expect(buttonOf('Dee Park', 'Advance')).toBeNull()
    await press('Dee Park', 'Reconsider', 'Interview')
    expect(buttonOf('Dee Park', 'Reconsider')).toBeNull()
    expect(buttonOf('Dee Park', 'Advance')).not.toBeNull()
    expect(buttonOf('Dee Park', 'Reject')).not.toBeNull()
    expect(tabs()).toEqual(['All (8)', 'Applied (2)', 'Screen (0)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)'])
    expect(summary()).toBe('6 active · 1 hired')
    expect(log()).toEqual(['Dee Park reconsidered (back to Interview)', 'Dee Park rejected'])

    await press('Fay Wu', 'Reject', 'Rejected')
    await press('Fay Wu', 'Reconsider', 'Offer')
    expect(log()[0]).toBe('Fay Wu reconsidered (back to Offer)')

    await press('Ana Ruiz', 'Advance', 'Screen')
    await press('Ana Ruiz', 'Reject', 'Rejected')
    await press('Ana Ruiz', 'Reconsider', 'Screen')
    expect(log()[0]).toBe('Ana Ruiz reconsidered (back to Screen)')
    // Reconsidered candidates keep moving through the pipeline, and a second rejection is remembered too.
    await press('Ana Ruiz', 'Advance', 'Interview')
    await press('Ana Ruiz', 'Reject', 'Rejected')
    await press('Ana Ruiz', 'Reconsider', 'Interview')
  })

  it('Reconsider works from the Rejected tab; a candidate rejected before this change goes back to Applied', async () => {
    await mountApp()
    await press('Cy Lam', 'Reject', 'Rejected')
    await click(tab('Rejected'))
    await waitFor(() => expect(names()).toEqual(['Cy Lam', 'Hana Kim']))

    await click(buttonOf('Hana Kim', 'Reconsider'))
    await waitFor(() => expect(names()).toEqual(['Cy Lam']))
    expect(log()[0]).toBe('Hana Kim reconsidered (back to Applied)')
    await click(buttonOf('Cy Lam', 'Reconsider'))
    await waitFor(() => expect(names()).toEqual([]))
    expect(bodyText()).toContain('No candidates in this stage.')
    expect(tabs()).toEqual(['All (8)', 'Applied (3)', 'Screen (0)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (0)'])
    expect(summary()).toBe('7 active · 1 hired')

    await click(tab('Applied'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Ben Ode', 'Hana Kim']))
    expect(stageOf('Hana Kim')).toBe('Applied')
  })
})

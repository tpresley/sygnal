import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click } from './dom.js'

// 38 (mod, level M, add): put active candidates on hold. Held cards get the `on-hold` class and an
// "On hold" badge, Advance/Reject are disabled, Hold becomes Resume; an "On hold (N)" tab after
// "Rejected"; the summary gains "· K on hold"; hold/resume are logged.

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
const isHeld = (name) => cardOf(name).classList.contains('on-hold')
const badge = (name) => cardOf(name).querySelector('.hold-badge')

async function hold(name) {
  await click(buttonOf(name, 'Hold'))
  await waitFor(() => expect(buttonOf(name, 'Resume')).not.toBeNull())
}
async function resume(name) {
  await click(buttonOf(name, 'Resume'))
  await waitFor(() => expect(buttonOf(name, 'Hold')).not.toBeNull())
}

describe('38 pipeline: on hold', () => {
  it('gives Applied, Interview and Offer candidates a Hold button, and nobody else', async () => {
    await mountApp()
    for (const name of ['Ana Ruiz', 'Ben Ode', 'Cy Lam', 'Dee Park', 'Eli Stone', 'Fay Wu']) {
      expect(buttonOf(name, 'Hold'), name).not.toBeNull()
      expect(isHeld(name)).toBe(false)
      expect(badge(name)).toBeNull()
    }
    for (const name of ['Gus Hale', 'Hana Kim']) expect(buttonOf(name, 'Hold'), name).toBeNull()
  })

  it('holding marks the card, disables Advance and Reject, and Resume undoes it', async () => {
    await mountApp()
    await hold('Cy Lam')
    expect(isHeld('Cy Lam')).toBe(true)
    expect(textOf(badge('Cy Lam'))).toBe('On hold')
    expect(buttonOf('Cy Lam', 'Hold')).toBeNull()
    expect(buttonOf('Cy Lam', 'Advance').disabled).toBe(true)
    expect(buttonOf('Cy Lam', 'Reject').disabled).toBe(true)
    expect(buttonOf('Cy Lam', 'Remove').disabled).toBe(false)
    // Other cards are untouched.
    expect(isHeld('Dee Park')).toBe(false)
    expect(buttonOf('Dee Park', 'Advance').disabled).toBe(false)

    // A held candidate cannot be moved.
    await click(buttonOf('Cy Lam', 'Advance'))
    await click(buttonOf('Cy Lam', 'Reject'))
    expect(stageOf('Cy Lam')).toBe('Interview')

    await resume('Cy Lam')
    expect(isHeld('Cy Lam')).toBe(false)
    expect(badge('Cy Lam')).toBeNull()
    expect(buttonOf('Cy Lam', 'Advance').disabled).toBe(false)
    expect(buttonOf('Cy Lam', 'Reject').disabled).toBe(false)
    await click(buttonOf('Cy Lam', 'Advance'))
    await waitFor(() => expect(stageOf('Cy Lam')).toBe('Offer'))
    // Still an active candidate: it can be held again in its new stage.
    await hold('Cy Lam')
    expect(isHeld('Cy Lam')).toBe(true)
  })

  it('adds an "On hold (N)" tab after Rejected that lists held candidates from every stage', async () => {
    await mountApp()
    expect(tabs()).toEqual(['All (8)', 'Applied (2)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)', 'On hold (0)'])
    await click(tab('On hold'))
    await waitFor(() => expect(tab('On hold').classList.contains('active')).toBe(true))
    expect(names()).toEqual([])
    expect(bodyText()).toContain('No candidates in this stage.')

    await click(tab('All'))
    await waitFor(() => expect(names()).toHaveLength(8))
    await hold('Eli Stone')
    await hold('Ana Ruiz')
    await waitFor(() => expect(tab('On hold').textContent.trim()).toBe('On hold (2)'))
    expect(tabs()).toEqual(['All (8)', 'Applied (2)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)', 'On hold (2)'])

    await click(tab('On hold'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Eli Stone']))
    expect(bodyText()).not.toContain('No candidates in this stage.')
    expect(tab('All').classList.contains('active')).toBe(false)

    // Held candidates still show in their own stage tab and in All.
    await click(tab('Applied'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Ben Ode']))
    expect(isHeld('Ana Ruiz')).toBe(true)
    await click(tab('Offer'))
    await waitFor(() => expect(names()).toEqual(['Eli Stone', 'Fay Wu']))
    await click(tab('All'))
    await waitFor(() => expect(names()).toHaveLength(8))

    // Resuming from the On hold tab takes the candidate off it.
    await click(tab('On hold'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Eli Stone']))
    await click(buttonOf('Eli Stone', 'Resume'))
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz']))
    expect(tabs().at(-1)).toBe('On hold (1)')
  })

  it('shows the number on hold in the summary; held candidates still count as active', async () => {
    await mountApp()
    expect(summary()).toBe('6 active · 1 hired · 0 on hold')
    await hold('Ben Ode')
    await waitFor(() => expect(summary()).toBe('6 active · 1 hired · 1 on hold'))
    await hold('Fay Wu')
    await waitFor(() => expect(summary()).toBe('6 active · 1 hired · 2 on hold'))
    await resume('Ben Ode')
    await waitFor(() => expect(summary()).toBe('6 active · 1 hired · 1 on hold'))
    await resume('Fay Wu')
    await waitFor(() => expect(summary()).toBe('6 active · 1 hired · 0 on hold'))
  })

  it('removing a held candidate updates the counts', async () => {
    await mountApp()
    await hold('Ana Ruiz')
    await hold('Dee Park')
    await waitFor(() => expect(summary()).toBe('6 active · 1 hired · 2 on hold'))
    await click(buttonOf('Ana Ruiz', 'Remove'))
    await waitFor(() => expect(names()).not.toContain('Ana Ruiz'))
    await waitFor(() => expect(summary()).toBe('5 active · 1 hired · 1 on hold'))
    expect(tabs()).toEqual(['All (7)', 'Applied (1)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)', 'On hold (1)'])

    await click(tab('On hold'))
    await waitFor(() => expect(names()).toEqual(['Dee Park']))
    await click(buttonOf('Dee Park', 'Remove'))
    await waitFor(() => expect(names()).toEqual([]))
    expect(bodyText()).toContain('No candidates in this stage.')
    expect(tabs().at(-1)).toBe('On hold (0)')
    expect(summary()).toBe('4 active · 1 hired · 0 on hold')
  })

  it('records holds and resumes in the activity log', async () => {
    await mountApp()
    await hold('Ana Ruiz')
    await waitFor(() => expect(log()).toEqual(['Ana Ruiz put on hold']))
    await resume('Ana Ruiz')
    await waitFor(() => expect(log()).toEqual(['Ana Ruiz resumed', 'Ana Ruiz put on hold']))
    await click(buttonOf('Ana Ruiz', 'Advance'))
    await waitFor(() => expect(log()[0]).toBe('Ana Ruiz moved to Interview'))
    expect(log()).toHaveLength(3)
  })
})

import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click, typeInto, choose } from './dom.js'
import { runProjectTests } from './project.js'

// 38 regressions: everything the board did before still works next to the hold feature.

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
const roleOf = (name) => textOf(cardOf(name).querySelector('.role'))
const tabs = () => [...document.querySelectorAll('nav.stage-tabs button')].map((b) => textOf(b))
function tab(label) {
  const b = [...document.querySelectorAll('nav.stage-tabs button')].find((el) => textOf(el).startsWith(`${label} (`))
  if (!b) throw new Error(`no "${label}" tab in: ${tabs().join(' | ')}`)
  return b
}
const summary = () => textOf($('p.summary'))
const log = () => [...document.querySelectorAll('section.activity li')].map((li) => textOf(li))
const nameField = () => $('form.add-candidate input[name="name"]')
const errorText = () => ($('form.add-candidate p.error') ? textOf($('form.add-candidate p.error')) : null)

async function add(name, role) {
  await typeInto(nameField(), name)
  if (role) await choose($('form.add-candidate select[name="role"]'), role)
  const submit = [...document.querySelectorAll('form.add-candidate button')].find((b) => textOf(b) === 'Add candidate')
  await click(submit)
}

describe('38 pipeline: existing behavior', () => {
  it('still renders the board, the tabs and the summary', async () => {
    await mountApp()
    expect(textOf($('h1'))).toBe('Hiring pipeline')
    expect(tabs().slice(0, 6)).toEqual(['All (8)', 'Applied (2)', 'Interview (2)', 'Offer (2)', 'Hired (1)', 'Rejected (1)'])
    expect(tab('All').classList.contains('active')).toBe(true)
    expect(names()).toEqual(['Ana Ruiz', 'Ben Ode', 'Cy Lam', 'Dee Park', 'Eli Stone', 'Fay Wu', 'Gus Hale', 'Hana Kim'])
    expect(summary()).toMatch(/^6 active · 1 hired\b/)
  })

  it('advances Applied → Interview → Offer → Hired, updating the stage, the tab counts and the log', async () => {
    await mountApp()
    await click(buttonOf('Ben Ode', 'Advance'))
    await waitFor(() => expect(stageOf('Ben Ode')).toBe('Interview'))
    expect(tabs().slice(0, 3)).toEqual(['All (8)', 'Applied (1)', 'Interview (3)'])
    await click(buttonOf('Ben Ode', 'Advance'))
    await waitFor(() => expect(stageOf('Ben Ode')).toBe('Offer'))
    await click(buttonOf('Ben Ode', 'Advance'))
    await waitFor(() => expect(stageOf('Ben Ode')).toBe('Hired'))
    expect(tabs().slice(0, 6)).toEqual(['All (8)', 'Applied (1)', 'Interview (2)', 'Offer (2)', 'Hired (2)', 'Rejected (1)'])
    expect(summary()).toMatch(/^5 active · 2 hired\b/)
    expect(buttonOf('Ben Ode', 'Advance')).toBeNull()
    expect(buttonOf('Ben Ode', 'Reject')).toBeNull()
    expect(log()).toEqual(['Ben Ode moved to Hired', 'Ben Ode moved to Offer', 'Ben Ode moved to Interview'])
  })

  it('rejects and removes candidates', async () => {
    await mountApp()
    await click(buttonOf('Dee Park', 'Reject'))
    await waitFor(() => expect(stageOf('Dee Park')).toBe('Rejected'))
    expect(buttonOf('Dee Park', 'Advance')).toBeNull()
    expect(tabs().slice(0, 6)).toEqual(['All (8)', 'Applied (2)', 'Interview (1)', 'Offer (2)', 'Hired (1)', 'Rejected (2)'])
    expect(summary()).toMatch(/^5 active · 1 hired\b/)
    await click(buttonOf('Gus Hale', 'Remove'))
    await waitFor(() => expect(names()).not.toContain('Gus Hale'))
    expect(tabs().slice(0, 6)).toEqual(['All (7)', 'Applied (2)', 'Interview (1)', 'Offer (2)', 'Hired (0)', 'Rejected (2)'])
    expect(summary()).toMatch(/^5 active · 0 hired\b/)
    expect(log()).toEqual(['Removed Gus Hale', 'Dee Park rejected'])
  })

  it('adds candidates at the end of Applied and refuses an empty name', async () => {
    await mountApp()
    await add('   ')
    await waitFor(() => expect(errorText()).toBe('Enter a name.'))
    expect(names()).toHaveLength(8)
    await add('Ivy Chen', 'Product manager')
    await waitFor(() => expect(names().at(-1)).toBe('Ivy Chen'))
    expect(roleOf('Ivy Chen')).toBe('Product manager')
    expect(stageOf('Ivy Chen')).toBe('Applied')
    expect(buttonOf('Ivy Chen', 'Hold')).not.toBeNull()
    expect(nameField().value).toBe('')
    expect(errorText()).toBeNull()
    expect(tabs().slice(0, 2)).toEqual(['All (9)', 'Applied (3)'])
    expect(log()).toEqual(['Added Ivy Chen (Product manager)'])
  })

  it('filters by stage tab and shows the empty message', async () => {
    await mountApp()
    await click(tab('Interview'))
    await waitFor(() => expect(names()).toEqual(['Cy Lam', 'Dee Park']))
    expect(tab('Interview').classList.contains('active')).toBe(true)
    expect(tab('All').classList.contains('active')).toBe(false)
    await click(tab('Hired'))
    await waitFor(() => expect(names()).toEqual(['Gus Hale']))
    await click(buttonOf('Gus Hale', 'Remove'))
    await waitFor(() => expect(names()).toEqual([]))
    expect(bodyText()).toContain('No candidates in this stage.')
    await click(tab('All'))
    await waitFor(() => expect(names()).toHaveLength(7))
    expect(bodyText()).not.toContain('No candidates in this stage.')
  })

  it('the activity log shows "No activity yet." and Clear empties it', async () => {
    await mountApp()
    expect(textOf($('section.activity'))).toContain('No activity yet.')
    await click(buttonOf('Eli Stone', 'Advance'))
    await waitFor(() => expect(log()).toEqual(['Eli Stone moved to Hired']))
    const clear = [...document.querySelectorAll('section.activity button')].find((b) => textOf(b) === 'Clear')
    await click(clear)
    await waitFor(() => expect(log()).toEqual([]))
    expect(textOf($('section.activity'))).toContain('No activity yet.')
  })

  it('the search, the role filter, the newest-first order, the notes and the role counts still work', async () => {
    await mountApp()
    await choose($('select[name="show-role"]'), 'Designer')
    await waitFor(() => expect(names()).toEqual(['Ana Ruiz', 'Eli Stone']))
    await choose($('select[name="sort"]'), 'newest')
    await waitFor(() => expect(names()).toEqual(['Eli Stone', 'Ana Ruiz']))
    expect(textOf(cardOf('Eli Stone').querySelector('.note-count'))).toBe('2 notes')
    expect([...cardOf('Eli Stone').querySelectorAll('.notes .note-text')].map((li) => textOf(li))).toEqual(['Strong portfolio', 'Can start in May'])

    await typeInto(cardOf('Ana Ruiz').querySelector('input[name="note"]'), 'Good references')
    await click(buttonOf('Ana Ruiz', 'Add note'))
    await waitFor(() => expect(textOf(cardOf('Ana Ruiz').querySelector('.note-count'))).toBe('1 note'))
    expect([...cardOf('Ana Ruiz').querySelectorAll('.notes .note-text')].map((li) => textOf(li))).toEqual(['Good references'])
    expect(cardOf('Ana Ruiz').querySelector('input[name="note"]').value).toBe('')

    const reset = [...document.querySelectorAll('button')].find((b) => textOf(b) === 'Reset view')
    await click(reset)
    await waitFor(() => expect(names()).toHaveLength(8))
    expect(names()[0]).toBe('Ana Ruiz')
    expect(textOf(cardOf('Ana Ruiz').querySelector('.note-count'))).toBe('1 note')

    await typeInto($('input[name="search"]'), '  HANA ')
    await waitFor(() => expect(names()).toEqual(['Hana Kim']))
    await typeInto($('input[name="search"]'), '')
    await waitFor(() => expect(names()).toHaveLength(8))
    await click(buttonOf('Ana Ruiz', 'Delete'))
    await waitFor(() => expect(textOf(cardOf('Ana Ruiz').querySelector('.note-count'))).toBe('No notes'))
    expect(textOf($('p.roles'))).toBe('Engineer: 4, Designer: 2, Product manager: 2')
  })

  // Passing own tests a legitimate solution keeps, so deleting failing tests instead of updating
  // them fails this test.
  // add: the starter suite has 15 tests (both arms); Hold breaks none of them and the reference
  // keeps all 15 and adds 1 (16), so at least the starter's 15 must pass.
  const MIN_PASSING_OWN_TESTS = 15

  it("project: the project's own tests pass", () => {
    const r = runProjectTests()
    expect(r.failures).toEqual([])
    expect(r.failed).toBe(0)
    expect(r.passed).toBeGreaterThanOrEqual(MIN_PASSING_OWN_TESTS)
  }, 240000)
})

// PLAN-9 B-1 / B-2: compose.decisions(): the requests it builds (decide(), the research wording),
// the steps and call counts, the preview, params (not_stated, number bins, free text), records
// (prefilter, slots, groups, candidate limits), rowMean, SYG680 / SYG682. No network: replies
// are built with answers().
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('../src/extra/ai/compose/layout', async () => await import('./p9-decisions-helpers.js'))
import { decisions, TEXT, W, readLayout } from '../src/extra/ai/compose/decisions.js'
import { answers } from '../src/extra/ai/answers.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { defineCatalog, toTree, formatTree } from './p9-decisions-helpers.js'
import { STRUCTURE, OPS, PM40 } from './p9-decisions-catalogs.js'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const dashboard = STRUCTURE.dashboard.catalog
const start = (backend, catalog, prompt, state = {}) => backend.start({ catalog, state, prompt, previous: null, names })
const reply = (backend, catalog, pending, picks, state = {}) => backend.reply({ catalog, state, pending, reply: answers(stepQuestions(backend, catalog, pending, state), picks), names })
// the questions a pending step sent (start() / reply() put them in the request)
let lastQuestions
const stepQuestions = () => lastQuestions
const sent = (r) => { lastQuestions = r.request.json.questions; return r }

afterEach(() => { configureDiagnostics({ mode: undefined }); clearDiagnostics() })

describe('compose.decisions(): requests', () => {
  it('start: a decide() request on the HTTP sink with the lane key, latest, ok and error', () => {
    const backend = decisions({ model: 'jev-latest' })
    expect(backend.sink).toBe('HTTP')
    const { request, pending } = start(backend, dashboard, 'Churn and signups next to each other')
    expect(request).toMatchObject({ url: '/api/decide', method: 'POST', key: 'compose', latest: true, ok: 'page.REPLY', error: 'page.FAILED' })
    expect(request.json.model).toBe('jev-latest')
    expect(request.json.state).toEqual({ user_request: 'Churn and signups next to each other' })
    expect(request.json.questions.use_revenue).toEqual({ type: 'choice', instructions: TEXT.select, criteria: { omit: TEXT.omit, use: dashboard.parts.revenue.description } })
    expect(request.json.questions.row).toEqual({ type: 'noul', instructions: TEXT.row })
    expect(Object.keys(request.json.questions)).toHaveLength(10) // 9 parts + the row gate
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending)
    expect(decisions({ model: 'm', url: '/x', key: 'lane' }).start({ catalog: dashboard, state: {}, prompt: 'p', previous: null, names }).request).toMatchObject({ url: '/x', key: 'lane' })
  })

  it('select → preview + the layout request (state: the request and the selected elements) → the layout', () => {
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, dashboard, 'Churn and signups next to each other'))
    const r1 = sent(reply(backend, dashboard, s.pending, { use_churn: 'use', use_signups: 'use', row: true }))
    expect(formatTree(toTree(r1.preview))).toBe('page(signups churn)')
    expect(r1.request.json.state).toEqual({
      user_request: 'Churn and signups next to each other',
      selected_elements: [{ id: 'signups', content: dashboard.parts.signups.description }, { id: 'churn', content: dashboard.parts.churn.description }],
    })
    const q = r1.request.json.questions
    expect(Object.keys(q).sort()).toEqual(['beside_churn', 'beside_signups', 'first_signups_vs_churn', 'left_signups_vs_churn'])
    expect(q.beside_churn).toEqual({ type: 'choice', instructions: TEXT.beside(dashboard.parts.churn.description), criteria: { none: 'No element: this one is not side by side with another.', signups: dashboard.parts.signups.description } })
    expect(q.first_signups_vs_churn.instructions).toBe(TEXT.first(undefined))
    const r2 = reply(backend, dashboard, r1.pending, { beside_churn: 'signups', beside_signups: 'churn', left_signups_vs_churn: 'churn', first_signups_vs_churn: 'churn' })
    expect(formatTree(toTree(r2.layout))).toBe('page(row(churn signups))')
    expect(Object.keys(r2.decisions)).toEqual(['select', 'layout'])
    expect(r2.request).toBeUndefined()
  })

  it('nothing fits: layout null, unavailable, one call', () => {
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, dashboard, 'Show me the stock price of Apple'))
    const r = reply(backend, dashboard, s.pending, {})
    expect(r).toMatchObject({ layout: null, unavailable: true })
    expect(r.request).toBeUndefined()
    expect(r.decisions.select.use_revenue.choice).toBe('omit')
  })

  it('a single part in one place: done after the select call', () => {
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, dashboard, 'What is on my plate today?'))
    const r = reply(backend, dashboard, s.pending, { use_tasks: 'use' })
    expect(r.request).toBeUndefined()
    expect(formatTree(toTree(r.layout))).toBe('page(tasks)')
  })

  it('parent_ over the places `in` allows (slot descriptions), guidance in first_, the page label', () => {
    const { catalog } = STRUCTURE.settings
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, catalog, 'My email and language'))
    expect(s.request.json.questions.row).toBeUndefined() // the settings catalog has no rows
    const r = sent(reply(backend, catalog, s.pending, { use_email: 'use', use_language: 'use', use_save: 'use', use_cancel: 'use' }))
    const q = r.request.json.questions
    expect(q.parent_email.instructions).toBe(TEXT.parent(catalog.parts.email.description))
    expect(q.parent_email.criteria).toEqual({ 'profile:default': catalog.containers.profile.description, 'security:default': catalog.containers.security.description })
    expect(q.first_email_vs_language.instructions).toContain('Conventional order: form fields before the form buttons; Save before Cancel.')
    // a part allowed on the page: the page's label
    lastQuestions = s.request.json.questions
    const d =sent(reply(backend, catalog, s.pending, { use_sessions: 'use', use_deleteAccount: 'use' }))
    expect(d.request.json.questions.parent_deleteAccount.criteria['page:default']).toBe('An account settings page, at the top level (not inside any section, tab or group)')
  })

  it('variants: pick_<group> with the variant wording; repeats: count_ and gap_', () => {
    const { catalog } = STRUCTURE.landing
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, catalog, 'A free-trial call to action at the top and again at the bottom, with testimonials in between'))
    const q = s.request.json.questions
    expect(q.pick_hero).toEqual({ type: 'choice', instructions: TEXT.variant, criteria: { omit: TEXT.omit, heroImage: catalog.parts.heroImage.description, heroPlain: catalog.parts.heroPlain.description } })
    expect(q.count_cta.criteria).toEqual({ 0: 'Not on the page.', 1: 'Once.', 2: '2 times, in different places on the page.' })
    const r = sent(reply(backend, catalog, s.pending, { count_cta: '2', use_testimonials: 'use' }))
    expect(r.request.json.questions.gap_testimonials_in_cta.instructions).toBe(TEXT.gap(catalog.parts.cta.description, 2, catalog.parts.testimonials.description, catalog.guidance))
    const done = reply(backend, catalog, r.pending, { gap_testimonials_in_cta: '1' })
    expect(formatTree(toTree(done.layout))).toBe('page(cta testimonials cta)')
  })

  it('rowMean: a weak second link joins a row at 0.25, not at 0.5', () => {
    const sel = { items: ['a', 'b', 'c'].map((k) => ({ key: k, part: k, d: k })), row: true }
    const catalog = defineCatalog({ parts: { a: { description: 'a' }, b: { description: 'b' }, c: { description: 'c' } } })
    const a = {
      beside_a: { type: 'choice', choice: 'b', probabilities: { none: 0, b: 1, c: 0 } },
      beside_b: { type: 'choice', choice: 'a', probabilities: { none: 0.4, a: 0.6, c: 0 } },
      beside_c: { type: 'choice', choice: 'b', probabilities: { none: 0.4, a: 0, b: 0.6 } },
    }
    expect(formatTree(readLayout(catalog, sel, a, { rowMean: 0.25 }))).toBe('page(row(a b c))')
    expect(formatTree(readLayout(catalog, sel, a, { rowMean: 0.5 }))).toBe('page(row(a b) c)')
  })
})

describe('compose.decisions(): params', () => {
  it('an enum param is a choice in the select call with not_stated; not_stated is the default (left out)', () => {
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, OPS, 'Show the revenue chart for last quarter'))
    const q = s.request.json.questions.param_revenueChart__range
    const range = OPS.parts.revenueChart.params.range
    expect(q).toEqual({ type: 'choice', instructions: W.param(OPS.parts.revenueChart.description, 'time range'), criteria: { not_stated: W.notStated('time range'), ...range.options } })
    expect(formatTree(toTree(reply(backend, OPS, s.pending, { use_revenueChart: 'use', param_revenueChart__range: 'quarter' }).layout))).toBe('page(revenueChart{range=quarter})')
    expect(toTree(reply(backend, OPS, s.pending, { use_revenueChart: 'use', param_revenueChart__range: 'not_stated' }).layout)).toEqual([{ part: 'revenueChart' }])
    expect(toTree(reply(backend, OPS, s.pending, { use_revenueChart: 'use', param_revenueChart__range: 'month' }).layout)).toEqual([{ part: 'revenueChart' }])
  })

  it('a number param picks a bin (the `ask` wording, the words in each bin) and reads as a number', () => {
    const backend = decisions({ model: 'm' })
    const s = sent(start(backend, OPS, 'A long list of all recent orders'))
    const limit = OPS.parts.orders.params.limit
    expect(s.request.json.questions.param_orders__limit).toEqual({ type: 'choice', instructions: W.param(OPS.parts.orders.description, 'number of rows', limit.ask), criteria: { not_stated: W.notStated('number of rows'), 5: limit.bins[5], 10: limit.bins[10], 25: limit.bins[25] } })
    const r = reply(backend, OPS, s.pending, { use_orders: 'use', param_orders__limit: '25' })
    expect(toTree(r.layout)).toEqual([{ part: 'orders', params: { limit: 25 } }])
  })

  it("text / list params are never asked (the default stays); a required one with no default makes the part LLM-only (SYG680, info)", () => {
    configureDiagnostics({ mode: 'warn' })
    const catalog = defineCatalog({
      parts: {
        searchBox: { description: 'Search box', params: { query: { type: 'text', default: '', label: 'search terms' }, tags: { type: 'list', default: [] } } },
        stickyNoteB: { description: 'Sticky note', params: { title: { type: 'text', required: true } } },
        other: { description: 'Other' },
      },
    })
    const backend = decisions({ model: 'm' })
    const s = start(backend, catalog, 'a search box')
    expect(Object.keys(s.request.json.questions).sort()).toEqual(['row', 'use_other', 'use_searchBox'])
    const d = getDiagnostics().filter((x) => x.code === 'SYG680')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ severity: 'info', component: 'compose.decisions' })
    expect(d[0].message).toContain("'stickyNoteB'")
  })
})

describe('compose.decisions(): records', () => {
  const state = {}
  it('the lexical prefilter keeps the records the prompt names; slots ask "which <label> … first / second"', () => {
    const backend = decisions({ model: 'm' })
    const s = start(backend, PM40, 'Show the Atlas and Borealis projects', state)
    const q = s.request.json.questions
    const project = PM40.parts.project
    expect(q.pick_projects.instructions).toBe(W.select)
    expect(q.pick_projects.criteria.project).toBe(W.recordFamily(project.description, 'project', ['Atlas', 'Borealis']))
    expect(q.rec_project__1).toEqual({ type: 'choice', instructions: W.slot(project.description, 'project', 1), criteria: { none: W.slotNone('project', 1), atlas: expect.any(String), borealis: expect.any(String) } })
    expect(Object.keys(q).filter((k) => k.startsWith('rec_project'))).toEqual(['rec_project__1', 'rec_project__2', 'rec_project__3', 'rec_project__4'])
    // the member / report record parts: nobody named, so not offered
    expect(q.rec_member__1).toBeUndefined()
    expect(q.pick_people.criteria).toEqual({ omit: TEXT.omit, team: PM40.parts.team.description })
    lastQuestions = q
    const r = reply(backend, PM40, s.pending, { pick_projects: 'project', rec_project__1: 'borealis', rec_project__2: 'atlas', row: false })
    expect(r.pending.items.map((i) => i.key)).toEqual(['project__borealis', 'project__atlas'])
    expect(r.pending.items[0].params).toEqual({ project: 'borealis' })
  })

  it('in a group, slot 1 takes the best record even when none wins (atLeastOne, after the prefilter)', () => {
    const backend = decisions({ model: 'm' })
    const s = start(backend, PM40, 'How is Cedar doing?')
    lastQuestions = s.request.json.questions
    const r = reply(backend, PM40, s.pending, { pick_projects: 'project', rec_project__1: { probabilities: { none: 0.6, cedar: 0.4 } } })
    expect(toTree(r.layout)).toEqual([{ part: 'project', params: { project: 'cedar' } }])
  })

  it('an Ollama url keeps every choice at ≤ 25 options: a larger param is split in chunks, read back as one', () => {
    const backend = decisions({ model: 'nimble', url: 'http://localhost:11434/v1/systemone' })
    const s = start(backend, PM40, 'Every project Maya Chen owns')
    const q = s.request.json.questions
    expect(q.param_projectList__owner).toBeUndefined()
    expect(Object.keys(q).filter((k) => k.startsWith('param_projectList__owner'))).toEqual(['param_projectList__owner__c0', 'param_projectList__owner__c1'])
    for (const x of Object.values(q)) if (x.criteria) expect(Object.keys(x.criteria).length).toBeLessThanOrEqual(25)
    lastQuestions = q
    const r = reply(backend, PM40, s.pending, { pick_projects: 'projectList', param_projectList__owner__c0: 'maya', param_projectList__owner__c1: 'not_stated' })
    expect(toTree(r.layout)).toEqual([{ part: 'projectList', params: { owner: 'maya' } }])
    expect(decisions({ model: 'x', maxOptions: 255, url: 'http://localhost:11434/v1/systemone' }).start({ catalog: PM40, state, prompt: 'Every project Maya Chen owns', previous: null, names }).request.json.questions.param_projectList__owner).toBeDefined()
  })

  it('fake() says when a target names a record the prompt does not (the prefilter never offered it)', () => {
    const backend = decisions({ model: 'm' })
    const s = start(backend, PM40, 'Show the Atlas project')
    expect(() => backend.fake({ catalog: PM40, state, pending: s.pending, target: [{ part: 'project', params: { project: 'nova' } }] })).toThrow(/doesn't name the project record "nova"/)
  })
})

describe('compose.decisions(): replies', () => {
  it('a choice outside the criteria is ignored and reported (SYG682)', () => {
    configureDiagnostics({ mode: 'warn' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = decisions({ model: 'm' })
    const s = start(backend, dashboard, 'How are sales doing?')
    const body = answers(s.request.json.questions, { use_revenue: 'use' })
    body.answers.use_tasks = { type: 'choice', choice: 'maybe', probabilities: { maybe: 1 } }
    const r = backend.reply({ catalog: dashboard, state: {}, pending: s.pending, reply: body, names })
    expect(formatTree(toTree(r.layout))).toBe('page(revenue)')
    const d = getDiagnostics().filter((x) => x.code === 'SYG682')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("'use_tasks'")
    warn.mockRestore()
  })

  it('the category prefilter (prefilter: true): call 0 asks cat_<id>, the select call only the chosen categories', () => {
    const { catalog } = STRUCTURE.ops
    const backend = decisions({ model: 'm', prefilter: true })
    const s = start(backend, catalog, 'Search the logs')
    expect(s.request.json.questions.cat_logs).toEqual({ type: 'choice', instructions: TEXT.category, criteria: { omit: 'Nothing in this area is needed.', use: 'Logs, errors and traces' } })
    lastQuestions = s.request.json.questions
    const r = reply(backend, catalog, s.pending, { cat_logs: 'use' })
    expect(Object.keys(r.request.json.questions).sort()).toEqual(['row', 'use_errorRate', 'use_logSearch', 'use_logVolume', 'use_topErrors', 'use_traces'])
    expect(r.preview).toBeUndefined()
    const none = reply(backend, catalog, s.pending, {})
    expect(none).toMatchObject({ layout: null, unavailable: true })
  })
})

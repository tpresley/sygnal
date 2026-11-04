// @vitest-environment jsdom
// 7.2 (the one bag): every function a user writes over state takes (subject, …its own arguments,
// bag), the bag being what the view gets: { ...props, state, context, uid } (handlers: plus
// previousState, children, slots, now / random / uuid). Declaration statics, .context entries,
// behavior calculated / timers, the wizard, the form and sygnal/ai.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h } from '../src/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { defineBehavior } from '../src/extra/behaviors.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.ts'
import { readBag } from '../src/shared.ts'
import { wizard } from '../src/extra/wizard.ts'
import { Outlet } from '../src/extra/outlet.ts'

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms))

// a parent passing `id` (from its state) and `kind` to Page; `n` changes nothing Page gets
function shell(Page, extra = {}) {
  function Root({ state }) { return h('main', null, h(Page, { state: 'page', id: state.id, kind: 'item' })) }
  Root.initialState = { id: 1, n: 0, page: {}, ...extra }
  Root.context = { rid: (s) => String(s.id) }
  Root.model = { ID: (s, id) => ({ ...s, id }), N: (s) => ({ ...s, n: s.n + 1 }) }
  return Root
}

describe('declaration statics: (state, bag)', () => {
  it('get the props, the state, the context and uid; re-run when a prop changes, not on an unrelated write', async () => {
    const seen = []
    function Page() { return h('p', null, 'x') }
    Page.resources = { item: (s, bag) => (seen.push(bag), `/api/${bag.kind}s/${bag.id}`) }
    const t = renderComponent(shell(Page))
    await t.ready()
    const b = seen[seen.length - 1]
    expect(b).toMatchObject({ id: 1, kind: 'item', context: { rid: '1' } })
    expect(b.state).toBe(t.state.page)
    expect(typeof b.uid).toBe('function')
    expect(b).not.toHaveProperty('children')
    expect(b).not.toHaveProperty('previousState')
    t.simulateAction('ID', 2)
    await t.settle()
    expect(t.requests('HTTP').filter((r) => r.resource).map((r) => r.url)).toEqual(['/api/items/1', '/api/items/2'])
    const runs = seen.length
    t.simulateAction('N')
    await t.next((s) => s.n === 1)
    await t.settle()
    expect(seen.length).toBe(runs)
    t.dispose()
  })

  it('7.2 compatibility: the context\'s own fields are on the bag; a prop of the same name wins', async () => {
    const got = []
    function Page() { return h('p', null, 'x') }
    Page.head = (s, { rid, context }) => (got.push([rid, context.rid]), { title: 'T' })
    const t = renderComponent(shell(Page))
    await t.ready()
    expect(got[0][0]).toBe(got[0][1])
    function Root({ state }) { return h('main', null, h(Page, { state: 'page', rid: 'mine' })) }
    Root.initialState = { page: {} }
    Root.context = { rid: () => 'theirs' }
    got.length = 0
    const u = renderComponent(Root)
    await u.ready()
    expect(got[0]).toEqual(['mine', 'theirs'])
    t.dispose(); u.dispose()
  })
})

describe('.context entries: (state, bag), the bag with the parent\'s context', () => {
  it('read the props and the parent context, and follow a prop change', async () => {
    function Leaf({ context }) { return h('b', null, context.label) }
    function Mid() { return h('div', null, h(Leaf)) }
    Mid.context = { label: (s, { kind, id, context, state, uid }) => `${kind}:${id}:${context.rid}:${state === undefined ? 'u' : 's'}:${typeof uid}` }
    const t = renderComponent(shell(Mid))
    await t.ready()
    expect(t.html()).toContain('item:1:1:s:function')
    t.simulateAction('ID', 5)
    await t.settle()
    expect(t.html()).toContain('item:5:5:s:function')
    t.dispose()
  })
})

describe('behaviors: calculated (slice, bag), timers (slice, options, key, bag)', () => {
  it('a calculated field reads the host state and props; the timers get the host bag', async () => {
    const counter = defineBehavior({
      initialState: { n: 0 },
      model: { INC: (s) => ({ ...s, n: s.n + 1 }) },
      calculated: { label: (slice, bag) => `${bag.state?.name ?? '-'}:${bag.kind ?? '-'}:${slice.n}` },
      timers: (slice, _o, key, bag) => ({ tick: bag?.kind && { every: 100 * (slice.n + 1), action: 'INC' } }),
    })
    function Host({ state }) { return h('p', null, h('button', { className: 'inc' }, state.c.label)) }
    Host.uses = { c: counter() }
    Host.intent = ({ DOM }) => ({ 'c.INC': DOM.click('.inc') })
    function Root() { return h('main', null, h(Host, { state: 'host', kind: 'k' })) }
    Root.initialState = { host: { name: 'host' } }
    const t = renderComponent(Root)
    await t.ready()
    expect(t.timers()).toMatchObject([{ name: 'c.tick', every: 100 }])
    expect(counter().state.label).toBe('-:-:0')
    await t.simulateEvent('.inc', 'click')
    expect(t.state.host.c.label).toBe('host:k:1')
    t.dispose()
  })
})

describe('readBag: a derivation\'s bag from a handler\'s props', () => {
  it('leaves out what only handlers get', () => {
    const b = readBag({ now: () => 1, random: () => 0, uuid: () => 'x', previousState: 1, children: [], slots: {}, id: 3, context: { a: 1 }, uid: () => 'u', state: 'old' }, 'new')
    expect(Object.keys(b).sort()).toEqual(['context', 'id', 'state', 'uid'])
    expect(b.state).toBe('new')
  })
})

describe('SYG458: a declaration reads a context field off its bag', () => {
  let apps = []
  beforeEach(() => { clearDiagnostics(); resetChecks() })
  afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; configureDiagnostics({ mode: undefined }) })
  const syg458 = () => getDiagnostics().filter((d) => d.code === 'SYG458')

  it('is a dev-entry warning with a title', () => {
    expect(DEV_CODE_SEVERITY.SYG458).toBe('warn')
    expect(CODE_TITLES.SYG458).toMatch(/context field off its bag/)
  })

  it('warns once per component and key for the compatibility read; not for bag.context nor a prop', async () => {
    function Page() { return h('p', null, 'x') }
    Page.head = (s, { route }) => ({ title: route.name })
    Page.connections = (s, { context: { route } }) => ({})
    function Other() { return h('p', null, 'y') }
    Other.head = (s, { route }) => ({ title: String(route) })
    function Root() { return h('main', null, h(Page), h(Other, { route: 7 })) }
    Root.initialState = {}
    Root.context = { route: () => ({ name: 'home' }) }
    // head needs a driver taking the static: a minimal one
    const head = () => ({ __sygnalStatic: 'head' })
    document.body.innerHTML = '<div id="root"></div>'
    apps.push(run(Root, { HEAD: head }, { mountPoint: '#root', diagnostics: 'collect' }))
    await sleep(20)
    const d = syg458()
    expect(d.map((x) => [x.component, x.data.key, x.data.prop])).toEqual([['Page', 'route', false], ['Other', 'route', true]])
    expect(d[0].message).toMatch(/8\.0/)
  })
})

describe('the wizard: (stepView, bag), dirty (stepView, stepName, bag), (hostState, bag)', async () => {
  const { wizard } = await import('../src/extra/wizard.ts')
  const { Outlet } = await import('../src/extra/outlet.ts')
  it('the key, the draft and the predicates read the host\'s props; dirty gets the step name before the bag', async () => {
    const seen = {}
    function One({ state }) { return h('p', { className: 'one' }, state.draft.title) }
    function Two() { return h('p', { className: 'two' }, 'two') }
    function Flow({ state }) { return h('div', null, h(Outlet, { from: 'wizard', of: { one: One, two: Two } }), h('button', { className: 'next' }, 'next')) }
    Flow.uses = {
      wizard: wizard({
        steps: {
          one: { valid: (s, b) => ((seen.valid ||= []).push([b.recordId, typeof b.uid, 'context' in b]), !!s.draft.title), label: (s, { recordId }) => 'One ' + recordId },
          two: {},
        },
        key: (st, { recordId }) => recordId ?? null,
        draft: (st, { recordId }) => ({ title: 'T' + recordId }),
        dirty: (s, name, b) => (seen.dirty = [name, b.recordId], false),
        next: '.next',
      }),
    }
    function Root({ state }) { return h('main', null, h(Flow, { state: 'flow', recordId: state.rid })) }
    Root.initialState = { rid: 7, flow: {} }
    Root.model = { RID: (s, rid) => ({ ...s, rid }) }
    const t = renderComponent(Root)
    await t.ready(); await t.settle()
    expect(t.state.flow.wizard).toMatchObject({ key: 7, draft: { title: 'T7' } })
    expect(t.state.flow.wizard.steps[0].label).toBe('One 7')
    // a handler's bag is complete; the intent's watches (the derived fields' sync) have the props and
    // the state (the start slice and the read-time normalizer: the state only)
    expect(seen.valid).toContainEqual([7, 'function', true])
    expect(seen.valid).toContainEqual([7, 'undefined', false])
    expect(seen.dirty).toEqual(['one', 7])
    // a new prop: a new key (the intent's watch follows the props), the flow anew with its draft
    t.simulateAction('RID', 8)
    await t.settle()
    expect(t.state.flow.wizard).toMatchObject({ key: 8, draft: { title: 'T8' } })
    expect(t.state.flow.wizard.steps[0].label).toBe('One 8')
    t.dispose()
  })
})

describe('the form: values, dynamic, the schema function and request get the bag', async () => {
  const { form } = await import('../src/extra/form.ts')
  const { z } = await import('zod')
  it('values from a prop; request (data, hostState, bag)', async () => {
    const got = {}
    function Edit({ state }) { return h('form', null, h('input', { name: 'title', value: state.form.values.title })) }
    Edit.uses = {
      form: form((st, b) => (got.schema = b.recordId, z.object({ title: z.string() })), {
        values: (st, { title }) => ({ title }),
        request: (data, st, { recordId }) => (got.request = recordId, { url: '/api/items/' + recordId, method: 'PUT' }),
      }),
    }
    function Root() { return h('main', null, h(Edit, { state: 'edit', title: 'Hello', recordId: 3 })) }
    Root.initialState = { edit: {} }
    const t = renderComponent(Root)
    await t.ready(); await t.settle()
    expect(t.state.edit.form.values).toEqual({ title: 'Hello' })
    expect(got.schema).toBe(3)
    await t.simulateEvent('form', 'submit')
    await t.settle()
    expect(got.request).toBe(3)
    expect(t.requests('HTTP').map((r) => r.url)).toContain('/api/items/3')
    t.dispose()
  })
})

describe('sygnal/ai: agent read / when / query run get the instance\'s bag', async () => {
  it('a child\'s read sees its props', async () => {
    function Item({ state }) { return h('p', null, String(state.n)) }
    Item.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    Item.agent = {
      name: 'item',
      read: (s, { label, context }) => ({ n: s.n, label, rid: context.rid }),
      actions: { INC: { description: 'add one', when: (s, { label }) => label === 'L' } },
      queries: { label: { description: 'the label', run: (s, _in, { label }) => label } },
    }
    function Root() { return h('main', null, h(Item, { state: 'item', label: 'L' })) }
    Root.initialState = { item: { n: 1 } }
    Root.context = { rid: () => 'r1' }
    const t = renderComponent(Root)
    await t.ready()
    expect((await t.callTool('item_read')).state).toEqual({ n: 1, label: 'L', rid: 'r1' })
    expect(await t.callTool('item_label')).toEqual({ ok: true, result: 'L' })
    expect(await t.callTool('item_inc')).toMatchObject({ ok: true })
    t.dispose()
  })
})

describe('SYG459: a behavior option reads a host-state field off its bag (N6)', () => {
  beforeEach(() => { clearDiagnostics(); resetChecks() })
  afterEach(() => { configureDiagnostics({ mode: undefined }) })

  it('is a dev-entry warning with a title', () => {
    expect(DEV_CODE_SEVERITY.SYG459).toBe('warn')
    expect(CODE_TITLES.SYG459).toMatch(/state field off its bag/)
  })

  it("warns once for the pre-7.2 wizard form (s, h) => h.session; not for bag.state, a prop or a missing name", async () => {
    function A() { return h('p', null, 'a') }
    function B() { return h('p', null, 'b') }
    const host = (when) => {
      function Host() { return h('div', null, h(Outlet, { of: { a: A, b: B }, from: 'wizard', focus: false })) }
      Host.initialState = { session: 'S1', note: 'n' }
      Host.uses = { wizard: wizard({ steps: { a: {}, b: { when } } }) }
      return Host
    }
    const t = renderComponent(host((_s, h) => h.session === 'S1'))
    await t.ready()
    await t.settle()
    const got = t.diagnostics.filter((d) => d.code === 'SYG459')
    expect(got).toHaveLength(1)
    expect(got[0].message).toMatch(/A wizard option read 'session' off its bag/)
    expect(got[0].fix).toMatch(/bag\.state\.session/)
    t.dispose()

    // the flow key, read in the wizard's intent watch
    clearDiagnostics(); resetChecks()
    function K() { return h('div', null, h(Outlet, { of: { a: A }, from: 'wizard', focus: false })) }
    K.initialState = { session: 'S1' }
    K.uses = { wizard: wizard({ steps: { a: {} }, key: (st, h) => h.session }) }
    const k = renderComponent(K)
    await k.ready()
    await k.settle()
    expect(k.diagnostics.filter((d) => d.code === 'SYG459').map((d) => d.data.key)).toEqual(['session'])
    k.dispose()

    clearDiagnostics(); resetChecks()
    const ok = renderComponent(host((_s, { state, label, other }) => state.session === 'S1' && label !== 1 && other === undefined), { props: { label: 'x' } })
    await ok.ready()
    await ok.settle()
    expect(ok.diagnostics.filter((d) => d.code === 'SYG459')).toEqual([])
    ok.dispose()
  })
})

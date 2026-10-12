// @vitest-environment jsdom
// PLAN-9 G-753: in the real DOM driver, keyed component instances that move into a parent element
// CREATED in the same patch (a new row that takes their place among their old siblings) keep
// their state and events, and the DOM matches the view. The instances' cached vnodes are in the
// old tree and the new one: snabbdom creates the new row with them inside (each moved vnode's elm
// became its new element) and then inserts the row before its old first sibling's elm, the moved
// vnode's (now the new element, inside the row): the browser threw NotFoundError, jsdom too, and
// the DOM stayed as it was. G-750 (test/p9-g750-move-parent.test.js) covers a move to an existing
// parent. The fix is in the DOM driver's isolate module (cycle/dom/IsolateModule.ts).
import { describe, it, expect, afterEach } from 'vitest'
import { run, makeDOMDriver } from '../src/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { IsolateModule } from '../src/cycle/dom/IsolateModule.ts'
import { init, h as sh } from '../src/cycle/dom/snabbdom.ts'
import modules from '../src/cycle/dom/modules.ts'

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms))
let app, el, errors
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const hooks = []
function Card({ state, label }) {
  return h('div', { className: 'card', data: { label }, hook: { insert: (v) => hooks.push(['insert', label, v.elm]), destroy: (v) => hooks.push(['destroy', label, v.elm]) } },
    h('span', { className: 'n' }, label + ':' + state.n), h('button', { className: 'inc' }, '+'))
}
Card.isolatedState = true
Card.initialState = { n: 0 }
Card.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Card.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

const click = (e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const inc = async (label, times = 1) => { for (let i = 0; i < times; i++) { click(el.querySelector(`.card[data-label="${label}"] .inc`)); await sleep() } }
// the page's tree: a card is `label:n`, an element `class[...]`
const tree = (e = el.querySelector('main > .page')) => [...e.children].map((c) =>
  c.classList.contains('card') ? c.textContent.replace('+', '') : `${c.className}[${tree(c).join(',')}]`)

const c = (k) => h(Card, { key: k, label: k })
// a layout: an array of labels and rows ({ row: [...] } / { box: [...] }, nested)
const build = (items) => items.map((it) => typeof it === 'string' ? c(it)
  : h('div', { className: Object.keys(it)[0] }, ...build(Object.values(it)[0])))

const start = async (steps) => {
  function Host({ state }) {
    return h('main', null, h('button', { className: 'go' }, 'go'),
      h('div', { className: 'page' }, ...build(steps[Math.min(state.step, steps.length - 1)])))
  }
  Host.initialState = { step: 0 }
  Host.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Host.model = { GO: (s) => ({ ...s, step: s.step + 1 }) }
  el = document.createElement('div'); el.id = 'root'; document.body.appendChild(el)
  errors = []
  hooks.length = 0
  app = run(Host, { DOM: makeDOMDriver('#root') }, { mountPoint: '#root', onError: (e) => errors.push(e.message) })
  await sleep(20)
  return async () => { click(el.querySelector('.go')); await sleep(20) }
}
const healthy = () => {
  expect(errors).toEqual([])
  expect(el.getAttribute('data-sygnal-error')).toBe(null)
}
// every step's DOM, `a` clicked once in each step (its events keep reaching it in its new place)
const walk = async (steps, expected) => {
  const go = await start(steps)
  await inc('a')
  expect(tree()).toEqual(expected[0])
  for (let i = 1; i < steps.length; i++) {
    await go()
    healthy()
    await inc('a')
    expect(tree()).toEqual(expected[i])
  }
  expect(el.querySelectorAll('.card').length).toBe(new Set(JSON.stringify(steps.at(-1)).match(/"[a-z]"/g)).size)
}

describe('G-753: keyed instances move into a parent element created in the same patch (real DOM)', () => {
  it('the first two of three move into a new first row (the ai-compose case)', async () => {
    await walk([['a', 'b', 'c'], [{ row: ['a', 'b'] }, 'c']], [['a:1', 'b:0', 'c:0'], ['row[a:2,b:0]', 'c:0']])
  })

  it('the last two move into a new row created after an old one', async () => {
    await walk([['c', 'a', 'b'], ['c', { row: ['a', 'b'] }]], [['c:0', 'a:1', 'b:0'], ['c:0', 'row[a:2,b:0]']])
  })

  it('a later child moves into a new row before its earlier siblings', async () => {
    await walk([['b', 'c', 'a'], [{ row: ['a'] }, 'b', 'c']], [['b:0', 'c:0', 'a:1'], ['row[a:2]', 'b:0', 'c:0']])
  })

  it('nested two levels deep, and back out', async () => {
    await walk([['a', 'b', 'c'], [{ row: [{ box: ['a', 'b'] }] }, 'c'], ['a', 'b', 'c']],
      [['a:1', 'b:0', 'c:0'], ['row[box[a:2,b:0]]', 'c:0'], ['a:3', 'b:0', 'c:0']])
  })

  it('moving back out of the row, and in again', async () => {
    await walk([['a', 'b', 'c'], [{ row: ['a', 'b'] }, 'c'], ['a', 'b', 'c'], [{ row: ['b', 'a'] }, 'c']],
      [['a:1', 'b:0', 'c:0'], ['row[a:2,b:0]', 'c:0'], ['a:3', 'b:0', 'c:0'], ['row[b:0,a:4]', 'c:0']])
  })

  it('all three children move into a new row', async () => {
    await walk([['a', 'b', 'c'], [{ row: ['c', 'a', 'b'] }]], [['a:1', 'b:0', 'c:0'], ['row[c:0,a:2,b:0]']])
  })

  it('two new rows in one patch, each taking a card', async () => {
    await walk([['a', 'b', 'c'], [{ row: ['b'] }, { box: ['a', 'c'] }]], [['a:1', 'b:0', 'c:0'], ['row[b:0]', 'box[a:2,c:0]']])
  })

  // the old row (an unkeyed div) is patched into the new box: c, its old sibling, moves into it
  // first (and gets created there) while the page still inserts the new row before c
  it('an old sibling moves into a patched parent while a new row is inserted before it', async () => {
    await walk([['c', { row: [{ box: ['b', 'a'] }] }], [{ row: ['b'] }, { box: ['c', 'a'] }]],
      [['c:0', 'row[box[b:0,a:1]]'], ['row[b:0]', 'box[c:0,a:2]']])
  })

  it('a long keyed list: every other card moves into a new row', async () => {
    const ks = 'abcdefghij'.split('')
    await walk([ks, [{ row: ks.filter((k, i) => i % 2 === 0) }, ...ks.filter((k, i) => i % 2)]],
      [ks.map((k) => k + ':' + (k === 'a' ? 1 : 0)), ['row[a:2,c:0,e:0,g:0,i:0]', 'b:0', 'd:0', 'f:0', 'h:0', 'j:0']])
  })

  it('the patch after a move updates the moved cards in place', async () => {
    const go = await start([['a', 'b', 'c'], [{ row: ['a', 'b'] }, 'c']])
    await go()
    const row = el.querySelector('.row'), a = row.querySelector('.card[data-label="a"]')
    await inc('a', 2); await inc('b')
    healthy()
    expect(tree()).toEqual(['row[a:2,b:1]', 'c:0'])
    expect(el.querySelector('.row')).toBe(row)
    expect(el.querySelector('.card[data-label="a"]')).toBe(a)
  })

  it("the moved roots' own hooks: destroy gets the old element, insert the new one", async () => {
    const go = await start([['a', 'b', 'c'], [{ row: ['a', 'b'] }, 'c']])
    const old = ['a', 'b', 'c'].map((k) => el.querySelector(`.card[data-label="${k}"]`))
    hooks.length = 0
    await go()
    healthy()
    const now = ['a', 'b'].map((k) => el.querySelector(`.row > .card[data-label="${k}"]`))
    expect(now.every((e, i) => e && e !== old[i])).toBe(true)
    expect(old[0].isConnected || old[1].isConnected).toBe(false)
    expect(hooks).toEqual(expect.arrayContaining([['insert', 'a', now[0]], ['destroy', 'a', old[0]], ['insert', 'b', now[1]], ['destroy', 'b', old[1]]]))
    expect(hooks).toHaveLength(4)
    expect(el.querySelector('.card[data-label="c"]')).toBe(old[2])
  })

  // G-750's limit: its old parent removed in the same patch (not patched itself), the moved
  // root's own hook.destroy saw the new element. The vnode is no longer created again
  // (into the page: an unkeyed new div there would be patched from the old one, keeping `a`)
  it("a card moving out of a removed parent: its destroy hook gets the old element", async () => {
    const go = await start([[{ box: ['a'] }, 'b'], ['b', 'a']])
    const oldA = el.querySelector('.card[data-label="a"]')
    hooks.length = 0
    await go()
    healthy()
    const newA = el.querySelector('.page > .card[data-label="a"]')
    expect(newA).not.toBe(oldA)
    expect(hooks).toEqual(expect.arrayContaining([['insert', 'a', newA], ['destroy', 'a', oldA]]))
    expect(hooks.filter(([, l]) => l === 'a')).toHaveLength(2)
    await inc('a')
    expect(tree()).toEqual(['b:0', 'a:1'])
  })

  it('the mock DOM shows the same view', async () => {
    function Host({ state }) {
      return h('main', null, h('div', { className: 'page' }, ...build(state.step ? [{ row: ['a', 'b'] }, 'c'] : ['a', 'b', 'c'])))
    }
    Host.initialState = { step: 0 }
    Host.model = { GO: (s) => ({ ...s, step: 1 }) }
    const t = renderComponent(Host)
    await t.ready()
    t.simulateAction('GO')
    await t.settle()
    expect(t.html()).toMatch(/<div class="page"><div class="row"><div class="card"[^>]*>.*a:0.*b:0.*<\/div><\/div><div class="card"[^>]*>.*c:0/)
    t.dispose()
  })

  // the module copies a moved vnode for the patch only: afterwards the tree has the vnode again,
  // with its new element, so the next patch takes snabbdom's shortcut for it
  it('after the patch the new tree has the moved vnode itself, with the new element', () => {
    const im = new IsolateModule(); im.setEventDelegator({ removeElement() {} })
    const diffed = []
    const patch = init([im.createModule(), { update: (o, v) => diffed.push(v) }].concat(modules))
    document.body.innerHTML = '<div id="r"></div>'
    const A = sh('b', { key: 'a' }, [sh('i', {}, 'a')]), B = sh('b', { key: 'b' }, 'b')
    const v1 = patch(document.getElementById('r'), sh('div', {}, [A, B]))
    const oldA = A.elm
    const v2 = sh('div', {}, [sh('p', {}, [A, B])])
    patch(v1, v2)
    expect(v2.children[0].children).toEqual([A, B])
    expect(v2.children[0].children[0]).toBe(A)
    expect(A.elm).not.toBe(oldA)
    expect(A.elm.parentNode).toBe(v2.children[0].elm)
    expect(A.children[0].elm.parentNode).toBe(A.elm)
    expect(oldA.isConnected).toBe(false)
    diffed.length = 0
    patch(v2, sh('div', {}, [sh('p', {}, [A, B])]))
    expect(diffed.includes(A) || diffed.includes(B)).toBe(false)
  })
})

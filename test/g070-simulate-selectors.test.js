// G-070 (4C): simulateEvent selectors match the rendered vnode tree like the real DOM
// (structural pseudo-classes, the child combinator), a selector that matches nothing fails the
// test with a clear error instead of silently dropping the event, and syntax the matcher can't
// handle throws "unsupported selector syntax".
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, createElement as h, Collection } from '../src/index.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = undefined
})

// ─── part a: structural selectors ───────────────────────────────────────────

function List({ state }) {
  return h('div', { className: 'app' },
    h('h1', null, 'title'),
    h('ul', { className: 'items' },
      ...state.items.map(it => h('li', { className: 'item', 'data-id': String(it.id) },
        h('span', { className: 'label' }, it.label),
        h('button', { className: 'hit' }, 'hit')))),
    h('p', { className: 'last' }, 'p1'),
    h('p', { className: 'other' }, 'p2'))
}
List.initialState = { items: [1, 2, 3, 4, 5].map(id => ({ id, label: 'item ' + id })), hits: [] }
List.intent = ({ DOM }) => ({ HIT: DOM.click('.hit').data('id', Number), P: DOM.click('p').map(e => e.target.tagName) })
List.model = {
  HIT: (s, id) => ({ ...s, hits: [...s.hits, id] }),
  P: s => s,
}

const hitWith = async (selector) => {
  await t.settle()
  const before = t.states.at(-1).hits.length
  t.simulateEvent(selector, 'click')
  const s = await t.waitForState(s => s.hits.length === before + 1, 1000)
  return s.hits.at(-1)
}

describe('G-070 a: structural selectors in simulateEvent', () => {
  it(':nth-child, :first-child, :last-child, :nth-last-child, odd/even, an+b', async () => {
    t = renderComponent(List)
    expect(await hitWith('.item:nth-child(3) .hit')).toBe(3)
    expect(await hitWith('li:first-child .hit')).toBe(1)
    expect(await hitWith('li:last-child button')).toBe(5)
    expect(await hitWith('li:nth-last-child(2) .hit')).toBe(4)
    expect(await hitWith('li:nth-child(even) .hit')).toBe(2)
    expect(await hitWith('li:nth-child(2n+3):not(:first-child):not([data-id="3"]) .hit')).toBe(5)
    expect(await hitWith('li:nth-child(-n+2):last-of-type .hit, li:nth-child( 2n + 2 ) .hit')).toBe(2)
    t.expectNoDiagnostics()
  })

  it('the child combinator > and descendant chains', async () => {
    t = renderComponent(List)
    expect(await hitWith('.app > ul > li:nth-child(4) > .hit')).toBe(4)
    expect(await hitWith('.app ul.items > .item:nth-child(2) button.hit')).toBe(2)
    expect(await hitWith('div>ul>li:nth-child(5)>button')).toBe(5)
    // '>' requires the direct parent: .hit is not a child of ul, so nothing matches
    await t.settle()
    expect(() => t.simulateEvent('ul > .hit', 'click')).toThrow(/matched nothing/)
    // only-child / attribute operators
    expect(await hitWith('[data-id^="4"] > button:only-of-type')).toBe(4)
    expect(await hitWith('li[data-id$="1"] .hit')).toBe(1)
  })

  it(':nth-of-type / :first-of-type / :last-of-type count same-tag siblings only', async () => {
    function P({ state }) {
      return h('div', { className: 'box' },
        h('h2', null, 'x'), h('p', { className: 'a' }, 'a'), h('span', null, 's'), h('p', { className: 'b' }, 'b'), h('p', { className: 'c' }, 'c'))
    }
    P.initialState = { n: 0 }
    P.intent = ({ DOM }) => ({ P: DOM.click('p').map(e => e.target.closest('p') && e.target) })
    P.model = { P: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(P)
    const which = async (sel) => {
      // :nth-of-type(2) is the 2nd <p> (the 4th child)
      t.simulateEvent(sel, 'click')
      await t.next()
    }
    await which('p:nth-of-type(2)')
    await which('p:first-of-type')
    await which('p:last-of-type')
    await which('.box > p:nth-child(4)')
    expect(t.states.at(-1).n).toBe(4)
    await t.settle()
    // p.b is the 4th child but the 2nd <p>: nth-child(2) is the first <p> (.a)
    expect(() => t.simulateEvent('p.b:nth-child(2)', 'click')).toThrow(/matched nothing/)
    expect(() => t.simulateEvent('p.b:nth-of-type(3)', 'click')).toThrow(/matched nothing/)
  })

  it('intent selectors with structural pseudo-classes and > receive the event too', async () => {
    function Menu({ state }) {
      return h('nav', null, h('ul', { className: 'menu' },
        ...['a', 'b', 'c'].map(k => h('li', { className: 'entry' }, h('a', { className: 'link', 'data-k': k }, k)))))
    }
    Menu.initialState = { picked: [] }
    Menu.intent = ({ DOM }) => ({
      FIRST: DOM.click('.menu > li:first-child .link').data('k'),
      ANY: DOM.click('.menu > .entry > .link').data('k'),
    })
    Menu.model = {
      FIRST: (s, k) => ({ ...s, picked: [...s.picked, 'first:' + k] }),
      ANY: (s, k) => ({ ...s, picked: [...s.picked, 'any:' + k] }),
    }
    t = renderComponent(Menu)
    t.simulateEvent('li:nth-child(2) .link', 'click')
    await t.waitForState(s => s.picked.length === 1)
    t.simulateEvent('.entry:first-child a', 'click')
    await t.waitForState(s => s.picked.length === 3)
    await t.settle()
    expect(t.states.at(-1).picked.slice(0, 1)).toEqual(['any:b'])
    expect([...t.states.at(-1).picked.slice(1)].sort()).toEqual(['any:a', 'first:a'])
  })

  it('Collection items (board of lists of cards): .list:nth-child(2) .card:nth-child(1) .next', async () => {
    function Card({ state }) {
      return h('div', { className: 'card' }, h('span', { className: 'title' }, state.title), h('button', { className: 'next' }, '→'))
    }
    Card.intent = ({ DOM }) => ({ NEXT: DOM.click('.next') })
    Card.model = { NEXT: s => ({ ...s, clicks: s.clicks + 1 }) }
    function ListCol({ state }) {
      return h('div', { className: 'list' }, h('h2', null, state.name), h('div', { className: 'cards' }, h(Collection, { of: Card, from: 'cards' })))
    }
    function Board() {
      return h('main', null, h('div', { className: 'board' }, h(Collection, { of: ListCol, from: 'lists' })))
    }
    const card = (id, title) => ({ id, title, clicks: 0 })
    Board.initialState = {
      lists: [
        { id: 'todo', name: 'Todo', cards: [card(1, 'a'), card(2, 'b')] },
        { id: 'doing', name: 'Doing', cards: [card(3, 'c'), card(4, 'd')] },
        { id: 'done', name: 'Done', cards: [card(5, 'e')] },
      ],
    }
    t = renderComponent(Board)
    await t.ready()
    const clicks = s => s.lists.map(l => l.cards.map(c => c.clicks))
    t.simulateEvent('.list:nth-child(2) .card:nth-child(1) .next', 'click')
    let s = await t.waitForState(s => s.lists[1].cards[0].clicks === 1, 1000)
    expect(clicks(s)).toEqual([[0, 0], [1, 0], [0]])
    t.simulateEvent('.board > .list:last-child .card:first-child > .next', 'click')
    s = await t.waitForState(s => s.lists[2].cards[0].clicks === 1, 1000)
    t.simulateEvent('.list:first-child .card:nth-child(2) .next', 'click')
    s = await t.waitForState(s => s.lists[0].cards[1].clicks === 1, 1000)
    expect(clicks(s)).toEqual([[0, 1], [1, 0], [1]])
    t.expectNoDiagnostics()
  })
})

// ─── part b: no match fails loudly ──────────────────────────────────────────

function Toggle({ state }) {
  return h('div', null, h('button', { className: 'open' }, 'open'),
    state.open ? h('div', { className: 'dialog' }, h('button', { className: 'ok' }, 'ok')) : null)
}
Toggle.initialState = { open: false, ok: 0 }
Toggle.intent = ({ DOM }) => ({ OPEN: DOM.click('.open'), OK: DOM.click('.dialog .ok') })
Toggle.model = { OPEN: s => ({ ...s, open: true }), OK: s => ({ ...s, ok: s.ok + 1 }) }

describe('G-070 b: a selector that matches nothing fails the test', () => {
  it('throws at the call when nothing is pending and the tree is quiet', async () => {
    t = renderComponent(Toggle)
    await t.settle()
    let err
    try { t.simulateEvent('.card:nth-child(3) .next', 'click') } catch (e) { err = e }
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain(".card:nth-child(3) .next")
    expect(err.message).toMatch(/matched nothing in the rendered output/)
    expect(err.message).toContain('t.html()')
    expect(err.message).toContain('[data-id="3"]')
    expect(err.message).toContain('<button class="open">open</button>')
  })

  it('a queued event that never matches rejects the pending next() quickly (not a 2s timeout)', async () => {
    t = renderComponent(Toggle)
    t.simulateEvent('.missing', 'click') // before ready: queued
    const start = Date.now()
    await expect(t.next(s => s.ok === 1)).rejects.toThrow(/simulateEvent\('\.missing', 'click'\): the selector matched nothing/)
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('rejects settle() and waitForState() too; with nothing pending the next t.* call throws', async () => {
    t = renderComponent(Toggle)
    t.simulateEvent('.missing', 'click')
    await expect(t.settle()).rejects.toThrow(/matched nothing/)
    t.dispose()

    t = renderComponent(Toggle)
    t.simulateEvent('.missing', 'click')
    await expect(t.waitForState(s => s.ok === 5)).rejects.toThrow(/matched nothing/)
    t.dispose()

    t = renderComponent(Toggle)
    t.simulateEvent('.missing', 'click')
    await new Promise(r => setTimeout(r, 400))
    expect(() => t.simulateAction('OPEN')).toThrow(/'\.missing'.*matched nothing/)
    // reported once
    expect(() => t.simulateAction('OPEN')).not.toThrow()
  })

  it('dispose() throws when the test never looked', async () => {
    t = renderComponent(Toggle)
    t.simulateEvent('.missing', 'click')
    await new Promise(r => setTimeout(r, 400))
    const tt = t
    t = undefined
    expect(() => tt.dispose()).toThrow(/matched nothing/)
  })

  it('still waits for an element that an earlier input renders', async () => {
    t = renderComponent(Toggle)
    await t.settle()
    t.simulateEvent('.open', 'click')
    t.simulateEvent('.dialog .ok', 'click')
    await t.waitForState(s => s.ok === 1, 1000)
    t.expectNoDiagnostics()
  })

  it('{ allowMissing: true } keeps the old drop + SYG103 behaviour', async () => {
    t = renderComponent(Toggle)
    await t.settle()
    expect(() => t.simulateEvent('.missing', 'click', { allowMissing: true })).not.toThrow()
    await t.settle()
    expect(t.diagnostics.filter(d => d.code === 'SYG103').map(d => d.data)).toEqual([{ selector: '.missing', type: 'click' }])
    expect(() => t.dispose()).not.toThrow()
  })

  it("'document' / 'body' are listener names and never fail", async () => {
    t = renderComponent(Toggle)
    await t.settle()
    expect(() => t.simulateEvent('document', 'keydown')).not.toThrow()
    expect(() => t.simulateEvent('body', 'click')).not.toThrow()
    await t.settle()
  })
})

// ─── part c: unsupported syntax throws ──────────────────────────────────────

describe('G-070 c: unsupported selector syntax throws', () => {
  it.each([
    ['.list:has(.card)', ':has'],
    ['.card + .card', "'+' combinator"],
    ['.card ~ .card', "'~' combinator"],
    ['.card::before', 'pseudo-elements'],
    ['button:hover', ':hover'],
    ['li:nth-child(2 of .item)', 'of S'],
    ['li:nth-child(x)', 'not an+b'],
    ['[lang|=en]', '|='],
    ['.a:not(.b .c)', 'combinators inside'],
  ])('%s', async (selector, what) => {
    t = renderComponent(List)
    await t.ready()
    let err
    try { t.simulateEvent(selector, 'click') } catch (e) { err = e }
    expect(err?.message).toMatch(/Unsupported selector syntax/)
    expect(err.message).toContain(selector)
    expect(err.message).toContain(what)
  })

  it('throws even before the component is ready (at the call)', () => {
    t = renderComponent(List)
    expect(() => t.simulateEvent('.a:has(.b)', 'click')).toThrow(/Unsupported selector syntax/)
  })
})

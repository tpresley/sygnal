// PLAN-9 K-3 (worker A): fromTree / toTree / removeNode and the finishing step (idempotent;
// identity keys; previous-key reuse; required / companions / pin / in / minSlots / min / max /
// accepts / row unwrap / limits / cycles / groups) and its diagnostics (SYG250, 251, 452).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.ts'
import { defineCatalog, fromTree, toTree, removeNode } from '../src/extra/ai/index.ts'
import { finish } from '../src/extra/ai/compose/layout.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { shape } from './p9-compose-fakes.js'

beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => _resetDiagnostics())
const codes = () => getDiagnostics().map((d) => d.code)

const C = () => h('div', null)
const STATE = { customers: [{ id: 7, name: 'N' }, { id: 9, name: 'G' }] }
const ANY = ['page', 'tabs', 'box', 'flat']
const cat = defineCatalog({
  limits: { maxParts: 6, maxDepth: 2 },
  parts: {
    a: { component: C, description: 'A', in: ANY },
    b: { component: C, description: 'B', in: ANY },
    c: { component: C, description: 'C', in: ANY },
    d: { component: C, description: 'D', in: ['tabs:two'] },
    chart: { component: C, description: 'Chart', params: { range: { options: { month: 'm', year: 'y' }, default: 'year' }, n: { type: 'number', default: 5, min: 1, max: 10 } } },
    note: { component: C, description: 'Note', maxUses: 3, params: { title: { type: 'text', maxLength: 5, required: true }, tags: { type: 'list', min: 1, max: 2, items: { maxLength: 3 } } } },
    cust: { component: C, description: 'Customer', params: { id: { from: (s) => s.customers.map((x) => ({ value: x.id })) } } },
    header: { component: C, description: 'Header', required: true, pin: 'start' },
    footer: { component: C, description: 'Footer', pin: 'end' },
    save: { component: C, description: 'Save', companions: ['cancel'] },
    cancel: { component: C, description: 'Cancel', in: ANY },
    cards: { component: C, description: 'Cards', group: 'g' },
    list: { component: C, description: 'List', group: 'g' },
  },
  containers: {
    tabs: { slots: { one: null, two: null }, minSlots: 2 },
    box: { min: 2, max: 3, in: ['page', 'box'] },
    flat: { accepts: 'leaves', arranged: true },
  },
})
const f = (tree, prev) => finish(cat, fromTree(cat, tree, prev), STATE)
const P = (keys, nodes) => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: keys } }, ...nodes } })

describe('fromTree / toTree', () => {
  it('identity keys: part, part:record, repeats ~2, containers by id; params without defaults', () => {
    const l = fromTree(cat, [
      { part: 'a' }, { part: 'cust', params: { id: 7 } }, { part: 'note', params: { title: 'x' } }, { part: 'note', params: { title: 'y' } },
      { part: 'row', children: [{ part: 'b' }, { part: 'chart', params: { range: 'year', n: 3 } }] }, { part: 'row', children: [{ part: 'c' }] },
      { part: 'tabs', children: { one: [{ part: 'header' }], two: [{ part: 'd' }] } },
    ])
    expect(Object.keys(l.nodes)).toEqual(['a', 'cust:7', 'note', 'note~2', 'b', 'chart', 'row', 'c', 'row~2', 'header', 'd', 'tabs', 'page'])
    expect(l.nodes.chart.params).toEqual({ n: 3 })
    expect(l.nodes.tabs.slots).toEqual({ one: ['header'], two: ['d'] })
    expect(l.nodes.page.slots.default).toEqual(['a', 'cust:7', 'note', 'note~2', 'row', 'row~2', 'tabs'])
  })

  it('reuses previous keys: same params first, then same identity (a param change keeps the key)', () => {
    const prev = fromTree(cat, [{ part: 'note', params: { title: 'x' } }, { part: 'note', params: { title: 'y' } }, { part: 'chart' }])
    const l = fromTree(cat, [{ part: 'note', params: { title: 'z' } }, { part: 'note', params: { title: 'y' } }, { part: 'chart', params: { range: 'month' } }], prev)
    expect(l.nodes['note~2'].params).toEqual({ title: 'y' })
    expect(l.nodes.note.params).toEqual({ title: 'z' })
    expect(l.nodes.chart.params).toEqual({ range: 'month' })
    // keys of a hand-made layout are reused by identity
    const hand = P(['x1'], { x1: { part: 'a' } })
    expect(fromTree(cat, [{ part: 'b' }, { part: 'a' }], hand).nodes.page.slots.default).toEqual(['b', 'x1'])
  })

  it('toTree inverts fromTree (array for a default slot, a record for named slots)', () => {
    const tree = [{ part: 'a' }, { part: 'row', children: [{ part: 'b' }, { part: 'c' }] }, { part: 'tabs', children: { one: [{ part: 'a' }], two: [{ part: 'd' }] } }, { part: 'chart', params: { n: 2 } }]
    expect(toTree(fromTree(cat, tree))).toEqual(tree)
    expect(toTree(null)).toEqual([])
  })

  it('removeNode removes a subtree and its references', () => {
    const l = fromTree(cat, [{ part: 'a' }, { part: 'row', children: [{ part: 'b' }, { part: 'c' }] }])
    const r = removeNode(l, 'row')
    expect(Object.keys(r.nodes).sort()).toEqual(['a', 'page'])
    expect(r.nodes.page.slots.default).toEqual(['a'])
    expect(removeNode(l, 'nope')).toBe(l)
    expect(removeNode(l, 'page')).toBe(l)
  })
})

describe('finish', () => {
  it('is idempotent on every case below', () => {
    const cases = [
      [{ part: 'footer' }, { part: 'save' }, { part: 'row', children: [{ part: 'a' }] }, { part: 'd' }],
      [{ part: 'tabs', children: { one: [{ part: 'a' }] } }, { part: 'box', children: [{ part: 'b' }] }],
      [{ part: 'row', children: [{ part: 'a' }, { part: 'b' }, { part: 'c' }, { part: 'cancel' }, { part: 'footer' }] }],
      [{ part: 'flat', children: [{ part: 'a' }, { part: 'row', children: [{ part: 'b' }, { part: 'c' }] }] }],
      [{ part: 'cards' }, { part: 'list' }, { part: 'note', params: { title: 'xxxxxxx' } }],
    ]
    for (const tree of cases) {
      const once = f(tree)
      expect(finish(cat, once, STATE)).toEqual(once)
    }
  })

  it('required parts (pinned to the start), companions after their part, pin end', () => {
    const l = f([{ part: 'footer' }, { part: 'save' }, { part: 'a' }])
    expect(shape(l)).toEqual(['header', 'save', 'cancel', 'a', 'footer'])
  })

  it('`in`: a part outside its places moves to the first that exists, else into a new container', () => {
    const l = f([{ part: 'a' }, { part: 'd' }])
    expect(shape(l)).toEqual(['header', 'a', 'tabs(d)'])
    const l2 = f([{ part: 'tabs', children: { one: [{ part: 'a' }], two: [{ part: 'b' }] } }, { part: 'd' }])
    expect(shape(l2)).toEqual(['header', 'tabs(a,b,d)'])
    expect(l2.nodes.tabs.slots.two).toEqual(['b', 'd'])
  })

  it('minSlots and min unwrap, a single-part row unwraps, empty containers go', () => {
    expect(shape(f([{ part: 'tabs', children: { one: [{ part: 'a' }] } }]))).toEqual(['header', 'a'])
    expect(shape(f([{ part: 'box', children: [{ part: 'a' }] }]))).toEqual(['header', 'a'])
    expect(shape(f([{ part: 'row', children: [{ part: 'a' }] }, { part: 'row', children: [] }]))).toEqual(['header', 'a'])
  })

  it('max: an over-full row splits into even rows; a container’s extra children go after it', () => {
    const l = f([{ part: 'row', children: [{ part: 'a' }, { part: 'b' }, { part: 'c' }, { part: 'save' }, { part: 'chart' }] }])
    // 7 parts with the companion: maxParts (6) drops the last
    expect(shape(l)).toEqual(['header', 'row(a,b,c)', 'row~2(save,cancel)'])
    const box = f([{ part: 'box', children: [{ part: 'a' }, { part: 'b' }, { part: 'c' }, { part: 'chart' }] }])
    expect(shape(box)).toEqual(['header', 'box(a,b,c)', 'chart'])
  })

  it('accepts: leaves (nested containers go after it); a row in an arranged slot or in a row unwraps', () => {
    const l = f([{ part: 'flat', children: [{ part: 'a' }, { part: 'box', children: [{ part: 'b' }, { part: 'c' }] }] }])
    expect(shape(l)).toEqual(['header', 'flat(a)', 'box(b,c)'])
    const r = f([{ part: 'flat', children: [{ part: 'row', children: [{ part: 'a' }, { part: 'b' }] }] }])
    expect(shape(r)).toEqual(['header', 'flat(a,b)'])
    const rr = finish(cat, P(['row'], { row: { part: 'row', slots: { default: ['a', 'row~2'] } }, 'row~2': { part: 'row', slots: { default: ['b', 'c'] } }, a: { part: 'a' }, b: { part: 'b' }, c: { part: 'c' } }), STATE)
    expect(shape(rr)).toEqual(['header', 'row(a,b,c)'])
  })

  it('maxUses per identity, groups (the first part wins), maxParts, maxDepth', () => {
    expect(shape(f([{ part: 'a' }, { part: 'a' }, { part: 'cust', params: { id: 7 } }, { part: 'cust', params: { id: 9 } }]))).toEqual(['header', 'a', 'cust:7', 'cust:9'])
    expect(shape(f([{ part: 'list' }, { part: 'cards' }]))).toEqual(['header', 'list'])
    const many = f(['a', 'b', 'c', 'chart', 'cancel', 'footer', 'cards'].map((part) => ({ part })))
    expect(shape(many)).toEqual(['header', 'a', 'b', 'c', 'chart', 'cancel'])
    const deep = f([{ part: 'box', children: [{ part: 'a' }, { part: 'box', children: [{ part: 'b' }, { part: 'box', children: [{ part: 'c' }, { part: 'cancel' }] }] }] }])
    // box~3 is deeper than maxDepth (2): moved to the page; box~2, left with one child, is under min: unwrapped
    expect(shape(deep)).toEqual(['header', 'box(a,b)', 'box~3(c,cancel)'])
  })

  it('params: invalid values fall back to defaults, numbers clamp, text and lists cut (SYG251)', () => {
    const l = finish(cat, P(['chart', 'note'], {
      chart: { part: 'chart', params: { range: 'decade', n: 99, extra: 1 } },
      note: { part: 'note', params: { title: 'abcdefgh', tags: ['abcd', 'b', 'c', 5] } },
    }), STATE)
    expect(l.nodes.chart.params).toEqual({ n: 10 })
    expect(l.nodes.note.params).toEqual({ title: 'abcde', tags: ['abc', 'b'] })
    expect(codes()).toEqual(['SYG251', 'SYG251', 'SYG251'])
  })

  it('drops nodes it cannot show: no record, a missing required text (SYG251)', () => {
    const l = finish(cat, P(['cust:1', 'cust', 'note', 'a'], { 'cust:1': { part: 'cust', params: { id: 1 } }, cust: { part: 'cust' }, note: { part: 'note' }, a: { part: 'a' } }), STATE)
    expect(shape(l)).toEqual(['header', 'a'])
    expect(codes()).toEqual(['SYG251', 'SYG251', 'SYG251'])
    expect(finish(cat, P(['c7'], { c7: { part: 'cust', params: { id: '7' } } }), STATE).nodes.c7.params).toEqual({ id: 7 })
  })

  it('unknown parts, slots and keys (SYG250); keys twice and cycles (SYG452)', () => {
    const l = finish(cat, P(['x', 'zz', 'tabs', 'a', 'a'], {
      x: { part: 'nope', slots: { default: ['b'] } },
      tabs: { part: 'tabs', slots: { one: ['c'], three: ['d'] } },
      a: { part: 'a', slots: { default: ['tabs'] } },
      b: { part: 'b' }, c: { part: 'c' }, d: { part: 'd' },
    }), STATE)
    expect(shape(l)).toEqual(['header', 'b', 'tabs(c,d)', 'a'])
    expect(codes()).toEqual(['SYG250', 'SYG250', 'SYG250', 'SYG250', 'SYG452', 'SYG452'])
    expect(l.nodes.tabs.slots).toEqual({ one: ['c'], two: ['d'] })
  })

  it('garbage in: an empty page', () => {
    expect(finish(cat, null, STATE)).toEqual({ root: 'page', nodes: { page: { part: 'page', slots: { default: ['header'] } }, header: { part: 'header' } } })
    expect(finish(cat, { nodes: 5 }, STATE).nodes.page.slots.default).toEqual(['header'])
  })
})

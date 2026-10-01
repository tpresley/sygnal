// @vitest-environment jsdom
// PLAN-2 1-A: rendering and props (B-014, B-015, B-017). Patches real (jsdom) elements
// with Sygnal's default snabbdom modules and the JSX pragma.
import { describe, it, expect, beforeEach } from 'vitest'
import { init } from 'snabbdom/build/init.js'
import modules from '../src/cycle/dom/modules.js'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'

const patch = init(modules)
let root
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  root = document.getElementById('root')
})

function mountSeq(...views) {
  let prev = root
  for (const v of views) prev = patch(prev, v)
  return prev.elm
}

describe('B-014: string and array `class`', () => {
  it('class="a b" (pragma) sets the classes a and b, not one per character', () => {
    const elm = mountSeq(h('p', { class: 'a b' }, 'x'))
    expect(elm.getAttribute('class')).toBe('a b')
  })

  it('class="a b" (jsx runtime) sets the classes a and b', () => {
    const elm = mountSeq(jsx('p', { class: 'a b', children: 'x' }))
    expect(elm.getAttribute('class')).toBe('a b')
  })

  it('a string class is the class map in the vnode', () => {
    expect(h('p', { class: '  a  b ' }).data.class).toEqual({ a: true, b: true })
  })

  it('class={["a", cond && "b", null]} sets the truthy entries', () => {
    const elm = mountSeq(h('p', { class: ['a', false && 'b', null, 'c d'] }, 'x'))
    expect(elm.getAttribute('class')).toBe('a c d')
  })

  it('a string class updates: "a b" -> "b c" removes a and adds c', () => {
    const elm = mountSeq(h('p', { class: 'a b' }, 'x'), h('p', { class: 'b c' }, 'x'))
    expect([...elm.classList].sort()).toEqual(['b', 'c'])
  })

  it('a string class combines with className and the selector classes', () => {
    const elm = mountSeq(h('p.s', { class: 'a', className: 'k' }, 'x'))
    expect([...elm.classList].sort()).toEqual(['a', 'k', 's'])
  })

  it('a string class on an SVG element still renders', () => {
    const elm = mountSeq(h('svg', { class: 'icon big' }))
    expect(elm.getAttribute('class')).toBe('icon big')
  })
})

describe('G-096: clsx-style class arrays', () => {
  it("class={['btn', { active: on, off: !on }]} merges the object's truthy keys", () => {
    const elm = mountSeq(h('button', { class: ['btn', { active: true, hidden: false }] }, 'x'))
    expect([...elm.classList].sort()).toEqual(['active', 'btn'])
    expect(elm.getAttribute('class')).not.toMatch(/object/)
  })

  it('nested arrays are flattened and falsy entries skipped', () => {
    expect(h('p', { class: ['a', ['b c', [null, { d: 1, e: 0 }], false], undefined, ''] }).data.class)
      .toEqual({ a: true, b: true, c: true, d: true })
  })

  it('jsx runtime: an object inside an array updates when its value changes', () => {
    const elm = mountSeq(
      jsx('p', { class: ['x', { on: true }], children: 'x' }),
      jsx('p', { class: ['x', { on: false }], children: 'x' }),
    )
    expect([...elm.classList]).toEqual(['x'])
  })
})

describe('B-015: removed props are cleared', () => {
  it('title is removed when the prop disappears', () => {
    const elm = mountSeq(h('p', { title: 'tip' }, 'x'), h('p', null, 'x'))
    expect(elm.hasAttribute('title')).toBe(false)
    expect(elm.title).toBe('')
  })

  it('title={undefined|null} does not render "undefined"/"null"', () => {
    const a = mountSeq(h('p', { title: undefined }, 'x'))
    expect(a.hasAttribute('title')).toBe(false)
    const b = mountSeq(h('p', { title: 'tip' }, 'x'), h('p', { title: null }, 'x'))
    expect(b.hasAttribute('title')).toBe(false)
  })

  it('a removed boolean prop is reset (disabled)', () => {
    const elm = mountSeq(h('button', { disabled: true }, 'x'), h('button', null, 'x'))
    expect(elm.disabled).toBe(false)
    expect(elm.hasAttribute('disabled')).toBe(false)
  })

  it('removed id, href and htmlFor are removed', () => {
    const a = mountSeq(h('a', { id: 'i', href: '/x' }, 'x'), h('a', null, 'x'))
    expect(a.hasAttribute('id')).toBe(false)
    expect(a.hasAttribute('href')).toBe(false)
    const l = mountSeq(h('label', { htmlFor: 'f' }, 'x'), h('label', null, 'x'))
    expect(l.hasAttribute('for')).toBe(false)
  })

  // G-095: `src = ''` queues an img/video error event and navigates an iframe to about:blank;
  // the property is only written when removing the attribute can't reset it.
  function spySrcWrites(Ctor) {
    const desc = Object.getOwnPropertyDescriptor(Ctor.prototype, 'src')
    const writes = []
    Object.defineProperty(Ctor.prototype, 'src', { ...desc, set(v) { writes.push(v); desc.set.call(this, v) } })
    return { writes, restore: () => Object.defineProperty(Ctor.prototype, 'src', desc) }
  }

  it("G-095: a removed src only removes the attribute; '' is never written (img, iframe)", () => {
    for (const [tag, Ctor] of [['img', HTMLImageElement], ['iframe', HTMLIFrameElement]]) {
      const spy = spySrcWrites(Ctor)
      try {
        const elm = mountSeq(h(tag, { src: 'data:,x' }), h(tag, null))
        expect(elm.hasAttribute('src')).toBe(false)
        expect(spy.writes).toEqual(['data:,x'])
      } finally { spy.restore() }
    }
  })

  it('G-095: src={undefined} on create writes nothing; becoming undefined writes no empty string', () => {
    const spy = spySrcWrites(HTMLImageElement)
    try {
      const a = mountSeq(h('img', { src: undefined }))
      expect(a.hasAttribute('src')).toBe(false)
      expect(spy.writes).toEqual([])
      const b = mountSeq(h('img', { src: 'data:,x' }), h('img', { src: undefined }))
      expect(b.hasAttribute('src')).toBe(false)
      expect(spy.writes).not.toContain('')
    } finally { spy.restore() }
  })

  it('G-109: src={null} is never written as "null" (on create or when it becomes null)', () => {
    const spy = spySrcWrites(HTMLImageElement)
    try {
      const a = mountSeq(h('img', { src: null }))
      expect(a.hasAttribute('src')).toBe(false)
      expect(spy.writes).toEqual([])
      const b = mountSeq(h('img', { src: 'data:,x' }), h('img', { src: null }), h('img', { src: 'data:,y' }))
      expect(b.getAttribute('src')).toBe('data:,y')
      expect(spy.writes).toEqual(['data:,x', 'data:,y'])
    } finally { spy.restore() }
  })

  it('G-095: a removed non-reflected prop is still reset', () => {
    const elm = mountSeq(h('p', { foo: 'bar' }, 'x'), h('p', null, 'x'))
    expect(elm.foo).toBe('')
  })

  it('a removed number prop goes back to its default (maxLength)', () => {
    const elm = mountSeq(h('input', { maxLength: 5 }), h('input', null))
    expect(elm.hasAttribute('maxlength')).toBe(false)
    expect(elm.maxLength).toBe(-1)
  })

  it('props that stay are untouched; changed props still update', () => {
    const elm = mountSeq(h('p', { title: 'a', lang: 'en' }, 'x'), h('p', { title: 'b' }, 'x'))
    expect(elm.title).toBe('b')
    expect(elm.hasAttribute('lang')).toBe(false)
  })

  it('a removed value/checked on a form field is left to the user (controlled -> uncontrolled)', () => {
    const elm = mountSeq(h('input', { value: 'typed' }), h('input', null))
    expect(elm.value).toBe('typed')
    const cb = mountSeq(h('input', { type: 'checkbox', checked: true }), h('input', { type: 'checkbox' }))
    expect(cb.checked).toBe(true)
  })

  it('a removed custom property on an element is unset', () => {
    const elm = mountSeq(h('div', { props: { myData: { a: 1 } } }, 'x'), h('div', null, 'x'))
    expect(elm.myData).toBe(undefined)
  })
})

describe('B-017: controlled <select> value applies after its options update', () => {
  const sel = (value, opts) => h('select', { value }, ...opts.map(o => h('option', { value: o }, o)))

  it('new value whose option is added in the same patch is selected', () => {
    const elm = mountSeq(sel('a', ['a', 'b']), sel('c', ['a', 'b', 'c']))
    expect(elm.value).toBe('c')
  })

  it('options replaced and value changed in one patch', () => {
    const elm = mountSeq(sel('a', ['a', 'b']), sel('y', ['x', 'y', 'z']))
    expect(elm.value).toBe('y')
  })

  it('unchanged value whose option is re-created stays selected', () => {
    const elm = mountSeq(sel('b', ['a', 'b']), sel('b', ['b', 'c']))
    expect(elm.value).toBe('b')
  })

  it('initial value on create is selected (selectModule)', () => {
    const elm = mountSeq(sel('b', ['a', 'b', 'c']))
    expect(elm.value).toBe('b')
  })
})

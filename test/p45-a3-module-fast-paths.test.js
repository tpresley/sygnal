// @vitest-environment jsdom
// PLAN-4.5 P45-A item 3 (audit finding 6, rec 7): Sygnal's snabbdom modules run for every
// vnode in every patch (11.5% of a Collection select). selectModule and controlledInputModule
// now look at the vnode's tag (its sel) before anything else and leave every element that
// isn't a form field alone, without touching the DOM element; classNameModule does work only
// when the vnode or the old vnode has a className prop (B-012: keyed on the prop, not the tag).
import { describe, it, expect } from 'vitest'
import { selectModule } from '../src/cycle/dom/selectModule.js'
import { controlledInputModule } from '../src/cycle/dom/controlledInputModule.js'
import { classNameModule } from '../src/cycle/dom/classNameModule.js'

// an element that records every property read or write
function watched(tagName) {
  const touched = []
  const elm = new Proxy({ tagName, classList: { add() {}, remove() {} } }, {
    get: (o, k) => { touched.push(String(k)); return o[k] },
    set: (o, k, v) => { touched.push('set ' + String(k)); o[k] = v; return true },
  })
  return { elm, touched }
}
const vnode = (sel, props, elm) => ({ sel, data: { props }, elm })

describe('P45-A: DOM module fast paths', () => {
  it('selectModule and controlledInputModule leave non-field elements untouched', () => {
    for (const sel of ['div', 'li.row', 'progress', 'meter', 'select-menu', 'my-input', 'td']) {
      const { elm, touched } = watched(sel.toUpperCase())
      const props = { value: 'x', checked: true, className: 'a' }
      selectModule.create(vnode(undefined), vnode(sel, props, elm))
      selectModule.update(vnode(sel, props), vnode(sel, props, elm))
      controlledInputModule.update(vnode(sel, props), vnode(sel, props, elm))
      selectModule.post()
      expect(touched, sel).toEqual([])
    }
  })

  it('classNameModule leaves elements without a className prop untouched', () => {
    const { elm, touched } = watched('INPUT')
    classNameModule.create(vnode(undefined), vnode('input', { value: 'x' }, elm))
    classNameModule.update(vnode('input', { value: 'x' }), vnode('input', { value: 'y' }, elm))
    classNameModule.update(vnode('div', undefined), vnode('div', undefined, elm))
    expect(touched).toEqual([])
  })

  it('classNameModule still works on any element that has the prop, field or not (B-012)', () => {
    for (const tag of ['p', 'input', 'my-el']) {
      const elm = document.createElement(tag)
      elm.className = 'foo old'
      classNameModule.update(vnode(tag + '.foo', { className: 'old' }), vnode(tag + '.foo', {}, elm))
      expect(elm.className, tag).toBe('foo')
    }
  })

  it('form fields are still synced: input, textarea, select (with id/class in the sel)', () => {
    for (const sel of ['input', 'input.x', 'textarea#t', 'select.s']) {
      const tag = sel.split(/[.#]/)[0]
      const elm = document.createElement(tag)
      if (tag === 'select') for (const v of ['', 'a', 'b']) { const o = document.createElement('option'); o.value = v; elm.appendChild(o) }
      else elm.value = 'typed'
      const want = tag === 'select' ? 'b' : ''
      controlledInputModule.update(vnode(sel, { value: want }), vnode(sel, { value: want }, elm))
      expect(elm.value, sel).toBe(want)
    }
  })

  it('selectModule re-applies a select value after its options exist (B-017)', () => {
    const elm = document.createElement('select')
    selectModule.create(vnode(undefined), vnode('select#pick', { value: 'b' }, elm))
    for (const v of ['a', 'b']) { const o = document.createElement('option'); o.value = v; elm.appendChild(o) }
    selectModule.post()
    expect(elm.value).toBe('b')
  })
})

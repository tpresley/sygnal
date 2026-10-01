// @vitest-environment jsdom
// PLAN-2 2-R (R2-1, D49): a present-but-nullish `value`/`checked` on a form field clears it
// ('' / false, the 5.4.0 behaviour) and keeps it controlled; only an absent prop hands the
// field back to the user. Nothing is ever written as the string "null" (G-109).
import { describe, it, expect, beforeEach } from 'vitest'
import { init } from 'snabbdom/build/init.js'
import modules from '../src/cycle/dom/modules.js'
import { createElement as h } from '../src/pragma/index.js'

const patch = init(modules)
let root
beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  root = document.getElementById('root')
})

function mountSeq(...views) {
  let prev = root
  for (const v of views) prev = patch(prev, v)
  return prev
}

describe('R2-1 / D49: nullish value/checked clears a controlled field', () => {
  it('value="Bob" -> value={null} clears the input', () => {
    const v = mountSeq(h('input', { value: 'Bob' }), h('input', { value: null }))
    expect(v.elm.value).toBe('')
  })

  it('a hand-built vnode with value: undefined (present key) clears the input too', () => {
    const v = mountSeq(h('input', { value: 'Bob' }), { ...h('input', null), data: { props: { value: undefined } } })
    expect(v.elm.value).toBe('')
  })

  it('checked={true} -> checked={null} unchecks the checkbox', () => {
    const v = mountSeq(h('input', { type: 'checkbox', checked: true }), h('input', { type: 'checkbox', checked: null }))
    expect(v.elm.checked).toBe(false)
  })

  it('textarea value={null} clears it', () => {
    const v = mountSeq(h('textarea', { value: 'note' }), h('textarea', { value: null }))
    expect(v.elm.value).toBe('')
  })

  it('value={null} on create leaves an empty field, never "null"', () => {
    const v = mountSeq(h('input', { value: null }))
    expect(v.elm.value).toBe('')
    expect(v.elm.getAttribute('value')).toBe(null)
  })

  it('stays cleared on later renders: typed text is reset while value stays null', () => {
    let v = mountSeq(h('input', { value: 'Bob' }), h('input', { value: null }))
    v.elm.value = 'typed'
    v = patch(v, h('input', { value: null }))
    expect(v.elm.value).toBe('')
    const cb = mountSeq(h('input', { type: 'checkbox', checked: true }), h('input', { type: 'checkbox', checked: null }))
    let cv = cb
    cv.elm.checked = true
    cv = patch(cv, h('input', { type: 'checkbox', checked: null }))
    expect(cv.elm.checked).toBe(false)
  })

  it('an absent value still hands control back (typed text stays)', () => {
    let v = mountSeq(h('input', { value: 'Bob' }), h('input', null))
    expect(v.elm.value).toBe('Bob')
    v.elm.value = 'typed'
    v = patch(v, h('input', null))
    expect(v.elm.value).toBe('typed')
  })

  it('null -> a value writes the value', () => {
    const v = mountSeq(h('input', { value: null }), h('input', { value: 'x' }))
    expect(v.elm.value).toBe('x')
  })

  it('G-109 still holds: a nullish non-form prop is never written as "null"', () => {
    const v = mountSeq(h('a', { href: '/x', title: 't' }, 'a'), h('a', { href: null, title: null }, 'a'))
    expect(v.elm.hasAttribute('href')).toBe(false)
    expect(v.elm.title).toBe('')
  })
})

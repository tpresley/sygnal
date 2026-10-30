import {JSDOM} from 'jsdom'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {loadQuickJS, createSandbox} from '../src/sandbox.js'
import {compile} from '../src/compile.js'

export const kernel = readFileSync(resolve(import.meta.dirname, '../dist/guest.js'), 'utf8')
export const QJS = await loadQuickJS()
export const settle = (ms = 5) => new Promise(r => setTimeout(r, ms))

/** a sandbox in a fresh jsdom page; returns the handles a test reads */
export function mount(code, opts = {}) {
  const {window} = new JSDOM('<!doctype html><div id="app"></div>')
  const container = window.document.getElementById('app')
  const errors = [], emits = [], logs = []
  const sb = createSandbox(opts.QJS || QJS, {
    kernel, source: opts.raw ? code : compile(code), container, ...opts,
    capabilities: {log: (l, t) => logs.push([l, t]), ...opts.capabilities, onEmit: (e) => { emits.push(e); opts.capabilities?.onEmit?.(e) }},
    onError: (e) => errors.push(e),
  })
  const $ = (sel) => container.querySelector(sel)
  const fire = (sel, type, init = {}) => {
    const el = $(sel)
    const E = /^key/.test(type) ? window.KeyboardEvent : /click|mouse|pointer/.test(type) ? window.MouseEvent : window.Event
    const e = new E(type, {bubbles: true, cancelable: true, ...init})
    el.dispatchEvent(e)
    return e
  }
  return {sb, window, container, $, fire, errors, emits, logs}
}

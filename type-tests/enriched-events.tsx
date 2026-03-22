/**
 * Type tests for EnrichedEventStream helpers returned by .events()
 *
 * Verifies that .value(), .checked(), .data(), .target(), .key()
 * are visible on streams returned by DOM.select().events() and
 * DOM proxy shorthands (DOM.click(), DOM.input(), etc.)
 */
import type { Component } from 'sygnal'

// ─── State ──────────────────────────────────────────────────────────────────

type State = {
  text: string
  checked: boolean
  key: string
  targetTag: string
  dataId: string
}

// ─── Actions ────────────────────────────────────────────────────────────────

type Actions = {
  TEXT_INPUT: string
  CHECKBOX: boolean
  KEY_PRESS: string
  TARGET: EventTarget | null
  DATA_ID: string | undefined
  TEXT_INPUT_VIA_PROXY: string
  CHECKED_VIA_PROXY: boolean
  MAPPED_VALUE: number
  MAPPED_KEY: boolean
  MAPPED_DATA: number
  MAPPED_TARGET: string
  MAPPED_CHECKED: string
}

// ─── Component ──────────────────────────────────────────────────────────────

type TestComp = Component<State, {}, {}, Actions>

const Comp: TestComp = function ({ state }) {
  return (
    <div>
      <input className="text-input" type="text" value={state.text} />
      <input className="checkbox" type="checkbox" checked={state.checked} />
      <button className="btn" data-id="42">Click</button>
      <div className="target">Target: {state.targetTag}</div>
      <input className="key-input" type="text" />
    </div>
  )
}

Comp.initialState = {
  text: '',
  checked: false,
  key: '',
  targetTag: '',
  dataId: '',
}

Comp.intent = ({ DOM }) => {
  // ── .value() on DOM.select().events() ────────────────────────────────────
  // This was the original bug — .value() was not typed on .events() return
  const textInput$ = DOM.select('.text-input').events('input').value()

  // ── .checked() on DOM.select().events() ──────────────────────────────────
  const checkbox$ = DOM.select('.checkbox').events('change').checked()

  // ── .key() on DOM.select().events() ──────────────────────────────────────
  const keyPress$ = DOM.select('.key-input').events('keydown').key()

  // ── .target() on DOM.select().events() ────────────────────────────────────
  const target$ = DOM.select('.btn').events('click').target()

  // ── .data() on DOM.select().events() ──────────────────────────────────────
  const dataId$ = DOM.select('.btn').events('click').data('id')

  // ── Proxy shorthand methods also return EnrichedEventStream ───────────────
  const proxyValue$ = DOM.input('.text-input').value()
  const proxyChecked$ = DOM.change('.checkbox').checked()

  // ── Chaining with transform functions ─────────────────────────────────────
  const mappedValue$ = DOM.select('.text-input').events('input')
    .value((val) => val.length)

  const mappedKey$ = DOM.select('.key-input').events('keydown')
    .key((k) => k === 'Enter')

  const mappedData$ = DOM.select('.btn').events('click')
    .data('id', (val) => Number(val))

  const mappedTarget$ = DOM.select('.btn').events('click')
    .target((el) => el ? el.constructor.name : 'null')

  const mappedChecked$ = DOM.select('.checkbox').events('change')
    .checked((val) => val ? 'yes' : 'no')

  return {
    TEXT_INPUT: textInput$,
    CHECKBOX: checkbox$,
    KEY_PRESS: keyPress$,
    TARGET: target$,
    DATA_ID: dataId$,
    TEXT_INPUT_VIA_PROXY: proxyValue$,
    CHECKED_VIA_PROXY: proxyChecked$,
    MAPPED_VALUE: mappedValue$,
    MAPPED_KEY: mappedKey$,
    MAPPED_DATA: mappedData$,
    MAPPED_TARGET: mappedTarget$,
    MAPPED_CHECKED: mappedChecked$,
  }
}

Comp.model = {
  TEXT_INPUT: (state, data) => ({ ...state, text: data }),
  CHECKBOX: (state, data) => ({ ...state, checked: data }),
  KEY_PRESS: (state, data) => ({ ...state, key: data }),
  TARGET: (state) => state,
  DATA_ID: (state, data) => ({ ...state, dataId: data ?? '' }),
  TEXT_INPUT_VIA_PROXY: (state, data) => ({ ...state, text: data }),
  CHECKED_VIA_PROXY: (state, data) => ({ ...state, checked: data }),
  MAPPED_VALUE: (state) => state,
  MAPPED_KEY: (state) => state,
  MAPPED_DATA: (state) => state,
  MAPPED_TARGET: (state) => state,
  MAPPED_CHECKED: (state) => state,
}

export default Comp

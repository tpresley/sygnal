import { run, makeBrowserDriver } from 'sygnal'

const KEY = 'p5-showcase-note'

export function Environment({ state }) {
  return (
    <div>
      <ul className="facts">
        <li>Color scheme: <strong>{state.dark ? 'dark' : 'light'}</strong> · wide window (≥ 900px): <strong>{String(state.wide)}</strong></li>
        <li>Page visible: <strong>{String(state.visible)}</strong> (hidden {state.hiddenCount} times; switch tabs and come back)</li>
        <li>Online: <strong>{String(state.online)}</strong></li>
        <li>localStorage "{KEY}": <strong>{state.stored === null ? '(absent)' : `"${state.stored}"`}</strong> (also follows other tabs)</li>
      </ul>
      <div className="row">
        <label>Note <input className="note" value={state.draft} /></label>
        <button className="store">Store it</button>
        <button className="forget">Remove it</button>
        <button className="copy">{state.copied ? 'Copied' : 'Copy to clipboard'}</button>
      </div>
      <div className="resize-box">Drag my corner: {Math.round(state.size.width)} × {Math.round(state.size.height)}</div>
      <div className="scroller">
        <p>Scroll down inside this box…</p>
        <p className="sentinel">{state.sentinel ? 'I am in view' : 'not in view'}</p>
      </div>
      {state.error ? <p className="error" role="alert">{state.error}</p> : null}
    </div>
  )
}

Environment.initialState = {
  dark: false, wide: false, visible: true, hiddenCount: 0, online: true, stored: null,
  draft: 'Hello from Sygnal', copied: false, size: { width: 0, height: 0 }, sentinel: false, error: null,
}

// what to watch, as a function of state (the timers shape): diffed by name
Environment.browser = () => ({
  dark: { media: '(prefers-color-scheme: dark)', action: 'DARK' },
  wide: { media: '(min-width: 900px)', action: 'WIDE' },
  visible: { visibility: true, action: 'VISIBLE' },
  online: { online: true, action: 'ONLINE' },
  stored: { storage: KEY, action: 'STORED', error: 'FAILED' },
  size: { resize: '.resize-box', action: 'RESIZED' },
  sentinel: { intersection: '.sentinel', action: 'SENTINEL' },
})

Environment.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.note').value(),
  STORE: DOM.click('.store'),
  FORGET: DOM.click('.forget'),
  COPY: DOM.click('.copy'),
})

Environment.model = {
  DARK: (state, { matches }) => ({ ...state, dark: matches }),
  WIDE: (state, { matches }) => ({ ...state, wide: matches }),
  VISIBLE: (state, { visible }) => ({ ...state, visible, hiddenCount: state.hiddenCount + (visible ? 0 : 1) }),
  ONLINE: (state, { online }) => ({ ...state, online }),
  STORED: (state, { value }) => ({ ...state, stored: value }),
  RESIZED: (state, { width, height }) => ({ ...state, size: { width, height } }),
  SENTINEL: (state, { visible }) => ({ ...state, sentinel: visible }),
  DRAFT: (state, draft) => ({ ...state, draft, copied: false }),
  // commands on the driver's sink, answered by reply actions
  STORE: { BROWSER: (state) => ({ setItem: KEY, value: state.draft, error: 'FAILED' }) },
  FORGET: { BROWSER: { removeItem: KEY, error: 'FAILED' } },
  COPY: { BROWSER: (state) => ({ copy: state.draft, ok: 'COPIED', error: 'FAILED' }) },
  COPIED: (state) => ({ ...state, copied: true, error: null }),
  FAILED: (state, { message }) => ({ ...state, error: message }),
}

export const start = (mountPoint, uid) => run(Environment, { BROWSER: makeBrowserDriver() }, { mountPoint, uid })

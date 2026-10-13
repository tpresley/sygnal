// The top bar's provider status and the Keys dialog (a Sygnal app of its own).
//
// A key typed here goes once, same-origin, to the dev server (POST /api/keys), which keeps it in
// memory for this session. The page never stores it and never gets it back: GET /api/providers
// only says whether each provider has a key and where it came from.
import { ABORT, run, makeFetchDriver, driverFromAsync } from 'sygnal'
import { dialog } from 'sygnal/ui'
import { ROUTES } from '../shared/providers.js'

const PROVIDERS = [
  { id: 'kindo', name: 'Kindo', hint: 'Kimi K3 and the other Kindo models (Responses, Chat Completions, Messages), and the MCP App\'s agent runs.', file: '~/.config/kindo/env', variable: 'KINDO_API_KEY' },
  { id: 'typesafe', name: 'TypeSafe', hint: 'Jev, the hosted decision model (sections 4, 5 and 7).', file: '~/.config/typesafe/env', variable: 'TYPESAFE_API_KEY' },
]

const SOURCE = { file: 'from key file', session: 'typed in this session' }

function chips(state) {
  const p = state.providers?.data
  const ollama = p?.ollama
  const kindo = p?.kindo
  const chip = (cls, label, title) => <span className={`prov ${cls}`} title={title}><i className="dot" />{label}</span>
  return [
    chip(ollama?.reachable ? 'on' : p ? 'off' : '', `Ollama${ollama?.reachable ? ` · ${ollama.models.length}` : ''}`, ollama?.reachable ? `${ollama.models.length} local models` : ollama?.error ?? 'checking…'),
    chip(kindo?.reachable ? 'on' : kindo?.configured ? 'off' : p ? 'warn' : '', kindo?.reachable ? `Kindo · ${kindo.models.length}` : 'Kindo', kindo?.reachable ? `${kindo.models.length} models` : kindo?.configured ? `key set, but ${kindo.error}` : 'no key'),
    chip(p?.typesafe?.configured ? 'on' : p ? 'warn' : '', 'TypeSafe', p?.typesafe?.configured ? 'Jev available' : 'no key'),
    chip(state.chrome === 'available' ? 'on' : state.chrome === 'unavailable' ? 'off' : 'warn', 'Chrome AI', `Prompt API: ${state.chrome ?? 'checking…'}`),
  ]
}

function row(state, p) {
  const s = state.providers?.data?.[p.id]
  const draft = state.drafts[p.id]
  return (
    <div className="row">
      <div className="row-head">
        <b>{p.name}</b>
        <small>{s?.configured ? `✓ ${SOURCE[s.source]}` : 'no key'}</small>
      </div>
      {s?.configured && s.error && <p className="key-problem" role="alert">{p.name}: {s.error}</p>}
      <form className="key-form" data={{ provider: p.id }}>
        <input type="password" className="key-input" data={{ provider: p.id }} autocomplete="off" spellcheck={false}
          aria-label={`${p.name} API key`} placeholder={s?.configured ? 'Replace the key…' : 'Paste an API key'} value={draft} />
        <button type="submit" className="btn small" disabled={!draft.trim() || state.saving}>Save</button>
        {s?.source === 'session' && <button type="button" className="btn ghost small forget" data={{ provider: p.id }}>Forget</button>}
      </form>
      <p className="hint">{p.hint} Or put <code>{p.variable}=…</code> in <code>{p.file}</code> and restart the dev server.</p>
    </div>
  )
}

function Header({ state }) {
  return (
    <div id="providers-bar">
      {chips(state)}
      <button type="button" className="keys-btn open-keys">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3 21 2m-4 4 3 3m-6 0 3 3" /></svg>
        Keys
      </button>
      <dialog className="keys" aria-labelledby="keys-title">
        <header>
          <h2 id="keys-title">API keys</h2>
          <p>Keys go to this page's local dev server, which adds them to requests to Kindo and TypeSafe. The page never keeps them, and never gets them back.</p>
        </header>
        <div className="rows">{PROVIDERS.map((p) => row(state, p))}</div>
        {state.error && <p className="keys-error" role="alert">{state.error}</p>}
        <footer>
          <span>Typed keys live in the dev server's memory until it stops. Ollama needs no key.</span>
          <button type="button" className="btn ghost small close-keys">Done</button>
        </footer>
      </dialog>
    </div>
  )
}

Header.initialState = { keysVersion: 0, drafts: { kindo: '', typesafe: '' }, saving: false, error: null, chrome: null }

Header.uses = { keys: dialog({ dialog: '.keys', trigger: '.open-keys', close: '.close-keys' }) }

Header.resources = {
  providers: (state) => ({ url: `/api/providers?v=${state.keysVersion}`, keepPrevious: true }),
}

Header.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.key-input').map((e) => ({ provider: e.target.dataset.provider, value: e.target.value })),
  SAVE: DOM.select('.key-form').events('submit', { preventDefault: true }).map((e) => e.currentTarget?.dataset.provider ?? e.target.dataset.provider),
  FORGET: DOM.click('.forget').data('provider'),
})

/** tell every widget to read the providers again (their pickers listen for it) */
const announce = () => document.dispatchEvent(new CustomEvent('showcase:keys'))

Header.model = {
  BOOTSTRAP: { CHROME: () => ({ ok: 'CHROME_STATUS' }) },
  CHROME_STATUS: (state, chrome) => ({ ...state, chrome }),
  DRAFT: (state, { provider, value }) => ({ ...state, drafts: { ...state.drafts, [provider]: value } }),
  SAVE: {
    STATE: (state, provider) => (state.drafts[provider]?.trim() ? { ...state, saving: true, error: null } : ABORT),
    HTTP: (state, provider) => (state.drafts[provider]?.trim()
      ? { url: '/api/keys', method: 'POST', json: { provider, key: state.drafts[provider] }, ok: 'SAVED', error: 'SAVE_FAILED' }
      : ABORT),
  },
  FORGET: { HTTP: (state, provider) => ({ url: `/api/keys/${provider}`, method: 'DELETE', ok: 'SAVED', error: 'SAVE_FAILED' }) },
  // the key is gone from the page as soon as the server has it
  SAVED: {
    STATE: (state) => ({ ...state, saving: false, drafts: { kindo: '', typesafe: '' }, keysVersion: state.keysVersion + 1 }),
    EFFECT: announce,
  },
  SAVE_FAILED: (state, { error }) => ({ ...state, saving: false, error: error.body?.error ?? error.message }),
}

export const startHeader = (mountPoint) => run(Header, {
  HTTP: makeFetchDriver(),
  CHROME: driverFromAsync(() => ROUTES.chrome.transport.status()),
}, { mountPoint, uid: 'header' })

// An issue tracker for the terminal: tabs, a filtered list longer than the screen with a detail
// pane, a form with validation (text, textarea, checkboxes, radios, a native <select>), a modal
// confirm, keyboard shortcuts, data from a (fake) server with a loading state, and a status bar.
// The views are plain HTML, so the same components run in a browser too.
import { ABORT, Collection, controls, focusWithin, form, keymap, xs } from 'sygnal'
import { tabs, tabsAttrs, disclosure, disclosureAttrs } from 'sygnal/ui'
import { PEOPLE } from './api.js'

export const { Query, Show, NewForm, Confirm } = controls({
  Query: 'input',
  Show: 'select',
  NewForm: 'form',
  Confirm: 'dialog',
})

const SHOW = {
  open: (issue) => !issue.closed,
  closed: (issue) => issue.closed,
  all: () => true,
}
const matches = (q) => (issue) => !q || (issue.title + ' ' + issue.labels.join(' ') + ' ' + issue.assignee).toLowerCase().includes(q.toLowerCase())
export const visible = (state) => state.issues.filter(SHOW[state.show]).filter(matches(state.query))

// ── one row of the list ──────────────────────────────────────────────
export function IssueRow({ state, context }) {
  const selected = context.selectedId === state.id
  return (
    <li className={'issue' + (selected ? ' selected' : '') + (state.closed ? ' closed' : '')} role="option" tabIndex={0} data-id={state.id} aria-selected={selected}>
      <span className="id">#{state.id}</span> <span className={'prio prio-' + state.priority}>{state.priority[0].toUpperCase()}</span> {state.title}
    </li>
  )
}

// the selection follows the focus (a listbox): a click, Tab or j / k focuses a row. The row is the
// item's own element (isolation), so the item tells its parent
IssueRow.intent = ({ DOM }) => ({ PICK: DOM.focus('.issue') })
IssueRow.model = { PICK: { PARENT: (state) => state.id } }

// ── the new-issue form (the form behavior) ───────────────────────────
const issueSchema = {
  '~standard': {
    version: 1,
    vendor: 'tracker',
    validate(v) {
      const issues = []
      if (v.title.trim().length < 3) issues.push({ path: ['title'], message: 'At least 3 characters' })
      if (!v.assignee) issues.push({ path: ['assignee'], message: 'Choose someone' })
      if (!v.bug && !v.feature && !v.docs) issues.push({ path: ['docs'], message: 'Pick at least one label' })
      if (issues.length) return { issues }
      const labels = ['bug', 'feature', 'docs'].filter((l) => v[l])
      return { value: { title: v.title.trim(), body: v.body, labels, priority: v.priority, assignee: v.assignee } }
    },
  },
}
const EMPTY = { title: '', body: '', bug: false, feature: false, docs: false, priority: 'medium', assignee: '' }

export function IssueForm({ state, uid }) {
  const f = state.form.fields
  return (
    <NewForm className="new-issue" noValidate>
      <label for={uid('title')}>Title</label>
      <input id={uid('title')} name="title" value={f.title.value} placeholder="What's wrong?" aria-invalid={f.title.invalid} aria-describedby={uid('title-error')} />
      <p className="error" id={uid('title-error')}>{f.title.error}</p>

      <label for={uid('body')}>Description</label>
      <textarea id={uid('body')} name="body" rows="3" value={f.body.value} />

      <fieldset className="labels">
        <legend>Labels</legend>
        <label><input type="checkbox" name="bug" checked={f.bug.value} /> bug</label>
        <label><input type="checkbox" name="feature" checked={f.feature.value} /> feature</label>
        <label><input type="checkbox" name="docs" checked={f.docs.value} aria-describedby={uid('labels-error')} /> docs</label>
        <p className="error" id={uid('labels-error')}>{f.docs.error}</p>
      </fieldset>

      <fieldset className="priority">
        <legend>Priority</legend>
        {['low', 'medium', 'high'].map((p) => (
          <label><input type="radio" name="priority" value={p} checked={f.priority.value === p} /> {p}</label>
        ))}
      </fieldset>

      <label for={uid('assignee')}>Assignee</label>
      <select id={uid('assignee')} name="assignee" value={f.assignee.value} aria-invalid={f.assignee.invalid} aria-describedby={uid('assignee-error')}>
        <option value="">— choose —</option>
        {PEOPLE.map((p) => <option value={p}>{p}</option>)}
      </select>
      <p className="error" id={uid('assignee-error')}>{f.assignee.error}</p>

      <p className="error" role="alert">{state.form.error}</p>
      <button type="submit" disabled={state.form.submitting}>{state.form.submitting ? 'Saving…' : 'Create issue'}</button>
    </NewForm>
  )
}

IssueForm.uses = {
  form: form(issueSchema, { values: EMPTY, request: { url: '/api/issues', method: 'POST' }, resetOnShow: true }),
}
IssueForm.model = {
  // the created issue goes to the tracker (CHILD.select(IssueForm) there)
  'form.DONE': { PARENT: (state, issue) => issue },
}

// ── the app ──────────────────────────────────────────────────────────
export default function Tracker({ state, uid }) {
  const t = tabsAttrs(state.view, uid)
  const list = visible(state)
  const sel = state.issues.find((x) => x.id === state.selectedId)
  const more = disclosureAttrs(state.more, uid)
  return (
    <main className="tracker">
      <header className="title-bar">
        <h1>Tracker</h1>
        <nav {...t.list} aria-label="Views">
          <button className="tab" {...t.tab('issues')}>Issues</button>
          <button className="tab" {...t.tab('new')}>New issue</button>
          <button className="tab" {...t.tab('help')}>Help</button>
        </nav>
      </header>

      <section className="panel" {...t.panel('issues')}>
        <div className="toolbar">
          <label>Filter <Query value={state.query} placeholder="title, label, person" /></label>
          <label>Show{' '}
            <Show value={state.show}>
              <option value="open">open</option>
              <option value="closed">closed</option>
              <option value="all">all</option>
            </Show>
          </label>
        </div>
        {state.loading && !state.issues.length ? <p className="loading">Loading issues…</p> : (
          <div className="split">
            <ul className="issues" role="listbox" aria-label="Issues">
              <Collection of={IssueRow} from="issues" filter={(x) => SHOW[state.show](x) && matches(state.query)(x)} />
            </ul>
            <article className="detail">
              {sel ? [
                <h2>#{sel.id} {sel.title}</h2>,
                <p className="meta">{sel.closed ? 'closed' : 'open'} · {sel.priority} · @{sel.assignee} · {sel.labels.join(', ')}</p>,
                <button className="more-toggle" {...more.trigger}>{state.more.open ? 'Hide description' : 'Show description'}</button>,
                <pre {...more.panel}>{sel.body}</pre>,
                <div className="actions">
                  <button className="toggle-closed">{sel.closed ? 'Reopen' : 'Close'}</button>
                  <button className="delete">Delete</button>
                </div>,
              ] : <p className="empty">{list.length ? 'Select an issue (j / k).' : 'No issues match.'}</p>}
            </article>
          </div>
        )}
      </section>

      <section className="panel" {...t.panel('new')}>
        <IssueForm state="draft" />
      </section>

      <section className="panel" {...t.panel('help')}>
        <h2>Keys</h2>
        <ul>
          <li><kbd>/</kbd> search · <kbd>n</kbd> new issue · <kbd>r</kbd> reload</li>
          <li><kbd>j</kbd> / <kbd>k</kbd> next / previous issue · <kbd>x</kbd> close or reopen · <kbd>d</kbd> delete</li>
          <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> switch tabs · <kbd>q</kbd> quit</li>
        </ul>
      </section>

      <Confirm className="confirm" aria-label="Confirm">
        <p>Delete #{state.confirmId}? This can't be undone.</p>
        <button className="confirm-ok">Delete</button> <button className="confirm-cancel">Cancel</button>
      </Confirm>

      <footer className="status-bar" role="status">
        <span className="sync">{state.loading ? 'Syncing…' : state.error ? 'Offline: ' + state.error : 'Synced'}</span>
        <span className="counts">{list.length} shown / {state.issues.length}</span>
        <span className="message">{state.message}</span>
      </footer>
    </main>
  )
}

Tracker.initialState = {
  issues: [],
  loading: true,
  error: '',
  query: '',
  show: 'open',
  selectedId: null,
  confirmId: null,
  message: '',
  draft: {},
}
Tracker.uses = {
  view: tabs({ tab: '.tab', selected: 'issues' }),
  more: disclosure({ trigger: '.more-toggle' }),
}
Tracker.context = { selectedId: (state) => state.selectedId }

Tracker.intent = ({ DOM, CHILD }) => {
  const keys = keymap(DOM, {
    '/': 'SEARCH', n: 'NEW', r: 'RELOAD', j: ['STEP', 1], k: ['STEP', -1],
    x: 'TOGGLE_CLOSED', d: 'ASK_DELETE', 1: ['TAB', 'issues'], 2: ['TAB', 'new'], 3: ['TAB', 'help'], q: 'QUIT',
  })
  return {
    ...keys,
    QUERY: DOM.input(Query).value(),
    SHOW: DOM.change(Show).value(),
    SELECT: CHILD.select(IssueRow),
    TOGGLE_CLOSED: xs.merge(keys.TOGGLE_CLOSED, DOM.click('.toggle-closed')),
    ASK_DELETE: xs.merge(keys.ASK_DELETE, DOM.click('.delete')),
    DELETE: DOM.click('.confirm-ok'),
    CANCEL_DELETE: xs.merge(DOM.click('.confirm-cancel'), DOM.close(Confirm)),
    CREATED: CHILD.select(IssueForm),
  }
}

const say = (state, message) => ({ ...state, message })
const patch = (state, id, f) => ({ ...state, issues: state.issues.map((x) => (x.id === id ? f(x) : x)) })

Tracker.model = {
  BOOTSTRAP: { HTTP: () => ({ url: '/api/issues', ok: 'LOADED', error: 'FAILED', latest: true }) },
  RELOAD: {
    STATE: (state) => ({ ...state, loading: true, message: 'Reloading…' }),
    HTTP: () => ({ url: '/api/issues', ok: 'LOADED', error: 'FAILED', latest: true }),
  },
  LOADED: (state, issues) => ({ ...state, issues, loading: false, error: '', message: state.message === 'Reloading…' ? 'Reloaded' : state.message }),
  FAILED: (state, { status }) => ({ ...state, loading: false, error: status ? 'HTTP ' + status : 'no connection' }),

  QUERY: (state, query) => ({ ...state, query }),
  SHOW: (state, show) => ({ ...state, show }),
  SEARCH: {
    STATE: (state) => ({ ...state, view: { ...state.view, selected: 'issues' } }),
    ELEMENT: () => ({ focus: Query }),
  },
  NEW: { ELEMENT: () => ({ focus: '.tab[data-value="new"]' }), STATE: (state) => ({ ...state, view: { ...state.view, selected: 'new' } }) },
  TAB: (state, tab) => ({ ...state, view: { ...state.view, selected: tab } }),
  SELECT: (state, id) => ({ ...state, selectedId: id }),
  STEP: {
    STATE: (state, by) => {
      const list = visible(state)
      if (!list.length) return ABORT
      const i = list.findIndex((x) => x.id === state.selectedId)
      const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + by))]
      return { ...state, selectedId: next.id }
    },
    // (the row is a Collection item's element: focusWithin reaches into children)
    ELEMENT: (state) => ({ focus: focusWithin(`.issue[data-id="${state.selectedId}"]`) }),
  },
  TOGGLE_CLOSED: {
    STATE: (state) => (state.selectedId == null ? ABORT : patch(state, state.selectedId, (x) => ({ ...x, closed: !x.closed }))),
    HTTP: (state) => {
      const x = state.issues.find((i) => i.id === state.selectedId)
      return x ? { url: '/api/issues/' + x.id, method: 'PUT', json: { closed: x.closed }, ok: 'SAVED', error: 'FAILED' } : ABORT
    },
  },
  SAVED: (state, issue) => say(state, `#${issue.id} ${issue.closed ? 'closed' : 'reopened'}`),
  ASK_DELETE: {
    STATE: (state) => (state.selectedId == null ? ABORT : { ...state, confirmId: state.selectedId }),
    ELEMENT: (state) => (state.confirmId == null ? ABORT : { showModal: Confirm }),
  },
  DELETE: {
    STATE: (state) => ({ ...state, issues: state.issues.filter((x) => x.id !== state.confirmId), selectedId: null, confirmId: null }),
    HTTP: (state, _, next, { previousState }) => ({ url: '/api/issues/' + previousState.confirmId, method: 'DELETE', ok: 'DELETED', error: 'FAILED' }),
    ELEMENT: () => ({ close: Confirm }),
  },
  DELETED: (state, { id }) => say(state, `#${id} deleted`),
  CANCEL_DELETE: {
    STATE: (state) => (state.confirmId == null ? ABORT : { ...state, confirmId: null }),
    ELEMENT: () => ({ close: Confirm }),
  },
  CREATED: (state, issue) => ({ ...state, issues: [...state.issues, issue], selectedId: issue.id, show: 'open', query: '', view: { ...state.view, selected: 'issues' }, message: `#${issue.id} created` }),
  QUIT: { TERMINAL: () => 'exit' },
}

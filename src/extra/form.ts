/*
 * PLAN-5 F-1 (D193): the `form` behavior, the canonical form recipe.
 *
 *   Signup.uses = { form: form(signupSchema, {
 *     values: { email: '', password: '', addresses: [{ id: 1, street: '', city: '' }] },
 *     submit: 'SIGN_UP',             // the host action a valid submit dispatches (data: the schema's output)
 *     check: { email: { request: (email) => ({ url: '/api/email-free', query: { email } }), error: (body) => !body.free && 'Taken' } },
 *   }) }
 *
 * 7.2: every function option (the schema function, `values`, `dynamic`, `request`) gets the bag
 * last: the host view's `{ ...props, state, context, uid }` (no children / slots), `state` the
 * host's state. In the intent's sync of `dynamic` / the schema function it has the props and the
 * state only; `values` before the host starts gets the blank state as its bag too.
 *
 * Fields are addressed by their `name=` attribute (the path in `values`; rows of an array by
 * id: `addresses.7.street`), heard on the form element (option `form`, default 'form'): input
 * and focusout bubble to it, also from fields rendered by Collection items. Nothing is wired per
 * field.
 *
 * Options: `values` (the start values; D239: or a function of the host's state, called when the
 * form starts), `submit` (host action), `request` (PLAN-11 F-3: the form sends the valid submit
 * itself on the `http` sink: a request, or `(data, hostState, bag) => request`, completed with the
 * body (`multipart: data` when a top-level value is a File / Blob or an array of them, else
 * `json: data`, unless it sets json / multipart / body), `progress: '<key>.PROGRESS'` for a multipart
 * submit or `progress: true` (a JSON submit stays on fetch: progress goes over XMLHttpRequest)
 * and its own `ok: '<key>.DONE'`, `error: '<key>.ERRORS'`; with `submit` too, that host action is
 * still dispatched (for state), and should send no request), `check` (async per-field checks through a driver: a
 * request with a reply action, `latest`), `show` ('blur' default: a schema error shows once its
 * field was blurred; 'input'; 'submit'), `form` (selector), `http` (the driver sink of the
 * checks, 'HTTP'), `resetOnShow` (D239), `tool` (PLAN-6 A-3, experimental: `formTool({ … })` from
 * 'sygnal/ai', the form as a declarative WebMCP tool; D291: formTool.ts is the app's import, the
 * form only calls its `$(behavior, result)` hook; a plain object is SYG245 from the dev entry).
 *
 * D239 (G-578): `resetOnShow: true` starts the form over (the start values, as a new form: touched,
 * errors, server errors, checks and the submit state cleared) each time it is shown: when its
 * host starts (VALIDATE: a component mounted again, a Switchable page made again for another
 * `instance`, a slice kept in the parent's state) and each time the form element appears again
 * in the host's DOM after being absent (a Switchable page shown again: hidden pages stay alive;
 * a form rendered conditionally). Re-renders while it is shown keep what the user typed. Off by
 * default: a wizard step keeps its values when the user comes back. Without a real DOM (the mock
 * DOM, SSR) only the host start counts. A `values` function is called with the host's state at
 * each start over (without resetOnShow: once, when the host starts with the slice untouched);
 * before that (a child's first render) the fields come from calling it with a blank state.
 *
 * Slice (state.form): values, initial, errors (all current schema errors by name), touched,
 * progress (PLAN-11 F-2: the submit's last progress step or null), resets (counts RESET and
 * resetOnShow starts: key a file input with it, since a file input can't be cleared by state),
 * server (server errors), remote (async check results: '' passed), pending (name -> value being
 * checked), submitting, submitted, submitCount, queued (a submit waits for a check or an async
 * schema), validating (an async schema runs), validated (the schema has answered since the start
 * or the last reset); calculated: fields (per name: { name, value, error, invalid, touched,
 * dirty, pending }; `error` is what to show), valid (G-382: the last answer's, kept while an async
 * schema re-validates), dirty, error (form-level message).
 *
 * Actions: form.CHANGE ({ name, value, item?, order? }: G-376: a checkbox gives `checked`, and `item`, its
 * value, which toggles membership when the field is an array (7.2: kept in document order, `order`
 * being the group's values as rendered); <select multiple> an array of the
 * selected values; PLAN-11 F-2: a file input its File, `multiple` an array of them, none null),
 * form.SET ({ values }: G-647, field name -> value, several
 * fields changed at once as if typed: one validation, `touched` as for CHANGE, unknown names
 * skipped; e.g. an AI fill), form.BLUR (name), form.SUBMIT, form.ADD ({ field,
 * value }), form.REMOVE ({ field, id }), form.ERRORS (an error reply or a map: server errors),
 * form.DONE (saved), form.RESET (values?), form.PROGRESS (PLAN-11 F-2: a progress step of the
 * submit request, `progress: 'form.PROGRESS'`: kept as `progress` while submitting, cleared by
 * DONE / ERRORS / RESET); internal: form.RESULT (an async schema's result),
 * form.CHECKED_<name> (a check's reply; a failed check passes: the server checks on submit),
 * form.VALIDATE (the first validation, when the host starts: G-375; `valid` is false until the
 * schema answered; with resetOnShow also each time the form element appears, D239), form.SYNC
 * (RT-1: the dynamic fields or the schema changed with the host's state).
 *
 * RT-1 (research: dev-plans/research/forms/runtime-fields.md), fields chosen at run time (a form
 * composed from pieces): `dynamic: (hostState) => ({ path: start value })` names fields beyond
 * `values` that follow the host's state. An entry that appears is added to values (and initial)
 * with its start value; one that stays keeps what was typed (a start value that is an object
 * reshapes it: keys it gained added, keys it lost dropped); one that goes loses its touched,
 * server errors, check results and running checks, and its value stays in values (and initial)
 * but is neither validated nor sent (`keepRemoved`, default true, as React Hook Form / TanStack
 * Form: the path in the slice's `kept`; the schema gets the values without the kept ones; an entry
 * that comes back shows it), or with `keepRemoved: false` is removed (and the parents it leaves
 * empty). An entry named after a path of `values` leaves it alone (the static field owns it).
 * RESET / resetOnShow start them over too (kept values gone). The schema can be a function of
 * the host's state, `form((state) => schema, …)`, for rules
 * that depend on what is composed (required-ness): called whenever the form validates, results
 * cached per schema object, so it must return the same schema for the same rules (memoized; a
 * new one for the same state, or one memoized on the whole host state, is SYG239 in dev). The form re-validates (form.SYNC) when the
 * dynamic fields change (structurally) or the schema function returns another schema.
 *
 * G-575 (D236): a valid submit is `submitting` (until form.DONE / form.ERRORS, a second submit
 * dropped) only when the host's submit entry has the `http` sink; any other submit (STATE, PARENT,
 * EVENTS, EFFECT, ...) sends no request and is done at once (submitted, as form.DONE would). A
 * slice kept in parent state from a host that unmounted mid-submit starts unstuck: VALIDATE (each
 * host start) clears submitting, queued and pending.
 *
 * Each action is one step function, `(slice, data, key) => outcome | null` (null: no change),
 * the outcome `{ s: new slice, focus: ELEMENT command, req: a check request, send: 1 (dispatch
 * submit), wait: { values, submit? } (an async schema to await) }`. Its sinks (STATE, EFFECT,
 * ELEMENT, and the checks' driver) read that outcome, computed once per (slice, data). D197:
 * the handlers get the `uses` key, which names the reply actions.
 *
 * Dev diagnostics (checks/forms.ts, through the core bridge's `form` hook; nothing in
 * production): SYG230 a field name not in values, SYG231 not a Standard Schema (throws), SYG232
 * a submit dropped, SYG233 a values key missing from the schema's output, SYG234 a submit that
 * dispatched one of the form's own actions (G-577), SYG235 a check request that sets reply
 * fields. The host checks (SYG234 submit, SYG235 check names, SYG236 row ids)
 * run when the host is created.
 */
import xs from './xstreamCompat'
import {defineBehavior, was} from './behaviors'
import {ABORT, readBag} from '../shared'
import {isStandardSchema} from './standardSchema'
import {FIELD, fieldOf} from './field'
import {checkForm, fieldNames, getField, hasField, setField, replyErrors, focusInvalid, isFile} from './formHelpers'

// PLAN-11 F-3: a submit's data goes as multipart when a top-level value is a file (or files)
const hasFile = (d: any) => !!d && typeof d == 'object' && Object.values(d).some(x => isFile(x) || Array.isArray(x) && x.some(isFile))

const dev = (...a: any[]): any => (globalThis as any).__SYGNAL_DIAGNOSTICS__?.form?.(...a)
const keys = (o: any) => Object.keys(o).filter(k => o[k])
// PLAN-11 F-2: values compared as JSON, a File by identity-ish fields (JSON gives every File {})
const fileIds = new WeakMap<object, number>()
let fileSeq = 0
const json = (v: any) => JSON.stringify(v, (_k, x) => isFile(x) ? `\0file:${fileIds.get(x) ?? (fileIds.set(x, ++fileSeq), fileSeq)}` : x)
const drop = (o: any, p: string) => {
  const r: any = {}
  for (const k in o) if (k != p && !k.startsWith(p + '.')) r[k] = o[k]
  return r
}

// RT-1: a dynamic entry's value shaped by its start value: a plain object keeps the keys of the
// start (what was typed in them kept), gains its new ones, loses the rest; any other value is kept.
// The same object when nothing changes
const plain = (x: any) => !!x && typeof x == 'object' && Object.getPrototypeOf(x) == Object.prototype
const shape = (cur: any, start: any): any => {
  if (!plain(start) || !plain(cur)) return cur === undefined ? start : cur
  let same = Object.keys(cur).length == Object.keys(start).length
  const r: any = {}
  for (const k in start) same = (r[k] = k in cur ? shape(cur[k], start[k]) : start[k]) === cur[k] && k in cur && same
  return same ? cur : r
}
const fit = (vals: any, n: string, start: any) => setField(vals, n, shape(hasField(vals, n) ? getField(vals, n) : undefined, start))
// a path removed from values (object keys; the same object when it isn't there), with the
// parents the removal left empty (`keep`: a parent path that stays, a static field)
const unset = (o: any, n: string, keep: (p: string) => any = () => 0, at = ''): any => {
  const [a, ...r] = n.split('.'), p = at ? at + '.' + a : a
  if (!plain(o) || !(a in o)) return o
  const c = {...o}, x = r.length ? unset(o[a], r.join('.'), keep, p) : c
  if (x === o[a]) return o
  r.length && (Object.keys(x).length || keep(p)) ? c[a] = x : delete c[a]
  return c
}
// RT-1: a field at or under one of the kept paths (a dynamic entry that went, its value kept)
const under = (n: string, kept: any) => { for (const p in kept) if (n == p || n.startsWith(p + '.')) return true; return false }
// a map by field name without the kept paths' names (the same object when it has none)
const hide = (m: any, kept: any) => {
  let r = m
  for (const n in m) if (under(n, kept)) r === m && (r = {...m}), delete r[n]
  return r
}
// a map by field name without the names that are no fields of vals ('' stays: form-level)
const prune = (m: any, vals: any) => {
  let r = m
  for (const n in m) if (n && !hasField(vals, n)) r === m && (r = {...m}), delete r[n]
  return r
}

// G-376: a checkbox (native, or a hyphenated tag with a boolean `checked`: a form-associated
// custom checkbox / switch) gives `checked` and its value as `item`; a <select multiple> the
// selected values; PLAN-11 F-2: a file input its File (`multiple`: an array of them; none: null);
// others give `value`
const box = (t: any) => t.type == 'checkbox' || /-/.test(t.tagName) && typeof t.checked == 'boolean'
// 7.2: a checkbox's `order` is its group's values in document order (its form's controls, so
// form="id" ones too; a host form's descendants), so an array field keeps FormData's order
const order = (t: any) => [...(t.form?.elements || t.closest?.('form')?.querySelectorAll?.('*') || [t])]
  .filter((b: any) => b.name == t.name && box(b)).map((b: any) => b.value)
const native = (t: any) =>
  t.type == 'file' ? {name: t.name, value: t.multiple || t.getAttribute?.('multiple') != null ? [...(t.files || [])] : t.files?.[0] ?? null, file: true}
  : box(t) ? {name: t.name, value: t.checked, item: t.value, order: order(t)}
  : {name: t.name, value: t.type == 'select-multiple' ? [...t.selectedOptions].map((o: any) => o.value) : t.value}

export const form = (schema: any, o: any = {}): any => {
  // RT-1: a function that isn't itself a Standard Schema (arktype's are callable) is the schema of the host's state
  const sfn = !isStandardSchema(schema) && typeof schema == 'function'
  sfn || isStandardSchema(schema) || dev(231, schema)
  const {values: vo = {}, submit, request: rq, check: checks = {}, show = 'blur', http = 'HTTP', form: sel = 'form', resetOnShow: again, dynamic: dyn, keepRemoved: kr = true} = o
  // D239: `values` can be a function of the host's state, called when the form starts (and each
  // show, resetOnShow). Before that (the host's first render, before its first action) the
  // fields come from calling it with a blank state: every read gives '' in the result
  const fn = typeof vo == 'function', B: any = new Proxy(() => B, {get: (_, k) => k == Symbol.toPrimitive ? () => '' : B})
  const clean = (x: any): any => x === B ? '' : Array.isArray(x) ? x.map(clean) : x && typeof x == 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, clean(y)])) : x
  let values: any = vo
  if (fn) try { values = clean(vo(B, B)) } catch (_) { values = {} }
  const cache = new WeakMap(), seen = new WeakMap(), checked = Object.keys(checks)
  // G-575: a submit is pending (until form.DONE / form.ERRORS) only when the host's submit entry
  // sends a request on the `http` sink; any other submit is done once its entry has run. Set when
  // the form merges into its host
  let req = true
  // 7.2: the props of the handler running (its 4th argument): a function option's bag is
  // readBag(P, h), the host's view bag (P is set by every model entry before its step runs)
  let P: any
  const bag = (h: any) => readBag(P, h, 'form')
  // the schema for the host state h and bag (RT-1: a schema function's, checked once per schema it returns)
  const sOf = (h: any, g = bag(h)) => {
    if (!sfn) return schema
    const x = schema(h, g)
    cache.has(x) || isStandardSchema(x) || dev(231, x)
    return x
  }
  // the schema's result, once per (schema, values object); an async one replaces its Promise when
  // it settles. `seen`: the last result per values object (for formTool's answer)
  const v = (vals: any, sc: any): any => {
    let m = cache.get(sc), r = m?.get(vals)
    m || cache.set(sc, m = new WeakMap())
    if (!r) {
      m.set(vals, r = checkForm(sc, vals))
      r.then?.((x: any) => (m.set(vals, x), seen.set(vals, x)))
    }
    seen.set(vals, r)
    return r
  }
  // G-379: a field is a path of values (an undefined value too); `quiet`: no SYG230 (a focusout
  // from a named button)
  const known = (s: any, n: any, quiet?: any) => {
    const k = n && hasField(s.values, n)
    n && !k && !quiet && dev(230, n, s.values)
    return k
  }
  // new values: errors now (sync schema), or after the schema's Promise (RESULT; `submit`: for a
  // queued submit). h: the host state (the schema's, RT-1)
  const edit = (s: any, vals: any, x: any, h: any, submit?: any) => {
    const sc = sOf(h), i = shown(vals, {...s, ...x}.kept), r = v(i, sc), a = !!r.then
    return {s: {...s, ...x, values: vals, validating: a, ...(!a && {errors: r.errors, validated: true})}, wait: a && {values: vals, input: i, schema: sc, submit}}
  }
  // the first check due: no schema error, a value, and not checked or running for it
  const due = (s: any, only?: string) => checked.find(f => {
    const x = getField(s.values, f)
    return (!only || f == only) && !under(f, s.kept) && !s.errors[f] && x !== '' && x != null && !(f in s.pending) && !(f in s.remote)
  })
  const ask = (s: any, f: string, k: string, queued: boolean) => {
    const x = getField(s.values, f), q = checks[f].request(x), ok = `${k}.CHECKED_${f}`
    dev(235, f, q)
    return {s: {...s, queued, pending: {...s.pending, [f]: x}}, req: {...q, ok, error: ok, latest: true}}
  }
  // a submit with s's errors: blocked (focus the first), a check to run or to wait for, or sent
  const attempt = (s: any, k: string) => {
    const bad = [...keys(s.errors), ...keys(s.remote)], f = due(s)
    return bad.length ? {s: {...s, queued: false}, focus: focusInvalid(bad, sel)}
      : f ? ask(s, f, k, true)
      : Object.keys(s.pending).length ? {s: {...s, queued: true}}
      : {s: req ? {...s, queued: false, submitting: true} : done({...s, queued: false}), send: 1}
  }
  const base = (vals: any, resets = 0, added = {}) => ({initial: vals, values: vals, touched: {}, server: {}, remote: {}, pending: {},
    submitting: false, submitted: false, submitCount: 0, queued: false, errors: {}, validated: false, progress: null, resets, added, kept: {}})
  // RT-1: a path of the static values (the `values` option's): a dynamic entry of that name
  // neither reshapes nor removes it
  const own = (n: string) => hasField(values, n)
  // RT-1: the dynamic entries `a` into values
  const grow = (vals: any, a: any) => {
    for (const n in a) own(n) || (vals = fit(vals, n, a[n]))
    return vals
  }
  // RT-1: vals without the kept paths (and the parents that leaves empty)
  const strip = (vals: any, kept: any) => {
    for (const n in kept) vals = unset(vals, n, own)
    return vals
  }
  // what the schema validates and a submit sends: the values without the kept ones (the fields on
  // the form, as with keepRemoved false), the same object per (values, kept)
  const bare = new WeakMap()
  const shown = (vals: any, kept: any) => {
    if (!kept || !Object.keys(kept).length || !vals || typeof vals != 'object') return vals
    const m = bare.get(vals)
    return m?.[0] === kept ? m[1] : (bare.set(vals, [kept, strip(vals, kept)]), bare.get(vals)[1])
  }
  // a start over (RESET, resetOnShow; `n`: counted in `resets`, so a file input keyed by it is
  // made anew), with the dynamic fields of the slice s at their start values (kept values gone)
  const fresh = (vals: any, s: any, h: any, n?: any) => {
    const a = s.added || {}
    vals = grow(strip(vals, s.kept), a)
    return edit(base(vals, (s.resets || 0) + (n ? 1 : 0), a), vals, 0, h)
  }
  const done = (s: any) => ({...s, submitting: false, submitted: true, initial: s.values, server: {}, touched: {}, progress: null})
  // 7.2: the group's values in document order (`order`, from the DOM), as FormData and
  // processForm; values no rendered box has (a filtered list) keep their places
  const group = (cur: any, d: any) => {
    if (!Array.isArray(cur) || !('item' in d)) return d.value
    const r = cur.filter(x => x !== d.item), a = d.value ? [...r, d.item] : r, o = d.order
    if (!Array.isArray(o)) return a
    const at = (x: any) => o.indexOf(x), slots = a.map((x, i) => at(x) < 0 ? -1 : i).filter(i => i >= 0)
    const sorted = slots.map(i => a[i]).sort((x, y) => at(x) - at(y))
    slots.forEach((i, j) => { a[i] = sorted[j] })
    return a
  }

  // fields changed as typed ones ([name, value] pairs; unknown names skipped, SYG230): their
  // server errors, check results and running checks go, `touched` as show 'input' says; one validation
  const put = (s: any, d: any[], h: any, quiet?: any) => {
    let vals = s.values, server = drop(s.server, ''), remote = s.remote, pending = s.pending, touched = s.touched
    for (const [n, y] of d) if (known(s, n, quiet)) {
      vals = setField(vals, n, y), server = drop(server, n), remote = drop(remote, n), pending = drop(pending, n)
      if (show == 'input') touched = {...touched, [n]: true}
    }
    return vals != s.values ? edit(s, vals, {server, remote, pending, touched, queued: false}, h) : null
  }

  const steps: Record<string, (s: any, d: any, k: string, h?: any) => any> = {
    // G-376: a checkbox (`item`: its value) on an array field is one of a group: checked adds
    // its value, unchecked removes it
    // PLAN-11 F-2: a file input whose name isn't in values is left alone, quietly (an app that reads
    // its files in its own intent, as before 6.7)
    CHANGE: (s, d, _k, h) => put(s, d?.name ? [[d.name, group(getField(s.values, d.name), d)]] : [], h, d?.file),
    BLUR: (s, n, k) => {
      if (!known(s, n, 1)) return null
      const t = show == 'submit' || s.touched[n] ? s.touched : {...s.touched, [n]: true}, x = {...s, touched: t}
      return due(s, n) ? ask(x, n, k, s.queued) : t != s.touched ? {s: x} : null
    },
    SUBMIT: (s, _, k, h) => {
      if (s.submitting || s.queued) return void dev(232, s)
      const n = {...s, submitCount: s.submitCount + 1}, sc = sOf(h), i = shown(s.values, s.kept), r = v(i, sc)
      // G-371: a submit waiting for an async schema is queued (a second one is dropped)
      return r.then ? {s: {...n, validating: true, queued: true}, wait: {values: s.values, input: i, schema: sc, submit: 1}} : attempt({...n, errors: r.errors}, k)
    },
    // (a result for other values or kept paths, or for a schema the host state no longer gives, is stale)
    RESULT: (s, d, k, h) => {
      if (d.values !== s.values || d.input !== shown(s.values, s.kept) || d.schema !== sOf(h)) return
      const n = {...s, errors: v(d.input, d.schema).errors, validating: false, validated: true}
      // the submit it was queued for (G-575: a done local submit isn't `submitting`, so not that)
      return d.submit && s.queued ? attempt(n, k) : {s: n}
    },
    ADD: (s, {field, value}, _k, h) => {
      const rows = getField(s.values, field) || []
      return edit(s, setField(s.values, field, [...rows, {id: rows.reduce((m: number, r: any) => Math.max(m, +r.id || 0), 0) + 1, ...value}]), 0, h)
    },
    REMOVE: (s, {field, id}, _k, h) => {
      const p = field + '.' + id
      return edit(s, setField(s.values, field, getField(s.values, field).filter((r: any) => r.id + '' != id)),
        {touched: drop(s.touched, p), server: drop(s.server, p)}, h)
    },
    // G-647: several fields at once ({ values: { name: value } }, names as in CHANGE), as if typed
    SET: (s, d, _k, h) => put(s, Object.entries(d?.values || {}), h),
    ERRORS: (s, d) => {
      const e = replyErrors(d, s.values)
      return {s: {...s, server: e, submitting: false, queued: false, progress: null}, focus: focusInvalid(e, sel)}
    },
    DONE: (s) => ({s: done(s)}),
    // PLAN-11 F-2: a progress step of the submit's request (`progress: 'form.PROGRESS'`), while it is pending
    PROGRESS: (s, d) => s.submitting && d && typeof d == 'object'
      ? {s: {...s, progress: {phase: d.phase, loaded: d.loaded, total: d.total ?? null, fraction: d.fraction ?? null}}} : null,
    // PLAN-11: only a plain object is new values (a click event from `DOM.click('.reset')` is not)
    RESET: (s, d, _k, h) => fresh(d && typeof d == 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(d)) ? d : s.initial, s, h, 1),
    // G-375: the first validation, when the host starts (form() doesn't validate at module load).
    // G-575: a slice kept in parent state from a host that unmounted mid-submit starts unstuck.
    // D239: with resetOnShow (also each time the form element appears again), or a `values`
    // function not called yet, the slice starts over from the start values (h: the host state)
    VALIDATE: (s, _, _k, h) => again || fn && s.values === values ? fresh(fn ? vo(h, bag(h)) : vo, s, h, again)
      : edit({...s, submitting: false, queued: false, pending: {}, progress: null}, s.values, 0, h),
    // RT-1: the dynamic fields (data: { fields }, `dynamic(hostState)`) or the schema changed: entries
    // added, reshaped or gone (their touched, server errors and checks with them; the value kept,
    // `kept`, or removed: keepRemoved false), then a validation; no change when nothing moved and
    // the schema answers the same
    SYNC: (s, d, _k, h) => {
      const a = d?.fields || {}, had = s.added || {}
      // a `values` function not called yet (VALIDATE): the entries are kept for its start (fresh)
      if (fn && s.values === values) return json(a) != json(had) ? {s: {...s, added: a}} : null
      let vals = s.values, init = s.initial, kept = s.kept || {}
      for (const n in had) if (!(n in a) && !own(n)) kr ? kept = {...kept, [n]: true} : (vals = unset(vals, n, own), init = unset(init, n, own))
      // an entry back (or one over a kept path): its kept value is what it shows
      for (const p in kept) if (Object.keys(a).some(n => under(p, {[n]: 1}))) kept === s.kept && (kept = {...kept}), delete kept[p]
      vals = grow(vals, a), init = grow(init, a)
      const x = edit(s, vals, {initial: init, added: a, kept, touched: hide(prune(s.touched, vals), kept), server: hide(prune(s.server, vals), kept),
        remote: hide(prune(s.remote, vals), kept), pending: hide(prune(s.pending, vals), kept)}, h, s.queued)
      return x.wait || vals != s.values || init != s.initial || json(a) != json(had) || json(x.s.errors) != json(s.errors) ? x : null
    },
  }
  // a check's reply (ok and error: an error reply carries an Error and passes)
  for (const f of checked) steps['CHECKED_' + f] = (s, d, k) => {
    if (!(f in s.pending)) return
    const n = {...s, pending: drop(s.pending, f), remote: {...s.remote, [f]: d?.error instanceof Error ? '' : checks[f].error?.(d) || ''}}
    return s.queued ? attempt(n, k) : {s: n}
  }

  // PLAN-11 F-3: the `request` option's request for a valid submit (data: the schema's output)
  const send = (vals: any, h: any, k: string, pre: any) => {
    const data = v(vals, sOf(pre)).value, q = typeof rq == 'function' ? rq(data, h, bag(h)) : rq
    if (!q || q === ABORT) return ABORT
    // progress (over XMLHttpRequest) only for an upload or when asked (`progress: true`): a JSON submit stays on fetch
    const own = 'json' in q || 'multipart' in q || 'body' in q, up = own ? 'multipart' in q : hasFile(data)
    return {...(!own && (up ? {multipart: data} : {json: data})), ...up && {progress: `${k}.PROGRESS`}, ...q, ...q.progress === true && {progress: `${k}.PROGRESS`}, ok: `${k}.DONE`, error: `${k}.ERRORS`}
  }

  const model: any = {}
  // the host state before the action (STATE gets it as props.state, outputs as props.previousState)
  const pre = (p: any) => p?.previousState || p?.state
  for (const a in steps) {
    let last: any[] = []
    // one step per (slice, data, host state): STATE's and its outputs'
    const out = (s: any, d: any, k: string, h: any) => last[0] === s && last[1] === d && last[2] === h ? last[3] : (last = [s, d, h, steps[a](s, d, k, h)])[3]
    model[a] = {
      // VALIDATE: on the host's state (HOST), for a `values` function; the slice's own steps on it
      ...a == 'VALIDATE' ? {HOST: (h: any, d: any, _n: any, p: any, _o: any, k: string) => { P = p; const x = out(h[k], d, k, h); return x ? {...h, [k]: x.s} : h }}
        : {STATE: (s: any, d: any, _n: any, p: any, _o: any, k: string) => (P = p, out(s, d, k, p?.state)?.s || ABORT)},
      // outputs share STATE's transition: computed from the slice before the action
      EFFECT: (s: any, d: any, next: any, p: any, _o: any, k: string) => {
        s = was(s, p, k), P = p
        const h = pre(p), x = out(s, d, k, h), w = x?.wait
        if (x?.send) {
          const i = shown(x.s.values, x.s.kept), r = v(i, sOf(h)).value
          dev(233, i, r)
          // G-577: a submit named after one of the form's own actions goes to that one
          submit in steps && dev(234, submit, k, b)
          // PLAN-11 F-3: with `request`, `submit` is optional (dispatched for state when given)
          if (submit !== undefined || !rq) next(submit, r, 0)
        }
        w && Promise.resolve(v(w.input, w.schema)).then(() => next('RESULT', w, 0))
      },
      ELEMENT: (s: any, d: any, _n: any, p: any, _o: any, k: string) => (P = p, out(was(s, p, k), d, k, pre(p))?.focus || ABORT),
      // the checks' requests, and (PLAN-11 F-3) the `request` option's for a valid submit; the
      // step from the slice before the action (7.0: outputs get the updated one), the host state as committed
      ...((checked.length || rq) && {[http]: (s: any, d: any, _n: any, p: any, _o: any, k: string) => {
        P = p
        const x = out(was(s, p, k), d, k, pre(p))
        return x?.req || (x?.send && rq ? send(shown(x.s.values, x.s.kept), p?.state, k, pre(p)) : ABORT)
      }}),
    }
  }

  const b = defineBehavior({
    form: schema,
    // validating until VALIDATE (sync) or its RESULT (async): not valid yet (G-375, not validated)
    initialState: {...base(values), validating: true},
    intent: ({DOM, props$}: any, _o: any, k: any, host: any) => {
      const f = DOM.select(sel)
      // (7.2: here the bag is the host's state and, for a sub-component host, its props, again when
      // they change; no context or uid: those reach the handlers' bags only)
      const B$ = props$ ? xs.combine(host.stream, props$).map(([h, p]: any) => ({...p, state: h})) : host.stream.map((h: any) => ({state: h}))
      let on = 0, pf: any, ps: any, ph: any, pg: any, n = 0
      return {
        // RT-1: the dynamic fields and the schema, from the host's state: form.SYNC when the fields
        // change (structurally) or the schema function returns another schema
        ...(dyn || sfn) && host && {SYNC: B$.map((g: any) => {
          const h = g.state, fields = dyn ? dyn(h, g) || {} : {}, f = json(fields), sc = sOf(h, g)
          // SYG239 (dev): another schema for the same state (called again, the first time only), or
          // for a state that differs only in the form's slice with the same values (memoized on
          // the whole host state: a new schema per state change)
          sfn && dev(239, () => !n++ ? schema(h, g) !== sc
            : sc !== ps && h?.[k]?.values === ph?.[k]?.values && Object.keys({...h, ...ph}).every(x => x == k || h[x] === ph[x])
              && Object.keys({...g, ...pg}).every(x => x == 'state' || g[x] === pg[x]))
          const r = f !== pf || sc !== ps
          pf = f, ps = sc, ph = h, pg = g
          return r && {fields}
        }).filter((x: any) => x)},
        // D239: resetOnShow also starts over each time the form element appears again (a
        // Switchable page shown again: hidden pages stay alive; a form rendered again)
        VALIDATE: again ? xs.merge(xs.of(0), f.elements().filter((e: any) => { const r = e.length && !on; on = e.length; return r })) : xs.of(0),
        // the widget field contract (extra/field.ts): a field widget's host fires a FIELD input for
        // its value; other input events on or inside the host (its own nameless controls) don't count
        CHANGE: f.events('input').map((e: any) => {
          const t = e.target, w = fieldOf(t)
          return !w ? native(t) : t.__sw == w ? e[FIELD] && {name: w.f().name, value: w.f().value} : t.name && native(t)
        }).filter((c: any) => c),
        // a field widget is touched when the focus leaves its host (not when it moves inside it)
        BLUR: f.events('focusout').map((e: any) => {
          const w = fieldOf(e.target)
          return !w ? e.target.name : w.h.contains(e.relatedTarget) ? null : w.f().name
        }).filter((n: any) => n !== null),
        SUBMIT: f.events('submit', {preventDefault: true}),
      }
    },
    model,
    calculated: {
      fields: (s: any) => {
        const out: any = {}
        for (const n of fieldNames(s.values)) {
          const value = getField(s.values, n)
          const error = s.server[n] || s.remote[n] || ((s.submitCount || show != 'submit' && s.touched[n]) && s.errors[n]) || ''
          out[n] = {name: n, value, error, invalid: !!error, touched: !!s.touched[n], dirty: value !== getField(s.initial, n), pending: n in s.pending}
        }
        return out
      },
      // G-382: an async schema re-validating keeps the last answer's validity (no flicker)
      valid: (s: any) => s.validated && !keys(s.errors).length && !keys(s.remote).length,
      dirty: (s: any) => json(s.values) != json(s.initial),
      error: (s: any) => s.server[''] || (s.submitCount && s.errors['']) || '',
    },
  })({...o, values}), merge = b.merge
  // PLAN-6 A-3 (D291): a formTool() patches the behavior (formTool.ts); v: the schema's result for
  // the slice (RT-1: a schema function's result is the one the submit validated with)
  o.tool?.$?.(b, (s: any) => { const i = shown(s.values, s.kept); return seen.get(i) || (sfn ? {errors: {}} : v(i, schema)) })
  b.merge = (c: any, k: string) => {
    const e = c.model?.[submit]
    req = !!rq || !!e && typeof e == 'object' && http in e
    merge(c, k)
  }
  return b
}

import {warn} from './diagnostics/legacy';

/*
 * PLAN-4 GS-5 (D114): state persistence for the root component, as a helper value:
 *
 *   TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate })
 *
 * The core has no persistence code: a root component calls `persist.setup(this)` once, in its
 * constructor (src/component.ts); an app that never imports persist() pays 0 B.
 *
 * - Stored as JSON `{ version, state }` under `key`; `state` has the picked top-level keys
 *   (`pick`), or all but `omit` and the calculated fields.
 * - Restore: a synchronous read before INITIALIZE, merged into initialState, so the restore is
 *   part of the initial-state action. A stored `version` other than `version` (default 1) goes
 *   through `migrate(old, fromVersion)`; without migrate, or when it returns nothing, the entry
 *   is ignored. `hydrate: true` (an app hydrating server HTML) restores in a RESTORE action after
 *   the first state instead, so the first render matches the server's.
 * - Writes: debounced (`debounceMs`, default 100), skipped when the stored text is the same,
 *   flushed on `pagehide` and on dispose.
 * - `PERSIST: { clear: true }` on any model entry (a value or a function of (state, data)) removes
 *   the stored copy; the state that same action produces isn't written (later changes are).
 *   The entry's PERSIST sink is turned into an EFFECT here, so it needs no driver.
 * - `sync: true`: another tab's write is applied through RESTORE (the `storage` event, or an
 *   adapter's `subscribe(fn)`).
 * - `storage`: 'local' (default), 'session', or a synchronous { getItem, setItem, removeItem }
 *   adapter (optionally with subscribe). renderComponent passes its fake stores as the
 *   `__storage` source ({ local, session, f: flush functions t.settle() calls }).
 * - Failures (unreadable entry, migrate throws, quota) are SYG642 (warn, printed in production
 *   too); the app continues on initialState / unsaved.
 */
const g: any = globalThis;

export const setupPersist = (c: any, o: any): void => {
  const {key, pick, omit, version = 1, migrate, sync, hydrate, debounceMs = 100} = o;
  const env = c.sources.__storage, calc = c.calculated || {};
  let S: any, t: any, last: any, raw: any, skip: any, off: any;
  // (the docs link the message ends with explains the causes and fixes)
  const fail = (what: string, e?: any) => warn('SYG642', c, `persist '${key}': ${what} failed`, undefined, e);
  const only = (s: any) => {
    const out: any = {};
    for (const k in s) if ((pick ? pick.includes(k) : !omit?.includes(k)) && !(k in calc)) out[k] = s[k];
    return out;
  };
  const read = (r: any) => {
    try {
      if (r == null) return;
      const {version: v = 1, state} = JSON.parse(r), s = v === version ? state : migrate && migrate(state, v);
      return s && only(s);
    } catch (e) { fail('restore', e); }
  };
  const write = () => {
    clearTimeout(t); t = 0;
    const r = JSON.stringify({version, state: only(last)}), p = raw;
    if (r != raw) try { raw = r; S.setItem(key, r); } catch (e) { raw = p; fail('save', e); }
  };
  const clear = () => {
    clearTimeout(t); t = 0; skip = 1; raw = null;
    setTimeout(() => skip = 0);
    try { S?.removeItem(key); } catch (e) { fail('clear', e); }
  };
  const send = (d: any) => d && c.action$.shamefullySendNext({type: 'RESTORE', data: d});
  // PERSIST sinks become EFFECTs (no driver); a model RESTORE entry replaces the built-in one
  const wrap = (p: any, e?: any) => (...a: any[]) => { const r = e?.(...a), v = typeof p == 'function' ? p(...a) : p; v?.clear && clear(); return r; };
  const model: any = {RESTORE: (s: any, d: any) => ({...s, ...d})};
  for (const k in c.model) {
    let v = c.model[k];
    const [a, s] = k.split('|');
    if (s?.trim() == 'PERSIST') { model[a.trim() + '|EFFECT'] = wrap(v); continue; }
    if (v && typeof v == 'object' && 'PERSIST' in v) { const {PERSIST, ...rest} = v; v = {...rest, EFFECT: wrap(PERSIST, rest.EFFECT)}; }
    model[k] = v;
  }
  c.model = model;
  try { S = typeof o.storage == 'object' ? o.storage : (env || g)[(o.storage || 'local') + (env ? '' : 'Storage')]; } catch (_) {}
  if (!S) return;
  try {
    raw = S.getItem(key);
    if (!hydrate) { const r = read(raw); if (r) c.initialState = {...c.initialState, ...r}; }
  } catch (e) { fail('restore', e); }
  const state$ = c.sources[c.stateSourceName].stream;
  let first = 1;
  const L = {next: (s: any) => {
    last = s;
    // the initial state (restored or not) isn't written back. hydrate: it is the server's; restore
    // once it has rendered (the DOM driver patches before this listener hears the vtree)
    if (first) {
      first = 0;
      let once = hydrate;
      const v$ = c.vdom$, l = {next: () => once && setTimeout(() => (v$.removeListener(l), send(read(raw))), once = 0)};
      return hydrate && v$.addListener(l);
    }
    if (!skip) clearTimeout(t), t = setTimeout(write, debounceMs);
  }};
  state$.addListener(L);
  const flush = () => t && write();
  const onSync = (k: any, v: any) => { if (k == key && v != raw) send(read(raw = v)); };
  const onStorage = (e: any) => (!e.storageArea || e.storageArea == S) && onSync(e.key, e.newValue);
  if (sync) off = S.subscribe ? S.subscribe(onSync) : (g.addEventListener?.('storage', onStorage), () => g.removeEventListener?.('storage', onStorage));
  g.addEventListener?.('pagehide', flush);
  env?.f.add(flush);
  c._dispose$.addListener({next: () => {
    flush();
    state$.removeListener(L);
    off?.();
    g.removeEventListener?.('pagehide', flush);
    env?.f.delete(flush);
  }});
};

/**
 * `App.persist = persist({ key, pick | omit, version, migrate, storage, sync, hydrate, debounceMs })`:
 * the root component's state, saved to localStorage (or sessionStorage, or an adapter) and
 * restored at startup. Only an app that imports it pays for it.
 */
export const persist = (o: any) => ({options: o, setup: (c: any) => setupPersist(c, o)});

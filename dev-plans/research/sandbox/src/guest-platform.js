// The platform a bare QuickJS context lacks (timers, console, microtasks), on the host's
// capabilities. Its own module so it runs before the core's modules load.
const H = globalThis.__host
const G = globalThis
G.queueMicrotask ||= (f) => { Promise.resolve().then(f) }
export const timers = new Map()
let timerSeq = 0
G.setTimeout = (f, ms) => { const id = ++timerSeq; timers.set(id, f); H.timer(id, +ms || 0); return id }
G.clearTimeout = (id) => { if (timers.delete(id)) H.clearTimer(id) }
// the core's macrotask hop (runtime.ts macro(): setImmediate when there is one): its own channel,
// so a component's timers can't starve it
G.setImmediate = (f) => { const id = ++timerSeq; timers.set(id, f); H.timer(id, -1); return id }
G.setInterval = (f, ms) => { const tick = () => { id = G.setTimeout(tick, ms); f() }; let id = G.setTimeout(tick, ms); return () => G.clearTimeout(id) }
G.requestAnimationFrame = (f) => G.setTimeout(() => f(Date.now()), 16)
const fmt = (a) => a.map(x => typeof x == 'string' ? x : x instanceof Error ? `${x.name}: ${x.message}` : (() => { try { return JSON.stringify(x) } catch { return String(x) } })()).join(' ')
G.console = {log: (...a) => H.log('log', fmt(a)), info: (...a) => H.log('log', fmt(a)), warn: (...a) => H.log('warn', fmt(a)), error: (...a) => H.log('error', fmt(a)), debug: () => {}}


// A page with one sandboxed counter in each tier (the guest source is precompiled CommonJS: the
// app's compile step is its own business). window.__sandbox reports for a browser check.
import kernel from 'sygnal/sandbox/kernel?raw'
import { createSandbox } from 'sygnal/sandbox'

const source = `
var h = __h;
function Counter(p) { return h('div', null, h('button', { className: 'inc' }, '+'), h('span', { className: 'n' }, String(p.state.n))) }
Counter.initialState = { n: 0 };
Counter.intent = function (s) { return { INC: s.DOM.select('.inc').events('click') } };
Counter.model = { INC: { STATE: function (s) { return { n: s.n + 1 } }, EVENTS: function (s) { return { type: 'COUNT', data: s.n } } } };
module.exports.default = Counter;`
const COUNT = { '~standard': { version: 1, vendor: 'app', validate: (v) => (typeof v == 'number' ? { value: v } : { issues: [{ message: 'a number' }] }) } }

window.__sandbox = { kernelBytes: kernel.length, emits: [], errors: [] }
for (const isolation of ['worker', 'thread']) {
  const box = document.createElement('section')
  box.className = isolation
  document.getElementById('app').appendChild(box)
  const sb = createSandbox({
    kernel, source, container: box, isolation, emits: { COUNT },
    onEmit: (e) => window.__sandbox.emits.push(isolation + ':' + e.data),
    onError: (e) => window.__sandbox.errors.push(isolation + ':' + e.reason + ':' + e.message),
  })
  sb.ready.then(() => { window.__sandbox[isolation] = 'ready' }, (e) => { window.__sandbox[isolation] = 'failed: ' + e.message })
}

// a loop over a slow builtin, which the in-thread deadline can't stop (README finding 2): the
// worker tier's watchdog terminates it while the page's own timers keep ticking
window.__sandboxHostile = () => new Promise((done) => {
  const box = document.createElement('section')
  document.getElementById('app').appendChild(box)
  let ticks = 0
  const iv = setInterval(() => ticks++, 10)
  const t0 = performance.now()
  const sb = createSandbox({
    kernel, container: box, emits: {}, limits: { hardMs: 300 },
    source: `var o = []; for (var i = 0; i < 1e4; i++) o.push({ i: i, s: 'x'.repeat(50) });
      function P() { return __h('button', { className: 'b' }, 'go') }
      P.intent = function (s) { return { GO: s.DOM.select('.b').events('click') } };
      P.model = { GO: function () { for (;;) JSON.parse(JSON.stringify(o)) } };
      module.exports.default = P;`,
    onError: (e) => { clearInterval(iv); done({ reason: e.reason, ms: performance.now() - t0 - boot, ticks }) },
  })
  let boot = 0
  sb.ready.then(() => { boot = performance.now() - t0; setTimeout(() => box.querySelector('.b').click(), 20) })
})

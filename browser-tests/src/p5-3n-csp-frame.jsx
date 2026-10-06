// PLAN-5 3-N G-498: runs inside p5-3n-csp.html (CSP style-src 'self', loaded in an iframe by
// tests/fixes-p5-3n.jsx). An unbounded <VirtualCollection> (the "grows" probe runs on every
// measure) under ancestors with inline styles set through the CSSOM: after the probe, each
// ancestor's style is as it was and no CSP violation was reported.
import { run, VirtualCollection } from 'sygnal'

const violations = []
document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective + ' ' + (e.sample || '')))
const frame = () => new Promise(r => requestAnimationFrame(() => r()))

function Row({ state }) {
  return <div className="row" style={{ height: '32px' }}>{state.label}</div>
}
function List() {
  return <div className="list"><VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} style={{}} /></div>
}
List.initialState = { rows: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: 'Row ' + (i + 1) })) }

window.probe = async () => {
  const root = document.getElementById('root')
  // ancestors: one with styles (CSSOM), one with overflow-anchor !important, one without a style attribute
  const a = document.createElement('div'), b = document.createElement('div'), c = document.createElement('div')
  a.style.color = 'rgb(255, 0, 0)'
  a.style.paddingTop = '3px'
  b.style.setProperty('overflow-anchor', 'auto', 'important')
  b.style.marginLeft = '2px'
  root.append(a); a.append(b); b.append(c)
  const styles = () => [a, b, c, root].map(n => n.hasAttribute('style') ? n.style.cssText : 'none').join(' | ')
  const before = styles()
  const app = run(List, {}, { mountPoint: c })
  try {
    for (let i = 0; i < 100 && !c.querySelector('.row'); i++) await frame()
    await frame(); await frame()
    const box = c.querySelector('.rows')
    // a resize: measured again (bound() → grows())
    box.style.width = '90%'
    await frame(); await frame()
    box.style.width = ''
    await frame(); await frame()
    await new Promise(r => setTimeout(r, 50))
    return {
      before, after: styles(),
      rows: c.querySelectorAll('.row').length,
      anchor: [a, b, c].map(n => getComputedStyle(n).overflowAnchor).join(','),
      violations,
    }
  } finally { app.dispose(); root.replaceChildren() }
}
window.probeReady = true

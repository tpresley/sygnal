import { run, lazy } from 'sygnal'

// the import starts when the placeholder scrolls into view
const VisibleGauge = lazy(() => import('./Gauge.jsx'), { when: 'visible', rootMargin: '0px', placeholderHeight: 90 })
// the import starts when the browser is idle after the page is shown
const IdleGauge = lazy(() => import('./Gauge.jsx'), { when: 'idle', placeholderHeight: 90 })

export function Dashboard() {
  return (
    <div>
      <IdleGauge label="Idle-loaded gauge" />
      <div className="scroller tall">
        <p>Scroll down inside this box. The gauge below has a placeholder
          (<code>data-sygnal-lazy="deferred"</code>) until it is visible: compare the two "loaded at" times.</p>
        <div className="spacer" />
        <VisibleGauge label="Visible-loaded gauge" />
      </div>
    </div>
  )
}

export const start = (mountPoint, uid) => run(Dashboard, {}, { mountPoint, uid })

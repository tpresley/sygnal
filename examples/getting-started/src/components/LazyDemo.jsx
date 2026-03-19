import { lazy } from 'sygnal'

const HeavyComponent = lazy(() => import('./HeavyComponent.jsx'))

function LazyDemo({ state } = {}) {
  return (
    <div>
      <button type="button" className="lazy-toggle">
        {state.show ? 'Unload' : 'Load Component'}
      </button>
      {state.show && <HeavyComponent />}
    </div>
  )
}

LazyDemo.initialState = { show: false }

LazyDemo.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.lazy-toggle').events('click'),
})

LazyDemo.model = {
  TOGGLE: (state) => ({ show: !state.show }),
}

export default LazyDemo

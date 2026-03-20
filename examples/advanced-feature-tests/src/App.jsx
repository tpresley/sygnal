import { Portal, Suspense, lazy, Collection } from 'sygnal'
import DisposableChild from './DisposableChild.jsx'
import TickItem from './TickItem.jsx'
import SlowComponent from './SlowComponent.jsx'

const LazyComponent = lazy(() => import('./LazyTest.jsx'))

function App({ state } = {}) {
  return (
    <div className="app">
      <h1>Feature Tests</h1>

      {/* Test 1: Internal portal */}
      <section className="test-section">
        <h2>Test 1: Internal Portal</h2>
        <div className="controls">
          <button type="button" className="toggle-internal">
            {state.showInternal ? 'Hide' : 'Show'} Portal
          </button>
          <span>Clicks: <strong>{state.internalClicks}</strong></span>
        </div>
        <div className="target-box">
          <div id="internal-target"></div>
        </div>
        {state.showInternal && (
          <Portal target="#internal-target">
            <div className="portal-content internal">
              <p>Internal portal content</p>
              <button type="button" className="internal-btn">Click me</button>
            </div>
          </Portal>
        )}
      </section>

      {/* Test 2: Lazy Loading */}
      <section className="test-section">
        <h2>Test 2: Lazy Loading</h2>
        <div className="controls">
          <button type="button" className="toggle-lazy">
            {state.showLazy ? 'Unload' : 'Load'} Component
          </button>
        </div>
        {state.showLazy && <LazyComponent />}
      </section>

      {/* Test 3: Dispose */}
      <section className="test-section">
        <h2>Test 3: Disposal (single child)</h2>
        <p>Mount/unmount — ticks should stop and MOCK driver receives cleanup.</p>
        <div className="controls">
          <button type="button" className="toggle-dispose">
            {state.showDisposable ? 'Unmount' : 'Mount'} Child
          </button>
        </div>
        {state.showDisposable && <DisposableChild />}
      </section>

      {/* Test 4: Collection Dispose */}
      <section className="test-section">
        <h2>Test 4: Collection Disposal</h2>
        <p>Add items, each ticks independently. Remove one — its ticks should stop and MOCK driver receives item-disposed.</p>
        <div className="controls">
          <button type="button" className="add-item">Add Item</button>
        </div>
        <Collection of={TickItem} from="items" />
      </section>

      {/* Test 5: Suspense */}
      <section className="test-section">
        <h2>Test 5: Suspense (READY sink)</h2>
        <p>The component emits READY after 3 seconds. Suspense shows a fallback until it signals ready.</p>
        <div className="controls">
          <button type="button" className="toggle-suspense">
            {state.showSuspense ? 'Unload' : 'Load'} Slow Component
          </button>
        </div>
        {state.showSuspense && (
          <Suspense fallback={
            <div style={{
              padding: '16px', background: '#fff8e1', borderRadius: '8px',
              border: '1px solid #ffe082', display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span className="spinner" />
              <span>Loading slow component… (3 second delay)</span>
            </div>
          }>
            <SlowComponent />
          </Suspense>
        )}
      </section>
      {/* Test 6: isolatedState guard */}
      <section className="test-section">
        <h2>Test 6: isolatedState Guard</h2>
        <p>Sub-components with .initialState must declare .isolatedState = true, or Sygnal throws an error.</p>
        <div className="controls">
          <button type="button" className="toggle-bad-child">
            {state.showBadChild ? 'Hide' : 'Show'} Bad Child (should error)
          </button>
          <button type="button" className="toggle-good-child">
            {state.showGoodChild ? 'Hide' : 'Show'} Good Child (isolatedState)
          </button>
        </div>
        {state.showBadChild && <BadChild state="bad" />}
        {state.showGoodChild && <GoodChild state="good" />}
      </section>
    </div>
  )
}

// Bad: has .initialState without .isolatedState — should throw
function BadChild({ state } = {}) {
  return <div style={{ padding: '12px', background: '#fee', border: '1px solid #f88', borderRadius: '4px' }}>
    Bad child rendered (this should not appear!)
  </div>
}
BadChild.initialState = { value: 42 }

// Good: has .initialState WITH .isolatedState — should work
function GoodChild({ state } = {}) {
  return <div style={{ padding: '12px', background: '#efe', border: '1px solid #8b8', borderRadius: '4px' }}>
    Good child with isolated state. Value: <strong>{state.value}</strong>
  </div>
}
GoodChild.initialState = { value: 42 }
GoodChild.isolatedState = true

App.initialState = {
  showInternal: false,
  showLazy: false,
  showDisposable: false,
  showSuspense: false,
  showBadChild: false,
  showGoodChild: false,
  internalClicks: 0,
  items: [],
  nextItemId: 1,
}

App.intent = ({ DOM, EVENTS }) => ({
  TOGGLE_INTERNAL: DOM.select('.toggle-internal').events('click'),
  TOGGLE_LAZY: DOM.select('.toggle-lazy').events('click'),
  TOGGLE_DISPOSE: DOM.select('.toggle-dispose').events('click'),
  TOGGLE_SUSPENSE: DOM.select('.toggle-suspense').events('click'),
  TOGGLE_BAD_CHILD: DOM.select('.toggle-bad-child').events('click'),
  TOGGLE_GOOD_CHILD: DOM.select('.toggle-good-child').events('click'),
  INTERNAL_CLICK: DOM.select('.internal-btn').events('click'),
  ADD_ITEM: DOM.select('.add-item').events('click'),
  REMOVE_ITEM: EVENTS.select('REMOVE_ITEM'),
})

App.model = {
  TOGGLE_INTERNAL: (state) => ({ ...state, showInternal: !state.showInternal }),
  TOGGLE_LAZY: (state) => ({ ...state, showLazy: !state.showLazy }),
  TOGGLE_DISPOSE: (state) => ({ ...state, showDisposable: !state.showDisposable }),
  TOGGLE_SUSPENSE: (state) => ({ ...state, showSuspense: !state.showSuspense }),
  TOGGLE_BAD_CHILD: (state) => ({ ...state, showBadChild: !state.showBadChild }),
  TOGGLE_GOOD_CHILD: (state) => ({ ...state, showGoodChild: !state.showGoodChild }),
  INTERNAL_CLICK: (state) => ({ ...state, internalClicks: state.internalClicks + 1 }),
  ADD_ITEM: (state) => ({
    ...state,
    items: [...state.items, { id: state.nextItemId, ticks: 0 }],
    nextItemId: state.nextItemId + 1,
  }),
  REMOVE_ITEM: (state, itemId) => ({
    ...state,
    items: state.items.filter(i => i.id !== itemId),
  }),
}

export default App

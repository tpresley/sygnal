import { Portal, lazy, Collection } from 'sygnal'
import DisposableChild from './DisposableChild.jsx'
import TickItem from './TickItem.jsx'

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
    </div>
  )
}

App.initialState = {
  showInternal: false,
  showLazy: false,
  showDisposable: false,
  internalClicks: 0,
  items: [],
  nextItemId: 1,
}

App.intent = ({ DOM, EVENTS }) => ({
  TOGGLE_INTERNAL: DOM.select('.toggle-internal').events('click'),
  TOGGLE_LAZY: DOM.select('.toggle-lazy').events('click'),
  TOGGLE_DISPOSE: DOM.select('.toggle-dispose').events('click'),
  INTERNAL_CLICK: DOM.select('.internal-btn').events('click'),
  ADD_ITEM: DOM.select('.add-item').events('click'),
  REMOVE_ITEM: EVENTS.select('REMOVE_ITEM'),
})

App.model = {
  TOGGLE_INTERNAL: (state) => ({ ...state, showInternal: !state.showInternal }),
  TOGGLE_LAZY: (state) => ({ ...state, showLazy: !state.showLazy }),
  TOGGLE_DISPOSE: (state) => ({ ...state, showDisposable: !state.showDisposable }),
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

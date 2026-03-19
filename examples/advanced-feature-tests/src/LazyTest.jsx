function LazyTest({ state } = {}) {
  return (
    <div style={{ padding: '16px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #a5d6a7' }}>
      <p>Lazy-loaded component!</p>
      <p>Click count: <strong>{state.lazyClicks || 0}</strong></p>
      <button type="button" className="lazy-click-btn">Click me</button>
    </div>
  )
}

LazyTest.intent = ({ DOM }) => ({
  LAZY_CLICK: DOM.select('.lazy-click-btn').events('click'),
})

LazyTest.model = {
  LAZY_CLICK: (state) => ({ ...state, lazyClicks: (state.lazyClicks || 0) + 1 }),
}

export default LazyTest

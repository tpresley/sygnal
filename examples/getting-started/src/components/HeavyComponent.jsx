function HeavyComponent({ state } = {}) {
  return (
    <div style={{
      padding: '16px', background: '#e8f5e9', borderRadius: '8px',
      border: '1px solid #a5d6a7',
    }}>
      <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>Lazy-loaded component!</p>
      <p style={{ margin: '0' }}>
        This component was loaded on demand. Click count: <strong>{state.heavyClicks || 0}</strong>
      </p>
      <button type="button" className="heavy-btn" style={{ marginTop: '8px' }}>
        Click me
      </button>
    </div>
  )
}

HeavyComponent.intent = ({ DOM }) => ({
  HEAVY_CLICK: DOM.select('.heavy-btn').events('click'),
})

HeavyComponent.model = {
  HEAVY_CLICK: (state) => ({ ...state, heavyClicks: (state.heavyClicks || 0) + 1 }),
}

export default HeavyComponent

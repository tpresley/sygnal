import xs from 'xstream'

function SlowComponent({ state } = {}) {
  return (
    <div style={{
      padding: '16px', background: '#e8f5e9', borderRadius: '8px',
      border: '1px solid #a5d6a7',
    }}>
      <p style={{ fontWeight: 'bold', margin: '0 0 8px 0' }}>Slow-loading component!</p>
      <p style={{ margin: '0' }}>
        This component signals READY after 3 seconds. Clicks: <strong>{state.slowClicks || 0}</strong>
      </p>
      <button type="button" className="slow-click-btn" style={{
        marginTop: '8px', background: '#059669', color: 'white',
      }}>Click me</button>
    </div>
  )
}

SlowComponent.intent = ({ DOM }) => ({
  SLOW_CLICK: DOM.select('.slow-click-btn').events('click'),
  BECAME_READY: xs.periodic(3000).take(1),
})

SlowComponent.model = {
  SLOW_CLICK: (state) => ({ ...state, slowClicks: (state.slowClicks || 0) + 1 }),
  BECAME_READY: {
    READY: () => true,
  },
}

export default SlowComponent

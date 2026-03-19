import xs from 'xstream'

function DisposableChild({ state } = {}) {
  return (
    <div style={{
      padding: '16px', background: '#fff3e0', borderRadius: '8px',
      border: '1px solid #ffcc80',
    }}>
      <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>Disposable Component</p>
      <p style={{ margin: '0' }}>
        Ticks: <strong>{state.ticks || 0}</strong> (increments every second while mounted)
      </p>
      <p style={{ margin: '4px 0 0 0', fontSize: '0.85em', color: '#666' }}>
        Check the console — "TICK" logs while mounted, "CLEANUP received" on unmount.
      </p>
    </div>
  )
}

DisposableChild.intent = ({ DOM, dispose$ }) => {
  // Create a timer stream that ticks every second
  const tick$ = xs.periodic(1000).map(() => {
    return true
  })

  return {
    TICK: tick$,
    CLEANUP: dispose$,
  }
}

DisposableChild.model = {
  TICK: { 
    STATE: (state) => ({ ...state, ticks: (state.ticks || 0) + 1 }),
    LOG:   'TICK — disposable component is alive'
  },
  CLEANUP: {
    // Send cleanup signal to the MOCK driver
    MOCK: (state) => {
      console.log('CLEANUP received by model — sending to MOCK driver')
      return { type: 'dispose', componentTicks: state.ticks || 0 }
    },
  },
}

export default DisposableChild

import {xs} from 'sygnal'

function TickItem({ state } = {}) {
  return (
    <div style={{
      padding: '8px 12px', margin: '4px 0', background: '#e3f2fd',
      borderRadius: '4px', border: '1px solid #90caf9', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span>Item {state.id} — ticks: <strong>{state.ticks || 0}</strong></span>
      <button type="button" className="remove-item">✕</button>
    </div>
  )
}

TickItem.intent = ({ DOM, EVENTS, dispose$ }) => {
  const tick$ = xs.periodic(1000)

  return {
    TICK: tick$,
    REMOVE: DOM.select('.remove-item').events('click'),
    CLEANUP: dispose$,
  }
}

TickItem.model = {
  TICK: (state) => ({ ...state, ticks: (state.ticks || 0) + 1 }),
  REMOVE: {
    EVENTS: (state) => ({ type: 'REMOVE_ITEM', data: state.id }),
  },
  CLEANUP: {
    MOCK: (state) => ({ type: 'item-disposed', itemId: state.id, finalTicks: state.ticks || 0 }),
  },
}

export default TickItem

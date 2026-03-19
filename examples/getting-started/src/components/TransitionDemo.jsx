import { Transition } from 'sygnal'

function TransitionDemo({ state } = {}) {
  return (
    <div>
      <button type="button" className="fade-toggle">
        {state.show ? 'Hide' : 'Show'} Content
      </button>
      {state.show && (
        <Transition name="fade">
          <div className="fade-box" style={{
            marginTop: '12px', padding: '16px',
            background: '#e8f0fe', borderRadius: '8px',
            border: '1px solid #c4d8f0',
          }}>
            <p style={{ margin: '0' }}>This content fades in and out.</p>
          </div>
        </Transition>
      )}
    </div>
  )
}

TransitionDemo.initialState = { show: false }

TransitionDemo.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.fade-toggle').events('click'),
})

TransitionDemo.model = {
  TOGGLE: (state) => ({ show: !state.show }),
}

export default TransitionDemo

import { createRef } from 'sygnal'

const boxRef = createRef()

function RefDemo({ state } = {}) {
  return (
    <div>
      <div className="measured-box" ref={boxRef} style={{
        width: state.expanded ? '100%' : '50%',
        padding: '16px',
        background: '#e8f0fe',
        borderRadius: '8px',
        transition: 'width 0.3s ease',
        boxSizing: 'border-box',
      }}>
        Resize me!
      </div>
      <p className="dimensions">
        {state.width > 0
          ? `Box dimensions: ${state.width} × ${state.height}px`
          : 'Click a button to measure'}
      </p>
      <button type="button" className="toggle">
        {state.expanded ? 'Shrink' : 'Expand'}
      </button>
      <button type="button" className="measure">Measure</button>
    </div>
  )
}

RefDemo.initialState = { expanded: false, width: 0, height: 0 }

RefDemo.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.toggle').events('click'),
  MEASURE: DOM.select('.measure').events('click'),
})

RefDemo.model = {
  TOGGLE: (state) => ({ ...state, expanded: !state.expanded }),
  MEASURE: (state) => {
    if (!boxRef.current) return state
    const rect = boxRef.current.getBoundingClientRect()
    return { ...state, width: Math.round(rect.width), height: Math.round(rect.height) }
  },
}

export default RefDemo

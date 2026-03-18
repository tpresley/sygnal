import { Portal } from 'sygnal'

function PortalDemo({ state } = {}) {
  return (
    <div>
      <p>This content is inside the component.</p>
      <button type="button" className="toggle-modal">
        {state.showModal ? 'Close Modal' : 'Open Modal'}
      </button>
      {state.showModal && (
        <Portal target="#portal-root">
          <div className="portal-overlay" style={{
            position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
            background: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: '1000',
          }}>
            <div style={{
              background: 'white', padding: '24px', borderRadius: '8px',
              maxWidth: '400px', width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            }}>
              <h3 style={{ marginTop: '0' }}>I'm a Portal!</h3>
              <p>This modal is rendered into <code>#portal-root</code>, outside the component tree.</p>
              <button type="button" className="close-modal-btn">Close</button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  )
}

PortalDemo.initialState = { showModal: false }

PortalDemo.intent = ({ DOM }) => ({
  TOGGLE: DOM.select('.toggle-modal').events('click'),
  CLOSE: DOM.select('document').events('click')
    .filter(e => e.target && e.target.closest && e.target.closest('.close-modal-btn')),
})

PortalDemo.model = {
  TOGGLE: (state) => ({ showModal: !state.showModal }),
  CLOSE: () => ({ showModal: false }),
}

export default PortalDemo

import { run, makeTimerDriver } from 'sygnal'
import { tooltip } from 'sygnal/ui'

// Two tooltips: manual popovers placed by CSS anchor positioning, delays from timers
export function Toolbar({ state, uid }) {
  const save = '--' + uid('save'), share = '--' + uid('share')
  return (
    <div>
      <div className="row">
        <button className="save" aria-describedby={uid('save-tip')} style={{ anchorName: save }}>Save</button>
        <button className="share" aria-describedby={uid('share-tip')} style={{ anchorName: share }}>Share</button>
      </div>
      <div className="tip save-tip" id={uid('save-tip')} role="tooltip" popover="manual" style={{ positionAnchor: save }}>
        Save the draft (Ctrl+S)
      </div>
      <div className="tip share-tip" id={uid('share-tip')} role="tooltip" popover="manual" style={{ positionAnchor: share }}>
        Copy a link to this page
      </div>
      <output>
        save tip: {state.saveTip.open ? 'shown' : state.saveTip.pending ? `pending ${state.saveTip.pending}` : 'hidden'} ·
        share tip (no delay): {state.shareTip.open ? 'shown' : 'hidden'}
      </output>
      <p className="muted">Hover or Tab to the buttons; Escape hides the tip.</p>
    </div>
  )
}

Toolbar.uses = {
  saveTip: tooltip({ trigger: '.save', tip: '.save-tip' }),
  shareTip: tooltip({ trigger: '.share', tip: '.share-tip', showDelay: 0, hideDelay: 300 }),
}

export const start = (mountPoint, uid) => run(Toolbar, { TIMER: makeTimerDriver() }, { mountPoint, uid })

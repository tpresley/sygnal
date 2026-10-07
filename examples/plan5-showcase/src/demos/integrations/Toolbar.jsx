import { run } from 'sygnal'
import { fromZag } from 'sygnal/zag'
import * as menu from '@zag-js/menu'

// Any Zag.js machine as a widget tag: spread Zag's prop getters on plain elements
const Actions = fromZag(menu, (api, props) => (
  <div className="zag-menu">
    <button {...api.getTriggerProps()}>{props.label} ▾</button>
    <div {...api.getPositionerProps()}>
      <ul className="zag-menu-list" {...api.getContentProps()}>
        {props.items.map((item) => <li className="zag-menu-item" {...api.getItemProps({ value: item })}>{item}</li>)}
      </ul>
    </div>
  </div>
), {
  name: 'Actions',
  events: { pick: ['onSelect', (details) => details.value] },
  commands: { open: (api) => api.setOpen(true) },
})

export function Toolbar({ state }) {
  return (
    <div>
      <div className="row">
        <Actions className="actions" label="Edit" items={['cut', 'copy', 'paste']} />
        <button className="open-menu">Open it from the model</button>
      </div>
      <output>{state.last ? `Picked: ${state.last}` : 'Nothing picked yet (try the keyboard: Enter, arrows, typeahead)'}</output>
    </div>
  )
}

Toolbar.initialState = { last: '' }

Toolbar.intent = ({ DOM }) => ({
  PICK: DOM.select('.actions').events('pick').detail(),
  OPEN: DOM.click('.open-menu'),
})

Toolbar.model = {
  PICK: (state, last) => ({ ...state, last }),
  OPEN: { ELEMENT: { open: '.actions' } },
}

export const start = (mountPoint, uid) => run(Toolbar, {}, { mountPoint, uid })

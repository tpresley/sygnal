import { run } from 'sygnal'
import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'

const ACTIONS = [
  { value: 'rename', label: 'Rename' },
  { value: 'duplicate', label: 'Duplicate' },
  { separator: true },
  { value: 'delete', label: 'Delete' },
]
const SIZES = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large', disabled: true },
]
const CITIES = ['Amsterdam', 'Berlin', 'Lisbon', 'London', 'Paris', 'Prague']

// Three Zag-based parts, each from its own subpath; all are widget tags
export function Picker({ state }) {
  return (
    <div className="picker">
      <div className="row">
        <Menu className="card-actions" label="Actions" items={ACTIONS} />
        <Select className="size" label="Size" items={SIZES} value={state.size} placeholder="Pick a size" />
      </div>
      <div className="row">
        <Combobox className="city" label="City" items={CITIES} value={state.city} placeholder="Type a city" />
        <button className="clear-city">Clear city (command)</button>
      </div>
      <output>
        last action: {state.last || '—'} · size: {state.size || '—'} · city: {state.city || '—'}
      </output>
    </div>
  )
}

Picker.initialState = { last: '', size: null, city: null }
Picker.intent = ({ DOM }) => ({
  ACTION: DOM.select('.card-actions').events('select').detail(),
  SIZE: DOM.select('.size').events('value-change').detail(),
  CITY: DOM.select('.city').events('value-change').detail(),
  CLEAR_CITY: DOM.click('.clear-city'),
})
Picker.model = {
  ACTION: (state, last) => ({ ...state, last }),
  SIZE: (state, size) => ({ ...state, size }),
  CITY: (state, city) => ({ ...state, city }),
  CLEAR_CITY: { ELEMENT: { clear: '.city' } },
}

export const start = (mountPoint, uid) => run(Picker, {}, { mountPoint, uid })

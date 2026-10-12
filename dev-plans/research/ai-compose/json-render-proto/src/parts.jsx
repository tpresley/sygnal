// The Sygnal registry for the catalog. View parts are plain functions (part of SpecView's JSX);
// Checkbox is an ordinary Sygnal component (its own intent and model) to show a component part.
import { emit } from './specView.jsx'

const Stack = ({ props, children }) => <div className={`stack ${props.direction || 'vertical'}`}>{children}</div>
const Card = ({ props, children }) => <section className="card"><h3>{props.title}</h3>{children}</section>
const Heading = ({ props }) => <h2 className="heading">{props.text}</h2>
const Text = ({ props }) => <p className="text">{props.text}</p>
const Metric = ({ props }) => <div className="metric"><span className="label">{props.label}</span> <b>{props.value}</b></div>
const TextInput = ({ key, props, bind }) => (
  <label className="field">{props.label} <input className={`input-${key}`} value={props.value ?? ''} {...bind('value')} /></label>
)
const Button = ({ key, props, on }) => <button className={`btn-${key}`} type="button" {...on('press')}>{props.label}</button>

// a component part: state = its bound props ({ checked }), events up with PARENT
function Checkbox({ state, label }) {
  return <label className="check"><input type="checkbox" className="box" checked={!!state.checked} /> {label}</label>
}
Checkbox.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.box').checked() })
Checkbox.model = {
  TOGGLE: {
    STATE: (state, checked) => ({ ...state, checked }),
    PARENT: emit('change'),
  },
}

export const components = { Stack, Card, Heading, Text, Metric, TextInput, Button, Checkbox }

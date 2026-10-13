// One room's light, a Collection item. A click, the slider and the assistant all send the same
// action, SET_LIGHT, so a tool call goes through exactly the reducer a click does.
//
// Its `agent` declaration is one tool for every room, `room_set_light({ id, ... })`: the `id`
// parameter lists the live room ids, labelled with the rooms' names (the app's own words, so
// `untrusted: false` lets the labels into the tool description).
import { z } from 'zod'
import { xs, classes, abort } from 'sygnal'
import { WARMTH } from './home.js'

export default function Room({ state }) {
  const { name, icon, on, brightness, warmth } = state
  return (
    <li className={classes('room', warmth, { on })} style={{ '--level': on ? brightness / 100 : 0 }}>
      <div className="room-head">
        <span className="bulb" aria-hidden="true" />
        <span className="room-name"><span aria-hidden="true">{icon}</span> {name}</span>
        <button type="button" className="power" aria-pressed={on ? 'true' : 'false'} aria-label={`${name} light`} data={{ on: on ? 'off' : 'on' }}>
          {on ? 'On' : 'Off'}
        </button>
      </div>
      <label className="dim">
        <span>Brightness <b>{brightness}%</b></span>
        <input type="range" className="brightness" min="1" max="100" value={brightness} aria-label={`${name} brightness`} />
      </label>
      <div className="warmth-pick" role="group" aria-label={`${name} color temperature`}>
        {WARMTH.map((w) => <button type="button" className={classes('warmth', w)} aria-pressed={w === warmth ? 'true' : 'false'} data={{ warmth: w }}>{w}</button>)}
      </div>
    </li>
  )
}

Room.intent = ({ DOM }) => ({
  SET_LIGHT: xs.merge(
    DOM.click('.power').data('on', (v) => ({ on: v === 'on' })),
    DOM.input('.brightness').value((v) => ({ brightness: Number(v) })),
    DOM.click('.warmth').data('warmth', (warmth) => ({ warmth })),
  ),
})

Room.model = {
  // a brightness switches the light on (0: off, keeping the last brightness), unless `on` says otherwise
  SET_LIGHT: (state, { brightness, ...change }) => {
    if (brightness === undefined && Object.keys(change).length === 0) return abort('give at least one of on, brightness, warmth')
    const light = brightness === 0 ? { on: false } : brightness ? { on: true, brightness } : {}
    return { ...state, ...light, ...change }
  },
}

Room.agent = {
  name: 'room',
  description: "A room's ceiling light",
  label: (state) => state.name,
  untrusted: false,
  actions: {
    SET_LIGHT: {
      description: "Change one room's light: switch it on or off, dim it, or change the color of its white light. Give only the fields to change. It never changes the room's temperature.",
      input: z.strictObject({
        on: z.boolean().optional().describe('true: switch the light on, false: switch it off'),
        brightness: z.number().int().min(0).max(100).optional().describe('Brightness in percent, 0 to 100 (0 switches the light off, any other value on)'),
        warmth: z.enum(WARMTH).optional().describe('The color of the light: warm white, neutral or cool white'),
      }),
      idempotent: true,
    },
  },
}

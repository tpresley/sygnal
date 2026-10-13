// The home's data: its rooms, the scenes, and the power estimate (the agent's `energy` query and
// the header's total use the same function).

export const ROOMS = [
  { id: 'living', name: 'Living room', icon: '🛋️', on: true, brightness: 70, warmth: 'warm', maxWatts: 60 },
  { id: 'kitchen', name: 'Kitchen', icon: '🍳', on: true, brightness: 100, warmth: 'neutral', maxWatts: 80 },
  { id: 'bedroom', name: 'Bedroom', icon: '🛏️', on: false, brightness: 40, warmth: 'warm', maxWatts: 40 },
  { id: 'office', name: 'Office', icon: '💻', on: true, brightness: 90, warmth: 'cool', maxWatts: 50 },
]

export const WARMTH = ['warm', 'neutral', 'cool']
export const MODES = ['heat', 'cool', 'off']
export const TEMP = { min: 16, max: 28 }

/** each scene: the lights it sets (rooms it doesn't name go off) and the thermostat */
export const SCENES = {
  movie_night: {
    label: 'Movie night', icon: '🎬',
    lights: { living: { brightness: 20, warmth: 'warm' } },
  },
  good_morning: {
    label: 'Good morning', icon: '☀️',
    lights: { kitchen: { brightness: 100, warmth: 'cool' }, bedroom: { brightness: 60, warmth: 'neutral' }, living: { brightness: 50, warmth: 'neutral' } },
    thermostat: { target: 21, mode: 'heat' },
  },
  focus: {
    label: 'Focus', icon: '🎯',
    lights: { office: { brightness: 100, warmth: 'cool' } },
  },
  away: {
    label: 'Away', icon: '🧳',
    lights: {},
    thermostat: { mode: 'off' },
    locked: true,
  },
}

/** a scene applied to the home's state */
export function applyScene(state, id) {
  const scene = SCENES[id]
  return {
    ...state,
    scene: id,
    rooms: state.rooms.map((r) => (scene.lights[r.id] ? { ...r, on: true, ...scene.lights[r.id] } : { ...r, on: false })),
    thermostat: { ...state.thermostat, ...scene.thermostat },
    locked: scene.locked ?? state.locked,
  }
}

/** estimated watts now, highest first: each light by its brightness, the heat pump by how far the target is from 20 °C */
export function energy(state) {
  const rooms = state.rooms
    .map((r) => ({ room: r.id, name: r.name, watts: r.on ? Math.round((r.maxWatts * r.brightness) / 100) : 0 }))
    .sort((a, b) => b.watts - a.watts)
  const { mode, target } = state.thermostat
  const heatPump = mode === 'off' ? 0 : Math.round(400 + 120 * Math.abs(target - 20))
  return { rooms, heatPump, total: rooms.reduce((sum, r) => sum + r.watts, heatPump) }
}

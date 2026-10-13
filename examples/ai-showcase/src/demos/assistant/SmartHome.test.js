import { it, expect, afterEach } from 'vitest'
import { renderComponent, xs } from 'sygnal'
import SmartHome from './SmartHome.jsx'
import { PROVIDERS } from '../../shared/fixtures.js'

let t
afterEach(() => t?.dispose())

// the AGENT source is index.js's; here a stand-in that never emits
const start = async () => {
  t = renderComponent(SmartHome, { drivers: { AGENT: () => ({ select: () => xs.never() }) } })
  await t.respond('HTTP', PROVIDERS)
  return t
}

it('offers the home and the rooms as tools, and the read projection as app state', async () => {
  await start()
  const tools = t.tools()
  expect(tools.map((tool) => tool.name)).toEqual(['home_read', 'home_apply_scene', 'home_set_thermostat', 'home_unlock', 'home_energy', 'room_set_light'])
  expect(tools.find((tool) => tool.name === 'home_unlock').annotations).toMatchObject({ consequentialHint: true })
  expect(tools.find((tool) => tool.name === 'room_set_light').inputSchema.properties.id.enum).toEqual(['living', 'kitchen', 'bedroom', 'office'])
  expect(t.agentContext().home).toMatchObject({ frontDoor: 'locked', thermostat: { target: 20.5, mode: 'heat' } })
})

it('runs a tool through the same reducer as a click, and answers queries from state', async () => {
  await start()
  expect(await t.callTool('room_set_light', { id: 'kitchen', on: false })).toMatchObject({ ok: true })
  expect(t.state.rooms.find((r) => r.id === 'kitchen').on).toBe(false)
  expect(t.actions.filter((a) => a.cause === 'agent').map((a) => a.type)).toEqual(['SET_LIGHT'])

  t.simulateEvent('.scene', 'click', { data: { scene: 'movie_night' } })
  await t.next((s) => s.scene === 'movie_night')
  const { result } = await t.callTool('home_energy')
  expect(result.rooms.find((r) => r.room === 'living').watts).toBe(12)   // 60 W at 20 %
  expect(result.total).toBe(result.heatPump + 12)
})

it('asks before unlocking, and offers LOCK only once it is unlocked', async () => {
  await start()
  expect(await t.callTool('home_unlock', {}, { confirm: false })).toEqual({ ok: false, error: 'the user declined' })
  expect(t.state.locked).toBe(true)
  expect(await t.callTool('home_unlock', {}, { confirm: true })).toMatchObject({ ok: true, state: { frontDoor: 'unlocked' } })
  expect(t.tools().map((tool) => tool.name)).toContain('home_lock')
  expect(t.tools().map((tool) => tool.name)).not.toContain('home_unlock')
})

it('runs the model\'s tool calls in the chat, with the picked model', async () => {
  await start()
  t.simulateEvent('.example', 'click', { data: { prompt: 'Make it a bit warmer' } })
  await t.next((s) => s.assistant.status === 'submitted')
  const [request] = t.requests('LLM')
  expect(request.model).toBe('kindo::moonshotai/Kimi-K3')
  expect(Object.keys(request.tools)).toContain('home_set_thermostat')
  expect(request.messages.some((m) => m.id === 'sygnal-app-state')).toBe(true)

  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'home_set_thermostat', input: { target: 21.5 } } }])
  expect(t.state.thermostat.target).toBe(21.5)
  await t.stream('LLM', ['Done: 21.5 °C.'])
  await t.settle()
  expect(t.html()).toContain('home_set_thermostat')
  expect(t.html()).toContain('Done: 21.5 °C.')
})

it('shows the confirmation for UNLOCK, and Deny tells the model', async () => {
  await start()
  t.simulateEvent('.prompt', 'input', { value: 'Unlock the front door' })
  t.simulateEvent('.ask', 'submit')
  await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'home_unlock', input: {} } }])
  await t.waitForState((s) => s.assistant.pending)
  expect(t.query('.confirm-box').textContent).toContain('Unlock the front door')
  t.simulateEvent('.deny', 'click')
  await t.next((s) => !s.assistant.pending)
  await t.settle()
  expect(t.state.locked).toBe(true)
  const last = t.requests('LLM').at(-1)
  expect(JSON.stringify(last.messages)).toContain('the user declined')
})

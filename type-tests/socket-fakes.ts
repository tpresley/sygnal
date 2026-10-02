// PLAN-3 2-C: renderComponent's socket fakes (t.connections / t.open / t.push / t.drop / t.sent)
import { renderComponent } from 'sygnal'
import type { FakeConnection, FakeConnectionTarget } from 'sygnal'

function Chat() { return null as any }
const t = renderComponent(Chat, { autoConnect: false })
const list: FakeConnection[] = t.connections('WS')
const state: 'connecting' | 'open' | 'closed' = list[0].state
const name: string = list[0].name + list[0].url + list[0].sender
const byName: FakeConnectionTarget = 'room'
const p: Promise<void> = t.open('WS', byName)
t.push('WS', { text: 'hi' })
t.push('WS', 'raw', { socket: '/ws/a' })
t.push('WS', { value: 1 }, { event: 'price', connection: 'prices' })
t.push('WS', 1, c => c.state === 'open')
t.drop('WS')
t.drop('WS', { code: 1011, reason: 'restart' }, '/ws/a')
t.drop('WS', 'room')
const sent: any[] = t.sent('WS', 'room')
// @ts-expect-error autoConnect is a boolean
renderComponent(Chat, { autoConnect: 'yes' })
// @ts-expect-error the sink name is required
t.push()
export { p, state, name, sent }

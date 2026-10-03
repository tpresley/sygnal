// PLAN-3 2-B: the `connections` static. Typed from STATE & CALCULATED; entries are socket or
// SSE specs or falsy (`state.room && { ... }`); action names are plain strings (D70).
import { makeSocketDriver, ABORT } from 'sygnal'
import type { Component, RootComponent, Connections, SocketRequest } from 'sygnal'

type ChatState = { room: string | null; status: string; messages: { text: string }[]; draft: string }
type ChatActions = { JOIN: string; LEAVE: null; SEND: null; RECEIVED: { text: string }; CONNECTED: null; DROPPED: null }

const room = (id: string | null) => id && {
  socket: `/ws/rooms/${id}`, message: 'RECEIVED', open: 'CONNECTED', close: 'DROPPED',
  reconnect: { delayMs: 1000, maxDelayMs: 1000, jitter: false },
}

export const Chat: RootComponent<ChatState, { WS: SocketRequest }, ChatActions> = ({ state }) => <p>{state.status}</p>
Chat.initialState = { room: null, status: 'offline', messages: [], draft: '' }
Chat.connections = (state) => ({ room: room(state.room) })
Chat.model = {
  JOIN: (state, id) => id === state.room ? ABORT : { ...state, room: id, status: 'connecting', messages: [] },
  LEAVE: (state) => ({ ...state, room: null, status: 'offline', messages: [] }),
  SEND: { STATE: (s) => ({ ...s, draft: '' }), WS: (s) => ({ to: 'room', json: { text: s.draft } }) },
  RECEIVED: (state, msg) => ({ ...state, messages: [...state.messages, msg] }),
  CONNECTED: (state) => ({ ...state, status: 'online' }),
  DROPPED: (state) => ({ ...state, status: 'reconnecting' }),
}
makeSocketDriver({ reconnect: { maxDelayMs: 10000 } })

// falsy entries of every kind, SSE with named events, an empty set
type FeedState = { on: boolean; topic: string; n: number }
export const Feed: Component<FeedState, {}, {}, {}, { url: string }> = () => <p>feed</p>
Feed.connections = (state) => ({
  a: state.on && { sse: state.url, events: { tick: 'TICK' }, withCredentials: true },
  b: state.topic && { socket: `/t/${state.topic}`, protocols: ['v1'], share: false },
  c: state.n && { socket: '/n' },
  d: null,
  e: undefined,
})
Feed.connections = () => ({})
// D85: stays open while the component is in a hidden Switchable page
Feed.connections = () => ({ live: { socket: '/live', background: true } })
// action names are plain strings, also when built at run time (D70)
const actionName: string = 'GOT'
Feed.connections = () => ({ x: { socket: '/x', message: actionName } })

// the state parameter is typed: STATE & CALCULATED
// @ts-expect-error no such state key
Feed.connections = (state) => ({ x: state.missing && { socket: '/x' } })
// @ts-expect-error a connection needs a socket or sse URL
Feed.connections = () => ({ x: { message: 'GOT' } })
// @ts-expect-error a then key makes a thenable (SYG610)
Feed.connections = () => ({ x: { socket: '/x', then: 'OPEN' } })
// @ts-expect-error a connection is not a string
Feed.connections = () => ({ x: '/ws' })
// @ts-expect-error it returns the set, not a list
Feed.connections = () => [{ socket: '/x' }]

export const set: Connections = { room: { socket: '/ws' }, off: false }

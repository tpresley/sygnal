// A stand-in for an AI chat that re-parses its streamed answer on every chunk (markdown, partial
// JSON, tool calls): Start streams 120 chunks, one every 16 ms, and each CHUNK reducer re-parses
// the whole buffer, so the parse grows with the answer: 10 ms for the first chunk, 0.5 ms more per
// chunk (70 ms at the end). Meanwhile the user types a note into a controlled field. The parse is
// a timed busy loop, so the cost is the same on both threads.
import {xs} from 'sygnal'

function parse(buffer, chunks) {
  const end = performance.now() + 10 + chunks * 0.5
  let words = 0
  while (performance.now() < end) words = buffer.split(' ').length
  return words
}

export default function Stream({state}) {
  return (
    <main>
      <button className="start">Start</button>
      <input className="note" value={state.note} placeholder="Type while it streams" />
      <p className="status">{state.chunks} chunks, {state.words} words</p>
      <ul className="out">{state.lines.map((l) => <li>{l}</li>)}</ul>
    </main>
  )
}

Stream.initialState = {note: '', chunks: 0, words: 0, buffer: '', lines: []}

Stream.intent = ({DOM}) => ({
  NOTE: DOM.input('.note').value(),
  CHUNK: DOM.click('.start').map(() => xs.periodic(16).take(120).map((i) => `token${i} `)).flatten(),
})

Stream.model = {
  NOTE: (state, note) => ({...state, note}),
  CHUNK: (state, chunk) => {
    const buffer = state.buffer + chunk
    const lines = state.chunks % 10 === 9 ? [...state.lines.slice(-19), buffer.slice(-60)] : state.lines
    return {...state, buffer, lines, chunks: state.chunks + 1, words: parse(buffer, state.chunks)}
  },
}

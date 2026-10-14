// Step 2: stop, retry, start over.
//
// New: two more selectors for the behavior. `stop` aborts the reply and keeps what streamed so
// far; `regenerate` sends the last user message again, for a reply you didn't like or one that
// failed (`status: 'error'`, with the reason in `error`). Clear is the app's own action: the chat
// is plain state, so starting over is a reducer.
import { classes } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const EXAMPLES = [
  'Tell me a long story about a lighthouse keeper.',
  'Write a limerick about a cat who codes.',
  'List ten fun facts about octopuses.',
]

export default function Chat({ state }) {
  const { messages, draft, status, prompt, error } = state.chat
  const busy = status === 'submitted' || status === 'streaming'
  return (
    <div className="w bc">
      <div className="w-toolbar">
        <span className="grow" />
        <button type="button" className="btn ghost small clear" disabled={busy || messages.length === 0}>Clear</button>
      </div>

      <div className="bc-log">
        <ol className="transcript" aria-live="polite">
          {messages.map((m) => <li className={classes('msg', m.role)}>{messageText(m)}</li>)}
          {busy && (
            <li className={classes('msg', 'assistant', { streaming: !!draft })}>
              {draft || <span className="thinking-dots"><i /><i /><i /></span>}
            </li>
          )}
        </ol>
      </div>

      {status === 'error' && <p className="status-line error" role="alert">{error}</p>}
      {(status === 'ready' || status === 'error') && messages.length > 0 && (
        <div className="bc-actions"><button type="button" className="btn ghost small retry">↻ {status === 'error' ? 'Try again' : 'Regenerate'}</button></div>
      )}

      <div className="examples">
        {EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }}>{e}</button>)}
      </div>

      <form className="composer ask">
        <input className="prompt" aria-label="Message" placeholder="Message Kimi K3…" value={prompt} />
        {busy
          ? <button type="button" className="btn ghost stop">Stop</button>
          : <button type="submit" className="btn" disabled={!prompt.trim()}>Send</button>}
      </form>
    </div>
  )
}

Chat.uses = {
  chat: chat({
    agent: false,
    form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.retry',
    instructions: 'You are a friendly assistant in a demo chat. Keep answers under 120 words, in plain text (no Markdown).',
  }),
}

Chat.intent = ({ DOM }) => ({
  EXAMPLE: DOM.click('.example').data('prompt'),
  CLEAR: DOM.click('.clear'),
})

Chat.model = {
  EXAMPLE: {
    STATE: (state, prompt) => ({ ...state, chat: { ...state.chat, prompt } }),
    ELEMENT: { focus: '.prompt' },
  },
  CLEAR: (state) => ({ ...state, chat: { ...state.chat, messages: [], status: 'ready', error: null } }),
}

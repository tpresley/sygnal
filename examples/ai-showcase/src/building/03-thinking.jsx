// Step 3: show the thinking, count the tokens.
//
// New: Kimi K3 reasons before it answers. The reasoning streams into `draftReasoning` ahead of the
// text, and stays on the finished message as a `reasoning` part, so the view renders a reply part
// by part. A host entry `'chat.DONE'` runs after each reply with its token usage, and the app
// keeps a tally outside the chat.
import { classes } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const EXAMPLES = [
  'Is 9.11 bigger than 9.9? Think it through.',
  'A bat and a ball cost $1.10 together. The bat costs $1 more than the ball. What does the ball cost?',
  'How many r\'s are in "strawberry"?',
]

/** one part of a reply: its text, or its reasoning (folded away) */
function part(p) {
  if (p.type === 'reasoning') return <details className="reasoning"><summary>Thought it through</summary>{p.text}</details>
  if (p.type === 'text') return p.text
  return null
}

function message(m) {
  return <li className={classes('msg', m.role)}>{m.role === 'assistant' ? m.parts.map(part) : messageText(m)}</li>
}

function tokens({ usage }) {
  return (
    <aside className="panel bc-side">
      <h3 className="panel-title">Tokens this chat</h3>
      <dl className="bc-meter">
        <dt>Replies</dt><dd>{usage.replies}</dd>
        <dt>In</dt><dd>{usage.input.toLocaleString()}</dd>
        <dt>Out</dt><dd>{usage.output.toLocaleString()}</dd>
        <dt>…of them thinking</dt><dd>{usage.reasoning.toLocaleString()}</dd>
      </dl>
    </aside>
  )
}

export default function Chat({ state }) {
  const { messages, draft, draftReasoning, status, prompt, error } = state.chat
  const busy = status === 'submitted' || status === 'streaming'
  return (
    <div className="w bc">
      <div className="w-toolbar">
        <span className="grow" />
        <button type="button" className="btn ghost small clear" disabled={busy || messages.length === 0}>Clear</button>
      </div>

      <div className="w-grid">
        <div className="bc-chat">
          <div className="bc-log">
            <ol className="transcript" aria-live="polite">
              {messages.map(message)}
              {busy && (
                <li className={classes('msg', 'assistant', { streaming: !!draft })}>
                  {draftReasoning && <details className="reasoning" open={!draft}><summary>Thinking…</summary>{draftReasoning}</details>}
                  {draft || (!draftReasoning && <span className="thinking-dots"><i /><i /><i /></span>)}
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

        {tokens(state)}
      </div>
    </div>
  )
}

const NO_USAGE = { replies: 0, input: 0, output: 0, reasoning: 0 }

Chat.initialState = { usage: NO_USAGE }

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
  CLEAR: (state) => ({ ...state, chat: { ...state.chat, messages: [], status: 'ready', error: null }, usage: NO_USAGE }),
  // runs after the behavior's own DONE: the turn is over
  'chat.DONE': (state, { usage: u }) => ({
    ...state,
    usage: {
      replies: state.usage.replies + 1,
      input: state.usage.input + (u?.inputTokens ?? 0),
      output: state.usage.output + (u?.outputTokens ?? 0),
      reasoning: state.usage.reasoning + (u?.reasoningTokens ?? 0),
    },
  }),
}

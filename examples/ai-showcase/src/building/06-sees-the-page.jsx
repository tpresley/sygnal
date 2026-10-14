// Step 6: it sees the page.
//
// New: an `agent` static says what a model may see of the app. `read` is a projection of the
// state, and the chat sends it with every request, so the model always sees the page as it is
// now: here, the answer style you set in the panel beside the chat. Change the tone mid-chat and
// the next reply follows it; nothing in the conversation has to say so. (`agent: false` is gone:
// the chat now uses the host's declaration.)
import { z } from 'zod'
import { classes, persist } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const EXAMPLES = [
  'Introduce yourself.',
  'How do airplanes stay up?',
  'Recommend a book for a rainy day.',
  'What style am I asking you to answer in?',
]

const TONES = { friendly: 'Friendly', pirate: 'Pirate', formal: 'Formal', emoji: 'Emoji' }
const LENGTHS = { short: 'One sentence', medium: 'A paragraph', long: 'In depth' }

const FollowUps = z.object({
  questions: z.array(z.string().max(80)).min(2).max(3)
    .describe('Short follow-up questions the user might ask next, written as the user would type them'),
})

function part(p) {
  if (p.type === 'reasoning') return <details className="reasoning"><summary>Thought it through</summary>{p.text}</details>
  if (p.type === 'text') return p.text
  return null
}

function message(m) {
  return <li className={classes('msg', m.role)}>{m.role === 'assistant' ? m.parts.map(part) : messageText(m)}</li>
}

function stylePanel({ style }) {
  return (
    <section className="panel bc-side">
      <h3 className="panel-title">Answer style <span className="badge blue">the model reads this</span></h3>
      <p className="bc-field">Tone</p>
      <div className="bc-seg" role="group" aria-label="Tone">
        {Object.entries(TONES).map(([value, label]) => (
          <button type="button" className="tone" aria-pressed={String(value === style.tone)} data={{ value }}>{label}</button>
        ))}
      </div>
      <p className="bc-field">Length</p>
      <div className="bc-seg" role="group" aria-label="Length">
        {Object.entries(LENGTHS).map(([value, label]) => (
          <button type="button" className="length" aria-pressed={String(value === style.length)} data={{ value }}>{label}</button>
        ))}
      </div>
    </section>
  )
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

/** chips that fill the prompt: the suggestions for the last reply, and the examples */
function chips(state) {
  const { messages, status } = state.chat
  const last = messages.at(-1)
  const ours = status === 'ready' && last && state.followUps.for === last.id
  return (
    <div className="bc-chips">
      {ours && (
        <div className="examples follow-ups">
          <span className="bc-label">{state.followUps.questions.length ? 'Ask next' : <><span className="spinner" /> Suggesting…</>}</span>
          {state.followUps.questions.map((q) => <button type="button" className="example suggested" data={{ prompt: q }}>{q}</button>)}
        </div>
      )}
      <div className="examples">
        <span className="bc-label">Try</span>
        {EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }}>{e}</button>)}
      </div>
    </div>
  )
}

export default function Chat({ state }) {
  const { messages, draft, draftReasoning, status, prompt, error } = state.chat
  const busy = status === 'submitted' || status === 'streaming'
  return (
    <div className="w bc">
      <div className="w-toolbar">
        <span className="badge ok" title="persist(): saved in this browser's localStorage">Saved in this browser · reload to check</span>
        <span className="grow" />
        <button type="button" className="btn ghost small clear" disabled={busy || messages.length === 0}>New chat</button>
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

          {chips(state)}

          <form className="composer ask">
            <input className="prompt" aria-label="Message" placeholder="Message Kimi K3…" value={prompt} />
            {busy
              ? <button type="button" className="btn ghost stop">Stop</button>
              : <button type="submit" className="btn" disabled={!prompt.trim()}>Send</button>}
          </form>
        </div>

        <div className="bc-side-col">
          {stylePanel(state)}
          {tokens(state)}
        </div>
      </div>
    </div>
  )
}

const NO_USAGE = { replies: 0, input: 0, output: 0, reasoning: 0 }

Chat.initialState = {
  style: { tone: 'friendly', length: 'medium' },
  usage: NO_USAGE,
  followUps: { for: null, questions: [] },   // `for`: the id of the reply they follow
}

// what survives a reload: the conversation (the chat slice), the tally and the suggestions
Chat.persist = persist({ key: 'building-chat:6', pick: ['chat', 'usage', 'followUps', 'style'] })

Chat.uses = {
  chat: chat({
    form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.retry',
    instructions: 'You are the assistant in a demo chat. Answer in the tone and length that `style` in the app state asks for (short: one sentence; medium: a paragraph; long: up to 250 words). Plain text, no Markdown.',
  }),
}

// what the model sees of the page, sent with every request (never stored in the conversation)
Chat.agent = {
  name: 'page',
  description: 'The demo page around the chat',
  read: (state) => ({ style: state.style }),
  untrusted: false,   // every string in `read` is the app's own
}

Chat.intent = ({ DOM }) => ({
  EXAMPLE: DOM.click('.example').data('prompt'),
  CLEAR: DOM.click('.clear'),
  TONE: DOM.click('.tone').data('value'),
  LENGTH: DOM.click('.length').data('value'),
})

Chat.model = {
  EXAMPLE: {
    STATE: (state, prompt) => ({ ...state, chat: { ...state.chat, prompt } }),
    ELEMENT: { focus: '.prompt' },
  },
  TONE: (state, tone) => ({ ...state, style: { ...state.style, tone } }),
  LENGTH: (state, length) => ({ ...state, style: { ...state.style, length } }),
  CLEAR: (state) => ({ ...state, chat: { ...state.chat, messages: [], status: 'ready', error: null }, usage: NO_USAGE, followUps: { for: null, questions: [] } }),
  'chat.DONE': {
    STATE: (state, { message, usage: u }) => ({
      ...state,
      usage: {
        replies: state.usage.replies + 1,
        input: state.usage.input + (u?.inputTokens ?? 0),
        output: state.usage.output + (u?.outputTokens ?? 0),
        reasoning: state.usage.reasoning + (u?.reasoningTokens ?? 0),
      },
      followUps: { for: message.id, questions: [] },
    }),
    // a one-off request with a schema; the chat's own conversation is untouched
    LLM: (state) => ({
      messages: [...state.chat.messages, { role: 'user', content: 'Suggest two or three short questions I might ask you next.' }],
      output: FollowUps,
      key: 'follow-ups',
      ok: 'FOLLOW_UPS',
      error: 'NO_FOLLOW_UPS',
    }),
  },
  FOLLOW_UPS: (state, { value }) => ({ ...state, followUps: { ...state.followUps, questions: value.questions } }),
  // suggestions are optional: without them the chips are just the examples
  NO_FOLLOW_UPS: (state) => ({ ...state, followUps: { for: null, questions: [] } }),
}

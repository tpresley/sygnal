// Step 5: remember the conversation.
//
// New: `persist()` saves the picked keys of the state in this browser and puts them back when the
// app starts again: the conversation (the chat slice), the token tally and the suggestions. Reload
// the page and the chat is still here. A chat saved while a reply was streaming comes back ready
// to send. New chat is still a reducer; the saved copy follows the state.
import { z } from 'zod'
import { classes, persist } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const EXAMPLES = [
  'My name is Sam and I love hiking. Remember that.',
  'Suggest a weekend trip I would enjoy.',
  'What do you remember about me?',
]

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

        {tokens(state)}
      </div>
    </div>
  )
}

const NO_USAGE = { replies: 0, input: 0, output: 0, reasoning: 0 }

Chat.initialState = {
  usage: NO_USAGE,
  followUps: { for: null, questions: [] },   // `for`: the id of the reply they follow
}

// what survives a reload: the conversation (the chat slice), the tally and the suggestions
Chat.persist = persist({ key: 'building-chat:5', pick: ['chat', 'usage', 'followUps'] })

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

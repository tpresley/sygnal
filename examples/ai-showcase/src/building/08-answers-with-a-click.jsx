// Step 8: answers with a click.
//
// New: a client tool, `choose`: a tool the app answers itself instead of running a reducer. When
// the model calls it, the call stays open in the reply, and the view renders it as a question with
// a button per option. Your click is the call's output (`chat.TOOL_OUTPUT`), and the model goes on
// from it, here usually by filling in the shopping list. Typing a message instead closes the call.
// `openToolCalls` lists the calls still waiting, so Regenerate hides while one does.
import { z } from 'zod'
import { abort, classes, persist } from 'sygnal'
import { chat, messageText, openToolCalls } from 'sygnal/ai'

const EXAMPLES = [
  'Help me pick a dinner to cook tonight, then add what I need to my list.',
  'Quiz me with one multiple-choice question about space.',
  'Ask me which tone you should use from now on.',
]

const TONES = { friendly: 'Friendly', pirate: 'Pirate', formal: 'Formal', emoji: 'Emoji' }
const LENGTHS = { short: 'One sentence', medium: 'A paragraph', long: 'In depth' }

const FollowUps = z.object({
  questions: z.array(z.string().max(80)).min(2).max(3)
    .describe('Short follow-up questions the user might ask next, written as the user would type them'),
})

const TOOL_LABELS = {
  page_add_items: 'Add to the list',
  page_check_item: 'Check off',
  page_clear_list: 'Clear the list',
  page_set_style: 'Change the answer style',
}

/** a tool call: running (…), done (✓) or failed (✗, with why) */
function toolLine(p) {
  const name = p.type.slice('tool-'.length)
  const failed = p.state === 'output-error' || p.output?.ok === false
  return (
    <span className={classes('tool-line', { failed })}>
      {p.state === 'input-available' ? '…' : failed ? '✗' : '✓'} {TOOL_LABELS[name] ?? name} <code>{name}</code>
      {failed && `: ${p.errorText ?? p.output?.error}`}
    </span>
  )
}

/** the `choose` client tool: its question, and a button per option until you pick one */
function choice(p) {
  const open = p.state === 'input-available'
  return (
    <div className="bc-choice">
      <b>{p.input?.question}</b>
      <div className="bc-options">
        {(p.input?.options ?? []).map((option) => (
          <button type="button" className={classes('pick', { picked: p.output?.picked === option })} data={{ call: p.toolCallId, option }} disabled={!open}>{option}</button>
        ))}
      </div>
    </div>
  )
}

function part(p) {
  if (p.type === 'reasoning') return <details className="reasoning"><summary>Thought it through</summary>{p.text}</details>
  if (p.type === 'text') return p.text
  if (p.type === 'tool-choose') return choice(p)
  if (p.type.startsWith('tool-')) return toolLine(p)
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

function listPanel({ list }) {
  return (
    <section className="panel bc-side">
      <h3 className="panel-title">Shopping list <span className="badge blue">the model edits this</span></h3>
      {list.length === 0
        ? <p className="bc-empty">Empty. Ask the chat to add something.</p>
        : <ul className="bc-list">{list.map((item) => (
            <li><button type="button" className={classes('item', { done: item.done })} aria-pressed={String(item.done)} data={{ id: item.id }}>{item.text}</button></li>
          ))}</ul>}
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

          {state.chat.pending && (
            <div className="confirm-box" role="alertdialog" aria-label="Confirm">
              <p>The assistant wants to: <b>{state.chat.pending.description}</b></p>
              <button type="button" className="btn danger small approve">Allow</button>
              <button type="button" className="btn ghost small deny">Deny</button>
            </div>
          )}
          {status === 'error' && <p className="status-line error" role="alert">{error}</p>}
          {(status === 'ready' || status === 'error') && messages.length > 0 && openToolCalls(state.chat).length === 0 && (
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
          {listPanel(state)}
          {stylePanel(state)}
          {tokens(state)}
        </div>
      </div>
    </div>
  )
}

const NO_USAGE = { replies: 0, input: 0, output: 0, reasoning: 0 }

Chat.initialState = {
  list: [],
  nextId: 1,
  style: { tone: 'friendly', length: 'medium' },
  usage: NO_USAGE,
  followUps: { for: null, questions: [] },   // `for`: the id of the reply they follow
}

// what survives a reload: the conversation (the chat slice), the tally and the suggestions
Chat.persist = persist({ key: 'building-chat:8', pick: ['chat', 'usage', 'followUps', 'style', 'list', 'nextId'] })

Chat.uses = {
  chat: chat({
    form: '.ask', prompt: '.prompt', stop: '.stop', regenerate: '.retry', approve: '.approve', deny: '.deny',
    // a tool the app answers itself: its calls wait for TOOL_OUTPUT
    clientTools: {
      choose: {
        description: 'Ask the user to pick one of a few options; they answer with a click',
        inputSchema: z.object({ question: z.string().min(1).max(120), options: z.array(z.string().min(1).max(40)).min(2).max(5) }),
      },
    },
    instructions: 'You are the assistant in a demo chat, next to the user\'s shopping list. To change the list or the answer style, call the tools; never just say you did. Whenever the user has to pick between options, call choose with the question and 2 to 5 short options instead of listing them, then wait for the pick. Answer in the tone and length that `style` in the app state asks for (short: one sentence; medium: a paragraph; long: up to 250 words). Plain text, no Markdown.',
  }),
}

// what the model sees of the page, sent with every request (never stored in the conversation)
Chat.agent = {
  name: 'page',
  description: 'The demo page around the chat',
  read: (state) => ({ style: state.style, list: state.list }),
  untrusted: false,   // every string in `read` is the app's own
  // what the model may do: each action is a tool (page_add_items, ...), run by the reducer below
  actions: {
    ADD_ITEMS: {
      description: 'Add items to the shopping list',
      input: z.strictObject({ items: z.array(z.string().min(1).max(40)).min(1).max(12) }),
    },
    CHECK_ITEM: {
      description: 'Check an item off the list (done: true) or put it back (done: false), by its id in the app state',
      input: z.strictObject({ id: z.number().int(), done: z.boolean() }),
    },
    CLEAR_LIST: {
      description: 'Remove every item from the list',
      consequential: true,   // the user allows or denies it first
      when: (state) => state.list.length > 0,
    },
    SET_STYLE: {
      description: 'Change the answer style when the user asks for another tone or length',
      input: z.strictObject({ tone: z.enum(Object.keys(TONES)).optional(), length: z.enum(Object.keys(LENGTHS)).optional() }),
      idempotent: true,
    },
  },
}

Chat.intent = ({ DOM }) => ({
  EXAMPLE: DOM.click('.example').data('prompt'),
  CLEAR: DOM.click('.clear'),
  TOGGLE: DOM.click('.item').data('id', Number),
  PICK: DOM.click('.pick').target((b) => ({ toolCallId: b.dataset.call, output: { picked: b.dataset.option } })),
  TONE: DOM.click('.tone').data('value'),
  LENGTH: DOM.click('.length').data('value'),
})

Chat.model = {
  EXAMPLE: {
    STATE: (state, prompt) => ({ ...state, chat: { ...state.chat, prompt } }),
    ELEMENT: { focus: '.prompt' },
  },
  // the agent's actions: the same kind of reducer as a click
  ADD_ITEMS: (state, { items }) => ({
    ...state,
    list: [...state.list, ...items.map((text, i) => ({ id: state.nextId + i, text, done: false }))],
    nextId: state.nextId + items.length,
  }),
  CHECK_ITEM: (state, { id, done }) => (state.list.some((item) => item.id === id)
    ? { ...state, list: state.list.map((item) => (item.id === id ? { ...item, done } : item)) }
    : abort(`There is no item ${id} on the list`)),
  CLEAR_LIST: (state) => ({ ...state, list: [] }),
  SET_STYLE: (state, style) => ({ ...state, style: { ...state.style, ...style } }),
  // your clicks
  PICK: { EFFECT: (state, answer, next) => next('chat.TOOL_OUTPUT', answer) },
  TOGGLE: (state, id) => ({ ...state, list: state.list.map((item) => (item.id === id ? { ...item, done: !item.done } : item)) }),
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

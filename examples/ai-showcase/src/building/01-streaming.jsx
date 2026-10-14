// Step 1: a streaming chat.
//
// The `chat` behavior owns the conversation, in `state.chat`: the form's submit sends the prompt,
// the reply streams into `draft`, and the finished reply joins `messages`. `agent: false` makes it
// a plain chat (no tools). The view is all this file writes.
import { classes } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'

const EXAMPLES = [
  'Explain Model-View-Intent in two sentences.',
  'Write a haiku about streaming tokens.',
  'Name three coffee shops run by robots.',
]

export default function Chat({ state }) {
  const { messages, draft, status, prompt } = state.chat
  const busy = status === 'submitted' || status === 'streaming'
  return (
    <div className="w bc">
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

      <div className="examples">
        {EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }}>{e}</button>)}
      </div>

      <form className="composer ask">
        <input className="prompt" aria-label="Message" placeholder="Message Kimi K3…" value={prompt} />
        <button type="submit" className="btn" disabled={busy || !prompt.trim()}>Send</button>
      </form>
    </div>
  )
}

Chat.uses = {
  chat: chat({
    agent: false,
    form: '.ask', prompt: '.prompt',
    instructions: 'You are a friendly assistant in a demo chat. Keep answers under 120 words, in plain text (no Markdown).',
  }),
}

// an example fills in the prompt; you send it
Chat.intent = ({ DOM }) => ({ EXAMPLE: DOM.click('.example').data('prompt') })

Chat.model = {
  EXAMPLE: {
    STATE: (state, prompt) => ({ ...state, chat: { ...state.chat, prompt } }),
    ELEMENT: { focus: '.prompt' },
  },
}

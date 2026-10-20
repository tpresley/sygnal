import { ABORT } from 'sygnal'
import { toMarkdown } from '../panel.js'

function renderInlineMarkdown(text, keyPrefix) {
  const source = String(text || '')
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
  const parts = source.split(regex)

  return parts.map((part, index) => {
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>
    }

    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={`${keyPrefix}-i-${index}`}>{part.slice(1, -1)}</em>
    }

    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>
  })
}

function renderMarkdownBlock(content, keyPrefix) {
  const lines = String(content || '').split('\n')
  const blocks = []
  let paragraphLines = []
  let listItems = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const joined = paragraphLines.join(' ').trim()
    if (joined) {
      blocks.push(
        <p key={`${keyPrefix}-p-${blocks.length}`}>
          {renderInlineMarkdown(joined, `${keyPrefix}-p-${blocks.length}`)}
        </p>
      )
    }
    paragraphLines = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push(
      <ul key={`${keyPrefix}-ul-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${keyPrefix}-li-${index}`}>
            {renderInlineMarkdown(item, `${keyPrefix}-li-${index}`)}
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  lines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      return
    }

    const listMatch = line.match(/^[-*]\s+(.+)/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1].trim())
      return
    }

    flushList()
    paragraphLines.push(line)
  })

  flushParagraph()
  flushList()

  return blocks.length ? blocks : [<p key={`${keyPrefix}-empty`}>{content}</p>]
}

function entryView(entry, index) {
  return (
    <div className={`entry ${entry.kind}`} key={`${entry.speakerId}-${index}`}>
      <p className="entry-meta">
        {entry.speakerName}
        {entry.pickedBy ? <span className="picked-by">next speaker picked by {entry.pickedBy}</span> : null}
      </p>
      <div className="entry-content">
        {entry.thinking && !entry.content
          ? <p className="thinking">Thinking…</p>
          : renderMarkdownBlock(entry.content, `entry-${index}`)}
      </div>
    </div>
  )
}

function TranscriptCard({ state }) {
  const hasTranscript = state.transcript.length > 0
  const canAskFollowUp = state.phase === 'completed' && !!state.panel

  return (
    <article className="card transcript-card">
      <div className="transcript-header">
        <h2>Discussion Transcript</h2>
        <button
          type="button"
          className={state.copied ? 'copy-transcript success' : 'copy-transcript'}
          disabled={!hasTranscript}
          title={hasTranscript ? 'Copy transcript as markdown' : 'No transcript to copy yet'}
        >
          {state.copied ? 'Copied!' : 'Copy Markdown'}
        </button>
      </div>

      {hasTranscript || state.live ? (
        <div className="transcript" aria-live="polite">
          {state.transcript.map(entryView)}
          {state.live ? entryView(state.live, state.transcript.length) : null}
        </div>
      ) : (
        <div className="transcript-empty">
          <p>No discussion turns yet.</p>
        </div>
      )}

      {canAskFollowUp ? (
        <form className="followup-row">
          <input
            type="text"
            className="followup-input"
            placeholder="Ask a follow-up question (name a panelist to hear from them first)..."
            value={state.followUpInput}
          />
          <button type="submit" className="followup-submit" title="Submit follow-up" aria-label="Submit follow-up">→</button>
        </form>
      ) : null}
    </article>
  )
}

TranscriptCard.intent = ({ DOM }) => ({
  COPY: DOM.click('.copy-transcript'),
  SET_FOLLOW_UP: DOM.input('.followup-input').value(),
  ASK: DOM.select('.followup-row').events('submit', { preventDefault: true }),
})

const question = (state) => state.followUpInput.trim()

TranscriptCard.model = {
  COPY: { BROWSER: (state) => ({ copy: toMarkdown(state), ok: 'COPIED', error: 'COPY_FAILED' }) },
  COPIED: (state, _, next) => {
    next('COPY_RESET', null, 1400)
    return { ...state, copied: true }
  },
  COPY_RESET: (state) => ({ ...state, copied: false }),
  COPY_FAILED: (state, { message }) => ({ ...state, error: `Could not copy: ${message}` }),
  SET_FOLLOW_UP: (state, followUpInput) => ({ ...state, followUpInput }),
  // the root runs the follow-up: it owns the discussion's requests
  ASK: {
    STATE: (state) => (question(state) ? { ...state, followUpInput: '' } : ABORT),
    PARENT: (state, data, next, { previousState }) => (question(previousState) ? { question: question(previousState) } : ABORT),
  },
}

export default TranscriptCard

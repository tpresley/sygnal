import { appendLog, appendTranscript, extractRequestedSpeakerIds } from '../panelLogic.js'

function toMarkdown(state) {
  const lines = []
  lines.push('# Virtual Panel Transcript')
  lines.push('')
  lines.push('## Topic')
  lines.push(state.topic || 'Untitled topic')
  lines.push('')

  if (state.panel) {
    lines.push('## Panelists')
    lines.push(`- **Moderator:** ${state.panel.moderator.name} (${state.panel.moderator.role})`)
    state.panel.experts.forEach((expert) => {
      lines.push(`- **Expert:** ${expert.name} (${expert.role})`)
    })
    lines.push('')
  }

  lines.push('## Transcript')
  if (!Array.isArray(state.transcript) || state.transcript.length === 0) {
    lines.push('_No discussion turns yet._')
    return lines.join('\n')
  }

  state.transcript.forEach((entry, index) => {
    lines.push(`${index + 1}. **${entry.speakerName}**`)
    const indented = String(entry.content || '')
      .split('\n')
      .map((line) => `   ${line}`)
      .join('\n')
    lines.push(indented)
    lines.push('\n')
  })

  return lines.join('\n')
}

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

function TranscriptCard({ state, speakerById }) {
  const panel = state.panel
  const transcript = state.transcript || []
  const hasTranscript = transcript.length > 0
  const copied = state.copyTranscriptSuccess === true
  const canAskFollowUp = state.phase === 'completed' && !!state.panel

  return (
    <article className="card transcript-card">
      <div className="transcript-header">
        <h2>Discussion Transcript</h2>
        <button
          type="button"
          className={copied ? 'copy-transcript success' : 'copy-transcript'}
          disabled={!hasTranscript}
          title={hasTranscript ? 'Copy transcript as markdown' : 'No transcript to copy yet'}
        >
          {copied ? 'Copied!' : 'Copy Markdown'}
        </button>
      </div>

      {hasTranscript ? (
        <div className="transcript">
          {transcript.map((entry, index) => {
            const speaker = speakerById(panel, entry.speakerId)
            const isModerator = speaker?.id === panel?.moderator?.id

            return (
              <div className={isModerator ? 'entry moderator' : 'entry'} key={`${entry.speakerId}-${index}`}>
                <p className="entry-meta">{entry.speakerName}</p>
                <div className="entry-content">
                  {renderMarkdownBlock(entry.content, `entry-${index}`)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="transcript-empty">
          <p>No discussion turns yet.</p>
        </div>
      )}

      {canAskFollowUp ? (
        <div className="followup-row">
          <input
            type="text"
            className="followup-input"
            placeholder="Ask a follow-up question..."
            value={state.followUpInput || ''}
          />
          <button
            type="button"
            className="followup-submit"
            title="Submit follow-up"
            aria-label="Submit follow-up"
          >
            →
          </button>
        </div>
      ) : null}
    </article>
  )
}

TranscriptCard.intent = ({ DOM }) => ({
  COPY_TRANSCRIPT: DOM.select('.copy-transcript').events('click').mapTo(null),
  SET_FOLLOW_UP_INPUT: DOM.select('.followup-input').events('input').map((event) => event.target.value),
  SUBMIT_FOLLOW_UP: DOM.select('.followup-submit').events('click').mapTo(null),
  SUBMIT_FOLLOW_UP_ENTER: DOM.select('.followup-input').events('keydown')
    .filter((event) => event.key === 'Enter')
    .map((event) => {
      event.preventDefault()
      return null
    })
})

function submitFollowUp(state, _, next) {
  if (state.phase !== 'completed' || !state.panel) return state
  const question = String(state.followUpInput || '').trim()
  if (!question) return state

  const nextRunId = (state.runCounter || 0) + 1
  const requestedSpeakerIds = extractRequestedSpeakerIds(question, state.panel)
  const forceEnd = state.turnCount >= state.maxTurns

  next('REQUEST_FOLLOW_UP_MODERATOR', {
    question,
    requestedSpeakerIds,
    runId: nextRunId,
    forceEnd
  }, 0)

  return {
    ...state,
    phase: 'deliberating',
    pendingRequest: 'moderator-followup-plan',
    activeRunId: nextRunId,
    runCounter: nextRunId,
    followUpQuestion: question,
    followUpInput: '',
    pendingFollowUpQueue: [],
    discussionStarted: true,
    error: null,
    transcript: appendTranscript(state.transcript, {
      speakerId: 'user-followup',
      speakerName: 'You',
      content: question
    }),
    logs: appendLog(state.logs, 'Submitted follow-up question to moderator')
  }
}

TranscriptCard.model = {
  COPY_TRANSCRIPT: {
    STATE: (state, _, next) => {
      next('CLEAR_COPY_TRANSCRIPT_SUCCESS', null, 1400)
      return {
        ...state,
        copyTranscriptSuccess: true,
        logs: appendLog(state.logs, 'Copied transcript to clipboard as markdown')
      }
    },
    CLIPBOARD: (state) => ({ text: toMarkdown(state) })
  },
  CLEAR_COPY_TRANSCRIPT_SUCCESS: (state) => ({
    ...state,
    copyTranscriptSuccess: false
  }),
  SET_FOLLOW_UP_INPUT: (state, value) => ({
    ...state,
    followUpInput: value
  }),
  SUBMIT_FOLLOW_UP: submitFollowUp,
  SUBMIT_FOLLOW_UP_ENTER: submitFollowUp
}

export default TranscriptCard

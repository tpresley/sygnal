// The interaction catalog, the chat scenarios and the fit check (shared by tools.mjs and rescore-tools.mjs).
export const INTERACT_CATALOG = {
  root: 'page', maxDepth: 1,
  parts: [
    { id: 'question', description: 'Question card: a question and one button per answer option; the user taps one', params: {
      question: { description: 'the question', text: { maxLength: 100 } },
      options: { description: 'the answer options, one per button', list: { min: 2, max: 6, maxLength: 40 } } } },
    { id: 'textInput', repeatable: true, description: 'Text field: the user types a short answer', params: { label: { description: 'what to type', text: { maxLength: 60 } } } },
    { id: 'dateInput', repeatable: true, description: 'Date and time picker', params: { label: { description: 'what the date is for', text: { maxLength: 60 } } } },
    { id: 'confirm', description: 'Confirm card: one proposed action with Confirm and Cancel buttons', params: { action: { description: 'the action to confirm, in a sentence', text: { maxLength: 120 } } } },
    { id: 'cardChoice', description: 'Cards: alternatives already proposed in the conversation, one card each; the user picks one', params: { cards: { description: 'the alternatives, one short title each', list: { min: 2, max: 4, maxLength: 60 } } } },
    { id: 'rating', description: 'Rating: the user rates something from 1 to 5 stars', params: { subject: { description: 'what is rated', text: { maxLength: 60 } } } },
  ],
}

const u = (content) => ({ role: 'user', content })
const a = (content) => ({ role: 'assistant', content })
const call = (args) => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'ask_user', arguments: args } }] })
const result = (content) => ({ role: 'tool', content })

// call: true | false | 'either'; accept: parts allowed; need: at least one of these; text: needles in the args' strings (all)
export const SCENARIOS = [
  { id: 't1', messages: [u('Book me a table at Luigi\'s for Friday evening.')], call: true, accept: ['question', 'textInput', 'dateInput'], need: ['question', 'textInput'], note: 'party size / time missing' },
  { id: 't2', messages: [u('What is the capital of France?')], call: false },
  { id: 't3', messages: [u('Delete everything in my Old Photos album, 1,240 photos.')], call: true, accept: ['confirm'], need: ['confirm'], text: ['photo'] },
  { id: 't4', messages: [u('I need a name for my bakery.'), a('Here are three ideas: 1. Rise & Shine, 2. The Daily Crumb, 3. Butter Lane. Which one do you like?'), u('Hmm, show them to me so I can pick')], call: true, accept: ['cardChoice', 'question'], need: ['cardChoice', 'question'], text: ['crumb', 'butter'] },
  { id: 't5', messages: [u('Remind me to call my mom.')], call: true, accept: ['dateInput', 'question', 'textInput'], need: ['dateInput', 'question'], note: 'when?' },
  { id: 't6', messages: [u('Thanks, that is all for today!')], call: false },
  { id: 't7', messages: [u('Translate "good morning" into Spanish.')], call: false },
  { id: 't8', messages: [u('Order my usual pizza.'), call({ children: [{ part: 'question', params: { question: 'Which size?', options: ['Medium', 'Large'] } }] }), result('Large')], call: 'either', accept: ['confirm'], need: ['confirm'], note: 'answer arrived: go on (or confirm the order)' },
  { id: 't9', messages: [u('I finished the essay draft you helped with. Ask me how it went so you can improve.')], call: true, accept: ['rating', 'textInput', 'question'], need: ['rating', 'question', 'textInput'] },
  { id: 't10', messages: [u('Change my shipping address.')], call: true, accept: ['textInput', 'question'], need: ['textInput'] },
  { id: 't11', messages: [u('Which is bigger, a kilometre or a mile?')], call: false },
  { id: 't12', messages: [u('Book a flight to Tokyo.'), a('I found two: A) ANA, nonstop, $1,240, departs 10:05. B) United, one stop, $890, departs 07:30.'), u('Let me choose between them')], call: true, accept: ['cardChoice', 'question'], need: ['cardChoice', 'question'], text: ['ana', 'united'] },
]

export function fit(s, layout) {
  const parts = Object.values(layout.nodes).map((n) => n.part).filter((p) => p !== 'page')
  if (!parts.length) return false
  const strings = JSON.stringify(Object.values(layout.nodes).map((n) => n.params || {})).toLowerCase()
  return parts.every((p) => s.accept.includes(p)) && parts.some((p) => s.need.includes(p)) && (s.text || []).every((t) => strings.includes(t))
}

export const INTERACT = INTERACT_CATALOG

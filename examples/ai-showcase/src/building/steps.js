// The "Building Chat" tab: one chat, built up a feature at a time. Each step is a complete Sygnal
// app (Chat.jsx), the previous step's code plus one feature, all on one model (kimi.js). The code
// panel marks the lines that are new since the step before.
import './building.css'

const step = (n, load, loadSource, loadPrevious) => () => Promise.all([
  load(), loadSource(), loadPrevious?.(), import('./kimi.js'), import('./kimi.js?raw'),
]).then(([mod, src, prev, kimi, kimiSrc]) => ({
  start: (mountPoint, uid) => kimi.start(mod.default, mountPoint, uid),
  files: { 'Chat.jsx': src.default, 'kimi.js': kimiSrc.default },
  // the source to compare with: its new lines are marked
  ...(prev && { changedSince: { 'Chat.jsx': { source: prev.default, label: `step ${n - 1}` } } }),
}))

const KIMI = ['kindo-kimi']

export const steps = [
  {
    id: 'chat-streaming',
    title: 'A streaming chat',
    blurb: 'The `chat` behavior owns the conversation: the form sends the prompt, the reply streams into `draft`, and the finished reply joins `messages`. The view is the only code you write. The example chips fill in the prompt; you send it.',
    apis: ['chat({ agent: false })', 'state.chat', 'draft', 'messageText', 'ELEMENT focus'],
    providers: KIMI,
    load: step(1, () => import('./01-streaming.jsx'), () => import('./01-streaming.jsx?raw')),
  },
  {
    id: 'chat-stop-retry',
    title: 'Stop, retry, start over',
    blurb: 'Two more selectors: `stop` aborts the reply and keeps what has streamed, `regenerate` sends the last message again, for a reply you didn\'t like or one that failed. Clearing the chat is the app\'s own reducer: the conversation is just state.',
    apis: ['stop', 'regenerate', 'status: error', 'error'],
    providers: KIMI,
    load: step(2, () => import('./02-stop-retry.jsx'), () => import('./02-stop-retry.jsx?raw'), () => import('./01-streaming.jsx?raw')),
  },
  {
    id: 'chat-thinking',
    title: 'Show the thinking, count the tokens',
    blurb: 'Kimi K3 reasons before it answers. The reasoning streams ahead of the text and stays on the reply as a part of its own, folded away. A host entry `chat.DONE` runs after every reply with its token usage, and a tally beside the chat adds it up.',
    apis: ['draftReasoning', 'reasoning parts', "'chat.DONE'", 'usage'],
    providers: KIMI,
    load: step(3, () => import('./03-thinking.jsx'), () => import('./03-thinking.jsx?raw'), () => import('./02-stop-retry.jsx?raw')),
  },
  {
    id: 'chat-follow-ups',
    title: 'Suggested follow-ups',
    blurb: 'After each reply the app makes one more request on the same driver: the conversation so far, with an `output` schema for two or three follow-up questions. The driver validates the answer, and the questions become chips that fill in the prompt.',
    apis: ['output: zod schema', 'value', 'one-off request', 'key'],
    providers: KIMI,
    load: step(4, () => import('./04-follow-ups.jsx'), () => import('./04-follow-ups.jsx?raw'), () => import('./03-thinking.jsx?raw')),
  },
  {
    id: 'chat-remember',
    title: 'Remember the conversation',
    blurb: 'One `persist()` declaration saves the conversation, the tally and the suggestions in this browser. Tell it something, reload the page, and ask what it remembers. New chat is still a reducer; the saved copy follows the state.',
    apis: ['persist()', 'pick', 'localStorage'],
    providers: KIMI,
    load: step(5, () => import('./05-remember.jsx'), () => import('./05-remember.jsx?raw'), () => import('./04-follow-ups.jsx?raw')),
  },
  {
    id: 'chat-sees',
    title: 'It sees the page',
    blurb: 'An `agent` declaration says what a model may see of the app: `read` is a projection of the state, sent with every request. Here it is the answer style you set beside the chat. Change the tone halfway through a conversation, and the next reply follows it.',
    apis: ['agent static', 'read', 'untrusted: false'],
    providers: KIMI,
    load: step(6, () => import('./06-sees-the-page.jsx'), () => import('./06-sees-the-page.jsx?raw'), () => import('./05-remember.jsx?raw')),
  },
  {
    id: 'chat-changes',
    title: 'It changes the page',
    blurb: 'Each of the agent\'s `actions` becomes a tool, with a zod schema for its input. A call runs through the same reducer as a click: the model fills in the shopping list, checks things off and changes its own answer style. Clearing the list is `consequential`, so it asks you first.',
    apis: ['actions', 'input: zod', 'consequential', 'APPROVE / DENY', 'tool parts', 'abort()'],
    providers: KIMI,
    load: step(7, () => import('./07-changes-the-page.jsx'), () => import('./07-changes-the-page.jsx?raw'), () => import('./06-sees-the-page.jsx?raw')),
  },
  {
    id: 'chat-click',
    title: 'Answers with a click',
    blurb: 'A client tool is one the app answers itself. When the model calls `choose`, the call stays open in the reply as a question with a button per option; your click is the tool\'s output, and the model carries on from it.',
    apis: ['clientTools', 'TOOL_OUTPUT', 'open tool calls'],
    providers: KIMI,
    load: step(8, () => import('./08-answers-with-a-click.jsx'), () => import('./08-answers-with-a-click.jsx?raw'), () => import('./07-changes-the-page.jsx?raw')),
  },
]

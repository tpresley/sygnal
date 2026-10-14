// The sections, in page order. Each widget is its own Sygnal app, loaded and started when its
// section scrolls near the screen, so one widget's drivers, requests or errors never touch another.
// A demo module exports `start(mountPoint, uid)` (returns the app) and `files` (its source, shown
// in the code panel).
export const sections = [
  {
    id: 'any-model',
    title: 'Any model, same component',
    blurb: 'A chat request is a driver request, like HTTP: the reply streams back as actions. Pick a model on Ollama, on Kindo through any of its three wire formats, or Chrome\'s on-device model. The component never changes; only the transport under the driver does. Turn on thinking to watch a reasoning model\'s reasoning stream before its answer.',
    apis: ['makeChatDriver', 'openResponses', 'chatCompletions', 'anthropicMessages', 'chromePrompt', 'delta / ok / abort'],
    providers: ['ollama', 'kindo', 'chrome'],
    load: () => import('./demos/any-model/index.js'),
  },
  {
    id: 'structured',
    title: 'Structured output',
    blurb: 'Give a request an `output` schema (zod here) and the model answers with JSON that the driver parses and validates. The component gets a typed value, or the schema\'s issues. Paste a messy email and get an event you can review.',
    apis: ['output: zod schema', 'value', 'issues'],
    providers: ['ollama', 'kindo'],
    load: () => import('./demos/structured/index.js'),
  },
  {
    id: 'tools',
    title: 'Tools',
    blurb: 'The model calls tools the app declares; each call arrives as a `tool` action before the reply ends, the app runs it, writes the result into the message with `withToolResults`, and sends the conversation back. Every call shows inline in the transcript.',
    apis: ['tools', 'tool action', 'withToolResults', 'finishReason'],
    providers: ['ollama', 'kindo'],
    load: () => import('./demos/tools/index.js'),
  },
  {
    id: 'decisions',
    title: 'Decision models',
    blurb: 'A decision model answers typed questions (`choice`, `noul`, `score`) with calibrated probabilities in a few hundred milliseconds, and writes no text. Here it triages a support ticket as a resource, so it decides again as you type. When it isn\'t sure, the ticket goes to a person.',
    apis: ['decide()', 'choice', 'noul', 'score', 'resources'],
    providers: ['ollama-decision', 'typesafe'],
    load: () => import('./demos/decisions/index.js'),
  },
  {
    id: 'command-bar',
    title: 'Command bar',
    blurb: 'One line of text, one action. The board declares what an agent may do with the `agent` static; the command bar asks a decision model which action and which card the command means. A sure answer runs, a consequential one asks first, and an unsure one runs nothing.',
    apis: ['agent static', 'commandBar()', 'consequential', 'below'],
    providers: ['ollama-decision', 'typesafe'],
    load: () => import('./demos/command-bar/index.js'),
  },
  {
    id: 'assistant',
    title: 'An assistant that operates the app',
    blurb: 'The same kind of `agent` declaration turns into tools for a chat model. The `chat` behavior runs the tool loop: every call is validated, goes through the same reducers as a click, and asks you before anything consequential. The panel on the right is exactly what the model sees.',
    apis: ['chat()', 'agent.read', 'agent.queries', 'agentTools()', 'APPROVE / DENY'],
    providers: ['ollama', 'kindo'],
    load: () => import('./demos/assistant/index.js'),
  },
  {
    id: 'compose',
    title: 'UI composed by a model',
    blurb: 'Describe the page you want, and a model arranges it from parts the app prepared. It picks parts and their settings; it never writes markup. Use a decision model (fast, from probabilities) or a chat model filling a schema (streams a preview). Then ask for changes.',
    apis: ['defineCatalog', 'compose()', 'compose.decisions()', 'compose.llm()', 'catalog.render'],
    providers: ['ollama', 'kindo', 'typesafe'],
    load: () => import('./demos/compose/index.js'),
  },
  {
    id: 'cards',
    title: 'Cards in a chat',
    blurb: 'When the assistant needs you to pick, confirm, fill in or rate something, it calls `ask_user`, and the app builds a card from its own parts. Your answer goes back to the model as the tool\'s result, and the conversation continues from it.',
    apis: ['chat({ ask })', 'askCard', 'compose.answer', 'result parts'],
    providers: ['ollama', 'kindo'],
    load: () => import('./demos/cards/index.js'),
  },
  {
    id: 'webmcp',
    title: 'WebMCP: tools for the browser\'s agent',
    blurb: 'One call offers the app\'s `agent` tools to the browser\'s own agent, and `formTool` turns a validated form into a tool. The console below lists what is registered as it changes and lets you call a tool the way an agent would. In Chrome with WebMCP enabled the real browser agent sees the same tools.',
    apis: ['experimentalExposeWebMcp', 'formTool', 'registerTool'],
    providers: ['none'],
    load: () => import('./demos/webmcp/index.js'),
  },
  {
    id: 'mcp-app',
    title: 'MCP App: Kindo agents inside Claude',
    blurb: 'An MCP App goes the other way: the app shows up inside the conversation. This one is a separate example (`examples/mcp-kindo-agents`): ask Claude to run one of your Kindo agents, and its view shows the agent\'s inputs, starts the run, follows it step by step and hands the result back to the model.',
    apis: ['makeMcpAppDriver', 'callTool', 'message', 'app-only tools'],
    providers: ['kindo'],
    load: () => import('./demos/mcp-app/index.js'),
  },
]

export const PROVIDER_LABELS = {
  ollama: 'Ollama',
  'ollama-decision': 'Ollama · nimble',
  kindo: 'Kindo',
  'kindo-kimi': 'Kindo · Kimi K3',
  typesafe: 'TypeSafe · Jev',
  chrome: 'Chrome AI',
  none: 'No model needed',
}

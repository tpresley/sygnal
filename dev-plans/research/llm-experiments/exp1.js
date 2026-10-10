// Experiment 1: the prototype LLM driver in a real Sygnal component (renderComponent, real
// driver), against the mock Anthropic / OpenAI Responses servers and the AI SDK mock model.
// Measures renders per streamed reply with each coalescing mode, checks abort/latest, tool
// calls, and the round trip of a tool result.
import {renderComponent, createElement as h} from 'sygnal';
import {makeLLMDriver} from './llmDriver.js';
import {anthropic, openaiResponses, fromAISDK, typesafeDecision} from './adapters.js';
import {startMock} from './mockServer.js';
import {streamText, jsonSchema, simulateReadableStream} from 'ai';
import {MockLanguageModelV4} from 'ai/test';

let renders = 0;
function Chat({state}) {
  renders++;
  return h('div', null, ...state.messages.map(m => h('p', {class: m.role}, m.parts ? m.parts.map(p => p.text ?? `[${p.name}]`).join('') : m.content)), state.draft ? h('p', {class: 'draft'}, state.draft) : null);
}
Chat.initialState = {messages: [], draft: '', status: 'idle', toolCalls: [], turns: 0};
Chat.model = {
  SEND: {
    STATE: (s, text) => ({...s, messages: [...s.messages, {role: 'user', content: text}], status: 'streaming', draft: ''}),
    LLM: (s, text) => ({messages: [...s.messages, {role: 'user', content: text}], tools: s.tools, key: 'chat', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL'}),
  },
  STOP: {STATE: s => ({...s, status: 'stopped'}), LLM: () => ({abort: 'chat'})},
  DELTA: (s, {text}) => ({...s, draft: text}),
  TOOL: (s, {call}) => ({...s, toolCalls: [...s.toolCalls, call]}),
  DONE: (s, {message, reason}) => ({...s, messages: [...s.messages, message], draft: '', status: 'idle', reason, turns: s.turns + 1}),
  FAILED: (s, {error}) => ({...s, status: 'error', error: String(error), turns: s.turns + 1}),
};

const results = [];
async function trial(name, adapter, {coalesce, text = 'hi', tools, initial} = {}) {
  renders = 0;
  const t0 = performance.now();
  const t = renderComponent(Chat, {drivers: {LLM: makeLLMDriver({adapter, coalesce})}, initialState: {...Chat.initialState, tools, ...initial}});
  await t.ready();
  const r0 = renders;
  t.simulateAction('SEND', text);
  const s = await t.waitForState(s => s.turns > 0, 20000);
  const out = {name, coalesce, renders: renders - r0, ms: Math.round(performance.now() - t0), status: s.status, reason: s.reason, chars: s.messages.at(-1)?.parts?.[0]?.text?.length, error: s.error, toolCalls: s.toolCalls.map(c => `${c.name}(${JSON.stringify(c.input)})`).join(' ')};
  results.push(out);
  t.dispose();
  return {state: s, out};
}

const mock = await startMock({tokens: 300, delayMs: 1, perChunk: 1});
const A = anthropic({baseURL: `${mock.url}/anthropic`, model: 'claude-x'});
const O = openaiResponses({baseURL: `${mock.url}/openai`, model: 'gpt-x'});
for (const coalesce of ['none', 'microtask', 'frame']) {
  await trial('anthropic 300 tok', A, {coalesce});
  await trial('openai-responses 300 tok', O, {coalesce});
}

// tools: a client-side tool call comes back as TOOL, then the app sends the result
const tools = {weather: {description: 'Weather for a city', parameters: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']}}};
const {state: afterTool} = await trial('anthropic + tool', A, {coalesce: 'frame', tools});
await trial('openai-responses + tool', O, {coalesce: 'frame', tools});
// round trip: assistant tool-call message + a tool result → wire formats are accepted
await trial('anthropic tool result round trip', A, {coalesce: 'frame', initial: {messages: [...afterTool.messages, {role: 'tool', parts: [{id: 'toolu_1', name: 'weather', output: {temp: 27}}]}]}, text: 'thanks'});
const sentAnthropic = mock.log.at(-1).json.messages.slice(-3);

// abort: STOP mid-stream; nothing arrives after it, the server sees the socket close
{
  renders = 0;
  const slow = await startMock({tokens: 2000, delayMs: 2});
  const t = renderComponent(Chat, {drivers: {LLM: makeLLMDriver({adapter: anthropic({baseURL: `${slow.url}/anthropic`, model: 'm'})})}});
  await t.ready();
  t.simulateAction('SEND', 'go');
  await t.waitForState(s => s.draft.length > 50);
  t.simulateAction('STOP');
  const atStop = t.state.draft.length;
  await t.settle?.().catch(() => {});
  await new Promise(r => setTimeout(r, 200));
  results.push({name: 'abort mid-stream', status: t.state.status, draftAfterStop: t.state.draft.length, atStop, messages: t.state.messages.length});
  t.dispose();
  slow.close();
}

// latest: a second SEND while the first streams cancels the first (same key)
{
  const slow = await startMock({tokens: 400, delayMs: 2});
  const t = renderComponent(Chat, {drivers: {LLM: makeLLMDriver({adapter: openaiResponses({baseURL: `${slow.url}/openai`, model: 'm'})})}});
  await t.ready();
  t.simulateAction('SEND', 'one');
  await t.waitForState(s => s.draft.length > 20);
  t.simulateAction('SEND', 'two');
  const s = await t.waitForState(s => s.turns > 0, 10000);
  await new Promise(r => setTimeout(r, 300));
  results.push({name: 'latest supersedes', assistantReplies: s.messages.filter(m => m.role === 'assistant').length, userMsgs: s.messages.filter(m => m.role === 'user').length});
  t.dispose();
  slow.close();
}

// AI SDK bridge over its mock model (stands in for any of its ~40 providers)
const chunks = [{type: 'stream-start', warnings: []}, {type: 'text-start', id: 't'},
  ...Array.from({length: 300}, (_, i) => ({type: 'text-delta', id: 't', delta: `w${i} `})), {type: 'text-end', id: 't'},
  {type: 'tool-call', toolCallId: 'c1', toolName: 'weather', input: '{"city":"Hilo"}'},
  {type: 'finish', finishReason: {unified: 'tool-calls', raw: 'tool_use'}, usage: {inputTokens: {total: 10}, outputTokens: {total: 300}}}];
const aiModel = () => new MockLanguageModelV4({doStream: async () => ({stream: simulateReadableStream({chunks, chunkDelayInMs: 1})})});
for (const coalesce of ['none', 'frame']) await trial('ai-sdk bridge 300 tok', fromAISDK({streamText, model: aiModel(), jsonSchema}), {coalesce, tools});

// TypeSafe-shaped decision through the same driver (stub client: the real SDK needs a key)
{
  const D = function Triage({state}) { return h('p', null, state.category ?? '…'); };
  D.initialState = {ticket: 'I was charged twice', category: null};
  D.model = {
    BOOTSTRAP: {LLM: s => ({state: {document: s.ticket}, questions: {category: {type: 'choice', prompt: 'What is this about?', options: ['billing', 'technical', 'other']}}, ok: 'DECIDED'})},
    DECIDED: (s, d) => ({...s, category: d.answers?.category?.choice, raw: d}),
  };
  const stub = {systemOne: async ({state}) => ({answers: {category: {choice: /charged/.test(state.document) ? 'billing' : 'other'}}})};
  // the chat driver drops the 'answers' event: shows the shape mismatch
  const t = renderComponent(D, {drivers: {LLM: makeLLMDriver({adapter: typesafeDecision(stub)})}});
  const s = await t.waitForState(s => s.raw, 2000).catch(() => t.state);
  results.push({name: 'typesafe via chat driver', category: s.category, okDataKeys: s.raw && Object.keys(s.raw).join(',')});
  t.dispose();
}

mock.close();
console.table(results);
console.log('anthropic wire messages for the tool round trip:', JSON.stringify(sentAnthropic, null, 1));
process.exit(0);

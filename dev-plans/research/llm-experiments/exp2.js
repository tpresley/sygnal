// Experiment 2: the same prototype driver and component against a real local model (Ollama's
// Anthropic- and OpenAI-compatible endpoints), streaming + a client-side tool round trip.
import {renderComponent, createElement as h} from 'sygnal';
import {makeLLMDriver} from './llmDriver.js';
import {anthropic, openaiResponses} from './adapters.js';

const MODEL = process.argv[2] || 'llama3.2';
let renders = 0;
function Chat({state}) { renders++; return h('div', null, state.draft); }
Chat.initialState = {messages: [], draft: '', turns: 0, deltas: 0};
const tools = {weather: {description: 'Current weather for a city', parameters: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']}}};
const ask = s => ({messages: s.messages, tools, system: 'Use the weather tool when asked about weather. Be brief.', key: 'chat', delta: 'DELTA', ok: 'DONE', error: 'FAILED', tool: 'TOOL'});
Chat.model = {
  SEND: {STATE: (s, text) => ({...s, messages: [...s.messages, {role: 'user', content: text}]}),
    LLM: (s, text) => ask({...s, messages: [...s.messages, {role: 'user', content: text}]})},
  DELTA: (s, {text}) => ({...s, draft: text, deltas: s.deltas + 1}),
  // a client-side tool: the reducer runs it (a real app would use EFFECT or another driver)
  DONE: {
    STATE: (s, {message, toolCalls}) => {
      const messages = [...s.messages, message];
      if (toolCalls.length) messages.push({role: 'tool', parts: toolCalls.map(c => ({id: c.id, name: c.name, output: {city: c.input.city, tempC: 27, sky: 'light rain'}}))});
      return {...s, messages, draft: '', turns: s.turns + 1, lastToolCalls: toolCalls};
    },
    LLM: (s, {toolCalls}) => toolCalls.length
      ? ask({...s, messages: [...s.messages, {role: 'assistant', parts: []}, {role: 'tool', parts: toolCalls.map(c => ({id: c.id, name: c.name, output: {city: c.input.city, tempC: 27, sky: 'light rain'}}))}]})
      : undefined,
  },
  FAILED: (s, {error}) => ({...s, error: String(error?.body ?? error), turns: 99}),
};
// the LLM sink above rebuilds messages from pre-action state (handlers get the pre-action state),
// so the tool turn is sent with a placeholder; fix it with the assistant message from the reply:
Chat.model.DONE.LLM = (s, {message, toolCalls}) => toolCalls.length
  ? ask({...s, messages: [...s.messages, message, {role: 'tool', parts: toolCalls.map(c => ({id: c.id, name: c.name, output: {city: c.input.city, tempC: 27, sky: 'light rain'}}))}]})
  : undefined;

for (const [name, adapter] of [
  ['anthropic-compat /v1/messages', anthropic({baseURL: 'http://localhost:11434', model: MODEL})],
  ['openai-compat /v1/responses', openaiResponses({baseURL: 'http://localhost:11434', model: MODEL})],
]) {
  renders = 0;
  const t0 = performance.now();
  const t = renderComponent(Chat, {drivers: {LLM: makeLLMDriver({adapter})}});
  await t.ready();
  t.simulateAction('SEND', "What's the weather in Hilo right now? Answer in one sentence.");
  const s = await t.waitForState(s => s.turns >= 2 || (s.turns === 1 && !s.lastToolCalls?.length) || s.turns === 99, 180000);
  const final = s.messages.at(-1);
  console.log(`\n== ${name} (${MODEL}) ${Math.round(performance.now() - t0)} ms, renders ${renders}, DELTA actions ${s.deltas}`);
  if (s.error) console.log('error:', s.error);
  console.log('tool calls:', JSON.stringify(s.lastToolCalls));
  console.log('turns:', s.turns, 'final:', final?.parts?.map(p => p.text ?? `[${p.type} ${p.name}]`).join('') ?? final?.content);
  t.dispose();
}
process.exit(0);

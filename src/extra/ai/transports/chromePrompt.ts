import {partsOf} from './shared';
import {outputJsonSchema} from '../chat/output';

/*
 * PLAN-6 L-2: chromePrompt({ temperature?, topK?, expectedInputs?, expectedOutputs?, monitor?,
 * LanguageModel? }), a chat transport for Chrome's built-in Prompt API (`LanguageModel`, Gemini
 * Nano on device: no server, no key).
 *
 * - transport.status() resolves with `LanguageModel.availability(options)`: 'available',
 *   'downloadable', 'downloading' or 'unavailable' ('unavailable' too when the browser has no
 *   `LanguageModel`). Render it before offering the feature; the first create() of a
 *   'downloadable' model starts the download (and needs a user gesture), `monitor` sees progress.
 *   A component reads it through a driver (G-647): `run(App, { LLM: makeChatDriver({ transport }),
 *   MODEL: driverFromAsync(transport.status) })`, and `MODEL: { ok: 'MODEL_STATUS' }` asks.
 * - stream(): a session per request (destroyed after it): `initialPrompts` from `instructions`
 *   and every message before the last user message, then `promptStreaming(last user text,
 *   { signal, responseConstraint })`; each chunk is a text delta. `output` becomes the
 *   `responseConstraint` (its JSON Schema). An unavailable model fails the request with an Error
 *   whose `status` is 'unavailable'. The Prompt API has no tool calling yet: `tools` are not sent.
 * - System messages (G-630): the Prompt API takes one system prompt, as the first initial prompt
 *   (a 'system' entry anywhere else is a TypeError), so `instructions` and every system message's
 *   text, wherever it is in the conversation, are joined into it (as anthropicMessages and
 *   fromAISDK do).
 * - `LanguageModel` (option): the API object to use instead of the global (tests).
 */

export interface ChromePromptOptions {
  temperature?: number;
  topK?: number;
  expectedInputs?: unknown[];
  expectedOutputs?: unknown[];
  monitor?: (m: EventTarget) => void;
  LanguageModel?: any;
}

const textOf = (m: any) => partsOf(m).filter(p => p.type == 'text').map(p => p.text).join('');

export function chromePrompt(options: ChromePromptOptions = {}) {
  const {LanguageModel: given, ...create} = options;
  const api = () => given ?? (globalThis as any).LanguageModel;
  const io = {...(create.expectedInputs && {expectedInputs: create.expectedInputs}), ...(create.expectedOutputs && {expectedOutputs: create.expectedOutputs})};
  const status = async (): Promise<string> => {
    const LM = api();
    return LM ? await LM.availability(io) : 'unavailable';
  };
  return {
    status,
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const LM = api(), s = await status();
      if (s == 'unavailable') throw Object.assign(new Error(`chromePrompt: the on-device model is unavailable${LM ? '' : ' (this browser has no LanguageModel)'}`), {status: s});
      const sys = (m: any) => m.role == 'system';
      const system = [req.instructions, ...req.messages.filter(sys).map(textOf)].filter(Boolean).join('\n\n');
      const msgs = req.messages.filter((m: any) => !sys(m));
      let i = msgs.length - 1;
      while (i >= 0 && msgs[i].role != 'user') i--;
      if (i < 0) throw new Error('chromePrompt: no user message to answer');
      const last = msgs.splice(i, 1)[0];
      const session = await LM.create({
        ...create, signal,
        initialPrompts: [...(system ? [{role: 'system', content: system}] : []), ...msgs.map((m: any) => ({role: m.role, content: textOf(m)}))],
      });
      try {
        const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
        const chunks = session.promptStreaming(textOf(last), {signal, ...(o && {responseConstraint: o.schema})});
        if (chunks[Symbol.asyncIterator]) for await (const delta of chunks) yield {type: 'text', delta: String(delta)};
        else for (const r = chunks.getReader(); ;) {
          const {value, done} = await r.read();
          if (done) break;
          yield {type: 'text', delta: String(value)};
        }
        yield {type: 'finish', reason: 'stop'};
      } finally {
        session.destroy?.();
      }
    },
  };
}

import {partsOf, toolName} from './shared';
import {outputJsonSchema} from '../chat/output';

/*
 * PLAN-6 L-2 (wave 2): fromAISDK({ streamText, model, Output?, ...settings }), the AI SDK 7 in
 * process as a chat transport (checked against ai@7.0.137): SSR, a Node or edge server that runs
 * the app, tests against an AI SDK mock model, trusted desktop shells. The app passes
 * `streamText` (and `Output` for structured output), so sygnal never imports `ai` (D240, D209):
 * it is the app's dependency, at the app's version. In a browser the provider key would ship to
 * every visitor: use uiMessageStream() against a server route there.
 *
 * Request -> streamText({ ...settings, model, instructions, messages, tools, output?,
 * abortSignal }): `instructions` and the system messages' text as `instructions` (AI SDK 7
 * rejects system messages in `messages`), the other messages as ModelMessages (text, files as URL file parts, reasoning with
 * its providerMetadata as providerOptions, tool parts as tool-call parts plus a tool message with
 * their result: text / json, error-text, execution-denied; a provider-executed part's result stays
 * in the assistant message), each tool as `{ description, inputSchema }` with no `execute` (the
 * app runs it: the AI SDK returns the call), its schema as a Standard JSON Schema (the app's
 * driver validates the call), `output` as `Output.object({ schema })` (an Error without `Output`).
 * The request's `model` is not used (the `model` option is a LanguageModel object).
 *
 * Stream (`result.stream`, AI SDK 7; `fullStream` before it): text-delta / reasoning-delta ->
 * text / reasoning (a reasoning-end with providerMetadata closes the reasoning part with it);
 * tool-call -> tool call (`executed` when providerExecuted); tool-result / tool-error /
 * tool-output-denied -> tool-result / tool-error / tool-denied; source -> source-url /
 * source-document; file -> a file part (a data URL); finish -> finish (finishReason, usage in
 * the AI SDK names); abort -> finish 'abort'; error -> a thrown Error. Everything else ignored.
 */

export interface FromAISDKOptions {
  streamText: (options: any) => any;
  model: unknown;
  Output?: {object: (options: {schema: unknown}) => unknown};
  [setting: string]: unknown;
}

// a JSON Schema as a Standard JSON Schema the AI SDK accepts; validation is the app's (the driver, A-1)
const standard = (schema: any) => {
  const js = () => schema;
  return {'~standard': {version: 1, vendor: 'sygnal', validate: (value: any) => ({value}), jsonSchema: {input: js, output: js}}};
};

const result = (p: any) =>
  p.state == 'output-available' ? (typeof p.output == 'string' ? {type: 'text', value: p.output} : {type: 'json', value: p.output ?? null})
  : p.state == 'output-error' ? {type: 'error-text', value: p.errorText ?? 'error'}
  : p.state == 'output-denied' ? {type: 'execution-denied', ...(p.approval?.reason && {reason: p.approval.reason})}
  : undefined;

const textOf = (m: any) => partsOf(m).filter(p => p.type == 'text').map(p => p.text).join('');

/** a user / assistant message as AI SDK ModelMessages (one assistant message per step, a tool message with its results after it) */
export function toModelMessages(m: any): any[] {
  const out: any[] = [];
  let content: any[] = [], results: any[] = [];
  const flush = () => {
    if (content.length) out.push({role: m.role, content});
    if (results.length) out.push({role: 'tool', content: results});
    content = []; results = [];
  };
  for (const p of partsOf(m)) {
    const name = toolName(p), tool = name && p.input !== undefined && m.role == 'assistant';
    if (results.length && !tool) flush();
    if (p.type == 'text') content.push({type: 'text', text: p.text});
    else if (p.type == 'file') content.push({type: 'file', data: new URL(p.url), mediaType: p.mediaType, ...(p.filename && {filename: p.filename})});
    else if (p.type == 'reasoning' && m.role == 'assistant') content.push({type: 'reasoning', text: p.text, ...(p.providerMetadata && {providerOptions: p.providerMetadata})});
    else if (tool) {
      const o = result(p), r = o && {type: 'tool-result', toolCallId: p.toolCallId, toolName: name, output: o};
      content.push({type: 'tool-call', toolCallId: p.toolCallId, toolName: name, input: p.input ?? {}, ...(p.providerExecuted && {providerExecuted: true})});
      if (r) (p.providerExecuted ? content : results).push(r);
    }
  }
  flush();
  return out;
}

export function fromAISDK(options: FromAISDKOptions) {
  const {streamText, model, Output, ...settings} = options || ({} as FromAISDKOptions);
  if (typeof streamText != 'function') throw new TypeError("fromAISDK: pass the AI SDK's streamText: fromAISDK({ streamText, model }) with import { streamText } from 'ai'");
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
      if (o && !Output) throw new Error("fromAISDK: a request with `output` needs the AI SDK's Output: fromAISDK({ streamText, Output, model }) with import { streamText, Output } from 'ai'");
      const tools = Object.entries(req.tools || {});
      // AI SDK 7 takes system text only as `instructions`
      const sys = (m: any) => m.role == 'system';
      const instructions = [req.instructions, ...req.messages.filter(sys).map(textOf)].filter(Boolean).join('\n\n');
      const r = streamText({
        ...settings,
        model,
        ...(instructions && {instructions}),
        messages: req.messages.filter((m: any) => !sys(m)).flatMap(toModelMessages),
        ...(tools.length && {tools: Object.fromEntries(tools.map(([name, t]: [string, any]) => [name, {...(t?.description && {description: t.description}), inputSchema: standard(t?.inputSchema || {type: 'object', properties: {}})}]))}),
        ...(o && {output: Output!.object({schema: standard(o.schema)})}),
        abortSignal: signal,
      });
      for await (const p of (r.stream ?? r.fullStream) as AsyncIterable<any>) {
        const t = p?.type;
        if (t == 'text-delta' || t == 'reasoning-delta') yield {type: t.slice(0, -6), delta: p.text ?? p.delta ?? ''};
        else if (t == 'reasoning-end') { if (p.providerMetadata) yield {type: 'reasoning', delta: '', providerMetadata: p.providerMetadata}; }
        else if (t == 'tool-call') yield {type: 'tool-call', id: p.toolCallId, name: p.toolName, input: p.input, ...(p.providerExecuted && {executed: true, providerExecuted: true})};
        else if (t == 'tool-result') yield {type: 'tool-result', id: p.toolCallId, output: p.output};
        else if (t == 'tool-error') yield {type: 'tool-error', id: p.toolCallId, error: String(p.error?.message ?? p.error)};
        else if (t == 'tool-output-denied') yield {type: 'tool-denied', id: p.toolCallId};
        else if (t == 'source') yield p.sourceType == 'url' ? {type: 'source-url', sourceId: p.id, url: p.url, ...(p.title && {title: p.title})} : {type: 'source-document', sourceId: p.id, mediaType: p.mediaType, title: p.title, ...(p.filename && {filename: p.filename})};
        else if (t == 'file' && p.file) yield {type: 'file', mediaType: p.file.mediaType, url: `data:${p.file.mediaType};base64,${p.file.base64}`};
        else if (t == 'finish') {
          const u = p.totalUsage;
          yield {type: 'finish', reason: p.finishReason, usage: u && {inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens, ...(u.outputTokenDetails?.reasoningTokens != null && {reasoningTokens: u.outputTokenDetails.reasoningTokens})}};
        }
        else if (t == 'abort') yield {type: 'finish', reason: 'abort'};
        else if (t == 'error') throw p.error instanceof Error ? p.error : new Error('fromAISDK: ' + (p.error?.message ?? String(p.error)));
      }
    },
  };
}

import {post, sse, json, partsOf, toolName} from './shared';
import type {HttpOptions} from './shared';
import {outputJsonSchema} from '../chat/output';

/*
 * PLAN-6 L-2: uiMessageStream(url, { headers?, fetch?, body?, dangerouslyAllowBrowser? }), a chat
 * transport for an AI SDK server (the production default, D243): a route that answers with
 * `result.toUIMessageStreamResponse()` / `createUIMessageStreamResponse()` (AI SDK 7's UI message
 * stream protocol v1: SSE, header `x-vercel-ai-ui-message-stream: v1`, `data: [DONE]` at the end).
 *
 * Request: the body DefaultChatTransport sends (`{ id, messages, trigger: 'submit-message',
 * messageId }`; `messageId` when the request continues the last message, `continue: true`, G-628, so `convertToModelMessages(messages)` works on the server as is: the messages
 * are UIMessages, D252; their ids as given, G-640: the chat behavior and driver give every message a
 * stable one; `m<index>` only for a message written without one), plus what the server may use: `instructions`, `model`, `tools` (name ->
 * { description, inputSchema }: client tools the server can declare without `execute`) and
 * `output` (`{ schema }`); `body` merged in.
 *
 * Response: a version other than v1 in the header fails the request with a clear Error (a
 * missing header is accepted: proxies strip headers). Chunks:
 * - `start` -> start (the message id); text-delta / reasoning-delta -> text / reasoning;
 * - `tool-input-available` -> a tool call, held until the step ends: a call the server answers
 *   (tool-output-available / -error / -denied, tool-approval-request) is yielded `executed: true`
 *   (the app doesn't run it; no `tool` reply), a call still open when the step or stream ends is
 *   a client tool call (the `tool` reply); `tool-input-error` -> an executed call + tool-error;
 * - `tool-approval-request` -> tool-approval (the part goes to `approval-requested`; the app
 *   answers by setting the part to `approval-responded` and sending the messages again, as with
 *   the AI SDK's addToolApprovalResponse); `tool-output-denied` -> tool-denied; the output of an
 *   approved call (the next request: only `tool-output-available` comes back) is yielded as
 *   that call (name and input from the request's messages) + its result, in the new message;
 * - `data-*` parts -> data events (a transient one is skipped: it isn't part of the message);
 *   `file`, `source-url`, `source-document` -> as is;
 * - `finish` -> finish (finishReason); `abort` -> finish ('abort'); `error` -> a thrown Error;
 * - everything else (text-start/end, tool-input-start/delta, start-step, message-metadata, ...)
 *   is ignored.
 */

export interface UIMessageStreamOptions extends HttpOptions {}

const VERSION = 'v1';
const ONE = /^(start-step|finish-step|finish)$/;

export function uiMessageStream(url: string, options: UIMessageStreamOptions = {}) {
  return {
    async *stream(req: any, signal: AbortSignal): AsyncGenerator<any, void, any> {
      const o = req.output !== undefined ? outputJsonSchema(req.output) : undefined;
      const messages = req.messages.map((m: any, i: number) => ({id: m.id ?? `m${i}`, role: m.role, parts: partsOf(m), ...(m.metadata !== undefined && {metadata: m.metadata})}));
      const last = messages[messages.length - 1];
      const res = await post(url, {
        ...(req.instructions && {instructions: req.instructions}),
        ...(req.model && {model: req.model}),
        ...(req.tools && {tools: req.tools}),
        ...(o && {output: o}),
      }, req, signal, options, 'uiMessageStream', {
        // the protocol fields: merged after `body`, which can't override them (G-654)
        ...(req.chatId != null && {id: req.chatId}),
        messages,
        trigger: 'submit-message',
        // G-628: a continued assistant message (DefaultChatTransport's messageId)
        ...(req.continue === true && last?.role == 'assistant' && {messageId: last.id}),
      });
      const v = res.headers?.get?.('x-vercel-ai-ui-message-stream');
      if (v && v != VERSION) {
        res.body.cancel?.().catch?.(() => {});
        throw Object.assign(new Error(`uiMessageStream: the server speaks UI message stream ${v}; this transport speaks ${VERSION} (AI SDK 7). Update sygnal, or pin the server's ai package to a version that sends ${VERSION}`), {version: v});
      }
      // client tool calls not yet answered by the server, in order
      let open: any[] = [];
      // the call `id` as an executed call: an open one, or one from the request's messages (the
      // server runs an approved call on the next request and sends only its output); [] once yielded
      const yielded = new Set<string>();
      const take = (id: string) => {
        if (yielded.has(id)) return [];
        yielded.add(id);
        const i = open.findIndex(c => c.id === id);
        if (i >= 0) return [{...open.splice(i, 1)[0], executed: true}];
        for (const m of req.messages) for (const p of partsOf(m)) {
          const name = toolName(p);
          if (name && p.toolCallId === id) return [{type: 'tool-call', id, name, input: p.input, executed: true}];
        }
        return [];
      };
      for await (const {data} of sse(res)) {
        if (data == '[DONE]') break;
        const c = json(data), t = c?.type;
        if (typeof t != 'string') continue;
        if (ONE.test(t)) { for (const o of open) yielded.add(o.id); yield* open; open = []; }
        if (t == 'text-delta' || t == 'reasoning-delta') yield {type: t.slice(0, -6), delta: c.delta};
        else if (t == 'start') { if (c.messageId != null) yield {type: 'start', id: c.messageId}; }
        else if (t == 'tool-input-available') open.push({type: 'tool-call', id: c.toolCallId, name: c.toolName, input: c.input, ...(c.providerExecuted && {executed: true, providerExecuted: true})});
        else if (t == 'tool-input-error') yield* [{type: 'tool-call', id: c.toolCallId, name: c.toolName, input: c.input, executed: true}, {type: 'tool-error', id: c.toolCallId, error: c.errorText}];
        else if (t == 'tool-output-available') yield* [...take(c.toolCallId), {type: 'tool-result', id: c.toolCallId, output: c.output}];
        else if (t == 'tool-output-error') yield* [...take(c.toolCallId), {type: 'tool-error', id: c.toolCallId, error: c.errorText}];
        else if (t == 'tool-output-denied') yield* [...take(c.toolCallId), {type: 'tool-denied', id: c.toolCallId}];
        else if (t == 'tool-approval-request') {
          yield* take(c.toolCallId);
          yield {type: 'tool-approval', id: c.toolCallId, approval: {id: c.approvalId, ...(c.reason && {requestReason: c.reason}), ...(c.approvalDescriptor !== undefined && {descriptor: c.approvalDescriptor}), ...(c.isAutomatic && {isAutomatic: true}), ...(c.signature && {signature: c.signature})}};
        }
        else if (t.startsWith('data-')) { if (!c.transient) yield {type: t, ...(c.id != null && {id: c.id}), data: c.data}; }
        else if (t == 'file' || t == 'source-url' || t == 'source-document') { const {providerMetadata, ...part} = c; yield part; }
        else if (t == 'finish') yield {type: 'finish', ...(c.finishReason && {reason: c.finishReason})};
        else if (t == 'abort') yield {type: 'finish', reason: 'abort'};
        else if (t == 'error') throw new Error('uiMessageStream: ' + (c.errorText ?? 'the server failed'));
      }
      yield* open;
    },
  };
}

/*
 * PLAN-6 L-2 (D273): encodeOpenResponses(chunks, { id?, model? }), the Open Responses SSE events
 * of a scripted reply, for a demo or test server that openResponses() reads (the docs' live
 * demo routes return `{ sse: encodeOpenResponses([...]) }`; tests serialize them as
 * `event: <type>\ndata: <JSON>\n\n`).
 *
 * Chunks are what renderComponent's `t.stream` takes: strings (text), `{ reasoning }`,
 * `{ toolCall: { id?, name, input } }`, `{ finish: reason | { reason, usage } }`, or the
 * equivalent ChatEvents (`{ type: 'text', delta }`, ...). Consecutive text chunks are one message
 * item, consecutive reasoning chunks one reasoning item (summary deltas, as Ollama streams them),
 * each tool call one function_call item. The stream ends with response.completed, or
 * response.incomplete for a 'length' / 'content-filter' finish; `usage` takes the AI SDK names
 * (inputTokens, outputTokens) or the wire names.
 */

export interface OpenResponsesEvent { type: string; sequence_number: number; [key: string]: unknown }

let n = 0;

const kind = (c: any): any =>
  typeof c == 'string' ? {k: 'text', d: c}
  : c?.type == 'text' || c?.type == 'reasoning' ? {k: c.type, d: c.delta}
  : c?.type == 'tool-call' ? {k: 'tool', c}
  : c?.type == 'finish' ? {k: 'finish', f: c}
  : c && 'reasoning' in c ? {k: 'reasoning', d: c.reasoning}
  : c && 'toolCall' in c ? {k: 'tool', c: c.toolCall}
  : c && 'finish' in c ? {k: 'finish', f: typeof c.finish == 'string' ? {reason: c.finish} : c.finish}
  : {k: 'skip'};

export function encodeOpenResponses(chunks: any[], options: {id?: string; model?: string} = {}): OpenResponsesEvent[] {
  const r = ++n, id = options.id ?? `resp_${r}`, out: any[] = [], output: any[] = [];
  let seq = 0, item: any = null, finish: any;
  const ev = (type: string, o: any) => out.push({type, sequence_number: seq++, ...o});
  const response = (status: string, extra?: any) => ({id, object: 'response', status, model: options.model ?? 'demo', output: status == 'in_progress' ? [] : output, ...extra});
  const close = () => {
    if (!item) return;
    const at = {item_id: item.id, output_index: item.i};
    if (item.type == 'message') {
      const part = {type: 'output_text', text: item.text, annotations: []};
      ev('response.output_text.done', {...at, content_index: 0, text: item.text});
      ev('response.content_part.done', {...at, content_index: 0, part});
      item.done = {id: item.id, type: 'message', role: 'assistant', status: 'completed', content: [part]};
    } else {
      const part = {type: 'summary_text', text: item.text};
      ev('response.reasoning_summary_text.done', {...at, summary_index: 0, text: item.text});
      ev('response.reasoning_summary_part.done', {...at, summary_index: 0, part});
      item.done = {id: item.id, type: 'reasoning', summary: [part]};
    }
    output.push(item.done);
    ev('response.output_item.done', {output_index: item.i, item: item.done});
    item = null;
  };
  ev('response.created', {response: response('in_progress')});
  for (const c of chunks) {
    const x = kind(c);
    let i = output.length;
    if (x.k == 'text' || x.k == 'reasoning') {
      const type = x.k == 'text' ? 'message' : 'reasoning';
      if (item?.type != type) {
        close();
        i = output.length;
        item = {type, i, id: `${type == 'message' ? 'msg' : 'rs'}_${r}_${i}`, text: ''};
        ev('response.output_item.added', {output_index: i, item: type == 'message' ? {id: item.id, type, role: 'assistant', status: 'in_progress', content: []} : {id: item.id, type, summary: []}});
        if (type == 'message') ev('response.content_part.added', {item_id: item.id, output_index: i, content_index: 0, part: {type: 'output_text', text: '', annotations: []}});
        else ev('response.reasoning_summary_part.added', {item_id: item.id, output_index: i, summary_index: 0, part: {type: 'summary_text', text: ''}});
      }
      item.text += x.d;
      ev(type == 'message' ? 'response.output_text.delta' : 'response.reasoning_summary_text.delta', {item_id: item.id, output_index: i, ...(type == 'message' ? {content_index: 0} : {summary_index: 0}), delta: x.d});
    } else if (x.k == 'tool') {
      close();
      i = output.length;
      const fid = `fc_${r}_${i}`, args = JSON.stringify(x.c.input ?? {});
      const fc = {id: fid, type: 'function_call', status: 'in_progress', call_id: x.c.id ?? `call_${r}_${i}`, name: x.c.name, arguments: ''};
      ev('response.output_item.added', {output_index: i, item: fc});
      ev('response.function_call_arguments.delta', {item_id: fid, output_index: i, delta: args});
      ev('response.function_call_arguments.done', {item_id: fid, output_index: i, arguments: args});
      output.push({...fc, status: 'completed', arguments: args});
      ev('response.output_item.done', {output_index: i, item: output[i]});
    } else if (x.k == 'finish') finish = x.f;
  }
  close();
  const u = finish?.usage, reason = finish?.reason;
  const usage = u && {input_tokens: u.inputTokens ?? u.input_tokens ?? 0, output_tokens: u.outputTokens ?? u.output_tokens ?? 0, total_tokens: u.totalTokens ?? u.total_tokens ?? (u.inputTokens ?? u.input_tokens ?? 0) + (u.outputTokens ?? u.output_tokens ?? 0)};
  if (reason == 'length' || reason == 'content-filter') ev('response.incomplete', {response: response('incomplete', {incomplete_details: {reason: reason == 'length' ? 'max_output_tokens' : 'content_filter'}, usage})});
  else ev('response.completed', {response: response('completed', {usage})});
  return out;
}

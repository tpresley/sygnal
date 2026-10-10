/**
 * The chat driver (PLAN-6 L-1, src/extra/ai/chat/driver.ts). Dev-entry-only codes
 * (DEV_CODE_SEVERITY), reported when the driver calls `__SYGNAL_DIAGNOSTICS__.chat(code, request, …)`,
 * so their text costs apps nothing:
 *
 * SYG673 — the transport yielded a known event type with the wrong shape (`why`: 'type' not an
 *          object with a string type, 'delta' not a string, 'name' a tool call with no name,
 *          'id' a tool result / error for no known call); it was skipped. The driver sends the
 *          first five per driver.
 * SYG677 — a request with no sender stamp (not sent by a component): dropped.
 * SYG675 — (info) an L-2 transport with `strict: strictSchemas` sent a tool (or the `output`
 *          schema) non-strict because it has no strict form, or (Anthropic) it is over the
 *          provider's per-request limits (`data`: { tool, errors }); once per tool and transport.
 * SYG672 — (3-W2, D285) a transport with `strict: true` (not the strictSchemas import): sent
 *          non-strict (`data`: { transport }); once per transport.
 *
 * SYG678 (a failure with no error action) and SYG679 (an invalid request) are printed by the
 * driver itself, in production too (legacy error()).
 */
import {bridge, devReport} from './shared'

const brief = (v: any) => { try { const s = JSON.stringify(v); return s && s.length > 120 ? s.slice(0, 120) + '…' : s } catch (_) { return String(v) } }
const WHY: Record<string, string> = {
  type: 'not an object with a string type',
  delta: 'its delta is not a string',
  name: 'a tool call with no tool name',
  id: 'its id matches no tool call of this reply',
}

function onChat(code: string, request: any, event?: any, why?: string) {
  const component = request && request.__emitterName
  if (code == 'SYG673') {
    devReport('SYG673', {
      component,
      message: `makeChatDriver: the transport sent a malformed ${event && typeof event.type == 'string' ? `'${event.type}' ` : ''}event (${WHY[why!] || why}): ${brief(event)}. It was skipped`,
      fix: "Fix the transport: it yields ChatEvents such as { type: 'text', delta: 'Hi' }, { type: 'tool-call', id, name, input } (see ChatEvent in sygnal/ai)",
      data: {event, reason: why},
    })
  } else if (code == 'SYG675') {
    const {tool, errors} = event || {}
    devReport('SYG675', {
      component,
      message: `strict mode: ${tool == '(output)' ? 'the output schema' : `the tool '${tool}'`} was sent non-strict: ${(errors || []).join('; ')}. The model may send arguments outside the schema; validation still checks them`,
      fix: 'Give it a strict form (an object root, no records: z.record() / additionalProperties with a schema), or accept the non-strict call',
      data: {tool, errors},
    })
  } else if (code == 'SYG672') {
    const {transport} = event || {}
    devReport('SYG672', {
      component,
      message: `${transport}({ strict: true }): strict mode takes the strict layer, strictSchemas from 'sygnal/ai' (a separate import, so apps that don't use it don't carry it), not true. The request was sent non-strict`,
      fix: `import { ${transport}, strictSchemas } from 'sygnal/ai' and pass ${transport}({ ..., strict: strictSchemas })`,
      data: {transport},
    })
  } else if (code == 'SYG677') {
    devReport('SYG677', {
      component,
      message: 'makeChatDriver: a request reached the driver from outside a component, so no reply action could reach anyone; it was dropped',
      fix: "Send chat requests from a component's model: SEND: { LLM: (state) => ({ messages: state.messages, ok: 'DONE', error: 'FAILED' }) }",
      data: {request},
    })
  }
}

/** install the hook the chat driver calls (removed by the returned function) */
export function installChatHooks(): () => void {
  const core = bridge()
  if (!core) return () => {}
  core.chat = onChat
  return () => { if (core.chat === onChat) core.chat = undefined }
}

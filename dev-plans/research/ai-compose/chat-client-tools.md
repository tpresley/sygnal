# 0-S3: client tools and `ask` in `chat` (design)

PLAN-9 spike 0-S3, 2026-10-11. This is a design pass: no repo files changed. A throwaway probe checked
what goes on the wire (below). It is the design for H-1 (client tools) and H-2 (`ask`).

## H-1 types (`src/ai.d.ts`)

```ts
interface ChatClientTool { description: string; inputSchema: JsonSchema | StandardSchemaV1 }
interface ChatOptions { …; clientTools?: Record<string, ChatClientTool>; ask?: ChatAskOptions }
interface ChatActions { …
  TOOL_OUTPUT: { toolCallId: string; output: unknown } | { toolCallId: string; errorText: string }  // = AI SDK 7 addToolOutput
  TOOL_CALL: ChatCall                       // host entry (= onToolCall), once per client call when it opens
  ANSWER: { scope: string; node: string; value: unknown }   // compose.answer(props, value)
}   // internal: CARD, CARD_FAILED, RESUME
export function openToolCalls(s: ChatState): ToolPart[]   // derived; ChatState gets no new field
```

The plan's `TOOL_RESULT` becomes **`TOOL_OUTPUT`**, for two reasons. AI SDK 7.0.137 deprecates
`addToolResult` in favour of `addToolOutput`, and `RESULTS` is already an internal action name.

## H-1 rules

1. **Tools in the request:** the agent tools plus `clientTools`. When a name is in both, the client
   tool wins, with SYG684. Client tools don't need the agent link, so they also work under SYG442.
2. **Splitting a reply's calls.** `replyStep` splits `openCalls(m)` by name.
   - Agent calls run through `runTools` as today.
   - Client calls stay `input-available`. A Standard Schema input that fails validation closes at
     once as `output-error` with the issues, so the model can repair it.
   - Each client call opens with a `TOOL_CALL` host entry.
3. **When the next request goes:** only when the last message has no `input-available` and no
   `approval-requested` part. `resultsStep`, `answerStep` and TOOL_OUTPUT all use this one test,
   so whichever finishes last sends, with `continue: true`.
4. **Status:** `'ready'` while only the user's answer is outstanding (as in the AI SDK). DONE is not
   dispatched, because the turn isn't over. Agent calls still running, or a card composing, mean
   `'streaming'`.
5. **TOOL_OUTPUT** is accepted only for an `input-available` client part in the last assistant
   message. The check is on state, so it needs no engine turn and works after a reload. Anything else
   does nothing and raises SYG685 (dev). `errorText` gives `output-error`.
6. **STOP:** the guard becomes `busy || openToolCalls.length`. Open client calls close as
   `output-error` "not answered: stopped by the user". Nothing is sent.
7. **SEND:** `closeOpen` closes them as "not answered: the user sent a new message". The new user
   message follows, and the model sees that its question was ignored.
8. **REGENERATE** drops the assistant message, and the open call with it. Late card replies are
   dropped by rule 5's guard.
9. **APPROVE / DENY** act on `pending` only and are independent of client calls; rule 3 combines them.
10. **FAILED** closes as today. Client calls are never open while a chat request is in flight.
11. **maxSteps:** past the limit, client calls close as "not run: the step limit…". The request sent
    after the answers counts as one step.
12. **Reload** (`persist()` restores the whole slice): an internal `RESUME` at start turns `submitted`
    or `streaming` into `ready`. Today a restored busy status probably locks SEND (reasoned, not
    verified: check it as a possible existing bug). A card left in `composing` is composed again from
    `part.input.need`, and open calls stay answerable.

## H-2: `chat({ ask: { catalog, backend?, instructions?, direct? } })`

- **The tool:** `ask_user`, input `{ need: string (≤ 300) }`, required, `additionalProperties: false`.
  Description: "Ask the user and wait for their answer: a choice, a pick among the app's items, a
  short form or a confirmation. Say in one sentence what you need from them; the app shows a card for
  it. Prefer this to asking in text when the answer is one of a few options or structured."
- **Where the card lives:** on the part, as `part.ui = { status: 'composing'|'open'|'answered'|'failed'|'cancelled', layout, local, ui, answer: { node, part, value } | null, pending? }`.
- **Composing the card.**
  - The request is the builder layer's `backend.start({ catalog, state, prompt: need, names })`,
    sent on `backend.sink`. For `compose.llm()` that is the chat's own sink, as a structured-output
    request.
  - It uses key `${k}.ask:${toolCallId}`, `ok: ${k}.CARD` and `error: ${k}.CARD_FAILED`. The
    separate key keeps it out of the chat run, and the reply's key identifies the card.
  - Cards compose one at a time. REPLY's sink sends the first, and each CARD sends the next
    `backend.reply` step or the next card, because an action has one value per sink.
  - With no backend the default is `compose.llm()` on the chat sink. `direct: true` makes the tool
    input the layout instead (H-3).
- **Answering.**
  - The behavior's intent merges `CHILD.select` of the catalog's `result` components, filtered by
    `scope`. Cards render in the host view, so the host can `CHILD.select` them too.
  - ANSWER guard: the part is open and `ui.status === 'open'`. The part becomes
    `output-available` with `output: { part, answer }` and `ui.status: 'answered'`, then rule 3
    applies.
- **When composing fails** (CARD_FAILED, or an invalid layout after repair): `output-error` with
  errorText "could not show a card: <reason>; ask in text instead", and `ui.status: 'failed'`. The
  turn continues.
- **Cancel** (STOP, SEND): `ui.status: 'cancelled'`, then rules 6 and 7.
- **Rendering:** `askCard(catalog, state, part, { key = 'assistant' })` is
  `catalog.render(part.ui, state, { scope: part.toolCallId, frozen: part.state !== 'input-available' || part.ui.status !== 'open', at: lens to the part by toolCallId })`.
  `local` writes go through that lens.

## Transports

- **uiMessageStream** sends the parts as they are, `ui` included (checked with a probe).
  - AI SDK 7.0.137 `validateUIMessages` accepts the extra key, but leaves it out of the copy it
    returns (checked).
  - `convertToModelMessages` gives a tool call plus a tool result `{ part, answer }` (checked).
  - The server declares client tools without `execute`.
  - A route that stores conversations must store `body.messages` raw to keep the cards.
- **openResponses / chatCompletions** send only input and output, so `ui` never goes (checked). An
  open part would go out as a `function_call` with no output, which providers reject. That is why
  rule 3 holds, and why SEND closes open calls first.

## Compatibility

- With no `clientTools` and no `ask`, code paths, state shape, requests and timing are unchanged.
- The only shared edits are generalizing the "can send" test and the STOP guard. Both reduce to
  today's logic when there are no client calls. The existing chat tests are the regression gate.

## Diagnostics (from the reserved SYG680–689)

- **SYG684** (warn, dev): a client tool name shadows an agent tool.
- **SYG685** (warn, dev): TOOL_OUTPUT or ANSWER for a call that isn't open.
- **SYG686** (warn): an `ask` catalog with no `result` part.

## Open questions (recommendation in brackets)

1. Call the option `clientTools` or `tools`? [`clientTools`: `tools` would be confused with agent
   tools.]
2. Should the compose request see the conversation, or only `need` plus app state? [Only `need` plus
   app state.]
3. Should STOP abort card composes? The driver's `abort` takes one key. [Add `abort: string[]` to the
   driver; until then the guard drops the replies.]
4. Should uiMessageStream strip `ui`? [No; document "store it raw".]
5. Should `ask_user` calls fire TOOL_CALL too? [Yes, for uniformity.]

## Verified vs. reasoned

- **Verified with the probe:** what each transport sends for a tool part carrying `ui`, and AI SDK 7
  validation and conversion.
- **Verified by reading:** the AI SDK names `addToolOutput` and `onToolCall`.
- **Reasoned from `behavior.ts`:** that the loop can hold a step open. Today every open call is run,
  or closed when there is no engine, so H-1 needs the split in rule 2. Prove it first in H-1.

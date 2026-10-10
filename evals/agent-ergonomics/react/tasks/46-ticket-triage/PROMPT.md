The support inbox in `src/` lists open tickets. Triage them with a decision model, and let a chat model settle the tickets the decision model is unsure about.

The server has two routes:

- `POST /api/decide` forwards a decision request to the decision API (the dictionary form of `/v1/systemone`, which holds the API key). The JSON body:

  ```json
  {
    "model": "jev-latest",
    "state": "<the ticket's text>",
    "questions": {
      "topic": { "type": "choice", "instructions": "…", "criteria": { "billing": "…", "bug": "…", "account": "…" } },
      "urgent": { "type": "noul", "instructions": "…", "criteria": { "true": "…", "false": "…" } }
    }
  }
  ```

  The question names, their types and the option names `billing`, `bug` and `account` are fixed; the instructions and the criteria texts are yours to write. The reply looks like `{ "model": "jev-latest", "answers": { "topic": { "type": "choice", "choice": "billing", "probabilities": { "billing": 0.9, "bug": 0.06, "account": 0.04 }, "confidence": 0.82 }, "urgent": { "type": "noul", "noul": 0.71 } }, "usage": { … } }`: `choice` is the most likely option, `confidence` (0 to 1) how sure the model is of it, and `noul` the probability that the ticket is urgent.
- `POST /api/chat` is an AI SDK 7 route for a chat model (`streamText(...).toUIMessageStreamResponse()`): AI SDK UI messages in (`{ "messages": [...] }`), the reply streamed back with the UI message stream protocol.

What the inbox does:

- When the app opens it triages every ticket: one `/api/decide` request per ticket, all sent at once (none waits for another). Each ticket has a `.topic` element, which reads "Triaging…" while its request is pending.
- With a topic confidence of 0.6 or more, `.topic` shows the topic: "Billing", "Bug" or "Account". A ticket whose urgent probability is 0.5 or more shows "Urgent" in a `.urgent` element; other tickets have no `.urgent` element.
- Below 0.6 the decision isn't trusted: `.topic` reads "Asking the assistant…" and the app sends one `/api/chat` request whose only user message contains the ticket's text and asks for a one-word answer: billing, bug or account. When the reply is complete, `.topic` shows that topic followed by " (assistant)", e.g. "Bug (assistant)". The reply counts if, ignoring case, surrounding spaces and a trailing period, it is one of the three words; any other reply, or a failed chat request, shows "Needs review". The urgent flag comes from the decision either way. A ticket decided with enough confidence never goes to the chat model.
- The header's `.urgent-count` shows how many tickets are marked urgent: "0 urgent", "1 urgent", "2 urgent", …
- If a ticket's decision request fails (an HTTP error or a network error), its `.topic` reads "Could not triage." and the ticket has a "Retry" button, which sends that ticket's decision request again (no other ticket's) and shows "Triaging…" until the new answer arrives.

The packing list in `src/` works. Add an assistant to the page that can change the list for the user.

The server side exists: `POST /api/chat` is an AI SDK 7 route (`streamText(...).toUIMessageStreamResponse()`). It takes the conversation as AI SDK UI messages (`{ "messages": [...] }`; any other fields you put in the JSON body reach the model too) and streams the reply with the UI message stream protocol. It declares three client-side tools, without `execute` on the server: when the model calls one, the app runs it and sends the result back.

| Tool | Input | What it does |
|---|---|---|
| `packing_add_item` | `{ "name": string, "quantity": integer }` | adds an item, not packed. The name must not be blank; the quantity is from 1 to 99 |
| `item_set_packed` | `{ "id": number, "packed": boolean }` | marks the item with that id as packed or not packed |
| `item_remove` | `{ "id": number }` | removes the item with that id |

- The assistant panel: a form with a text field labelled "Ask the assistant" and a "Send" submit button. Sending clears the field and posts the conversation, the new message last. The conversation is shown in an `ol.assistant-messages`, one `li` per message with its text (the assistant's text replies included; tool calls need not be shown).
- Every request tells the model what is on the list at that moment: each item's id, name, quantity and whether it is packed, somewhere in the JSON body.
- When a reply calls tools, run them in the order they were called, with the same effect as doing it in the list by hand. Then send the conversation with their results right away, without the user doing anything, and show the reply that comes back. A call that can't be done (input that doesn't fit the table, or an id that isn't on the list) changes nothing, and its result tells the model what was wrong.
- `item_remove` needs the user's consent: show an element with `role="alertdialog"` that names the item, with "Allow" and "Deny" buttons, and wait. "Allow" removes the item. "Deny" keeps it, and the result tells the model that the user declined. Either way the dialog goes away and the results are sent.
- Everything the list could do before still works.
